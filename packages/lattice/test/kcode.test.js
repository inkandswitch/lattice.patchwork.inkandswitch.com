import {test} from "node:test"
import assert from "node:assert/strict"
import {buildKcode} from "../kcode.js"
import {docText, textHash} from "../files.js"
import {knitoutToKcode} from "../../knitoutjs/core/vendor/knitout-to-kcode.js"

const KNITOUT = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", "x-patchwork-sources automerge:js#1", "in 3", "knit + f1 3", "knit + f2 3", "out 3"].join("\n")

// a handle that's only a doc, changed in place
function fakeHandle(url, doc, {heads = ["h"]} = {}) {
	const changes = []
	return {
		url,
		doc: () => doc,
		heads: () => heads,
		view: at => ({url: `${url}#${at.join("|")}`, doc: () => doc}),
		change(fn) {
			changes.push(fn)
			fn(doc)
		},
		changes,
	}
}

test("the kcode says where it came from", async () => {
	const k = fakeHandle("automerge:k", {name: "pattern.k", content: KNITOUT, knitoutSources: ["automerge:js#1"]})
	const kc = fakeHandle("automerge:kc", {name: "pattern.kc", content: ""})
	const before = Date.now()
	const result = await buildKcode(k, kc, async () => ({kcode: "kcode body", warnings: []}))
	assert.equal(result.error, undefined)
	assert.deepEqual(result.warnings, [])
	const text = docText(kc.doc())
	assert.ok(text.startsWith("// x-patchwork-sources automerge:k#h automerge:js#1\n"), text)
	assert.equal(text, "// x-patchwork-sources automerge:k#h automerge:js#1\nkcode body")
	// stored whole, as a .k a pattern writes is
	assert.equal(typeof kc.doc().content, "object")
	assert.equal(kc.doc().kcodeSource, "automerge:k")
	assert.equal(kc.doc().kcodeSourceHash, textHash(KNITOUT))
	assert.ok(kc.doc().kcodeBuiltAt >= before)
	assert.deepEqual([...kc.doc().kcodeSources], ["automerge:k#h", "automerge:js#1"])
	assert.equal(k.doc().kcodeTarget, "automerge:kc")
})

test("a .k that knows where it goes isn't changed again", async () => {
	const k = fakeHandle("automerge:k", {name: "pattern.k", content: KNITOUT, kcodeTarget: "automerge:kc"})
	const kc = fakeHandle("automerge:kc", {name: "pattern.kc", content: ""})
	await buildKcode(k, kc, async () => ({kcode: "kcode body", warnings: []}))
	assert.equal(k.changes.length, 0)
	// one with no sources of its own is still the first of the .kc's
	assert.deepEqual([...kc.doc().kcodeSources], ["automerge:k#h"])
})

test("the .k is converted as it was when it was pinned", async () => {
	let doc = {name: "pattern.k", content: KNITOUT}
	const k = {
		...fakeHandle("automerge:k", doc),
		doc: () => doc,
		view: () => ({url: "automerge:k#h", doc: () => ({name: "pattern.k", content: "pinned"})}),
	}
	const kc = fakeHandle("automerge:kc", {name: "pattern.kc", content: ""})
	let converted
	await buildKcode(k, kc, async text => {
		converted = text
		return {kcode: "kcode body", warnings: []}
	})
	assert.equal(converted, "pinned")
	assert.equal(kc.doc().kcodeSourceHash, textHash("pinned"))
})

test("a failed conversion changes nothing", async () => {
	const k = fakeHandle("automerge:k", {name: "pattern.k", content: KNITOUT, knitoutSources: ["automerge:js#1"]})
	const kc = fakeHandle("automerge:kc", {name: "pattern.kc", content: "what it was"})
	const result = await buildKcode(k, kc, async () => ({error: "7 ERROR: no\nmore", warnings: ["hm"]}))
	assert.equal(result.error, "7 ERROR: no\nmore")
	assert.deepEqual(result.warnings, ["hm"])
	assert.equal(kc.changes.length, 0)
	assert.equal(k.changes.length, 0)
	assert.equal(docText(kc.doc()), "what it was")
})

test("the converter skips the sources line quietly", () => {
	const warned = []
	const {warn, log} = console
	console.warn = (...args) => warned.push(args.join(" "))
	console.log = () => {}
	try {
		knitoutToKcode(KNITOUT, "pattern", {})
	} finally {
		console.warn = warn
		console.log = log
	}
	assert.deepEqual(
		warned.filter(line => line.includes("x-patchwork-sources")),
		[],
	)
})
