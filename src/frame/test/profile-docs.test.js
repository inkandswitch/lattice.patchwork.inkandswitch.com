import {test} from "node:test"
import assert from "node:assert/strict"
import {
	MACHINE_TYPE,
	RELAX_STATES,
	STRUCTURES,
	SWATCH_TYPE,
	YARN_TYPE,
	datatypeFor,
	indexChanges,
	newMachine,
	newSwatch,
	newYarn,
	profileKind,
	swatchDensity,
	swatchYarns,
} from "../profile-docs.js"

const near = (actual, expected, within = 0.01) =>
	assert.ok(Math.abs(actual - expected) < within, `${actual} isn't ${expected}`)

test("the states and structures", () => {
	assert.deepEqual(RELAX_STATES, ["dry", "steamed", "wet", "full"])
	assert.deepEqual(STRUCTURES, ["jersey", "rib-1x1", "rib-2x2", "other"])
})

test("a new machine is a kniterate", () => {
	const machine = newMachine()
	assert.equal(machine["@patchwork"].type, MACHINE_TYPE)
	assert.equal(machine.gauge, 7)
	assert.equal(machine.needles, 252)
	assert.equal(machine.beds, 2)
	assert.deepEqual(machine.carriers, ["1", "2", "3", "4", "5", "6"])
	assert.deepEqual(machine.stitchSizes, {min: 0, max: 15})
	assert.equal(machine.floatLimit, 7)
})

test("a new swatch is guessed jersey, measured in no state", () => {
	const swatch = newSwatch()
	assert.equal(swatch.knit.sure, "guessed")
	assert.equal(swatch.knit.structure, "jersey")
	assert.deepEqual(swatch.relaxed, {dry: null, steamed: null, wet: null, full: null})
})

test("which kind of profile a doc is", () => {
	assert.equal(profileKind(newYarn()), "yarn")
	assert.equal(profileKind(newSwatch()), "swatch")
	assert.equal(profileKind(newMachine()), "machine")
	assert.equal(profileKind({"@patchwork": {type: "file"}}), null)
	assert.equal(profileKind(null), null)
})

test("a datatype makes the doc, and keeps its title", () => {
	const doc = {}
	const datatype = datatypeFor(SWATCH_TYPE)
	datatype.init(doc)
	assert.deepEqual(doc.relaxed, {dry: null, steamed: null, wet: null, full: null})
	assert.equal(doc["@patchwork"], undefined)
	assert.equal(datatype.getTitle({title: "x"}), "x")
	const yarn = {}
	datatypeFor(YARN_TYPE).init(yarn)
	datatypeFor(YARN_TYPE).setTitle(yarn, "lambswool")
	assert.equal(yarn.title, "lambswool")
})

const swatchWith = (knit, state) => ({...newSwatch(), knit: {...newSwatch().knit, ...knit}, relaxed: {...newSwatch().relaxed, dry: state}})

test("density entered per 10 cm is as it was entered", () => {
	const swatch = swatchWith({}, {entered: "per10", wales: 49, courses: 74})
	assert.deepEqual(swatchDensity(swatch, "dry"), {wales: 49, courses: 74})
})

test("density entered in mm is worked out over the needles and rows", () => {
	const swatch = swatchWith({needles: 51, rows: 100}, {entered: "mm", width: 186, height: 142})
	const density = swatchDensity(swatch, "dry")
	near(density.wales, 27.42)
	near(density.courses, 70.42)
})

test("mm without the needles knows only what it can", () => {
	const swatch = swatchWith({needles: null, rows: 100}, {entered: "mm", width: 98, height: 142})
	const density = swatchDensity(swatch, "dry")
	assert.equal(density.wales, null)
	near(density.courses, 70.42)
	assert.equal(swatchDensity(swatchWith({needles: null, rows: null}, {entered: "mm", width: 98, height: 142}), "dry"), null)
	assert.equal(swatchDensity(swatchWith({}, null), "dry"), null)
	assert.equal(swatchDensity(swatchWith({}, null), "wet"), null)
})

test("the yarns a swatch was knitted from, once each", () => {
	const swatch = {...newSwatch(), knit: {...newSwatch().knit, feeds: [{carrier: "3", yarns: ["a", "b"]}, {carrier: "4", yarns: ["a"]}]}}
	assert.deepEqual(swatchYarns(swatch), ["a", "b"])
})

test("what to add to and take from the yarns' indexes", () => {
	assert.deepEqual(indexChanges(["a", "b"], ["b", "c"]), {add: ["c"], remove: ["a"]})
})
