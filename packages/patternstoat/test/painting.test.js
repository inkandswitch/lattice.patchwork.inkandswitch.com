import {test} from "node:test"
import assert from "node:assert/strict"
import {applyRecord, floodCells, recordOf, undoOf, yarnAfterPick} from "../painting.js"
import {newPatternstoat, paintColours, paintStitches} from "../patternstoat.js"

const sorted = cells => [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0])

test("fill floods the same colour, four ways, inside the grid", () => {
	const grid = [
		[1, 1, 2],
		[1, 2, 2],
		[1, 1, 1],
	]
	assert.deepEqual(sorted(floodCells(grid, 0, 0)), sorted([[0, 0], [1, 0], [0, 1], [0, 2], [1, 2], [2, 2]]))
	assert.deepEqual(floodCells(grid, 5, 0), []) // outside: nothing
})

test("fill on a big grid doesn't overflow the stack", () => {
	const grid = Array.from({length: 2000}, () => Array(252).fill(1))
	assert.equal(floodCells(grid, 0, 0).length, 2000 * 252)
})

// a stroke, as the editor keeps one: what was there, and what it painted
function stroke(doc, kind, points, paint) {
	const before = recordOf(doc, kind, points)
	paint()
	return {before, after: recordOf(doc, kind, points)}
}

test("undo puts back what a stroke replaced", () => {
	const doc = newPatternstoat({width: 3, height: 1})
	paintColours(doc, [[0, 0], [1, 0], [2, 0]], 1)
	const done = stroke(doc, "colours", [[0, 0], [1, 0]], () => paintColours(doc, [[0, 0], [1, 0]], 2))
	applyRecord(doc, undoOf(doc, done))
	assert.deepEqual(doc.colours[0], [1, 1, 1])
})

test("undo leaves a cell someone else has painted since", () => {
	const doc = newPatternstoat({width: 2, height: 1})
	paintColours(doc, [[0, 0], [1, 0]], 1)
	const done = stroke(doc, "colours", [[0, 0], [1, 0]], () => paintColours(doc, [[0, 0], [1, 0]], 2))
	paintColours(doc, [[1, 0]], 3) // someone else
	applyRecord(doc, undoOf(doc, done))
	assert.deepEqual(doc.colours[0], [1, 3])
})

test("nothing left to undo is null", () => {
	const doc = newPatternstoat({width: 1, height: 1})
	const done = stroke(doc, "colours", [[0, 0]], () => paintColours(doc, [[0, 0]], 2))
	paintColours(doc, [[0, 0]], 3)
	assert.equal(undoOf(doc, done), null)
})

test("undo and redo a stitch", () => {
	const doc = newPatternstoat({width: 2, height: 1})
	const done = stroke(doc, "stitches", [[1, 0]], () => paintStitches(doc, [[1, 0]], "f", "t"))
	applyRecord(doc, undoOf(doc, done))
	assert.equal(doc.stitches[0][1], undefined)
	applyRecord(doc, undoOf(doc, {before: done.after, after: done.before}))
	assert.deepEqual({...doc.stitches[0][1]}, {f: "t", b: null})
})

test("undo and redo a row's yarn", () => {
	const doc = newPatternstoat({width: 2, height: 3})
	const done = stroke(doc, "yarns", [[0, 1]], () => (doc.yarns[1] = "5"))
	applyRecord(doc, undoOf(doc, done))
	assert.deepEqual(doc.yarns, ["3", "3", "3"])
	applyRecord(doc, undoOf(doc, {before: done.after, after: done.before}))
	assert.deepEqual(doc.yarns, ["3", "5", "3"])
})

test("the yarn strip keeps the last yarn picked, after a colour's picked", () => {
	let yarn = "3"
	yarn = yarnAfterPick(yarn, {kind: "yarn", value: "5"})
	yarn = yarnAfterPick(yarn, {kind: "colour", value: 2})
	assert.equal(yarn, "5")
	assert.equal(yarnAfterPick("5", {kind: "yarn", value: "1"}), "1")
})
