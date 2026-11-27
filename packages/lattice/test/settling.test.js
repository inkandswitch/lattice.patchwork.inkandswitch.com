import {test} from "node:test"
import assert from "node:assert/strict"
import {apply, newMachine, readKnitout} from "../knitting.js"
import {newFabric, relax, sizer, strain} from "../loopsim.js"
import {newSettling, sizeArgs} from "../settling.js"
import {settler} from "../settler.js"

// a little jersey: cast on with tucks, then rows of knit, both ways
function jersey(needles = 8, rows = 6) {
	const lines = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", "in 3"]
	for (let n = needles; n >= 1; n -= 2) lines.push(`tuck - f${n} 3`)
	for (let n = 1; n <= needles; n += 2) lines.push(`tuck + f${n} 3`)
	for (let r = 0; r < rows; r++) {
		const dir = r % 2 ? "+" : "-"
		const ns = Array.from({length: needles}, (_, i) => i + 1)
		for (const n of r % 2 ? ns : ns.reverse()) lines.push(`knit ${dir} f${n} 3`)
	}
	lines.push("out 3")
	return readKnitout(lines.join("\n"))
}

const request = (upTo, more = {}) => ({upTo, budget: Infinity, gap: 0, inflate: 0, squash: 0.3, size: sizeArgs({}, null), grab: null, ...more})

// what the views did themselves: the ops on a machine, then a jump's
// relax, then relaxed till it's settled
function direct(knitout, upTo, options = {}) {
	const machine = newMachine()
	const yarnOf = name => Math.max(0, knitout.carriers.indexOf(name)) % 6
	for (let i = 0; i < upTo; i++) apply(machine, knitout.ops[i], i, yarnOf)
	const fabric = newFabric()
	const opts = {gap: 0, inflate: 0, squash: 0.3, size: sizer({}), ...options}
	relax(fabric, machine, 0, opts)
	relax(fabric, machine, Infinity, opts)
	return {fabric, machine}
}

test("settling a .k gives what relaxing it here does", () => {
	const knitout = jersey()
	const settling = newSettling()
	settling.load(knitout.ops, knitout.carriers)
	const answer = settling.step(request(knitout.ops.length))
	const {fabric, machine} = direct(knitout, knitout.ops.length)
	assert.equal(answer.count, machine.loops.length)
	assert.ok(answer.count >= 50, `only ${answer.count} loops`)
	assert.ok(answer.strain.some(s => s > 0), "nothing's strained: the strain test proves nothing")
	assert.deepEqual([...answer.xs], [...fabric.xs.subarray(0, fabric.count)])
	assert.deepEqual([...answer.ys], [...fabric.ys.subarray(0, fabric.count)])
	assert.deepEqual([...answer.zs], [...fabric.zs.subarray(0, fabric.count)])
	assert.deepEqual([...answer.pinned], [...fabric.pinned.subarray(0, fabric.count)])
	assert.deepEqual([...answer.slack], [...fabric.slack.subarray(0, fabric.count)])
	const strains = Array.from({length: fabric.count}, (_, i) => Math.fround(strain(fabric, i)))
	assert.deepEqual([...answer.strain], strains)
})

test("going back to an earlier op is the same as going there fresh", () => {
	const knitout = jersey()
	const half = Math.floor(knitout.ops.length / 2)
	const settling = newSettling()
	settling.load(knitout.ops, knitout.carriers)
	settling.step(request(knitout.ops.length))
	const back = settling.step(request(half))
	const fresh = newSettling()
	fresh.load(knitout.ops, knitout.carriers)
	const there = fresh.step(request(half))
	assert.equal(back.count, there.count)
	assert.deepEqual([...back.xs], [...there.xs])
	assert.deepEqual([...back.ys], [...there.ys])
})

test("a new .k starts from nothing", () => {
	const big = jersey(8, 6)
	const small = jersey(4, 2)
	const settling = newSettling()
	settling.load(big.ops, big.carriers)
	settling.step(request(big.ops.length))
	settling.load(small.ops, small.carriers)
	const answer = settling.step(request(small.ops.length))
	const {fabric} = direct(small, small.ops.length)
	assert.equal(answer.count, fabric.count)
	assert.deepEqual([...answer.xs], [...fabric.xs.subarray(0, fabric.count)])
})

test("the answer's arrays are its own, not the fabric's", () => {
	const knitout = jersey()
	const settling = newSettling()
	settling.load(knitout.ops, knitout.carriers)
	const answer = settling.step(request(knitout.ops.length))
	const xs = [...answer.xs]
	settling.step(request(knitout.ops.length, {squash: 0.1}))
	assert.deepEqual([...answer.xs], xs)
})

test("sizes go over as json, and come back to the same sizer", () => {
	const settings = {fabric: null, yarns: null, gauge: 7, speed: 1, squash: 0.3}
	const args = sizeArgs(settings, null)
	assert.equal(typeof args, "string")
	assert.equal(sizer(JSON.parse(args)).key, sizer(settings).key)
})

// ── the settler: no Worker in node, so it settles on the page, through the
// same messages the worker has

const tick = () => new Promise(resolve => setTimeout(resolve, 5))
function watched(options) {
	let resolve = () => {}
	const s = settler({...options, onUpdate: () => resolve()})
	s.next = () => new Promise(r => (resolve = r))
	return s
}

test("the settler answers, and says so", async () => {
	const knitout = jersey()
	const s = watched()
	s.load(knitout.ops, knitout.carriers)
	assert.equal(s.fabric.count, 0)
	const coming = s.next()
	assert.equal(s.settle(request(knitout.ops.length)), true)
	await coming
	assert.equal(s.fabric.count, direct(knitout, knitout.ops.length).machine.loops.length)
	s.destroy()
})

test("settled, and asked the same, the settler stops asking", async () => {
	const knitout = jersey()
	const s = watched()
	s.load(knitout.ops, knitout.carriers)
	let asked = 0
	while (s.settle(request(knitout.ops.length))) {
		assert.ok(++asked < 50, "still asking") // (z eases a step an answer: a few)
		await s.next()
	}
	let updates = 0
	s.onUpdate = () => updates++
	await tick()
	assert.equal(updates, 0)
	assert.equal(s.settle(request(knitout.ops.length)), false)
	s.destroy()
})

test("an answer from before a new .k is dropped", async () => {
	const big = jersey(8, 6)
	const small = jersey(4, 2)
	const s = watched()
	s.load(big.ops, big.carriers)
	s.settle(request(big.ops.length))
	s.load(small.ops, small.carriers)
	await tick()
	assert.equal(s.fabric.count, 0)
	const coming = s.next()
	assert.equal(s.settle(request(small.ops.length)), true)
	await coming
	assert.equal(s.fabric.count, direct(small, small.ops.length).machine.loops.length)
	s.destroy()
})

test("asked again while it's settling, it asks once the answer's in", async () => {
	const knitout = jersey()
	const half = Math.floor(knitout.ops.length / 2)
	const s = watched()
	s.load(knitout.ops, knitout.carriers)
	const first = s.next()
	s.settle(request(half))
	assert.equal(s.settle(request(knitout.ops.length)), true)
	await first
	assert.equal(s.fabric.upTo, half)
	const second = s.next()
	assert.equal(s.settle(request(knitout.ops.length)), true)
	await second
	assert.equal(s.fabric.upTo, knitout.ops.length)
	s.destroy()
})

test("with a limit, it stops asking after so many", async () => {
	const knitout = jersey()
	const s = watched({limit: 0})
	s.load(knitout.ops, knitout.carriers)
	const coming = s.next()
	s.settle(request(knitout.ops.length, {budget: 0}))
	await coming
	assert.ok(s.fabric.moved > 0.01, "it settled at once: the limit's not tried")
	assert.equal(s.settle(request(knitout.ops.length, {budget: 0})), false)
	s.destroy()
})

test("a new .k's settler isn't ready till it's answered", async () => {
	const knitout = jersey()
	const s = watched()
	s.load(knitout.ops, knitout.carriers)
	assert.equal(s.ready, false)
	const coming = s.next()
	s.settle(request(knitout.ops.length))
	assert.equal(s.ready, false)
	await coming
	assert.equal(s.ready, true)
	s.load(knitout.ops, knitout.carriers)
	assert.equal(s.ready, false)
	s.destroy()
})

test("an answer for an op later than the one asked for isn't ready", async () => {
	const knitout = jersey()
	const half = Math.floor(knitout.ops.length / 2)
	const s = watched()
	s.load(knitout.ops, knitout.carriers)
	let coming = s.next()
	s.settle(request(knitout.ops.length))
	await coming
	assert.equal(s.ready, true)
	coming = s.next()
	s.settle(request(half))
	assert.equal(s.ready, false, "the fabric's from further on than the view's machine")
	await coming
	assert.equal(s.ready, true)
	assert.equal(s.fabric.upTo, half)
	s.destroy()
})

test("an answer for an earlier op than asked is ready: it's behind, not wrong", async () => {
	const knitout = jersey()
	const half = Math.floor(knitout.ops.length / 2)
	const s = watched()
	s.load(knitout.ops, knitout.carriers)
	const coming = s.next()
	s.settle(request(half))
	await coming
	s.settle(request(knitout.ops.length))
	assert.equal(s.ready, true)
	s.destroy()
})

// each row's height, on the whole: a jersey's rows are `needles` loops each,
// after the cast-on's
function rowHeights(fabric, needles) {
	const heights = []
	for (let at = 0; at < fabric.count; at += needles) {
		let sum = 0
		const to = Math.min(fabric.count, at + needles)
		for (let i = at; i < to; i++) sum += fabric.ys[i]
		heights.push(sum / (to - at))
	}
	return heights
}

// only the newest `limit` loops settle: the older ones are still knitted, and
// still hang below them, a row apart, wherever the newer ones have gone
for (const [how, settle] of [
	["laid out at once", (fabric, machine, knitout, opts) => {
		knitout.ops.forEach((op, i) => apply(machine, op, i, () => 0))
		relax(fabric, machine, 0, opts)
		relax(fabric, machine, Infinity, opts)
	}],
	["knitted a little at a time", (fabric, machine, knitout, opts) => {
		knitout.ops.forEach((op, i) => {
			apply(machine, op, i, () => 0)
			if (i % 5 === 0) relax(fabric, machine, 20, opts)
		})
		relax(fabric, machine, Infinity, opts)
	}],
]) {
	test(`the rows older than the limit hang below the rest, ${how}`, () => {
		const needles = 8
		const knitout = jersey(needles, 40)
		const machine = newMachine()
		const fabric = newFabric()
		const limit = 100
		settle(fabric, machine, knitout, {gap: 0, inflate: 0, squash: 0.3, size: sizer({}), limit})
		assert.ok(fabric.count > 3 * limit, `only ${fabric.count} loops`)
		const heights = rowHeights(fabric, needles)
		for (let r = 1; r < heights.length; r++) {
			const step = heights[r] - heights[r - 1]
			assert.ok(step > 0.3 && step < 1.5, `row ${r} is ${step.toFixed(2)} above the row before`)
		}
	})
}
