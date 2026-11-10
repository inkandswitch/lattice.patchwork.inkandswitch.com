import {test} from "node:test"
import assert from "node:assert/strict"
import {newMachine, newSwatch, newYarn} from "../profile-docs.js"
import {resolveProfiles} from "../profiles.js"
import {sizer} from "../loopsim.js"

const near = (actual, expected, within = 0.01) =>
	assert.ok(Math.abs(actual - expected) < within, `${actual} isn't ${expected}`)

const yarn = (overrides = {}) => ({...newYarn(), title: "lambswool", count: {system: "Nm", value: 30, ply: 2}, ...overrides})
const swatch = (yarns, overrides = {}) => {
	const fresh = newSwatch()
	return {
		...fresh,
		title: "lambswool jersey",
		knit: {...fresh.knit, machine: "m1", feeds: [{carrier: "3", yarns, plated: false}], needles: 51, rows: 100, ...overrides.knit},
		relaxed: {...fresh.relaxed, dry: {entered: "per10", wales: 27.5, courses: 70}},
		...overrides.doc,
	}
}
const kDoc = (profiles, yarns = []) => ({"@patchwork": {type: "file"}, name: "pattern.k", profiles, yarns})

// docs by url, and a find over them that rejects for "gone"
function world(docs) {
	const map = new Map(Object.entries(docs))
	return url => (url === "gone" ? Promise.reject(new Error("gone")) : Promise.resolve(map.get(url) ?? null))
}

test("the project's only machine, when the .k names none", async () => {
	const find = world({m1: newMachine(), m2: newMachine()})
	const one = await resolveProfiles({find, k: kDoc(null), projectFiles: [{url: "m1", extension: "machine"}]})
	assert.equal(one.machine.url, "m1")
	assert.equal(one.machine.gauge, 7)
	const two = await resolveProfiles({
		find,
		k: kDoc(null),
		projectFiles: [
			{url: "m1", extension: "machine"},
			{url: "m2", extension: "machine"},
		],
	})
	assert.equal(two.machine, null)
})

test("a carrier's yarn, its tex, and its swatches", async () => {
	const find = world({m1: newMachine(), y1: yarn({swatches: ["s1"]}), s1: swatch(["y1"])})
	const resolved = await resolveProfiles({find, k: kDoc({machine: "m1", carriers: {"3": ["y1"]}})})
	const carrier = resolved.carriers["3"]
	near(carrier.tex, 66.67)
	assert.equal(carrier.plated, false)
	assert.equal(carrier.yarns[0].relaxesLike, "wool")
	assert.equal(carrier.swatches.length, 1)
	const [s] = carrier.swatches
	assert.equal(s.machine.url, "m1")
	assert.equal(s.stitch, "5")
	assert.deepEqual(s.relaxed.dry, {wales: 27.5, courses: 70})
	assert.equal(s.relaxed.steamed, null)
	assert.ok(resolved.urls.includes("s1"))
})

test("two strands, plated as the .k's yarns say, weigh together", async () => {
	const find = world({y1: yarn(), y2: yarn()})
	const yarns = [null, null, {colours: ["#ffffff", "#000000"], plated: true}]
	const resolved = await resolveProfiles({find, k: kDoc({machine: null, carriers: {"3": ["y1", "y2"]}}, yarns)})
	assert.equal(resolved.carriers["3"].plated, true)
	near(resolved.carriers["3"].tex, 133.33)
})

test("a doc that isn't a yarn isn't one", async () => {
	const find = world({k2: kDoc(null)})
	const resolved = await resolveProfiles({find, k: kDoc({machine: null, carriers: {"3": ["k2"]}})})
	assert.deepEqual(resolved.missing, [{url: "k2", why: "not a yarn"}])
	assert.equal(resolved.carriers["3"], undefined)
})

test("a swatch that doesn't feed the yarn isn't the yarn's; one listed twice is one", async () => {
	const find = world({y1: yarn({swatches: ["s1", "s2", "s1"]}), s1: swatch(["y1"]), s2: swatch(["y9"])})
	const resolved = await resolveProfiles({find, k: kDoc({machine: null, carriers: {"3": ["y1"]}})})
	assert.deepEqual(
		resolved.carriers["3"].swatches.map(s => s.url),
		["s1"],
	)
})

test("a doc that can't be found is missing, and nothing throws", async () => {
	const find = world({})
	const resolved = await resolveProfiles({find, k: kDoc({machine: "gone", carriers: {"3": ["gone"]}})})
	assert.deepEqual(resolved.missing, [
		{url: "gone", why: "not found"},
		{url: "gone", why: "not found"},
	])
	assert.equal(resolved.machine, null)
})

test("what's resolved can go to a worker", async () => {
	// (a stand-in for an automerge string: an object, with a method)
	const strange = {toString: () => "strange"}
	const find = world({m1: {...newMachine(), title: strange, make: strange}, y1: yarn({title: strange, swatches: ["s1"]}), s1: swatch(["y1"], {doc: {title: strange}})})
	const resolved = await resolveProfiles({find, k: kDoc({machine: "m1", carriers: {"3": ["y1"]}})})
	assert.doesNotThrow(() => structuredClone(resolved))
	assert.equal(resolved.machine.title, "strange")
})

test("the 3d view's loops are sized from the profiles", async () => {
	const find = world({m1: newMachine(), y1: yarn({swatches: ["s1"]}), s1: swatch(["y1"])})
	const profiles = await resolveProfiles({find, k: kDoc({machine: "m1", carriers: {"3": ["y1"]}})})
	const size = sizer({gauge: 7, profiles})
	const pitch = 25.4 / 7
	near(size("5", 2).across, 100 / 27.5 / pitch)
})

test("a swatch of the yarn in the project counts, even if the yarn's list missed it", async () => {
	const find = world({y1: yarn({swatches: []}), s1: swatch(["y1"])})
	const resolved = await resolveProfiles({find, k: kDoc({machine: null, carriers: {"3": ["y1"]}}), projectFiles: [{url: "s1", extension: "swatch"}]})
	assert.deepEqual(
		resolved.carriers["3"].swatches.map(s => s.url),
		["s1"],
	)
})

test("profiles that link nothing size the 3d view as if there were none", () => {
	const fabric = {relax: "wet", stitches: {"5": {across: 27.5, up: 70}}}
	const without = sizer({gauge: 7, fabric})("5", 2)
	const empty = sizer({gauge: 7, fabric, profiles: {machine: null, carriers: {}, missing: [], urls: []}})("5", 2)
	near(empty.up, without.up, 0.0001)
	near(empty.across, without.across, 0.0001)
})
