import assert from "node:assert/strict"
import {describe, it} from "node:test"
import xterm from "@xterm/headless"
import {history} from "../history.js"

const ROWS = 10

function terminal(scrollback) {
	return new xterm.Terminal({cols: 40, rows: ROWS, scrollback, allowProposedApi: true})
}

const write = (term, data) => new Promise(done => term.write(data, done))

// lines "line 0" to "line to - 1", from line from
async function lines(term, from, to, marks) {
	for (let n = from; n < to; n++) {
		await write(term, `${n ? "\r\n" : ""}line ${n}`)
		marks?.mark()
	}
}

const text = line => line.translateToString(true)

describe("history", () => {
	it("numbers what's scrolled off from 0", async () => {
		const term = terminal(100)
		const scrollback = history(term)
		await lines(term, 0, 30)
		scrollback.mark()
		assert.equal(scrollback.count(), 30 - ROWS)
		assert.equal(scrollback.top(), 30 - ROWS)
		const [first, got] = scrollback.lines(0, 3)
		assert.equal(first, 0)
		assert.deepEqual(got.map(text), ["line 0", "line 1", "line 2"])
	})

	it("keeps the numbers as the scrollback fills and drops its oldest", async () => {
		const term = terminal(20)
		const scrollback = history(term)
		await lines(term, 0, 200, scrollback)
		const epoch = scrollback.epoch
		const top = scrollback.top()
		assert.equal(top, 200 - ROWS)
		// the line above the screen is the one it's numbered
		const [above, [line]] = scrollback.lines(top - 1, top)
		assert.equal(above, top - 1)
		assert.equal(text(line), `line ${top - 1}`)
		// what's gone from the scrollback isn't there
		const [first, got] = scrollback.lines(0, top)
		assert.equal(first, top - 20)
		assert.equal(text(got[0]), `line ${top - 20}`)
		assert.equal(scrollback.epoch, epoch)
	})

	it("counts again when more scrolls by than it keeps between marks", async () => {
		const term = terminal(20)
		const scrollback = history(term)
		await lines(term, 0, 30)
		scrollback.mark()
		const epoch = scrollback.epoch
		await lines(term, 30, 100)
		scrollback.mark()
		assert.equal(scrollback.epoch, epoch + 1)
		// numbered from the oldest line still kept
		const [first, [line]] = scrollback.lines(0, 1)
		assert.equal(first, 0)
		assert.equal(text(line), `line ${100 - ROWS - 20}`)
	})

	it("counts again after forgetting (a resize rewraps it)", async () => {
		const term = terminal(100)
		const scrollback = history(term)
		await lines(term, 0, 30)
		scrollback.mark()
		const epoch = scrollback.epoch
		term.resize(20, ROWS)
		scrollback.forget()
		scrollback.mark()
		assert.equal(scrollback.epoch, epoch + 1)
	})

	it("leaves the history alone while the alternate screen's up", async () => {
		const term = terminal(100)
		const scrollback = history(term)
		await lines(term, 0, 30)
		scrollback.mark()
		const top = scrollback.top()
		await write(term, "\x1b[?1049h")
		await write(term, "a\r\nb\r\nc\r\n".repeat(20))
		scrollback.mark()
		assert.equal(term.buffer.active.type, "alternate")
		assert.equal(scrollback.top(), top)
		await write(term, "\x1b[?1049l")
		scrollback.mark()
		assert.equal(scrollback.top(), top)
		const [, [line]] = scrollback.lines(top - 1, top)
		assert.equal(text(line), `line ${top - 1}`)
	})

	it("keeps counting through the screen being erased (ctrl-l)", async () => {
		const term = terminal(100)
		const scrollback = history(term)
		await lines(term, 0, 30)
		scrollback.mark()
		const epoch = scrollback.epoch
		const top = scrollback.top()
		await write(term, "\x1b[H\x1b[2J")
		scrollback.mark()
		assert.equal(scrollback.epoch, epoch)
		assert.equal(scrollback.top(), top)
		const [, [line]] = scrollback.lines(top - 1, top)
		assert.equal(text(line), `line ${top - 1}`)
	})

	it("counts again when the scrollback's cleared (clear)", async () => {
		const term = terminal(100)
		const scrollback = history(term)
		await lines(term, 0, 30)
		scrollback.mark()
		const epoch = scrollback.epoch
		// what `clear` sends: home, erase the screen, erase the scrollback
		await write(term, "\x1b[H\x1b[2J\x1b[3J")
		scrollback.mark()
		assert.equal(scrollback.count(), 0)
		assert.equal(scrollback.epoch, epoch + 1)
		await write(term, Array.from({length: 30}, (_, n) => `after ${n}`).join("\r\n"))
		scrollback.mark()
		const top = scrollback.top()
		const [, got] = scrollback.lines(0, top)
		assert.equal(text(got.at(-1)), `after ${30 - ROWS - 1}`)
	})

	it("sends no more than it's asked for, nor past max", async () => {
		const term = terminal(100)
		const scrollback = history(term)
		await lines(term, 0, 60)
		scrollback.mark()
		const [first, got] = scrollback.lines(0, 50, 10)
		assert.equal(first, 40)
		assert.equal(got.length, 10)
		assert.deepEqual(scrollback.lines(60, 70), [null, []])
	})
})
