import {test} from "node:test"
import assert from "node:assert/strict"
import {buildInto, sourceHash} from "../build-into.js"
import {newCharm} from "../charm.js"
import {CharmDatatype, PatternstoatDatatype} from "../datatypes.js"
import {newPatternstoat, paintWristwarmer} from "../patternstoat.js"

const handle = (url, doc) => ({url, _doc: doc, doc() { return this._doc }, change(fn) { fn(this._doc) }})
const repoOf = handles => ({
	async find(url) {
		if (!handles[url]) throw new Error(`no ${url}`)
		return handles[url]
	},
})
const immutable = text => ({immutable: text})

test("a build writes the .k, says where it came from, and links back", async () => {
	const charm = handle("charm", newCharm())
	const doc = newPatternstoat({charm: "charm"})
	paintWristwarmer(doc)
	const stoat = handle("stoat", doc)
	const k = handle("k", {content: "before"})
	const result = await buildInto(stoat, k, repoOf({charm}), {immutable})
	assert.equal(result.error, undefined)
	assert.match(k.doc().content.immutable, /^;!knitout-2/)
	assert.equal(k.doc().knitoutSource, "stoat")
	assert.equal(k.doc().knitoutSourceHash, sourceHash(stoat.doc(), charm.doc()))
	assert.equal(typeof k.doc().knitoutBuiltAt, "number")
	assert.equal(stoat.doc().knitoutTarget, "k")
	assert.equal(result.rows.length, 80)
})

test("the source hash changes when the design or the charm does", () => {
	const doc = newPatternstoat({width: 2, height: 2})
	const charm = newCharm()
	const before = sourceHash(doc, charm)
	doc.colours[0][0] = 1
	assert.notEqual(sourceHash(doc, charm), before)
	const middle = sourceHash(doc, charm)
	charm.rows[1].stitch = "7"
	assert.notEqual(sourceHash(doc, charm), middle)
})

test("no charm: an error, and the .k as it was", async () => {
	const stoat = handle("stoat", newPatternstoat())
	const k = handle("k", {content: "before"})
	const result = await buildInto(stoat, k, repoOf({}), {immutable})
	assert.deepEqual(result.error, {row: null, needle: null, message: "no charm linked"})
	assert.equal(k.doc().content, "before")
})

test("a charm that won't load is an error, not a throw", async () => {
	const stoat = handle("stoat", newPatternstoat({charm: "gone"}))
	const k = handle("k", {content: "before"})
	const result = await buildInto(stoat, k, repoOf({}), {immutable})
	assert.equal(result.error.row, null)
	assert.match(result.error.message, /^couldn't load the charm/)
	assert.equal(k.doc().content, "before")
})

test("a failed build leaves the .k as it was", async () => {
	const doc = newPatternstoat({charm: "charm", width: 2, height: 1})
	doc.colours[0] = [9, 9]
	const k = handle("k", {content: "before"})
	const result = await buildInto(handle("stoat", doc), k, repoOf({charm: handle("charm", newCharm())}), {immutable})
	assert.equal(result.error.message, "colour 9 isn't in the charm")
	assert.equal(k.doc().content, "before")
})

test("the datatypes start new docs as new ones are", () => {
	const charm = {}
	CharmDatatype.init(charm)
	assert.deepEqual(charm, (({"@patchwork": _, ...rest}) => rest)(newCharm()))
	const stoat = {}
	PatternstoatDatatype.init(stoat)
	assert.equal(stoat.width, 40)
	assert.equal(PatternstoatDatatype.getTitle({}), "patternstoat")
	assert.equal(CharmDatatype.getTitle({title: "wrist"}), "wrist")
})

test("building what's already built leaves the .k alone", async () => {
	const charm = handle("charm", newCharm())
	const doc = newPatternstoat({charm: "charm", width: 4, height: 4})
	doc.colours = doc.colours.map(row => row.map(() => 1))
	const stoat = handle("stoat", doc)
	const k = handle("k", {content: "before"})
	let changes = 0
	const change = k.change.bind(k)
	k.change = fn => {
		changes++
		change(fn)
	}
	await buildInto(stoat, k, repoOf({charm}), {immutable})
	const result = await buildInto(stoat, k, repoOf({charm}), {immutable})
	assert.equal(changes, 1)
	assert.equal(result.error, undefined)
	assert.ok(result.unchanged)
	stoat.doc().colours[0][0] = 7
	await buildInto(stoat, k, repoOf({charm}), {immutable})
	assert.equal(changes, 2)
})
