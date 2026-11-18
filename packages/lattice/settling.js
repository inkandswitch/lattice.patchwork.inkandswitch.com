import {apply, newMachine} from "./knitting.js"
import {firstLoop, newFabric, relax, sizer, strain} from "./loopsim.js"

// the fabric settling (loopsim.js's relax) on a machine of its own: what
// settling-worker.js runs off the page's thread, or settler.js on it, where
// there's no worker. it's given the .k's ops once, and then asked, again and
// again, to be at an op and settle a little more; it answers with copies of
// what the views draw. the views keep their own machines, for which loop
// joins which: a loop's the same loop on both, its number the order it was
// made in
//
// a request: {upTo (the ops done: fewer than last time, and the machine
// starts again), budget (ms to settle for; Infinity, till it's settled), gap,
// inflate, squash, grab (as relax has them), size (sizeArgs's json)}
//
// an answer: {upTo, count, xs, ys, zs, slack, pinned, strain (each loop's,
// as loopsim's strain has it), moved (as relax returns it)}, each array
// `count` long

// what sizer's given, as json: plain, so it can go to a worker
export function sizeArgs(settings, profiles) {
	return JSON.stringify({
		fabric: settings?.fabric ?? null,
		yarns: settings?.yarns ?? null,
		gauge: settings?.gauge ?? 7,
		profiles: profiles ?? null,
	})
}

export function newSettling() {
	let ops = []
	let carriers = []
	let machine = newMachine()
	let fabric = newFabric()
	let done = 0
	let fresh = true // (nothing's laid out yet: the next step's a jump)
	let sized = null
	let size = sizer()
	const yarnOf = name => Math.max(0, carriers.indexOf(name)) % 6

	function restart() {
		machine = newMachine()
		fabric = newFabric()
		done = 0
		fresh = true
	}

	function sizeOf(args) {
		if (args !== sized) {
			sized = args
			size = sizer(args ? JSON.parse(args) : {})
		}
		return size
	}

	function answer(moved) {
		const count = fabric.count
		const strains = new Float32Array(count)
		for (let i = firstLoop(machine); i < count; i++) strains[i] = strain(fabric, i)
		return {
			upTo: done,
			count,
			xs: fabric.xs.slice(0, count),
			ys: fabric.ys.slice(0, count),
			zs: fabric.zs.slice(0, count),
			slack: fabric.slack.slice(0, count),
			pinned: fabric.pinned.slice(0, count),
			strain: strains,
			moved,
		}
	}

	const settling = {
		// a new .k: what's settled is forgotten
		load(newOps, newCarriers) {
			ops = newOps ?? []
			carriers = newCarriers ?? []
			restart()
		},
		// a message, as the settler sends them: {type: "load", gen, ops,
		// carriers} (no answer), or {type: "step", gen, request}, answered
		// {gen, answer}
		handle(message) {
			if (message.type === "load") settling.load(message.ops, message.carriers)
			else if (message.type === "step") return {gen: message.gen, answer: settling.step(message.request)}
			return null
		},
		step({upTo, budget = Infinity, gap = 0, inflate = 0, squash, grab = null, size: args = null}) {
			const to = Math.max(0, Math.min(ops.length, Math.floor(upTo)))
			// (back: from nothing; and from nothing, laid out at once)
			if (to < done) restart()
			const jump = fresh
			fresh = false
			for (; done < to; done++) apply(machine, ops[done], done, yarnOf)
			const options = {gap, inflate, squash, grab, size: sizeOf(args)}
			let moved = jump ? relax(fabric, machine, 0, options) : 0
			const until = budget === Infinity ? Infinity : performance.now() + budget
			moved = Math.max(moved, relax(fabric, machine, Infinity, {...options, until}))
			return answer(moved)
		},
	}
	return settling
}
