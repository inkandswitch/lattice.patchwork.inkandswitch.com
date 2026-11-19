import {test} from "node:test"
import assert from "node:assert/strict"
import {assignments} from "./assignments.js"
import {fieldsOf, newPatternstoat, paintColours, paintStitches, paintWristwarmer, resize, setYarns} from "../patternstoat.js"

test("a new patternstoat is out of work everywhere, in yarn 3, half gauge", () => {
	const doc = newPatternstoat({width: 3, height: 2})
	assert.equal(doc["@patchwork"].type, "lattice:patternstoat")
	assert.deepEqual(doc.colours, [[0, 0, 0], [0, 0, 0]])
	assert.deepEqual(doc.yarns, ["3", "3"])
	assert.deepEqual(doc.stitches, {0: {}, 1: {}})
	assert.equal(doc.gauge, 2)
	assert.equal(doc.charm, null)
})

test("painting assigns only the cells it touches", () => {
	const doc = newPatternstoat({width: 4, height: 2})
	const rowBefore = doc.colours[1]
	paintColours(doc, [[1, 0], [2, 0]], 1)
	assert.deepEqual(doc.colours, [[0, 1, 1, 0], [0, 0, 0, 0]])
	assert.equal(doc.colours[1], rowBefore) // the untouched row is the same array
})

test("fields are runs of one colour", () => {
	assert.deepEqual(fieldsOf([0, 1, 1, 2, 2, 2, 1, 0]), [
		{colour: 1, start: 1, end: 2},
		{colour: 2, start: 3, end: 5},
		{colour: 1, start: 6, end: 6},
	])
})

test("stitches paint a bed at a time, and rubbing both out takes the cell away", () => {
	const doc = newPatternstoat({width: 4, height: 2})
	paintStitches(doc, [[1, 0]], "f", "t")
	paintStitches(doc, [[1, 0]], "b", "k")
	assert.deepEqual(doc.stitches[0], {1: {f: "t", b: "k"}})
	paintStitches(doc, [[1, 0]], "f", null)
	assert.deepEqual(doc.stitches[0], {1: {f: null, b: "k"}})
	paintStitches(doc, [[1, 0]], "b", null)
	assert.deepEqual(doc.stitches, {0: {}, 1: {}})
})

test("yarns are set over rows, inclusive", () => {
	const doc = newPatternstoat({width: 1, height: 4})
	setYarns(doc, 1, 2, "5")
	assert.deepEqual(doc.yarns, ["3", "5", "5", "3"])
})

test("resizing keeps a yarn a row, and drops stitches outside", () => {
	const doc = newPatternstoat({width: 3, height: 2})
	doc.yarns[1] = "4"
	paintStitches(doc, [[2, 1]], "f", "t")
	resize(doc, 2, 5)
	assert.deepEqual(doc.yarns, ["3", "4", "4", "4", "4"])
	assert.equal(doc.colours.length, 5)
	assert.ok(doc.colours.every(row => row.length === 2))
	assert.deepEqual(doc.stitches[1], {})
	resize(doc, 2, 1)
	assert.deepEqual(doc.yarns, ["3"])
	assert.equal(doc.height, 1)
})

test("the wristwarmer: a thumb slit cast off and straight back on, stripes, ends cast on and off", () => {
	const doc = newPatternstoat()
	paintWristwarmer(doc)
	assert.equal(doc.width, 40)
	assert.equal(doc.height, 80)
	assert.ok(doc.colours[0].every(c => c === 5))
	assert.deepEqual(doc.colours[50].slice(3, 11), [1, 3, 3, 3, 3, 3, 3, 1])
	assert.deepEqual(doc.colours[51].slice(3, 11), [1, 4, 4, 4, 4, 4, 4, 1])
	assert.equal(doc.colours[52][4], 1)
	assert.deepEqual([doc.yarns[5], doc.yarns[10], doc.yarns[16], doc.yarns[22]], ["1", "3", "4", "3"])
	assert.ok(doc.colours[79].every(c => c === 6))
	assert.equal(doc.yarns[79], "3")
})

test("painting a stitch into an empty row assigns only the cell, never the row's map", () => {
	const doc = newPatternstoat({width: 4, height: 2})
	const seen = assignments(doc, d => paintStitches(d, [[1, 0]], "f", "t"))
	assert.deepEqual(seen.filter(s => s.object).map(s => s.path), ["stitches.0.1"])
	const rubbed = assignments(doc, d => paintStitches(d, [[1, 0]], "f", null))
	assert.ok(rubbed.every(s => s.path !== "stitches.0"), "a row's map is never deleted")
	assert.deepEqual(doc.stitches[0], {})
})

test("resizing keeps a stitch map a row", () => {
	const doc = newPatternstoat({width: 2, height: 2})
	resize(doc, 2, 4)
	assert.deepEqual(Object.keys(doc.stitches).sort(), ["0", "1", "2", "3"])
	resize(doc, 2, 1)
	assert.deepEqual(Object.keys(doc.stitches), ["0"])
})

test("painting never writes past a row's end (a row two resizes left short)", () => {
	const doc = newPatternstoat({width: 4, height: 1})
	doc.colours[0].splice(3, 1) // as two people resizing at once can leave it
	const seen = assignments(doc, d => paintColours(d, [[3, 0], [1, 0]], 1))
	assert.deepEqual(seen.map(s => s.path), ["colours.0.1"])
})
