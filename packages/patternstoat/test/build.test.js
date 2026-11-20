import {test} from "node:test"
import assert from "node:assert/strict"
import {buildKnitout} from "../build.js"
import {newCharm, setRow} from "../charm.js"
import {newPatternstoat, paintStitches, paintWristwarmer} from "../patternstoat.js"
import {checkKnitout} from "../../lattice/knitcheck.js"
import {holding} from "./holding.js"

const tube = (width, height, colour = 1, options = {}) => {
	const stoat = newPatternstoat({width, height, left: 10, ...options})
	stoat.colours = stoat.colours.map(row => row.map(() => colour))
	return stoat
}

// runs of knit and tuck lines going one way, on one bed, in one carrier:
// [dir, bed, carrier, [needles]]
function passes(knitout) {
	const runs = []
	for (const line of knitout.split("\n")) {
		const m = line.match(/^(knit|tuck) ([+-]) ([fb])(\d+) (\d)$/)
		if (!m) continue
		const [, , dir, bed, n, carrier] = m
		const last = runs[runs.length - 1]
		if (last && last[0] === dir && last[1] === bed && last[2] === carrier) last[3].push(Number(n))
		else runs.push([dir, bed, carrier, [Number(n)]])
	}
	return runs
}

test("a half-gauge tube: front on even needles going right, back on odd going left", () => {
	const {knitout} = buildKnitout(tube(3, 1), newCharm())
	assert.deepEqual(passes(knitout), [
		["+", "f", "3", [10, 12, 14]],
		["-", "b", "3", [15, 13, 11]],
	])
	assert.match(knitout, /^;!knitout-2\n;;Carriers: 1 2 3 4 5 6\n/)
})

test("gauge 1 puts both beds on the same needle", () => {
	const {knitout} = buildKnitout(tube(3, 1, 1, {gauge: 1}), newCharm())
	assert.deepEqual(passes(knitout), [
		["+", "f", "3", [10, 11, 12]],
		["-", "b", "3", [12, 11, 10]],
	])
})

test("stripes: each row in its yarn, carriers in once and out after their last", () => {
	const stoat = tube(2, 4)
	stoat.yarns = ["3", "4", "3", "4"]
	const {knitout} = buildKnitout(stoat, newCharm())
	const lines = knitout.split("\n")
	assert.equal(lines.filter(l => l === "in 3").length, 1)
	assert.equal(lines.filter(l => l === "in 4").length, 1)
	assert.ok(lines.indexOf("in 4") < lines.indexOf("knit + f10 4"))
	assert.ok(lines.indexOf("out 3") > lines.lastIndexOf("knit - b11 3"))
	assert.ok(lines.indexOf("out 3") < lines.lastIndexOf("knit + f10 4"))
	assert.ok(lines.indexOf("out 4") > lines.lastIndexOf("knit - b11 4"))
})

test("each design row is marked, and rows[] finds it", () => {
	const {knitout, rows} = buildKnitout(tube(2, 3), newCharm())
	const lines = knitout.split("\n")
	assert.equal(rows.length, 3)
	rows.forEach((line, r) => assert.equal(lines[line], `;; row ${r + 1}`))
})

test("transparent cells knit what's painted", () => {
	const stoat = tube(3, 1, 7)
	paintStitches(stoat, [[1, 0]], "f", "t")
	const {knitout} = buildKnitout(stoat, newCharm())
	assert.match(knitout, /^tuck \+ f12 3$/m)
	assert.doesNotMatch(knitout, /f10|f14/) // nothing painted there: nothing
})

test("a stitch painted on a tube replaces the charm's on its bed, in its pass", () => {
	const stoat = tube(3, 1) // the tube: row a knits the front, row b the back
	paintStitches(stoat, [[1, 0]], "f", "t")
	const {knitout} = buildKnitout(stoat, newCharm())
	assert.match(knitout, /^tuck \+ f12 3$/m)
	assert.doesNotMatch(knitout, /^knit \+ f12 3$/m)
	assert.match(knitout, /^knit - b13 3$/m) // the back is the charm's still
})

test("a stitch painted on a bed the charm leaves empty knits in the first pass", () => {
	const stoat = tube(3, 1, 2) // back only: row a nothing, row b knits the back
	paintStitches(stoat, [[1, 0]], "f", "k")
	const lines = buildKnitout(stoat, newCharm()).knitout.split("\n")
	const front = lines.findIndex(l => /^knit \+ f12 3$/.test(l))
	assert.ok(front >= 0)
	assert.ok(front < lines.findIndex(l => /^knit - b1[135] 3$/.test(l)))
})

test("a stitch painted in a cast off knits there, and the cast off either side still binds off", () => {
	const stoat = tube(5, 1, 6) // cast off, both beds
	paintStitches(stoat, [[2, 0]], "f", "k")
	const {knitout} = buildKnitout(stoat, newCharm())
	assert.match(knitout, /^knit \+ f14 3$/m)
	assert.deepEqual(checkKnitout(knitout).problems.filter(p => p.level === "error"), [])
	// the run left of it ends on it: f10 and f12's loops are on f14
	const held = holding(knitout.split("\n"))
	assert.equal(held.get("f10") ?? 0, 0)
	assert.equal(held.get("f12") ?? 0, 0)
	assert.ok(held.get("f14") >= 1)
})

test("either goes the other way from the carrier's last pass", () => {
	const charm = newCharm()
	setRow(charm, "a", {dir: "~"})
	setRow(charm, "b", {dir: "~"})
	const {knitout} = buildKnitout(tube(2, 2), charm)
	assert.deepEqual(passes(knitout).map(([dir, bed]) => dir + bed), ["+f", "-b", "+f", "-b"])
})

test("a pass's settings are written when they change", () => {
	const charm = newCharm()
	setRow(charm, "b", {stitch: "7"})
	const {knitout} = buildKnitout(tube(2, 2), charm)
	const lines = knitout.split("\n")
	assert.deepEqual(lines.slice(2, 5), ["x-stitch-number 5", "x-speed-number 100", "x-roller-advance 100"])
	const settings = lines.filter(l => l.startsWith("x-stitch-number"))
	assert.deepEqual(settings, ["x-stitch-number 5", "x-stitch-number 7", "x-stitch-number 5", "x-stitch-number 7"])
	assert.equal(lines[lines.indexOf("knit - b13 3") - 1], "x-stitch-number 7")
})

test("a fixed yarn on a pass knits in it, whatever the row's yarn", () => {
	const charm = newCharm()
	setRow(charm, "b", {yarn: "5"})
	const {knitout} = buildKnitout(tube(2, 1), charm)
	assert.deepEqual(passes(knitout).map(([, bed, carrier]) => bed + carrier), ["f3", "b5"])
	assert.match(knitout, /^in 5$/m)
})

test("transfers come first in their pass, at the rack they need", () => {
	const charm = newCharm()
	charm.cells[1].b = [{f: "x", b: "k"}] // transfer the front to the back, then knit the back
	const lines = buildKnitout(tube(2, 1), charm).knitout.split("\n")
	const at = lines.indexOf("xfer f10 b11")
	assert.ok(at > 0)
	assert.equal(lines[at - 1], "rack -1")
	assert.ok(lines.indexOf("rack 0", at) < lines.indexOf("knit - b13 3"))
	assert.ok(holding(lines).get("b11") >= 1)
})

test("a colour missing from the charm is an error at its row and needle", () => {
	const stoat = tube(3, 2)
	stoat.colours[1][2] = 9
	assert.deepEqual(buildKnitout(stoat, newCharm()).error, {row: 2, needle: 14, message: "colour 9 isn't in the charm"})
})

test("past the bed is an error at the needle that's past it", () => {
	const stoat = tube(3, 1)
	stoat.left = 250
	assert.deepEqual(buildKnitout(stoat, newCharm()).error, {row: 1, needle: 253, message: "past the bed (1–252)"})
})

test("a yarn that isn't a carrier is an error", () => {
	const stoat = tube(2, 1)
	stoat.yarns[0] = "9"
	assert.deepEqual(buildKnitout(stoat, newCharm()).error, {row: 1, needle: null, message: "yarn 9 isn't a carrier (1–6)"})
})

test("no charm is an error", () => {
	assert.deepEqual(buildKnitout(tube(2, 1), null).error, {row: null, needle: null, message: "no charm linked"})
})

test("the wristwarmer builds with no errors from the checks, and its thumb gap opens", () => {
	const stoat = newPatternstoat()
	paintWristwarmer(stoat)
	const {knitout, rows, error} = buildKnitout(stoat, newCharm())
	assert.equal(error, undefined)
	const problems = checkKnitout(knitout).problems
	assert.deepEqual(problems.filter(p => p.level === "error"), [])
	assert.deepEqual(problems.filter(p => p.kind === "float"), []) // nothing strung across the thumb hole
	const lines = knitout.split("\n")
	// just after the gap's cast off (design row 51, index 50)
	const held = holding(lines.slice(0, rows[51]))
	for (let x = 4; x <= 9; x++) assert.equal(held.get(`f${60 + 2 * x}`) ?? 0, 0)
	assert.equal(held.get(`f${60 + 2 * 10}`), 1)
	// and cast back on in the next row, as a thumb hole knitted in the round is
	const after = holding(lines.slice(0, rows[53]))
	for (let x = 4; x <= 9; x++) assert.equal(after.get(`f${60 + 2 * x}`), 1)
})

test("a charm with no reference rows is an error, not an empty .k", () => {
	const charm = newCharm()
	charm.rows = []
	assert.deepEqual(buildKnitout(tube(2, 1), charm).error, {row: null, needle: null, message: "the charm has no reference rows"})
})

test("a patternstoat with no left edge is an error, not needle NaN", () => {
	const stoat = tube(2, 1)
	delete stoat.left
	assert.equal(buildKnitout(stoat, newCharm()).error.message, "past the bed (1–252)")
})

test("casting off or transferring at full gauge is an error: it would join the tube", () => {
	const stoat = tube(3, 1, 3, {gauge: 1})
	assert.deepEqual(buildKnitout(stoat, newCharm()).error, {row: 1, needle: 10, message: "cast off needs half gauge: at full gauge it transfers onto the other bed's loops"})
	const charm = newCharm()
	charm.cells[1].b = [{f: "x", b: "k"}]
	assert.equal(buildKnitout(tube(2, 1, 1, {gauge: 1}), charm).error.message, "transfer needs half gauge: at full gauge it transfers onto the other bed's loops")
})

test("a pass's settings have to be whole numbers", () => {
	const charm = newCharm()
	setRow(charm, "b", {stitch: "abc"})
	assert.deepEqual(buildKnitout(tube(2, 1), charm).error, {row: 1, needle: null, message: "stitch abc isn't a number"})
})
