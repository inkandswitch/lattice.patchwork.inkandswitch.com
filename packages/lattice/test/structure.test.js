import {test} from "node:test"
import assert from "node:assert/strict"
import {ROLLER, SPEED, carriageTrack, readKnitout} from "../knitting.js"
import {passStructures, structureOf} from "../structure.js"

// stitches along a row, from "FFBB…": front n at n, back at n + 0.5
const row = beds => [...beds].map((bed, i) => ({back: bed === "B", x: bed === "B" ? i + 0.5 : i}))

test("no stitches, no structure", () => {
	assert.equal(structureOf([]), null)
})

test("one bed is jersey", () => {
	assert.equal(structureOf(row("FFFFFF")), "jersey")
	assert.equal(structureOf(row("BBBB")), "jersey")
})

test("front and back by turns is 1×1 rib", () => {
	assert.equal(structureOf(row("FBFBFBFB")), "rib-1x1")
})

test("two and two is 2×2 rib", () => {
	assert.equal(structureOf(row("FFBBFFBB")), "rib-2x2")
})

test("2×2 rib with a short run at either edge is still 2×2 rib", () => {
	assert.equal(structureOf(row("FBBFFBBF")), "rib-2x2")
	assert.equal(structureOf(row("BFFBBFF")), "rib-2x2")
})

test("anything else is other", () => {
	assert.equal(structureOf(row("FFFB")), "other")
	assert.equal(structureOf(row("FFFBBBFFFBBB")), "other")
})

// a .k: each row's needles knitted back and forth on carrier 3, as
// "f1 b1 f2…", at racking `rack`
function knitout(rows, rack = 0) {
	const lines = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", "in 3"]
	if (rack) lines.push(`rack ${rack}`)
	rows.forEach((needles, r) => {
		const dir = r % 2 ? "-" : "+"
		const order = r % 2 ? [...needles].reverse() : needles
		for (const needle of order) lines.push(`knit ${dir} ${needle} 3`)
	})
	lines.push("out 3")
	return lines.join("\n")
}
const structures = text => {
	const {ops} = readKnitout(text)
	const all = passStructures(ops, carriageTrack(ops))
	return ops.map((op, i) => (op.kind === "knit" ? all[i] : undefined)).filter(s => s !== undefined)
}
const needles = (pattern, from = 1) => [...pattern].map((bed, i) => `${bed === "F" ? "f" : "b"}${from + i}`)

test("each pass of a jersey swatch is jersey", () => {
	const rows = [needles("FFFFFF"), needles("FFFFFF")]
	const found = structures(knitout(rows))
	assert.equal(found.length, 12)
	assert.ok(found.every(s => s === "jersey"))
})

test("a pass knitting both beds by turns, at half racking, is 1×1 rib", () => {
	const rows = [1, 2, 3, 4].map(() => ["f1", "b1", "f2", "b2", "f3", "b3", "f4", "b4"])
	assert.ok(structures(knitout(rows, 0.5)).every(s => s === "rib-1x1"))
})

test("a 2×2 rib cuff, then a jersey body", () => {
	const cuff = [1, 2, 3, 4].map(() => needles("FFBBFFBB"))
	const body = [1, 2, 3, 4].map(() => needles("FFFFFFFF"))
	const found = structures(knitout([...cuff, ...body], 0.5))
	assert.ok(found.slice(0, 32).every(s => s === "rib-2x2"), found.slice(0, 32).join())
	assert.ok(found.slice(32).every(s => s === "jersey"), found.slice(32).join())
})

test("every op carries its roller and speed, as it carries its stitch", () => {
	assert.equal(ROLLER, 100)
	assert.equal(SPEED, 100)
	const {ops} = readKnitout("x-roller-advance 150\nknit + f1 1\nx-add-roller-advance 20\nknit + f2 1\nx-speed-number 300\nknit + f3 1\n")
	const knits = ops.filter(op => op.kind === "knit")
	assert.equal(knits[0].roller, 150)
	assert.equal(knits[0].speed, 100)
	assert.equal(knits[1].roller, 170)
	assert.equal(knits[2].speed, 300)
	assert.equal(readKnitout("knit + f1 1\n").ops[0].roller, 100)
})
