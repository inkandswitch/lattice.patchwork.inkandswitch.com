import {test} from "node:test"
import assert from "node:assert/strict"
import {feedMatches, machineTier, platingNote, stitchSizes} from "../size.js"

const near = (actual, expected, within = 0.001) =>
	assert.ok(Math.abs(actual - expected) < within, `${actual} isn't ${expected}`)

const studio = {url: "m1", title: "the studio kniterate", make: "Kniterate", model: "Kniterate", gauge: 7}
const other = {url: "m2", title: "agnes's kniterate", make: "Kniterate", model: "Kniterate", gauge: 7}
const shima = {url: "m3", title: "a shima", make: "Shima Seiki", model: "SES", gauge: 14}

const NONE = {dry: null, steamed: null, wet: null, full: null}
// a swatch, as profiles.js resolves one
const swatch = (overrides = {}) => ({
	url: "s1",
	title: "lambswool jersey, st 5",
	sure: "believed",
	machine: studio,
	stitch: "5",
	structure: "jersey",
	needles: 51,
	rows: 100,
	feeds: [{carrier: "3", yarns: ["y1"], plated: false}],
	relaxed: {...NONE, dry: {wales: 27.5, courses: 70}},
	loop: null,
	roller: 100,
	speed: 100,
	...overrides,
})
const carrier = (overrides = {}) => ({
	yarns: [{url: "y1", title: "lambswool", tex: 66.7, relaxesLike: "wool", colour: null}],
	plated: false,
	tex: 66.7,
	swatches: [swatch()],
	...overrides,
})
const sizes = (carrierProfile, overrides = {}) =>
	stitchSizes({carrier: carrierProfile, stitch: "5", structure: "jersey", machine: studio, gauge: 7, fabric: null, ...overrides})

test("which machines' swatches count", () => {
	assert.equal(machineTier(studio, studio, 7), "measured")
	assert.equal(machineTier(other, studio, 7), "other-machine")
	assert.equal(machineTier(shima, studio, 7), null)
	assert.equal(machineTier(other, null, 7), "other-machine")
	assert.equal(machineTier(shima, null, 7), null)
	assert.equal(machineTier(null, studio, 7), null)
})

test("a swatch on this machine, of these yarns, at this stitch, is measured", () => {
	const size = sizes(carrier())
	assert.equal(size.tier, "measured")
	near(size.states.dry.across, 100 / 27.5)
	near(size.states.dry.up, 100 / 70)
	assert.deepEqual(size.swatches, [{url: "s1", title: "lambswool jersey, st 5", sure: "believed", machine: studio}])
	assert.equal(size.roller, 100)
})

test("one on another kniterate counts, but says so; this machine's wins", () => {
	assert.equal(sizes(carrier({swatches: [swatch({machine: other})]})).tier, "other-machine")
	const both = sizes(carrier({swatches: [swatch({url: "s2", machine: other}), swatch()]}))
	assert.equal(both.tier, "measured")
	assert.deepEqual(
		both.swatches.map(s => s.url),
		["s1"],
	)
})

test("one on a different model doesn't count", () => {
	assert.equal(sizes(carrier({swatches: [swatch({machine: shima})]})).tier, "guess")
})

test("rib never sizes jersey, nor jersey rib", () => {
	assert.equal(sizes(carrier({swatches: [swatch({structure: "rib-2x2"})]})).tier, "guess")
	assert.equal(sizes(carrier(), {structure: "rib-2x2"}).tier, "guess")
})

test("plated only matches plated, held only held", () => {
	const two = {yarns: [{url: "y1", tex: 66.7, relaxesLike: "wool"}, {url: "y2", tex: 66.7, relaxesLike: "wool"}], tex: 133.4}
	const held = swatch({feeds: [{carrier: "3", yarns: ["y1", "y2"], plated: false}]})
	assert.equal(sizes(carrier({...two, plated: true, swatches: [held]})).tier, "guess")
	assert.equal(sizes(carrier({...two, plated: false, swatches: [held]})).tier, "measured")
})

test("which yarn's in the hole and which in the slit doesn't change the size", () => {
	const two = {yarns: [{url: "y2", tex: 66.7, relaxesLike: "wool"}, {url: "y1", tex: 66.7, relaxesLike: "wool"}], tex: 133.4, plated: true}
	const plated = swatch({feeds: [{carrier: "3", yarns: ["y1", "y2"], plated: true}]})
	assert.equal(feedMatches(plated, carrier({...two, swatches: [plated]})), true)
	assert.equal(sizes(carrier({...two, swatches: [plated]})).tier, "measured")
})

test("a swatch measured only for its loop sizes jersey from it", () => {
	const size = sizes(carrier({swatches: [swatch({relaxed: NONE, loop: 14})]}))
	assert.equal(size.tier, "loop")
	near(size.states.dry.up, 14 / 5.0)
	near(size.states.dry.across, 14 / 3.8)
})

test("a loop alone doesn't size rib", () => {
	const size = sizes(carrier({swatches: [swatch({relaxed: NONE, loop: 14, structure: "rib-2x2"})]}), {structure: "rib-2x2"})
	assert.equal(size.tier, "guess")
})

test("nothing measured is a guess, a stitch a needle wide", () => {
	const size = sizes(carrier({swatches: []}))
	assert.equal(size.tier, "guess")
	near(size.states.dry.across, 25.4 / 7)
	near(size.states.dry.up, ((25.4 / 7) * 3.8) / 5.0)
})

test("a carrier without profiles is sized from what this browser kept, as before", () => {
	const fabric = {relax: "dry", fibre: "wool", stitches: {"5": {across: 27.5, up: 70}}}
	const size = sizes(null, {fabric})
	assert.equal(size.tier, "measured")
	near(size.states.dry.across, 100 / 27.5)
	assert.deepEqual(size.swatches, [])
	assert.equal(sizes(null, {fabric: {}}).tier, "guess")
})

test("a plated pair that isn't Nm 6–8 together says so", () => {
	assert.match(platingNote(carrier({plated: true, tex: 66.7})), /Nm 15\.0 together/)
	assert.equal(platingNote(carrier({plated: true, tex: 140})), null)
	assert.equal(platingNote(carrier({plated: false, tex: 66.7})), null)
})
