import {test} from "node:test"
import assert from "node:assert/strict"
import {COUNT_SYSTEMS, PLATED_TEX, nmOf, texOf} from "../counts.js"

const near = (actual, expected, within = 0.001) =>
	assert.ok(Math.abs(actual - expected) < within, `${actual} isn't ${expected}`)

test("the count systems", () => {
	assert.deepEqual(COUNT_SYSTEMS, ["Nm", "Ne", "tex", "denier"])
})

test("Nm 2/30 is 66.7 tex", () => {
	near(texOf({system: "Nm", value: 30, ply: 2}), 66.667)
})

test("Ne 30 is 19.7 tex", () => {
	near(texOf({system: "Ne", value: 30, ply: 1}), 19.683)
})

test("90 denier is 10 tex", () => {
	assert.equal(texOf({system: "denier", value: 90, ply: 1}), 10)
})

test("3 plies of 20 tex are 60 tex", () => {
	assert.equal(texOf({system: "tex", value: 20, ply: 3}), 60)
})

test("a ply that's missing, nought or less is one", () => {
	near(texOf({system: "Nm", value: 30}), 33.333)
	near(texOf({system: "Nm", value: 30, ply: 0}), 33.333)
	near(texOf({system: "Nm", value: 30, ply: -2}), 33.333)
})

test("a count that isn't one is null", () => {
	assert.equal(texOf({system: "Nm", value: 0, ply: 2}), null)
	assert.equal(texOf({system: "Nm", value: null}), null)
	assert.equal(texOf({system: "yards", value: 3}), null)
	assert.equal(texOf(null), null)
})

test("tex back to Nm", () => {
	near(nmOf(66.667), 15, 0.01)
	assert.equal(nmOf(0), null)
})

test("a plated pair knits best between Nm 8 and Nm 6", () => {
	assert.equal(PLATED_TEX.low, 125)
	near(PLATED_TEX.high, 166.667)
})
