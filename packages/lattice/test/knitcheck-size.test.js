import {test} from "node:test"
import assert from "node:assert/strict"
import {checkKnitout, machineLimits} from "../knitcheck.js"

const near = (actual, expected, within = 0.001) =>
	assert.ok(Math.abs(actual - expected) < within, `${actual} isn't ${expected}`)

// a .k knitting `rows` rows of `width` needles back and forth on each of
// `carriers` in turn (a row each), on the front bed: or, given `pattern`
// ("FFBB"), on both, at half racking
function knitout({width = 20, rows = 10, carriers = ["3"], pattern = null, extra = [], rack = 0} = {}) {
	const lines = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", ...carriers.map(c => `in ${c}`), ...extra]
	if (rack) lines.push(`rack ${rack}`)
	for (let r = 0; r < rows; r++) {
		const carrier = carriers[r % carriers.length]
		const dir = Math.floor(r / carriers.length) % 2 ? "-" : "+"
		let needles = [...Array(width).keys()].map(i => {
			const bed = pattern ? pattern[i % pattern.length] : "F"
			return `${bed === "F" ? "f" : "b"}${i + 1}`
		})
		if (dir === "-") needles = needles.reverse()
		for (const needle of needles) lines.push(`knit ${dir} ${needle} ${carrier}`)
	}
	lines.push(...carriers.map(c => `out ${c}`))
	return lines.join("\n")
}

const studio = {url: "m1", title: "the studio kniterate", make: "Kniterate", model: "Kniterate", gauge: 7, needles: 252, carriers: ["1", "2", "3", "4", "5", "6"]}
const NONE = {dry: null, steamed: null, wet: null, full: null}
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
	yarns: [{url: "y1", title: "lambswool", tex: 140, relaxesLike: "wool", colour: null}],
	plated: false,
	tex: 140,
	swatches: [swatch()],
	...overrides,
})
const profiles = (carriers = {"3": carrier()}) => ({machine: studio, carriers, missing: [], urls: []})

test("without profiles, the size is as it always was", () => {
	const guessed = checkKnitout(knitout(), null, {gauge: 7})
	near(guessed.size.states.dry.width.mm, 72.57142857142857)
	near(guessed.size.states.dry.length.mm, 27.577142857142857)
	assert.equal(guessed.size.states.dry.length.rows, 10)
	assert.equal(guessed.size.sources[0].tier, "guess")
	assert.equal(guessed.size.sources[0].count, 200)
	assert.equal(guessed.size.sources[0].tightness, null)
	near(guessed.yarn[0].metres, 2.7577142857142785)

	const measured = checkKnitout(knitout(), null, {gauge: 7, fabric: {stitches: {"5": {across: 27.5, up: 70}}, tex: 67}})
	near(measured.size.states.dry.width.mm, 72.7272727272727)
	near(measured.size.states.dry.length.mm, 14.285714285714286)
	assert.equal(measured.size.sources[0].tier, "measured")
	near(measured.size.sources[0].tightness, 5.923610558591906)
	near(measured.size.sources[0].gsm, 178.22)
	near(measured.yarn[0].grams, 0.18516363636363675)
	assert.equal(measured.size.stitches, undefined)
	assert.equal(measured.size.relaxed, undefined)
})

test("a measured swatch sizes the knitting, in each state", () => {
	const result = checkKnitout(knitout(), null, {gauge: 7, profiles: profiles()})
	const {dry, wet, steamed} = result.size.states
	near(dry.width.mm, (20 * 100) / 27.5)
	near(dry.length.mm, (10 * 100) / 70)
	assert.equal(dry.length.rows, 10)
	assert.equal(steamed, null)
	assert.ok(wet.width.mm < dry.width.mm)
	assert.equal(wet.estimated, true)
	assert.equal(dry.estimated, false)
	const [source] = result.size.sources
	assert.equal(source.carrier, "3")
	assert.equal(source.stitch, "5")
	assert.equal(source.structure, "jersey")
	assert.equal(source.tier, "measured")
	assert.equal(source.count, 200)
})

test("steamed is there when it was measured", () => {
	const steamed = swatch({relaxed: {...NONE, dry: {wales: 27.5, courses: 70}, steamed: {wales: 29, courses: 74}}})
	const result = checkKnitout(knitout(), null, {gauge: 7, profiles: profiles({"3": carrier({swatches: [steamed]})})})
	near(result.size.states.steamed.width.mm, (20 * 100) / 29)
})

test("a rib cuff and a jersey body are each sized from their own structure", () => {
	const cuff = knitout({width: 16, rows: 4, pattern: "FFBB", rack: 0.5})
	const body = knitout({width: 16, rows: 4})
	// the cuff, then the body, on the same carrier
	const text = [...cuff.split("\n").slice(0, -1), ...body.split("\n").slice(3)].join("\n")
	const result = checkKnitout(text, null, {gauge: 7, profiles: profiles()})
	const tiers = Object.fromEntries(result.size.sources.map(source => [source.structure, source.tier]))
	assert.deepEqual(tiers, {"rib-2x2": "guess", jersey: "measured"})
})

test("a carrier that isn't linked is sized as it always was", () => {
	const text = knitout({carriers: ["3", "4"], rows: 10})
	const linked = profiles({"3": carrier()})
	const guessed = checkKnitout(text, null, {gauge: 7, profiles: linked})
	const tierOf = (result, c) => result.size.sources.find(source => source.carrier === c).tier
	assert.equal(tierOf(guessed, "3"), "measured")
	assert.equal(tierOf(guessed, "4"), "guess")
	const kept = checkKnitout(text, null, {gauge: 7, profiles: linked, fabric: {stitches: {"5": {across: 27.5, up: 70}}}})
	assert.equal(tierOf(kept, "4"), "measured")
})

test("the yarn weighs what its tex says", () => {
	const result = checkKnitout(knitout(), null, {gauge: 7, profiles: profiles()})
	const [{metres, grams}] = result.yarn
	near(grams, (metres * 140) / 1000)
})

test("a plated pair that's too fine says so", () => {
	const two = [{url: "y1", tex: 33, relaxesLike: "wool"}, {url: "y2", tex: 33, relaxesLike: "wool"}]
	const result = checkKnitout(knitout(), null, {gauge: 7, profiles: profiles({"3": carrier({yarns: two, plated: true, tex: 66, swatches: []})})})
	assert.ok(result.size.notes.some(note => /Nm 6–8/.test(note)), result.size.notes.join("; "))
})

test("knitting at another roller than the swatch says so", () => {
	const result = checkKnitout(knitout({extra: ["x-roller-advance 150"]}), null, {gauge: 7, profiles: profiles()})
	assert.ok(
		result.size.notes.some(note => /roller 100, this at 150/.test(note)),
		result.size.notes.join("; "),
	)
})

test("the machine's limits come from its profile", () => {
	assert.deepEqual(machineLimits(null).needles, 252)
	assert.equal(machineLimits({machine: {...studio, needles: 100}}).needles, 100)
	const wide = checkKnitout(knitout({width: 120, rows: 2}), null, {gauge: 7, profiles: {...profiles(), machine: {...studio, needles: 100}}})
	assert.ok(wide.problems.some(problem => problem.kind === "width"))
})

test("without profiles, a washed swatch's numbers are the washed state's", () => {
	const fabric = {relax: "wet", stitches: {"5": {across: 27.5, up: 70}}}
	const result = checkKnitout(knitout(), null, {gauge: 7, fabric})
	near(result.size.states.wet.width.mm, (20 * 100) / 27.5)
	assert.equal(result.size.states.wet.estimated, false)
})

test("a machine's named as its profile names it, a kniterate as the kniterate", () => {
	const wide = checkKnitout(knitout({width: 120, rows: 2}), null, {gauge: 7, profiles: {...profiles(), machine: {...studio, needles: 100}}})
	const text = wide.problems.find(problem => problem.kind === "width").text
	assert.match(text, /: the studio kniterate's beds are 100$/)
	assert.equal(machineLimits(null).name, "the kniterate")
	assert.equal(machineLimits({machine: {...studio, title: ""}}).name, "the kniterate")
})

test("a rib piece knitted as its swatch was comes out as wide as the swatch", () => {
	const rib = swatch({structure: "rib-2x2", needles: 16, rows: 20, relaxed: {...NONE, dry: {wales: 16, courses: 140}}})
	const result = checkKnitout(knitout({width: 16, rows: 20, pattern: "FFBB", rack: 0.5}), null, {gauge: 7, profiles: profiles({"3": carrier({swatches: [rib]})})})
	near(result.size.states.dry.width.mm, 100)
	near(result.size.states.dry.length.mm, (20 * 100) / 140)
})

test("a swatch half measured steamed doesn't stop the check", () => {
	const half = swatch({relaxed: {...NONE, steamed: {wales: 29, courses: null}}})
	assert.doesNotThrow(() => checkKnitout(knitout(), null, {gauge: 7, profiles: profiles({"3": carrier({swatches: [half]})})}))
})

test("profiles that link nothing leave a washed fabric's numbers as they were", () => {
	const fabric = {relax: "wet", stitches: {"5": {across: 27.5, up: 70}}, tex: 67, around: 5}
	const tube = knitout({width: 20, rows: 10, pattern: null})
	const without = checkKnitout(tube, null, {gauge: 7, fabric})
	const empty = checkKnitout(tube, null, {gauge: 7, fabric, profiles: {machine: null, carriers: {}, missing: [], urls: []}})
	near(empty.size.sources[0].gsm, without.size.sources[0].gsm)
	assert.deepEqual(empty.size.on, without.size.on)
	// (as the code before profiles had it: 192 g/m², washed)
	near(without.size.sources[0].gsm, 192.29, 0.01)
})

test("steamed main yarn, and a waste yarn nothing's measured of: every state still has a size", () => {
	const steamed = swatch({relaxed: {...NONE, steamed: {wales: 29, courses: 74}}})
	const result = checkKnitout(knitout({carriers: ["1", "3"], rows: 20}), null, {gauge: 7, profiles: profiles({"3": carrier({swatches: [steamed]})})})
	assert.ok(result.size.states.steamed)
	assert.equal(result.size.states.steamed.estimated, true)
	assert.ok(result.size.states.dry)
})

test("each source says how many needles and rows it knitted", () => {
	const result = checkKnitout(knitout({carriers: ["1", "3"], rows: 20}), null, {gauge: 7, profiles: profiles()})
	const main = result.size.sources.find(source => source.carrier === "3")
	assert.equal(main.needles, 20)
	assert.equal(main.rows, 10)
	const rib = checkKnitout(knitout({width: 8, rows: 2, pattern: "FB", rack: 0.5}), null, {gauge: 7})
	assert.equal(rib.size.sources[0].needles, 8)
})
