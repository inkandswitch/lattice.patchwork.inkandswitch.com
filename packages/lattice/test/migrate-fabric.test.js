import {test} from "node:test"
import assert from "node:assert/strict"
import {profilesFromFabric} from "../migrate-fabric.js"

test("what this browser kept becomes a yarn, and a swatch for each stitch number", () => {
	const fabric = {relax: "dry", fibre: "wool", tex: 67, strands: 2, stitches: {"5": {loop: 14, across: 27.5, up: 70}}}
	const {yarn, swatches} = profilesFromFabric(fabric)
	assert.deepEqual(yarn.count, {system: "tex", value: 67, ply: 2})
	assert.equal(yarn.relaxesLike, "wool")
	assert.equal(yarn["@patchwork"].type, "lattice:yarn")
	assert.equal(swatches.length, 1)
	const [swatch] = swatches
	assert.equal(swatch["@patchwork"].type, "lattice:swatch")
	assert.equal(swatch.knit.stitch, "5")
	assert.equal(swatch.knit.structure, "jersey")
	assert.equal(swatch.knit.sure, "believed")
	assert.equal(swatch.loop.mm, 14)
	assert.deepEqual(swatch.relaxed.dry, {entered: "per10", wales: 27.5, courses: 70, width: null, height: null, grams: null, date: null, by: null})
})

test("a stitch number with only its loop measured keeps just that", () => {
	const {swatches} = profilesFromFabric({relax: "wet", fibre: "cotton", tex: null, strands: 1, stitches: {"7": {loop: 12}}})
	assert.equal(swatches[0].relaxed.wet, null)
	assert.equal(swatches[0].loop.mm, 12)
})

test("migrated swatches are on the project's machine, if it has one", () => {
	const {swatches} = profilesFromFabric({relax: "dry", fibre: "wool", stitches: {"5": {across: 27.5, up: 70}}}, {machine: "automerge:m"})
	assert.equal(swatches[0].knit.machine, "automerge:m")
})
