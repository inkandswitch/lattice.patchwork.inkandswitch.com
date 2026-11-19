import {test} from "node:test"
import assert from "node:assert/strict"
import {applyCharm, parseCharm, printCharm} from "../charm-text.js"
import {newCharm} from "../charm.js"

const ids = charm => charm.rows.map(r => r.id)

test("a new charm prints and parses back to itself", () => {
	const charm = newCharm()
	const parsed = parseCharm(printCharm(charm), ids(charm))
	assert.equal(parsed.error, undefined)
	assert.deepEqual(parsed.columns, charm.columns)
	assert.deepEqual(parsed.rows, charm.rows)
	assert.deepEqual(parsed.cells, charm.cells)
})

test("the starter prints as rules a colour", () => {
	const lines = printCharm(newCharm()).split("\n")
	assert.equal(lines[0], "rows: > +<")
	assert.equal(lines[1], "<> 1 tube #8e7cc3 (k/. ./k)")
	assert.equal(lines[2], '<> 2 "back only" #6fa8dc (./. ./k)')
	assert.equal(lines[7], '<> 7 "as painted" #a4a19a (*/. ./*)')
})

test("a wide column with an anchor, and rows with settings and a fixed yarn", () => {
	const text = 'rows: > +<[s6 v100 r100 y5] ~\n<> 9 "ilana\'s tile" #4caf50 x3 *| (t/.,k/.,./. ./.,./k,t/. ./.,./.,./.)\n'
	const parsed = parseCharm(text)
	assert.equal(parsed.error, undefined)
	assert.deepEqual(parsed.columns, [{colour: 9, name: "ilana's tile", hex: "#4caf50", width: 3, anchor: "colour-right", order: 0}])
	assert.deepEqual(parsed.rows.map(({id, ...r}) => r), [
		{ref: true, dir: "+", yarn: "row", stitch: null, speed: null, roller: null},
		{ref: false, dir: "-", yarn: "5", stitch: "6", speed: "100", roller: "100"},
		{ref: true, dir: "~", yarn: "row", stitch: null, speed: null, roller: null},
	])
	assert.equal(printCharm(parsed), text)
})

test("the pattern-edge anchors print as ||* and *||, and ‖ reads as ||", () => {
	const parsed = parseCharm("rows: >\n<> 9 tile #4caf50 x2 ‖* (k/.,t/.)\n<> 8 other #4caf51 *|| (k/.)")
	assert.deepEqual(parsed.columns.map(c => c.anchor), ["pattern-left", "pattern-right"])
	assert.match(printCharm(parsed), /^<> 9 tile #4caf50 x2 \|\|\* \(k\/\.,t\/\.\)$/m)
})

test("a bad cell says its line, and nothing's applied", () => {
	const doc = newCharm()
	const before = structuredClone(doc)
	const result = parseCharm("rows: > +<\n<> 1 tube #8e7cc3 (q/. ./k)")
	assert.equal(result.error.line, 2)
	assert.match(result.error.message, /what's "q"\?/)
	assert.deepEqual(doc, before)
})

test("errors name what's wrong and where", () => {
	assert.deepEqual(parseCharm("<> 1 tube #8e7cc3 (k/.)").error, {line: 1, message: "rows: has to come first"})
	assert.deepEqual(parseCharm("rows: +>").error, {line: 1, message: "the first row has to be a reference row"})
	assert.deepEqual(parseCharm("rows: > +<\n<> 1 tube #8e7cc3 (k/.)").error, {line: 2, message: "colour 1 has 1 row's cells, the charm has 2 rows"})
	assert.deepEqual(parseCharm("rows: >\n<> 1 a #8e7cc3 (k/.)\n\n<> 1 b #8e7cc3 (k/.)").error, {line: 4, message: "colour 1 twice"})
	assert.deepEqual(parseCharm("rows: >\n<> 1 a #8e7cc3 x2 (k/.)").error, {line: 2, message: "colour 1 is 2 wide, its row 1 has 1 cell"})
})

test("comments and blank lines are fine", () => {
	const parsed = parseCharm("; the tube\nrows: > +< ; a pass each way\n\n<> 1 tube #8e7cc3 (k/. ./k) ; knit round\n")
	assert.equal(parsed.error, undefined)
	assert.equal(parsed.columns.length, 1)
})

test("applying keeps row ids and only changes what's different", () => {
	const doc = newCharm()
	const tubeCells = doc.cells[1]
	const text = printCharm(doc).replace('"back only"', '"back to front"')
	applyCharm(doc, parseCharm(text, ids(doc)))
	assert.deepEqual(ids(doc), ["a", "b"])
	assert.equal(doc.columns[1].name, "back to front")
	assert.equal(doc.cells[1], tubeCells)
})

test("a column taken out of the text is taken out of the charm", () => {
	const doc = newCharm()
	const text = printCharm(doc).split("\n").filter(line => !line.startsWith("<> 3 ")).join("\n")
	applyCharm(doc, parseCharm(text, ids(doc)))
	assert.deepEqual(doc.columns.map(c => c.colour), [1, 2, 4, 5, 6, 7])
	assert.equal(doc.cells[3], undefined)
})

test("a row added in the text is added, and its cells with it", () => {
	const doc = newCharm()
	const text = printCharm(doc)
		.replace("rows: > +<", "rows: > +< +~")
		.split("\n")
		.map(line => (line.startsWith("<> 1 ") ? line.replace(/\)$/, " t/.)") : line.startsWith("<>") ? line.replace(/\)$/, " ./.)") : line))
		.join("\n")
	const parsed = parseCharm(text, ids(doc))
	assert.equal(parsed.error, undefined, parsed.error?.message)
	applyCharm(doc, parsed)
	assert.equal(doc.rows.length, 3)
	assert.deepEqual(doc.cells[1][doc.rows[2].id], [{f: "t", b: null}])
	assert.deepEqual(doc.cells[2][doc.rows[2].id], [{f: null, b: null}])
})
