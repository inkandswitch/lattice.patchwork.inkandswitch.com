import {test} from "node:test"
import assert from "node:assert/strict"
import {readKnitout} from "../knitting.js"
import {programOf} from "../knitscape-program.js"
import {Op} from "../vendor/knitscape/shared/opData.js"
import {generateTopology} from "../vendor/knitscape/knitbit/simulation/topology.js"

const k = lines => readKnitout([";!knitout-2", ";;Carriers: 1 2 3 4 5 6", ...lines].join("\n"))
const row = (program, y) => Array.from({length: program.width}, (_, x) => program.ops.pixel(x, y))
const E = Op.EMPTY

test("a pass is a row: its carrier, its direction, a cell a needle", () => {
	const program = programOf(k(["in 3", "tuck - f4 3", "tuck - f2 3", "knit + f1 3", "knit + f2 3", "knit + f3 3", "knit + f4 3"]))
	assert.equal(program.width, 4)
	assert.equal(program.height, 2)
	assert.deepEqual(row(program, 0), [E, Op.FTUCK, E, Op.FTUCK])
	assert.deepEqual(row(program, 1), [Op.FKNIT, Op.FKNIT, Op.FKNIT, Op.FKNIT])
	assert.deepEqual(program.direction, ["left", "right"])
	// (carrier 3 is the third yarn: its colour's the third)
	assert.deepEqual(program.yarnFeeder, [3, 3])
	assert.deepEqual(program.racking, [0, 0])
	assert.equal(program.castOn, false)
})

test("needles are counted from the leftmost the .k uses", () => {
	const program = programOf(k(["in 3", "knit + f10 3", "knit + f12 3"]))
	assert.equal(program.width, 3)
	assert.equal(program.min, 10)
	assert.deepEqual(row(program, 0), [Op.FKNIT, E, Op.FKNIT])
})

test("a pass knitting a needle's front and back is two rows, the same way", () => {
	const program = programOf(k(["in 3", "knit + f1 3", "knit + b1 3", "knit + f2 3"]))
	assert.equal(program.height, 2)
	assert.deepEqual(row(program, 0), [Op.FKNIT, E])
	assert.deepEqual(row(program, 1), [Op.BKNIT, Op.FKNIT])
	assert.deepEqual(program.direction, ["right", "right"])
})

test("a carrier changing, or the direction, starts a row", () => {
	const program = programOf(k(["in 3", "in 5", "knit + f1 3", "knit + f2 5", "knit - f2 5"]))
	assert.equal(program.height, 3)
	assert.deepEqual(program.yarnFeeder, [3, 5, 5])
	assert.deepEqual(program.direction, ["right", "right", "left"])
})

test("tucks and misses on either bed", () => {
	const program = programOf(k(["in 3", "tuck + f1 3", "miss + f2 3", "tuck + b3 3"]))
	assert.deepEqual(row(program, 0), [Op.FTUCK, Op.MISS, Op.BTUCK])
})

test("transfers are a row of no yarn, racked to where they go", () => {
	// (front 2 to back 3: knitout's rack -1, knitscape's +1, its back needle
	// n opposite front n − rack)
	const program = programOf(k(["in 3", "knit + f2 3", "knit + f3 3", "rack -1", "xfer f2 b3", "rack 0", "xfer b3 f3"]))
	assert.equal(program.height, 3)
	assert.deepEqual(row(program, 1), [Op.FTB, E])
	assert.equal(program.yarnFeeder[1], null)
	assert.equal(program.racking[1], 1)
	assert.deepEqual(row(program, 2), [E, Op.BTF])
	assert.equal(program.racking[2], 0)
	// (and each row of no yarn goes the other way from the row before)
	assert.deepEqual(program.direction, ["right", "left", "right"])
})

test("transfers at one racking share a row, till a needle comes up twice", () => {
	const program = programOf(k(["in 3", "knit + f1 3", "knit + f2 3", "xfer f1 b1", "xfer f2 b2", "xfer b1 f1"]))
	assert.equal(program.height, 3)
	assert.deepEqual(row(program, 1), [Op.FTB, Op.FTB])
	assert.deepEqual(row(program, 2), [Op.BTF, E])
})

test("a knitting row's racking is the machine's, as knitscape has it", () => {
	const program = programOf(k(["in 3", "rack 0.25", "knit + f1 3", "knit + b1 3"]))
	assert.deepEqual(program.racking, [-0.25, -0.25])
})

test("drops are cells in a row of no yarn, and a knit with no yarn drops", () => {
	const program = programOf(k(["in 3", "knit + f1 3", "knit + b2 3", "drop f1", "knit + b2"]))
	assert.deepEqual(row(program, 1), [Op.FDROP, Op.BDROP])
	assert.equal(program.yarnFeeder[1], null)
})

test("two carriers through one op: the first one's yarn", () => {
	const program = programOf(k(["in 2 4", "knit + f1 2 4"]))
	assert.deepEqual(program.yarnFeeder, [2])
})

test("only the ops before upTo", () => {
	const knitout = k(["in 3", "knit + f1 3", "knit + f2 3", "knit - f2 3"])
	const program = programOf(knitout, {upTo: 2})
	assert.equal(program.height, 1)
	assert.deepEqual(row(program, 0), [Op.FKNIT, E])
	// (but as wide as the whole .k, so it doesn't move as it grows)
	assert.equal(program.width, 2)
})

test("no stitches: an empty program", () => {
	const program = programOf(k(["in 3", "out 3"]))
	assert.equal(program.height, 0)
	assert.equal(program.width, 1)
})

test("from empty needles, a tucked cast-on has no legs, and the knit through it has", () => {
	const program = programOf(k(["in 3", "tuck - f2 3", "tuck + f1 3", "knit - f2 3", "knit - f1 3"]))
	const {nodes, yarnPaths} = generateTopology(program, "technical")
	const rowNodes = r => nodes.filter(n => n.row === r)
	assert.ok(rowNodes(0).length > 0 && rowNodes(0).every(n => !n.isLeg), "the cast-on's tucks are heads only")
	assert.ok(rowNodes(2).some(n => n.isLeg), "the knits go through the tucks")
	assert.equal(yarnPaths.length, 1)
	assert.equal(yarnPaths[0].yarnIndex, 3)
})

test("knitting onto empty needles has nothing to go through: no legs", () => {
	const program = programOf(k(["in 3", "knit + f1 3", "knit + f2 3"]))
	const {nodes} = generateTopology(program, "technical")
	assert.ok(nodes.length > 0)
	assert.ok(nodes.every(n => !n.isLeg))
	// (knitscape's own programs start cast on: a loop on every front needle)
	const {nodes: castOn} = generateTopology({...program, castOn: undefined}, "technical")
	assert.ok(castOn.some(n => n.isLeg))
})
