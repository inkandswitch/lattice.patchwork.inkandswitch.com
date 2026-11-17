import {test} from "node:test"
import assert from "node:assert/strict"
import {
	applySplices,
	codeAt,
	deleteRows,
	flipDirection,
	insertRow,
	occupancy,
	paint,
	repeatRows,
	rowsOf,
	setCarriers,
	setOption,
} from "../kniterate-rows.js"

const k = lines => [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", ...lines].join("\n")
const row = (dir, from, to, carrier = "3", bed = "f", op = "knit") => {
	const lines = []
	if (dir === "+") for (let n = from; n <= to; n++) lines.push(`${op} + ${bed}${n} ${carrier}`)
	else for (let n = to; n >= from; n--) lines.push(`${op} - ${bed}${n} ${carrier}`)
	return lines
}
const edited = (text, splices) => applySplices(text, splices)
const cells = (index, entries) => new Map([[index, new Map(entries)]])

test("rows are the knitout's passes: a way, a carrier, in needle order", () => {
	const text = k(["in 3", ...row("+", 1, 4), ...row("-", 1, 4), "rack 1", "xfer f2 b1", "xfer f3 b2", "rack 0", "drop f1"])
	const {rows} = rowsOf(text)
	assert.deepEqual(
		rows.map(r => [r.kind, r.dir, r.carriers, r.front.size, r.back.size, r.rack]),
		[
			["knit", "+", "3", 4, 0, 0],
			["knit", "-", "3", 4, 0, 0],
			["xfer", null, "", 2, 0, 1],
			["drop", null, "", 1, 0, 0],
		],
	)
})

test("a pass that turns back on itself is two rows, even going the same way", () => {
	const {rows} = rowsOf(k(["in 3", ...row("+", 1, 4), ...row("+", 1, 4)]))
	assert.equal(rows.length, 2)
})

test("both beds in a pass are one row, the back's needles across from the front's", () => {
	const text = k(["in 3", "rack 0.25", "knit + f1 3", "knit + b1 3", "knit + f2 3", "knit + b2 3"])
	const {rows} = rowsOf(text)
	assert.equal(rows.length, 1)
	assert.deepEqual(codeAt(rows[0], 1), {f: "k", b: "k"})
})

test("an empty row is a comment, and stays a row", () => {
	const {rows} = rowsOf(k(["in 3", ...row("+", 1, 2), ";!row knit - 3", ...row("+", 1, 2)]))
	assert.equal(rows.length, 3)
	assert.equal(rows[1].dir, "-")
	assert.equal(rows[1].front.size, 0)
})

test("each row has the speed, stitch, roller and rack in effect for it", () => {
	const text = k(["in 3", "x-speed-number 200", "x-stitch-number 7", ...row("+", 1, 2), "x-roller-advance 50", ...row("-", 1, 2)])
	const [a, b] = rowsOf(text).rows
	assert.deepEqual([a.speed, a.stitch, a.roller], ["200", "7", "100"])
	assert.deepEqual([b.speed, b.stitch, b.roller], ["200", "7", "50"])
})

test("painting a stitch onto a needle in a row puts its line in, in needle order", () => {
	const text = k(["in 3", "knit + f1 3", "knit + f2 3", "knit + f4 3"])
	const model = rowsOf(text)
	const {splices} = paint(model, cells(0, [[3, {f: "k", b: null}]]))
	assert.equal(edited(text, splices), k(["in 3", "knit + f1 3", "knit + f2 3", "knit + f3 3", "knit + f4 3"]))
})

test("painting going left puts it in going left", () => {
	const text = k(["in 3", "knit - f4 3", "knit - f2 3"])
	const {splices} = paint(rowsOf(text), cells(0, [[3, {f: "t", b: null}]]))
	assert.equal(edited(text, splices), k(["in 3", "knit - f4 3", "tuck - f3 3", "knit - f2 3"]))
})

test("painting over a stitch changes its line, keeping where it came from", () => {
	const text = k(["in 3", "knit + f1 3 ;!source:k12", "knit + f2 3"])
	const {splices} = paint(rowsOf(text), cells(0, [[1, {f: "t", b: null}]]))
	assert.equal(edited(text, splices), k(["in 3", "tuck + f1 3 ;!source:k12", "knit + f2 3"]))
	// a small splice: only the word that changed
	assert.equal(splices.length, 1)
	assert.ok(splices[0].remove <= 4, JSON.stringify(splices))
})

test("knitting both beds paints the back needle across from the column", () => {
	const text = k(["in 3", "knit + f1 3", "knit + f2 3"])
	const {splices} = paint(rowsOf(text), cells(0, [[2, {f: "k", b: "k"}]]))
	assert.equal(edited(text, splices), k(["in 3", "knit + f1 3", "knit + f2 3", "knit + b2 3"]))
})

test("rubbing a needle out takes its line out, and an emptied row stays as a comment", () => {
	const text = k(["in 3", "knit + f1 3", "knit + f2 3", "knit - f2 3"])
	const model = rowsOf(text)
	const once = edited(text, paint(model, cells(0, [[1, {f: null, b: null}]])).splices)
	assert.equal(once, k(["in 3", "knit + f2 3", "knit - f2 3"]))
	const twice = edited(once, paint(rowsOf(once), cells(0, [[2, {f: null, b: null}]])).splices)
	assert.equal(twice, k(["in 3", ";!row knit + 3", "knit - f2 3"]))
	assert.equal(rowsOf(twice).rows.length, 2)
})

test("an empty row takes the kind of what's painted into it", () => {
	const text = k(["in 3", "knit + f1 3", "knit + f2 3", ";!row knit - 3"])
	const {splices, skipped} = paint(rowsOf(text), cells(1, [[2, {f: "x", b: null}]]))
	assert.deepEqual(skipped, [])
	assert.equal(edited(text, splices), k(["in 3", "knit + f1 3", "knit + f2 3", "xfer f2 b2"]))
})

test("a transfer doesn't go in a knitting row", () => {
	const text = k(["in 3", "knit + f1 3"])
	const {splices, skipped} = paint(rowsOf(text), cells(0, [[1, {f: "x", b: null}]]))
	assert.equal(edited(text, splices), text)
	assert.equal(skipped.length, 1)
})

test("transfers at a racking go to the needle across", () => {
	const text = k(["rack 1", "xfer f3 b2"])
	const {splices} = paint(rowsOf(text), cells(0, [[4, {f: "x", b: null}]]))
	assert.equal(edited(text, splices), k(["rack 1", "xfer f3 b2", "xfer f4 b3"]))
})

test("a speed for some rows is set before them and put back after", () => {
	const text = k(["in 3", ...row("+", 1, 2), ...row("-", 1, 2), ...row("+", 1, 2)])
	const out = edited(text, setOption(rowsOf(text), 1, 1, "speed", 250))
	assert.equal(out, k(["in 3", ...row("+", 1, 2), "x-speed-number 250", ...row("-", 1, 2), "x-speed-number 100", ...row("+", 1, 2)]))
	const rows = rowsOf(out).rows
	assert.deepEqual(rows.map(r => r.speed), ["100", "250", "100"])
})

test("setting a row's speed where it's set already changes that line", () => {
	const text = k(["in 3", "x-speed-number 200", ...row("+", 1, 2)])
	assert.equal(edited(text, setOption(rowsOf(text), 0, 0, "speed", 300)), k(["in 3", "x-speed-number 300", ...row("+", 1, 2)]))
})

test("a racking for some rows", () => {
	const text = k(["in 3", ...row("+", 1, 2), ...row("-", 1, 2)])
	const out = edited(text, setOption(rowsOf(text), 0, 0, "rack", 1))
	assert.deepEqual(rowsOf(out).rows.map(r => r.rack), [1, 0])
})

test("turning a row round reverses it", () => {
	const text = k(["in 3", "knit + f1 3", "tuck + f2 3 ;!source:k4"])
	assert.equal(edited(text, flipDirection(rowsOf(text), 0, 0)), k(["in 3", "tuck - f2 3 ;!source:k4", "knit - f1 3"]))
})

test("rows knitted with another carrier", () => {
	const text = k(["in 3", "knit + f1 3", "split + f2 b2 3"])
	assert.equal(edited(text, setCarriers(rowsOf(text), 0, 0, "4")), k(["in 3", "knit + f1 4", "split + f2 b2 4"]))
})

test("a new row goes after, going the other way", () => {
	const text = k(["in 3", ...row("+", 1, 2)])
	assert.equal(edited(text, insertRow(rowsOf(text), 0)), k(["in 3", ...row("+", 1, 2), ";!row knit - 3"]))
})

test("rows again, and rows gone", () => {
	const text = k(["in 3", ...row("+", 1, 2), ...row("-", 1, 2)])
	const twice = edited(text, repeatRows(rowsOf(text), 0, 1))
	assert.equal(rowsOf(twice).rows.length, 4)
	const gone = edited(twice, deleteRows(rowsOf(twice), 1, 2))
	assert.equal(gone, k(["in 3", ...row("+", 1, 2), ...row("-", 1, 2)]))
})

test("a file without a newline at the end takes a new last line", () => {
	const text = "in 3\nknit + f1 3"
	assert.equal(edited(text, paint(rowsOf(text), cells(0, [[2, {f: "k", b: null}]])).splices), "in 3\nknit + f1 3\nknit + f2 3")
})

test("what's on the needles after each row", () => {
	const text = k(["in 3", ...row("+", 1, 3), "xfer f2 b2", "drop f3"])
	const after = occupancy(rowsOf(text))
	assert.equal(after[0].front.get(2), 1)
	assert.equal(after[1].front.get(2), undefined)
	assert.equal(after[1].back.get(2), 1)
	assert.equal(after[2].front.get(3), undefined)
})
