import {across} from "./knitting.js"

// where every loop of the fabric hangs, worked out from how they're joined:
// each loop is pulled through its parents (a wale's length below it), and
// its yarn runs on from the loop before (a needle's pitch across, or a row
// up, at the end of a pass). the loops still on needles are pinned to them;
// the rest settle, like cloth does. so a cast-on stays a straight edge,
// short rows bulge the fabric and stretch the loops on the needles they
// skipped, and transfers lean the wales they move.
//
// positions are in needle pitches: x across the bed, y up (the needles' hooks
// are at 0, the fabric hangs below)

export const WALE = 0.72
// only the newest loops move; older ones are where they settled
const LIMIT = 20000
// so many new loops at once (a seek) and the fabric's laid out afresh
const COLD = 400
const COLD_SWEEPS = 50
// how hard the takedown holds the fabric's bottom edge level; and how much
// each loop keeps to the needle it was knitted on
const TAKEDOWN = 0.25
const KEEP_TO_NEEDLE = 0.03

export function newFabric() {
	return {xs: new Float32Array(1024), ys: new Float32Array(1024), count: 0, pinned: new Uint8Array(1024)}
}

function grow(fabric, size) {
	if (fabric.xs.length >= size) return
	let length = fabric.xs.length
	while (length < size) length *= 2
	for (const name of ["xs", "ys"]) {
		const grown = new Float32Array(length)
		grown.set(fabric[name])
		fabric[name] = grown
	}
	fabric.pinned = new Uint8Array(length)
}

// the loops a fabric shows: the newest LIMIT of them
export function firstLoop(machine) {
	return Math.max(0, machine.loops.length - LIMIT)
}

// lay out loops that are new since last time, then settle the fabric some
// `sweeps`: how far anything moved, at most
export function relax(fabric, machine, sweeps) {
	const {loops} = machine
	const count = loops.length
	grow(fabric, count)
	const start = firstLoop(machine)
	const {xs, ys, pinned} = fabric
	pinned.fill(0, 0, count)
	for (const held of machine.held.values()) {
		const x = across(machine, held.needle)
		for (const loop of held.loops) {
			pinned[loop.id] = 1
			xs[loop.id] = x
			ys[loop.id] = 0
		}
	}

	if (!fabric.count || count - fabric.count > COLD || count < fabric.count) {
		// hang each loop as far down as its wale's deepest: then settle
		const depth = new Int32Array(count)
		for (let i = count - 1; i >= start; i--) {
			for (const parent of loops[i].parents) depth[parent] = Math.max(depth[parent], depth[i] + 1)
			if (!pinned[i]) {
				xs[i] = loops[i].x
				ys[i] = -Math.max(1, depth[i]) * WALE
			}
		}
		sweeps = Math.max(sweeps, COLD_SWEEPS)
	} else {
		for (let i = fabric.count; i < count; i++) {
			if (pinned[i]) continue
			xs[i] = loops[i].x
			ys[i] = -WALE
		}
	}
	fabric.count = count

	const before = Math.min(count, fabric.count)
	const was = sweeps ? [xs.slice(start, count), ys.slice(start, count)] : null
	const nudge = (a, b, rest, stretchy) => {
		const wa = pinned[a] ? 0 : 1
		const wb = pinned[b] ? 0 : 1
		if (!wa && !wb) return
		let dx = xs[b] - xs[a]
		let dy = ys[b] - ys[a]
		let distance = Math.hypot(dx, dy)
		if (distance < 1e-6) {
			dy = -1e-3
			distance = 1e-3
		}
		// a loop on a needle can be pulled long (a short row's left it
		// behind), but not squashed
		if (stretchy && distance > rest) return
		const share = (distance - rest) / distance / (wa + wb)
		const mx = dx * share
		const my = dy * share
		xs[a] += mx * wa
		ys[a] += my * wa
		xs[b] -= mx * wb
		ys[b] -= my * wb
	}

	// the bottom edge: the loops cast on, or the oldest the fabric shows
	const bottom = []
	for (let i = start; i < count; i++) {
		const loop = loops[i]
		if (!pinned[i] && (loop.cast || (loop.parents.length && loop.parents.every(parent => parent < start)))) {
			bottom.push(i)
		}
	}

	for (let sweep = 0; sweep < sweeps; sweep++) {
		// the takedown grips the bottom edge, and holds it level
		let level = 0
		for (const i of bottom) level += ys[i] / bottom.length
		for (const i of bottom) ys[i] += (level - ys[i]) * TAKEDOWN
		for (let i = start; i < count; i++) {
			if (pinned[i]) continue
			xs[i] += (loops[i].n + (loops[i].back ? machine.rack : 0) - xs[i]) * KEEP_TO_NEEDLE
		}
		// newest first: each row pushes the ones it was pulled through down
		for (let i = count - 1; i >= start; i--) {
			const loop = loops[i]
			for (const parent of loop.parents) {
				if (parent < start) continue
				nudge(i, parent, WALE, pinned[i])
				// and a parent stays below
				const above = ys[i] - ys[parent] - WALE * 0.5
				if (above < 0) {
					const wc = pinned[i] ? 0 : 1
					const wp = pinned[parent] ? 0 : 1
					if (wc + wp) {
						ys[i] -= (above * wc) / (wc + wp)
						ys[parent] += (above * wp) / (wc + wp)
					}
				}
			}
			if (loop.prev != null && loop.prev >= start) {
				const along = Math.abs(loop.x - loops[loop.prev].x)
				// the yarn goes on to the next needle, or (turning) up a row
				nudge(i, loop.prev, Math.max(along, WALE), false)
			}
		}
	}
	let moved = 0
	if (was) {
		for (let i = start; i < before; i++) {
			moved = Math.max(moved, Math.abs(xs[i] - was[0][i - start]), Math.abs(ys[i] - was[1][i - start]))
		}
	}
	return moved
}
