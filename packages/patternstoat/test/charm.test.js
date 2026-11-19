import {test} from "node:test"
import assert from "node:assert/strict"
import {addColumn, addRow, cellAt, columnOf, groupsOf, newCharm, paintCell, removeColumn, removeRow, setColumn, setRow} from "../charm.js"

test("a new charm has the wristwarmer's colours, a tube a row and a +1", () => {
	const charm = newCharm()
	assert.equal(charm["@patchwork"].type, "lattice:charm")
	assert.deepEqual(charm.columns.map(c => c.colour), [1, 2, 3, 4, 5, 6, 7])
	assert.deepEqual(groupsOf(charm).map(g => g.map(r => r.id)), [["a", "b"]])
	assert.deepEqual(charm.cells[1].a, [{f: "k", b: null}])
	assert.deepEqual(charm.cells[1].b, [{f: null, b: "k"}])
	assert.deepEqual(charm.cells[7].a, [{f: "*", b: null}])
	assert.deepEqual(charm.cells[6].b, [{f: null, b: "co"}])
})

test("a tile repeats from each anchor, cut off away from it", () => {
	// a 3-wide column, field x 2..8 (7 wide), pattern 13 wide
	const charm = newCharm()
	addColumn(charm, {colour: 9, name: "tile", hex: "#4caf50", width: 3})
	for (let i = 0; i < 3; i++) paintCell(charm, 9, "a", i, "f", ["k", "t", "m"][i])
	const field = {start: 2, end: 8}
	const run = anchor => {
		setColumn(charm, 9, {anchor})
		const column = columnOf(charm, 9)
		return [2, 3, 4, 5, 6, 7, 8].map(x => cellAt(charm, column, "a", x, field, 13).f).join("")
	}
	assert.equal(run("colour-left"), "ktmktmk")
	assert.equal(run("colour-right"), "mktmktm")
	assert.equal(run("pattern-left"), "mktmktm") // x mod 3: 2 is "m"
	assert.equal(run("pattern-right"), "tmktmkt") // 2 - ((12 - x) mod 3)
})

test("a missing cell is nothing on both beds", () => {
	const charm = newCharm()
	assert.deepEqual(cellAt(charm, columnOf(charm, 2), "a", 0, {start: 0, end: 0}, 1), {f: null, b: null})
})

test("removing a column takes its cells", () => {
	const charm = newCharm()
	removeColumn(charm, 3)
	assert.equal(columnOf(charm, 3), undefined)
	assert.equal(charm.cells[3], undefined)
})

test("widening a column pads its cells, narrowing trims", () => {
	const charm = newCharm()
	setColumn(charm, 1, {width: 2})
	assert.deepEqual(charm.cells[1].a, [{f: "k", b: null}, {f: null, b: null}])
	paintCell(charm, 1, "a", 1, "f", "t")
	setColumn(charm, 1, {width: 1})
	assert.deepEqual(charm.cells[1].a, [{f: "k", b: null}])
})

test("rows before the first reference row aren't a group", () => {
	const charm = newCharm()
	charm.rows.unshift({id: "z", ref: false, dir: "~", yarn: "row", stitch: null, speed: null, roller: null})
	assert.deepEqual(groupsOf(charm).map(g => g.map(r => r.id)), [["a", "b"]])
})

test("rows are added where asked, and taken out with their cells", () => {
	const charm = newCharm()
	const id = addRow(charm, {after: "a", ref: false})
	assert.deepEqual(charm.rows.map(r => r.id), ["a", id, "b"])
	assert.equal(charm.rows[1].dir, "~")
	assert.equal(charm.rows[1].yarn, "row")
	setRow(charm, id, {stitch: "7"})
	assert.equal(charm.rows[1].stitch, "7")
	removeRow(charm, "b")
	assert.deepEqual(charm.rows.map(r => r.id), ["a", id])
	assert.equal(charm.cells[1].b, undefined)
})
