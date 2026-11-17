import {test} from "node:test"
import assert from "node:assert/strict"
import {checkKnitout} from "../knitcheck.js"

// the kniterate's own limits (support.kniterate.com, "Machine limitations"):
// floats of at most 6–7 stitches, and at most 2–3 short rows in the middle
// of a piece

// a .k: a tucked cast-on over f`from`–f`to`, then `shape` (rows to knit,
// each [first, last] needle, alternating direction from +), then two
// rows over everything
function knitout(shape, {from = 40, to = 100} = {}) {
	const lines = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", "in 3"]
	for (let n = to; n >= from; n--) lines.push(`tuck - f${n} 3`)
	let dir = "-"
	const row = ([a, b], carrier = "3") => {
		dir = dir === "-" ? "+" : "-"
		const needles = []
		for (let n = a; n <= b; n++) needles.push(n)
		if (dir === "-") needles.reverse()
		for (const n of needles) lines.push(`knit ${dir} f${n} ${carrier}`)
	}
	for (let r = 0; r < 4; r++) row([from, to])
	for (const rowNeedles of shape) row(rowNeedles)
	for (let r = 0; r < 2; r++) row([from, to])
	lines.push("out 3")
	return lines.join("\n")
}
const repeat = (times, rowNeedles) => Array.from({length: times}, () => rowNeedles)
const of = (text, kind) => checkKnitout(text).problems.filter(problem => problem.kind === kind)

test("three short rows in the middle of a piece are all right", () => {
	assert.deepEqual(of(knitout(repeat(3, [65, 75])), "middle"), [])
})

test("more short rows than that in the middle of a piece are a risk", () => {
	const [problem, ...rest] = of(knitout(repeat(12, [65, 75])), "middle")
	assert.equal(rest.length, 0, "one problem for the one short-rowed part")
	assert.equal(problem.level, "risk")
	assert.match(problem.text, /12 rows/)
})

test("short rows that step in a needle a row are caught too", () => {
	// a heel: each row a needle in from each side, then back out. no needle
	// gets far ahead of the one beside it, but the middle's 30 rows ahead of
	// the edges
	const shape = []
	for (let i = 0; i < 15; i++) shape.push([40 + i, 100 - i])
	for (let i = 14; i >= 0; i--) shape.push([40 + i, 100 - i])
	const problems = of(knitout(shape), "middle")
	assert.equal(problems.length, 1)
	assert.equal(problems[0].level, "risk")
})

test("short rows at the edge of a piece aren't in the middle", () => {
	assert.deepEqual(of(knitout(repeat(12, [40, 70])), "middle"), [])
})

test("knitting every row isn't short rowing", () => {
	assert.deepEqual(of(knitout(repeat(40, [40, 100])), "middle"), [])
})

// a .k with carrier 3 knitting f1–f`width`, but for every `every`th needle,
// which carrier 4 knits (in the same pass, after it): carrier 3 floats
// behind them
function fairIsle(every, {width = 60, rows = 4} = {}) {
	const lines = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", "in 3", "in 4"]
	for (let r = 0; r < rows; r++) {
		const dir = r % 2 ? "-" : "+"
		let needles = [...Array(width).keys()].map(i => i + 1)
		if (dir === "-") needles = needles.reverse()
		for (const n of needles) lines.push(`knit ${dir} f${n} ${n % every ? 3 : 4}`)
	}
	lines.push("out 3", "out 4")
	return lines.join("\n")
}

test("floats of up to 7 stitches aren't a risk", () => {
	// carrier 4's floats: every 8th needle, past the 7 between
	assert.deepEqual(
		of(fairIsle(8), "float").filter(problem => problem.level === "risk"),
		[],
	)
})

test("floats longer than 7 stitches are a risk", () => {
	const risks = of(fairIsle(12), "float").filter(problem => problem.level === "risk")
	assert.ok(risks.length, "a risk")
	assert.match(risks[0].text, /11 stitches/)
})

test("short rows in the middle of a tube, cast on with tucks, are caught", () => {
	const lines = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", "in 3"]
	for (let n = 100; n >= 40; n--) lines.push(`tuck - f${n} 3`)
	for (let n = 40; n <= 100; n++) lines.push(`tuck + b${n} 3`)
	for (let r = 0; r < 10; r++) {
		for (let n = 75; n >= 65; n--) lines.push(`knit - f${n} 3`)
		for (let n = 65; n <= 75; n++) lines.push(`knit + b${n} 3`)
	}
	lines.push("out 3")
	const problems = of(lines.join("\n"), "middle")
	assert.ok(problems.length, "caught")
	assert.equal(problems[0].level, "risk")
})
