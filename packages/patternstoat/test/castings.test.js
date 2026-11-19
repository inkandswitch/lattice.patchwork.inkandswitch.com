import {test} from "node:test"
import assert from "node:assert/strict"
import {castOff, castOn} from "../castings.js"
import {holding} from "./holding.js"

const knit = (dir, bed, ns, c = "3") => ns.map(n => `knit ${dir} ${bed}${n} ${c}`)
const header = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", "in 3"]
// half gauge: front on even needles 10..30, back on odd 11..31
const fronts = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]
const backs = fronts.map(n => n + 1)
const cast = [...header, ...knit("+", "f", fronts), ...knit("-", "f", [...fronts].reverse())]

test("casting off the middle of a row leaves its needles empty and the next one holding", () => {
	const lines = [
		...cast,
		...knit("+", "f", [10, 12]),
		...castOff({bed: "f", needles: [14, 16, 18], next: 20, dir: "+", carrier: "3", other: "b"}),
		...knit("+", "f", [20, 22, 24, 26, 28, 30]),
	]
	const held = holding(lines)
	for (const n of [14, 16, 18]) assert.equal(held.get(`f${n}`) ?? 0, 0)
	assert.equal(held.get("f20"), 1) // knitted through the bound-off chain
	for (const n of [14, 15, 16, 17, 18, 19]) assert.equal(held.get(`b${n}`) ?? 0, 0) // went through the back, left nothing
	assert.ok(lines.indexOf("rack 0") > 0 && lines.lastIndexOf("rack 0") > lines.lastIndexOf("rack 2"))
})

test("casting off going left ends on the needle to its left", () => {
	const lines = [
		...cast,
		...knit("+", "f", fronts),
		...knit("-", "f", [30, 28, 26, 24, 22, 20]),
		...castOff({bed: "f", needles: [18, 16, 14], next: 12, dir: "-", carrier: "3", other: "b"}),
		...knit("-", "f", [12, 10]),
	]
	const held = holding(lines)
	for (const n of [14, 16, 18]) assert.equal(held.get(`f${n}`) ?? 0, 0)
	assert.equal(held.get("f12"), 1)
})

test("a cast off with nowhere to go keeps its last loop", () => {
	const lines = [...cast, ...knit("+", "f", [10, 12, 14, 16, 18, 20, 22, 24]), ...castOff({bed: "f", needles: [26, 28, 30], next: null, dir: "+", carrier: "3", other: "b"})]
	const held = holding(lines)
	assert.equal(held.get("f26") ?? 0, 0)
	assert.equal(held.get("f28") ?? 0, 0)
	assert.equal(held.get("f30"), 1)
})

test("casting off the back goes through the front", () => {
	const lines = [
		...header,
		...knit("+", "b", backs),
		...knit("-", "b", [...backs].reverse()),
		...knit("+", "b", [11, 13]),
		...castOff({bed: "b", needles: [15, 17, 19], next: 21, dir: "+", carrier: "3", other: "f"}),
		...knit("+", "b", [21, 23]),
	]
	const held = holding(lines)
	for (const n of [15, 17, 19]) assert.equal(held.get(`b${n}`) ?? 0, 0)
	assert.equal(held.get("b21"), 1)
})

test("casting on gives empty needles loops the next pass knits", () => {
	const lines = [
		...header,
		...knit("+", "f", [10, 12]),
		...castOn({bed: "f", needles: [14, 16, 18], dir: "+", carrier: "3"}),
		...knit("+", "f", [20, 22]),
		...knit("-", "f", [22, 20, 18, 16, 14, 12, 10]),
	]
	const held = holding(lines)
	for (const n of [14, 16, 18]) assert.equal(held.get(`f${n}`), 1)
})

test("the back's loops beside a front cast off aren't touched", () => {
	const lines = [
		...cast,
		...knit("-", "b", [...backs].reverse()),
		...knit("+", "f", [10, 12]),
		...castOff({bed: "f", needles: [14, 16, 18], next: 20, dir: "+", carrier: "3", other: "b"}),
		...knit("+", "f", [20, 22, 24, 26, 28, 30]),
	]
	const held = holding(lines)
	for (const n of backs) assert.equal(held.get(`b${n}`), 1)
})
