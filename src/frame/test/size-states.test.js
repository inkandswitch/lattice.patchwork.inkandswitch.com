import {test} from "node:test"
import assert from "node:assert/strict"
import {kOf, statesFrom} from "../size.js"

const near = (actual, expected, within = 0.001) =>
	assert.ok(Math.abs(actual - expected) < within, `${actual} isn't ${expected}`)

test("Munden's constants for each state, and none for steamed", () => {
	assert.deepEqual(kOf("wool", "dry"), {kc: 5.0, kw: 3.8})
	assert.equal(kOf("wool", "steamed"), null)
})

test("a measured dry stitch, and the rest estimated from it", () => {
	const states = statesFrom({dry: {across: 3.65, up: 1.42}}, "wool")
	assert.equal(states.dry.across, 3.65)
	assert.equal(states.dry.up, 1.42)
	assert.equal(states.dry.estimated, false)
	near(states.wet.across, (3.65 * 3.8) / 4.1)
	near(states.wet.up, (1.42 * 5.0) / 5.3)
	assert.equal(states.wet.estimated, true)
	near(states.full.across, (3.65 * 3.8) / 4.2)
	near(states.full.up, (1.42 * 5.0) / 5.5)
	assert.equal(states.full.estimated, true)
	assert.equal(states.steamed, null)
})

test("steamed alone is only steamed", () => {
	const states = statesFrom({steamed: {across: 2, up: 1.4}}, "wool")
	assert.deepEqual(states.steamed, {across: 2, up: 1.4, loop: null, estimated: false})
	assert.equal(states.dry, null)
	assert.equal(states.wet, null)
	assert.equal(states.full, null)
})

test("half a measurement: the other half from the loop's shape", () => {
	const states = statesFrom({dry: {across: null, up: 1.42}}, "wool")
	near(states.dry.across, (1.42 * 5.0) / 3.8)
	assert.equal(states.dry.up, 1.42)
	assert.equal(states.dry.estimated, true)
})

test("a loop that's given is every state's", () => {
	const states = statesFrom({dry: {across: 3.65, up: 1.42}, steamed: {across: 3.5, up: 1.4}}, "wool", 14)
	for (const state of ["dry", "steamed", "wet", "full"]) assert.equal(states[state].loop, 14)
})
