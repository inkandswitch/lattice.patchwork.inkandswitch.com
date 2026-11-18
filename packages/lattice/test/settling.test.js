import {test} from "node:test"
import assert from "node:assert/strict"
import {apply, newMachine, readKnitout} from "../knitting.js"
import {newFabric, relax, sizer, strain} from "../loopsim.js"
import {newSettling, sizeArgs} from "../settling.js"

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

const request = (upTo, more = {}) => ({upTo, rewind: 0, budget: Infinity, gap: 0, inflate: 0, squash: 0.3, size: sizeArgs({}, null), grab: null, ...more})

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

test("a rewind starts the machine again, even at the same op", () => {
	const knitout = jersey()
	const settling = newSettling()
	settling.load(knitout.ops, knitout.carriers)
	const first = settling.step(request(knitout.ops.length))
	const again = settling.step(request(knitout.ops.length, {rewind: 1}))
	assert.equal(again.count, first.count)
	assert.deepEqual([...again.xs], [...first.xs])
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
	settling.step(request(knitout.ops.length, {rewind: 1, squash: 0.1}))
	assert.deepEqual([...answer.xs], xs)
})

test("sizes go over as json, and come back to the same sizer", () => {
	const settings = {fabric: null, yarns: null, gauge: 7, speed: 1, squash: 0.3}
	const args = sizeArgs(settings, null)
	assert.equal(typeof args, "string")
	assert.equal(sizer(JSON.parse(args)).key, sizer(settings).key)
})
