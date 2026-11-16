import {test} from "node:test"
import assert from "node:assert/strict"
import {compile, toJSONSafe} from "../page-run.js"

test("an expression is its value", async () => {
	assert.equal(await compile("1 + 2")({}), 3)
	assert.equal(await compile("lattice.x")({x: "hi"}), "hi")
})

test("a body says what with return", async () => {
	assert.equal(await compile("const a = 2; return a * lattice.n")({n: 4}), 8)
})

test("await, in either", async () => {
	assert.equal(await compile("await Promise.resolve(5)")({}), 5)
	assert.equal(await compile("const v = await Promise.resolve(6); return v")({}), 6)
})

test("a body without return is undefined", async () => {
	assert.equal(await compile("let a = 1; a++")({}), undefined)
})

test("code that doesn't parse throws when compiled", () => {
	assert.throws(() => compile("return )("), SyntaxError)
})

test("a cycle is cut", () => {
	const a = {name: "a"}
	a.self = a
	assert.deepEqual(toJSONSafe(a), {name: "a", self: "[cycle]"})
})

test("the same thing twice isn't a cycle", () => {
	const shared = {n: 1}
	assert.deepEqual(toJSONSafe({x: shared, y: shared}), {x: {n: 1}, y: {n: 1}})
})

test("functions are named", () => {
	function knit() {}
	assert.deepEqual(toJSONSafe({knit, anon: () => {}}), {knit: "[function knit]", anon: "[function anon]"})
})

test("maps, sets, and undefined", () => {
	assert.deepEqual(toJSONSafe(new Map([["a", 1]])), {a: 1})
	assert.deepEqual(toJSONSafe(new Set([1, 2])), [1, 2])
	assert.deepEqual(toJSONSafe({u: undefined, n: null}), {n: null})
	assert.equal(toJSONSafe(undefined), null)
	assert.equal(toJSONSafe(10n), "10n")
})

test("an error says what and where", () => {
	const safe = toJSONSafe(new TypeError("no yarn"))
	assert.equal(safe.error, "TypeError: no yarn")
	assert.match(safe.stack, /page-run\.test\.js/)
})

test("deep things stop", () => {
	const deep = {a: {b: {c: {d: 1}}}}
	assert.deepEqual(toJSONSafe(deep, {depth: 2}), {a: {b: "[object]"}})
})

test("long lists and long strings are cut, saying how much", () => {
	const list = toJSONSafe(Array.from({length: 10}, (_, i) => i), {items: 3})
	assert.deepEqual(list, [0, 1, 2, "…7 more"])
	assert.equal(toJSONSafe("abcdef", {chars: 3}), "abc…(3 more)")
})
