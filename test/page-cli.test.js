import {test} from "node:test"
import assert from "node:assert/strict"
import {linkFor, parseCommand} from "../scripts/page.mjs"

test("eval runs its code", () => {
	assert.deepEqual(parseCommand(["eval", "document.title"]), {
		route: "run",
		code: "document.title",
		tab: undefined,
		timeout: undefined,
	})
})

test("eval - reads the code from stdin", () => {
	const command = parseCommand(["eval", "-"])
	assert.equal(command.stdin, "code")
})

test("dom, with a depth", () => {
	const {route, code} = parseCommand(["dom", ".pane", "--depth", "3"])
	assert.equal(route, "run")
	assert.equal(code, `lattice.dom(".pane", {depth: 3})`)
})

test("dom with nothing is the body", () => {
	assert.equal(parseCommand(["dom"]).code, `lattice.dom("body", {depth: 3})`)
})

test("a selector with quotes in it stays one", () => {
	assert.equal(parseCommand(["inspect", `[title="a b"]`]).code, `lattice.inspect("[title=\\"a b\\"]")`)
})

test("add-file takes its content from stdin", () => {
	const command = parseCommand(["add-file", "automerge:abc", "swatch.js"])
	assert.equal(command.stdin, "content")
	assert.equal(command.code({content: "knit"}), `lattice.addFile("automerge:abc", "swatch.js", "knit")`)
})

test("write too", () => {
	const command = parseCommand(["write", "automerge:abc"])
	assert.equal(command.stdin, "content")
	assert.equal(command.code({content: "x"}), `lattice.write("automerge:abc", "x")`)
})

test("--tab and --timeout are carried", () => {
	const command = parseCommand(["--tab", "abc", "logs", "--timeout", "500"])
	assert.equal(command.tab, "abc")
	assert.equal(command.timeout, 500)
	assert.equal(command.code, "lattice.logs()")
})

test("tabs and link aren't runs", () => {
	assert.equal(parseCommand(["tabs"]).route, "tabs")
	assert.deepEqual(parseCommand(["link", "https://x/y?dev=z"]), {route: "link", url: "https://x/y?dev=z"})
})

test("something it doesn't know says how", () => {
	assert.throws(() => parseCommand(["knit"]), /usage/)
	assert.throws(() => parseCommand([]), /usage/)
	assert.throws(() => parseCommand(["add-file", "automerge:abc"]), /usage/)
})

test("a link has the token in its fragment, and whatever fragment it had", () => {
	assert.equal(linkFor("https://site/p?dev=https://t", "tok"), "https://site/p?dev=https://t#page=tok")
	assert.equal(linkFor("https://site/p#folder=f", "tok"), "https://site/p#folder=f&page=tok")
	assert.equal(linkFor("https://site/p#page=old", "tok"), "https://site/p#page=tok")
})
