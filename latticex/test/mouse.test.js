import assert from "node:assert/strict"
import {describe, it} from "node:test"
import xterm from "@xterm/headless"
import {mouse} from "../mouse.js"

function terminal() {
	const term = new xterm.Terminal({cols: 200, rows: 10, allowProposedApi: true})
	return {term, encode: mouse(term)}
}

const write = (term, data) => new Promise(done => term.write(data, done))
const text = bytes => bytes.toString("latin1")

describe("mouse", () => {
	it("sends nothing until the program asks", () => {
		const {encode} = terminal()
		assert.equal(encode({action: "down", button: 0, x: 1, y: 1}).length, 0)
	})

	it("says presses, releases and the wheel in sgr", async () => {
		const {term, encode} = terminal()
		// what tmux turns on: presses, drags, sgr
		await write(term, "\x1b[?1002h\x1b[?1006h")
		assert.equal(text(encode({action: "down", button: 0, x: 4, y: 2})), "\x1b[<0;5;3M")
		assert.equal(text(encode({action: "move", button: 0, x: 5, y: 2})), "\x1b[<32;6;3M")
		assert.equal(text(encode({action: "up", button: 0, x: 5, y: 2})), "\x1b[<0;6;3m")
		assert.equal(text(encode({action: "wheelup", x: 0, y: 0})), "\x1b[<64;1;1M")
		assert.equal(text(encode({action: "wheeldown", x: 0, y: 0, ctrl: true})), "\x1b[<81;1;1M")
	})

	it("leaves out what the program's mode doesn't report", async () => {
		const {term, encode} = terminal()
		// vt200: presses and releases, no movement
		await write(term, "\x1b[?1000h\x1b[?1006h")
		assert.equal(encode({action: "move", button: 0, x: 5, y: 2}).length, 0)
		assert.notEqual(encode({action: "down", button: 2, x: 5, y: 2}).length, 0)
	})

	it("says the oldest encoding as bytes, past column 95 too", async () => {
		const {term, encode} = terminal()
		await write(term, "\x1b[?1000h")
		const bytes = encode({action: "down", button: 0, x: 150, y: 0})
		assert.deepEqual([...bytes], [0x1b, 0x5b, 0x4d, 32, 32 + 151, 32 + 1])
	})

	it("ignores what isn't an event", async () => {
		const {term, encode} = terminal()
		await write(term, "\x1b[?1003h\x1b[?1006h")
		assert.equal(encode({action: "explode", x: 1, y: 1}).length, 0)
		assert.equal(encode({action: "down", x: "1", y: 1}).length, 0)
		assert.equal(encode(null).length, 0)
	})
})
