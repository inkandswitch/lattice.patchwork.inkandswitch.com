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
// are at 0, the fabric hangs below), z out of the front bed (each bed's
// fabric hangs `gap` either side of the middle)

// the yarn, by Munden's constants for plain knitting, relaxed (courses per
// unit × loop length ≈ 5.0, wales per unit × loop length ≈ 3.8): a loop
// takes 3.8 needles' worth of yarn, and its rows are 3.8 / 5.0 of a needle
// apart. a loop pulled long reaches at most half its yarn, legs straight:
// any further and the yarn itself is pulled tight
export const LOOP = 3.8
export const WALE = LOOP / 5.0
export const REACH = LOOP / 2
// only the newest loops move; older ones are where they settled
const LIMIT = 20000
// so many new loops at once (a seek) and the fabric's laid out afresh
const COLD = 400
const COLD_SWEEPS = 50
// (and how many times over its loops are hung, each pass passing what holds
// them up or down further along their wales and rows)
const HANG_PASSES = 8
// (and knitting, it's eased so much of the way to where it'd hang, each time
// there's more of it)
const REHANG = 0.5
// the takedown pulls the fabric's bottom edge down (so far each sweep), and
// holds it level (so hard); and each loop keeps to the needle it was knitted
// on (so hard)
const TAKEDOWN = 0.01
// and every loop off the needles falls (so far each sweep) as far as its yarn
// lets it: slack fabric hangs, rather than spreading out every which way. (no
// further than where it'd hang, though: a long hanging chain of loops, each
// pulled by the loops below it, would otherwise stretch)
const GRAVITY = 0.02
const LEVEL = 0.25
const KEEP_TO_NEEDLE = 0.03
// knitting's stiff pulled, and soft pushed: when there's more of it one side
// than the other (short rows), the extra rows bunch up, as far as SQUASH of a
// wale apart (unless relax is told otherwise: see settings.js). a loop on a needle gives (a little) to let fabric go on down
const SOFT = 0.15
export const SQUASH = 0.3
const GIVE = 0.25
// and each stitch holds its shape across its diagonals: it doesn't shear
// (so a tube doesn't twist) as easily as a bare grid of wales and rows would
const SHEAR = 0.5
// how hard an inflated tube's loops push out of its face, each sweep: till
// the yarn round it is pulled TAUT longer than it is
const PRESSURE = 0.03
const TAUT = 0.04
// and how stiff a tube's yarn is, round it: it rounds off the folds
const BEND = 0.15
// a loop bunched closer than a wale to the loop below it bulges out of its
// bed's face, away from the other bed (an ottoman's ridges, a short row's
// pucker): BULGE times as far as it's short of a wale. (it eases out, or
// back, EASE of the way each sweep)
const BULGE = 1.6
const EASE = 0.3
// yarn that can go slack: a float, or yarn carried up the fabric's side
const FLOAT = 1
const CARRIED = 2

// a fabric keeps its loops' positions, and the graph joining them, flat in
// typed arrays (a loop's parents and the loop before it never change once
// it's made, so they're read off machine.loops once): the sweeps touch
// nothing else
export function newFabric() {
	const fabric = {
		count: 0, // loops laid out
		floor: null, // the lowest each loop falls to: where it'd hang (see hang)
		hungFor: "", // the needles' loops (and settings) it was worked out for
		joined: 0, // loops whose joins are read
		size: 0,
		xs: null,
		ys: null,
		zs: null, // (where it's shown: the yarn's z, and its bulge)
		flat: null, // the yarn's z, as the constraints have it
		out: null, // how far it bulges out of its bed's face (see BULGE)
		pinned: null,
		home: null, // the x a loop keeps to: its needle's
		round: null, // which way round a tube it goes: 1 if it's knitted going + on the front, or − on the back
		plane: null, // the z it keeps to, on the machine: its bed's
		face: null, // which way out of its bed it bulges: 1 off the front, −1 off the back
		push: null, // which way out of the fabric's face a loop is
		outward: null, // and which way it's pushed, inflated
		prev: null,
		next: null,
		course: null, // how far its yarn goes from the loop before
		slack: null, // whether that yarn floats (it can go slack), or is carried up loose
		// a stitch's diagonal: the loop below the one before it (when that's
		// beside the loop below it), and how far apart they are
		diagonal: null,
		pass: null, // which pass of the carriage made it
		child: null, // the first loop pulled through it
		// how many rows were made, beside the loops it was pulled through,
		// while they waited on their needles (on the wales their yarn goes on
		// to): each pulled them that much longer, and they stay long
		waited: null,
		span: null,
		firstParent: null, // its parents are parents[firstParent[i]…firstParent[i + 1]]
		parents: new Int32Array(1024),
		parentCount: 0,
	}
	grow(fabric, 1)
	return fabric
}

function grow(fabric, size) {
	if (fabric.size >= size) return
	let length = Math.max(1024, fabric.size)
	while (length < size) length *= 2
	const sized = (Type, old, each = 1) => {
		const grown = new Type(length * each)
		if (old) grown.set(old)
		return grown
	}
	fabric.xs = sized(Float32Array, fabric.xs)
	fabric.ys = sized(Float32Array, fabric.ys)
	fabric.zs = sized(Float32Array, fabric.zs)
	fabric.floor = sized(Float32Array, fabric.floor)
	fabric.flat = sized(Float32Array, fabric.flat)
	fabric.out = sized(Float32Array, fabric.out)
	fabric.pinned = sized(Uint8Array, fabric.pinned)
	fabric.home = sized(Float32Array, fabric.home)
	fabric.round = sized(Int8Array, fabric.round)
	fabric.plane = sized(Float32Array, fabric.plane)
	fabric.face = sized(Int8Array, fabric.face)
	fabric.push = sized(Float32Array, fabric.push, 3)
	fabric.outward = sized(Float32Array, fabric.outward, 3)
	fabric.prev = sized(Int32Array, fabric.prev)
	fabric.next = sized(Int32Array, fabric.next)
	fabric.course = sized(Float32Array, fabric.course)
	fabric.slack = sized(Uint8Array, fabric.slack)
	fabric.diagonal = sized(Int32Array, fabric.diagonal)
	fabric.pass = sized(Int32Array, fabric.pass)
	fabric.child = sized(Int32Array, fabric.child)
	fabric.waited = sized(Int32Array, fabric.waited)
	fabric.span = sized(Float32Array, fabric.span)
	// (the joins are read again from the start)
	fabric.firstParent = new Int32Array(length + 1)
	fabric.size = length
	fabric.joined = 0
	fabric.parentCount = 0
}

// read the joins of the loops made since last time
function join(fabric, loops, count) {
	const {prev, next, course, slack, diagonal, span, firstParent, pass, child, waited} = fabric
	for (let i = fabric.joined; i < count; i++) {
		const loop = loops[i]
		const last = i > 0 ? loops[i - 1] : null
		pass[i] = !last ? 0 : pass[i - 1] + (last.dir !== loop.dir || last.yarn !== loop.yarn ? 1 : 0)
		child[i] = -1
		waited[i] = 0
		for (const parent of loop.parents) {
			if (child[parent] === -1) child[parent] = i
			for (const beside of [prev[parent], next[parent]]) {
				if (beside < 0 || beside === i) continue
				let rows = 0
				for (let c = child[beside]; c >= 0 && c !== i && pass[c] < pass[i]; c = child[c]) rows++
				waited[i] = Math.max(waited[i], rows)
			}
		}
		firstParent[i] = fabric.parentCount
		if (fabric.parentCount + loop.parents.length > fabric.parents.length) {
			const grown = new Int32Array(fabric.parents.length * 2 + loop.parents.length)
			grown.set(fabric.parents)
			fabric.parents = grown
		}
		for (const parent of loop.parents) fabric.parents[fabric.parentCount++] = parent
		prev[i] = loop.prev ?? -1
		next[i] = -1
		if (loop.prev != null) {
			next[loop.prev] = i
			// the yarn goes on to the next needle, or (turning) up a row
			const along = Math.abs(loop.x - loops[loop.prev].x)
			course[i] = Math.max(along, WALE)
			// unless other loops were made in between: then it floats behind
			// them, or (another yarn's stripe) is carried up the side
			slack[i] = i - loop.prev > 1 ? (along < 1 ? CARRIED : FLOAT) : 0
		}
		diagonal[i] = -1
		const before = loop.prev != null ? loops[loop.prev] : null
		if (before && !slack[i] && loop.parents.length && before.parents.length) {
			const below = loop.parents[0]
			const beside = before.parents[0]
			if (prev[below] === beside || next[below] === beside) {
				diagonal[i] = beside
				span[i] = Math.hypot(WALE, course[i])
			}
		}
	}
	firstParent[count] = fabric.parentCount
	fabric.joined = count
}

// the loops a fabric shows: the newest LIMIT of them
export function firstLoop(machine, limit = LIMIT) {
	return Math.max(0, machine.loops.length - limit)
}

// how hard loop i is pulled, from 0 (at rest) to 1 (pulled as long as its
// yarn reaches): by how far it is from the loops it was pulled through
export function strain(fabric, i) {
	const {xs, ys, flat: zs, firstParent, parents} = fabric
	if (i >= fabric.joined) return 0
	let most = 0
	for (let p = firstParent[i]; p < firstParent[i + 1]; p++) {
		const parent = parents[p]
		const distance = Math.hypot(xs[i] - xs[parent], ys[i] - ys[parent], zs[i] - zs[parent])
		most = Math.max(most, (distance - WALE) / (REACH - WALE))
	}
	return Math.min(1, most)
}

// lay out loops that are new since last time, then settle the fabric some
// `sweeps` (or till performance.now() is `until`): how far anything moved,
// at most. `inflate` (0 to 1) lets the fabric off its bed's plane, and blows
// a tube up round, as if it were worn. only the newest `limit` loops move.
// bunched rows come as close as `squash` of a wale. `grab` ({id, x, y}) is a
// loop someone's pulling on: it's held where they've pulled it to, and the
// rest of the fabric comes with it
export function relax(
	fabric,
	machine,
	sweeps,
	{gap = 0, inflate = 0, until = Infinity, limit = LIMIT, squash = SQUASH, grab = null} = {},
) {
	const {loops} = machine
	const count = loops.length
	if (count < fabric.count) Object.assign(fabric, newFabric())
	grow(fabric, count)
	join(fabric, loops, count)
	const start = firstLoop(machine, limit)
	const {xs, ys, flat: zs, out, pinned, home, round, plane, face, push, outward, prev, next, course, slack, diagonal, span, firstParent, parents, waited} =
		fabric
	// how far loop i is from the loops it was pulled through, at rest: a
	// wale, or (if they waited on their needles while rows were made beside
	// them) bunched rows' further, as far as their yarn reaches
	const rest = i => Math.min(REACH, WALE * (1 + waited[i] * squash))
	// and how far loop i's yarn can be from the loop before it on its yarn: a
	// course, or (if one of them's still on its needle, its legs pulled long
	// as the fabric goes on down) as much further as they reach
	const reach = i => course[i] + (pinned[i] !== pinned[prev[i]] ? REACH - WALE : 0)

	for (let i = start; i < count; i++) {
		const loop = loops[i]
		home[i] = loop.n + (loop.back ? machine.rack : 0)
		plane[i] = loop.back ? -gap : gap
		face[i] = loop.back ? -1 : 1
		round[i] = loop.back ? -loop.dir : loop.dir
	}
	pinned.fill(0, 0, count)
	let needles = 0
	for (const held of machine.held.values()) {
		const x = across(machine, held.needle)
		const z = held.needle.back ? -gap : gap
		for (const loop of held.loops) {
			pinned[loop.id] = 1
			needles = (needles * 31 + loop.id) | 0
			xs[loop.id] = x
			ys[loop.id] = 0
			zs[loop.id] = z
		}
	}
	// where it'd hang: worked out again when the knitting's changed
	const hungFor = `${count} ${needles} ${squash}`
	const rehung = hungFor !== fabric.hungFor
	const {floor} = fabric
	if (rehung) {
		floor.set(hang().subarray(start, count), start)
		fabric.hungFor = hungFor
	}

	// (sweeps, however long they take)
	let least = 0
	if (!fabric.count || count - fabric.count > COLD) {
		// hang each loop about where it'll settle (see hang), then settle
		for (let i = start; i < count; i++) {
			if (pinned[i]) continue
			xs[i] = loops[i].x
			ys[i] = floor[i]
			zs[i] = plane[i]
		}
		least = COLD_SWEEPS
	} else {
		for (let i = fabric.count; i < count; i++) {
			if (pinned[i]) continue
			xs[i] = loops[i].x
			ys[i] = -WALE
			zs[i] = plane[i]
		}
		// and as it's knitted, the takedown draws it down towards where it'd
		// hang (so it's where it'd be laid out afresh, however it got there)
		if (rehung && !grab) {
			for (let i = start; i < count; i++) if (!pinned[i]) ys[i] += (floor[i] - ys[i]) * REHANG
		}
	}
	fabric.count = count

	// the loop someone's pulling on, held like a loop on a needle is (but a
	// loop on a needle is held there, not by whoever's pulling)
	const grabbed = grab && grab.id >= start && grab.id < count && !pinned[grab.id] ? grab.id : -1
	const held = i => pinned[i] || i === grabbed

	const was = sweeps ? [xs.slice(start, count), ys.slice(start, count), zs.slice(start, count)] : null
	// pull a and b towards `rest` apart: all the way, or (pulled long) by
	// `pulled`, or (pushed short) by `pushed`
	function nudge(a, b, rest, pulled, pushed) {
		const wa = held(a) ? 0 : 1
		const wb = held(b) ? 0 : 1
		if (!wa && !wb) return
		let dx = xs[b] - xs[a]
		let dy = ys[b] - ys[a]
		const dz = zs[b] - zs[a]
		let distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
		if (distance < 1e-6) {
			dy = -1e-3
			distance = 1e-3
		}
		const give = distance > rest ? pulled : pushed
		if (!give) return
		const share = ((distance - rest) / distance / (wa + wb)) * give
		const mx = dx * share
		const my = dy * share
		const mz = dz * share
		xs[a] += mx * wa
		ys[a] += my * wa
		zs[a] += mz * wa
		xs[b] -= mx * wb
		ys[b] -= my * wb
		zs[b] -= mz * wb
	}

	// the bottom edge: the loops cast on, or the oldest the fabric shows
	const bottom = []
	for (let i = start; i < count; i++) {
		if (pinned[i]) continue
		let older = firstParent[i + 1] > firstParent[i]
		for (let p = firstParent[i]; p < firstParent[i + 1]; p++) if (parents[p] >= start) older = false
		if (loops[i].cast || older) bottom.push(i)
	}

	// a tube's yarn goes round it one way, so (yarn along) × (wale up) points
	// out of it, or into it, the same for every loop: which, is which way
	// round most of its loops go
	let handed = 0
	if (inflate) for (let i = start; i < count; i++) handed += round[i]
	const way = handed < 0 ? -1 : 1
	// and its yarn goes round both beds without turning: each run of yarn
	// going round one way (a row that turns at its end is a run; a tube's
	// spiral is one long run) is a tube if it's on both beds
	const run = inflate ? new Int32Array(count) : null
	const beds = inflate ? new Uint8Array(count) : null
	if (inflate) {
		for (let i = start; i < count; i++) {
			const p = prev[i]
			run[i] = p >= start && !slack[i] && round[p] === round[i] ? run[p] : i
			beds[run[i]] |= loops[i].back ? 2 : 1
		}
	}
	const pressure = way * PRESSURE * inflate
	const hold = 1 - inflate
	// (off the machine, a tube's wales go round it, not straight down)
	const keep = KEEP_TO_NEEDLE * hold

	sweeps = Math.max(sweeps, least)
	for (let sweep = 0; sweep < sweeps && (sweep < least || sweep % 4 || performance.now() < until); sweep++) {
		// the takedown grips the bottom edge, pulls it down, and holds it level
		// (off the machine, it only hangs)
		let level = 0
		for (const i of bottom) level += ys[i] / bottom.length
		for (const i of bottom) ys[i] += (level - ys[i]) * LEVEL * hold - TAKEDOWN
		for (let i = start; i < count; i++) {
			if (pinned[i]) continue
			ys[i] = grabbed >= 0 ? ys[i] - GRAVITY : Math.max(floor[i], ys[i] - GRAVITY)
			xs[i] += (home[i] - xs[i]) * keep
			zs[i] += (plane[i] - zs[i]) * hold
			// (and out of its face as far as it's bunched up: which the yarn's
			// constraints don't see, or the bulge would pull it up, bunching it
			// more)
			let short = 0
			for (let p = firstParent[i]; p < firstParent[i + 1]; p++) {
				const parent = parents[p]
				if (parent < start) continue
				short = Math.max(short, WALE - Math.hypot(xs[i] - xs[parent], ys[i] - ys[parent]))
			}
			out[i] += (face[i] * BULGE * short - out[i]) * EASE
		}
		if (grabbed >= 0) {
			xs[grabbed] = grab.x
			ys[grabbed] = grab.y
		}
		if (inflate) inflateBy(pressure)
		// newest first: each row holds up the ones it was pulled through
		for (let i = count - 1; i >= start; i--) {
			for (let p = firstParent[i]; p < firstParent[i + 1]; p++) {
				const parent = parents[p]
				if (parent < start) continue
				nudge(i, parent, rest(i), pinned[i] ? GIVE : 1, SOFT)
				// (and no further than its yarn reaches)
				nudge(i, parent, REACH, 1, 0)
				// and a parent stays below
				const above = ys[i] - ys[parent] - WALE * squash
				if (above < 0) {
					const wc = held(i) ? 0 : 1
					const wp = held(parent) ? 0 : 1
					if (wc + wp) {
						ys[i] -= (above * wc) / (wc + wp)
						ys[parent] += (above * wp) / (wc + wp)
					}
				}
			}
			// (yarn can go slack, floating, but not be pulled long; and nor
			// can yarn going across to the other bed, which needn't be a
			// wale's length from its loop below it, needles away)
			if (prev[i] >= start && slack[i] !== CARRIED) {
				const across = loops[i].back !== loops[prev[i]].back
				nudge(i, prev[i], reach(i), 1, slack[i] || across ? 0 : 1)
			}
			const beside = diagonal[i]
			if (beside >= start && prev[i] >= start) {
				const below = parents[firstParent[i]]
				nudge(i, beside, span[i], (pinned[i] ? GIVE : 1) * SHEAR, SOFT * SHEAR)
				nudge(prev[i], below, span[i], (pinned[prev[i]] ? GIVE : 1) * SHEAR, SOFT * SHEAR)
			}
		}
	}
	let moved = 0
	if (was) {
		for (let i = start; i < count; i++) {
			moved = Math.max(
				moved,
				Math.abs(xs[i] - was[0][i - start]),
				Math.abs(ys[i] - was[1][i - start]),
				Math.abs(zs[i] - was[2][i - start]),
			)
		}
	}
	for (let i = start; i < count; i++) {
		if (pinned[i]) out[i] = 0
		fabric.zs[i] = zs[i] + out[i]
	}
	return moved

	// how high each loop hangs (its y): about where it'll settle. as far down
	// as its wale's deepest, but no further than its stitches reach unpulled
	// (a wale apart, rows level); and never closer to the needles than its
	// rows can bunch. (where those disagree, as an ottoman's front and back
	// do, the rows bunch)
	function hang() {
		// (how far down, below the needles: the most it could be, and the least)
		const lowest = new Float32Array(count)
		const highest = new Float32Array(count)
		// how far each loop is from the loops it was pulled through, at rest;
		// and how far it can be above or below the one before it on its yarn
		// (−1: as far as it likes)
		const rests = new Float32Array(count)
		const rises = new Float32Array(count)
		const bunched = WALE * squash
		for (let i = count - 1; i >= start; i--) {
			rests[i] = rest(i)
			if (prev[i] < start || slack[i] === CARRIED) rises[i] = -1
			else {
				const along = loops[i].x - loops[prev[i]].x
				rises[i] = Math.sqrt(Math.max(0, reach(i) ** 2 - along * along))
			}
			if (!pinned[i]) lowest[i] = Math.max(WALE, lowest[i])
			for (let p = firstParent[i]; p < firstParent[i + 1]; p++) {
				const parent = parents[p]
				lowest[parent] = Math.max(lowest[parent], lowest[i] + rests[i])
			}
		}
		for (let i = start; i < count; i++) {
			if (pinned[i]) lowest[i] = 0
			highest[i] = pinned[i] ? 0 : bunched
		}
		for (let pass = 0; pass < HANG_PASSES; pass++) {
			let changed = false
			for (let i = count - 1; i >= start; i--) {
				const low = lowest[i] + rests[i]
				const high = highest[i] + bunched
				for (let p = firstParent[i]; p < firstParent[i + 1]; p++) {
					const parent = parents[p]
					if (parent < start || pinned[parent]) continue
					if (low < lowest[parent]) {
						lowest[parent] = low
						changed = true
					}
					if (high > highest[parent]) {
						highest[parent] = high
						changed = true
					}
				}
			}
			for (let forward = 1; forward >= 0; forward--) {
				for (let k = start; k < count; k++) {
					const i = forward ? k : count - 1 - k + start
					const most = rises[i]
					if (most < 0) continue
					const before = prev[i]
					if (!pinned[i]) {
						if (lowest[before] + most < lowest[i]) {
							lowest[i] = lowest[before] + most
							changed = true
						}
						if (highest[before] - most > highest[i]) {
							highest[i] = highest[before] - most
							changed = true
						}
					}
					if (!pinned[before]) {
						if (lowest[i] + most < lowest[before]) {
							lowest[before] = lowest[i] + most
							changed = true
						}
						if (highest[i] - most > highest[before]) {
							highest[before] = highest[i] - most
							changed = true
						}
					}
				}
			}
			if (!changed) break
		}
		const hung = new Float32Array(count)
		for (let i = start; i < count; i++) hung[i] = -Math.max(lowest[i], highest[i])
		return hung
	}

	// how much longer the yarn either side of i is than it would be
	function stretch(i) {
		let most = 0
		for (const [a, b] of [
			[prev[i], i],
			[i, next[i]],
		]) {
			if (a < start || b < start || b >= count || slack[b]) continue
			const dx = xs[b] - xs[a]
			const dy = ys[b] - ys[a]
			const dz = zs[b] - zs[a]
			most = Math.max(most, Math.sqrt(dx * dx + dy * dy + dz * dz) / course[b] - 1)
		}
		return most
	}

	// is loop i in a tube: it, the loops either side of it on its yarn, and the
	// loops it was pulled through, all going round the same way (in a sheet
	// the rows go each way in turn; in a jacquard the beds go the same way)
	// (a loop with none below it can't tell)
	function inTube(i) {
		if (round[i] !== way || beds[run[i]] !== 3 || firstParent[i + 1] === firstParent[i]) return false
		if (prev[i] >= start && round[prev[i]] !== way) return false
		if (next[i] >= start && next[i] < count && round[next[i]] !== way) return false
		for (let p = firstParent[i]; p < firstParent[i + 1]; p++) {
			if (parents[p] >= start && round[parents[p]] !== way) return false
		}
		return true
	}

	// push each loop of a tube out of its face: the way its yarn's going ×
	// the way its wale's going, averaged with the loops it was pulled through
	function inflateBy(pressure) {
		for (let i = start; i < count; i++) {
			// (not along yarn that floats, or is carried up from rows below)
			const a = prev[i] >= start && !slack[i] ? prev[i] : i
			const b = next[i] >= start && next[i] < count && !slack[next[i]] ? next[i] : i
			const tx = xs[b] - xs[a]
			const ty = ys[b] - ys[a]
			const tz = zs[b] - zs[a]
			let wx = 0
			let wy = 0
			let wz = 0
			let up = 0
			for (let p = firstParent[i]; p < firstParent[i + 1]; p++) {
				const parent = parents[p]
				if (parent < start) continue
				wx += xs[i] - xs[parent]
				wy += ys[i] - ys[parent]
				wz += zs[i] - zs[parent]
				up++
			}
			if (!up) wy = 1
			const nx = ty * wz - tz * wy
			const ny = tz * wx - tx * wz
			const nz = tx * wy - ty * wx
			const scale = 1 / (Math.sqrt((tx * tx + ty * ty + tz * tz) * (wx * wx + wy * wy + wz * wz)) + 1e-6)
			push[i * 3] = nx * scale
			push[i * 3 + 1] = ny * scale
			push[i * 3 + 2] = nz * scale
		}
		// a loop that isn't in a tube itself (a heel's short rows, say) is
		// pushed the way the loops it was pulled through are: a heel, out of
		// its leg, cups out. (with no tube to start from, nothing is)
		for (let i = start; i < count; i++) {
			const tube = inTube(i)
			let px = tube ? push[i * 3] : 0
			let py = tube ? push[i * 3 + 1] : 0
			let pz = tube ? push[i * 3 + 2] : 0
			const first = firstParent[i]
			const last = firstParent[i + 1]
			if (last > first && parents[first] >= start) {
				let qx = 0
				let qy = 0
				let qz = 0
				for (let p = first; p < last; p++) {
					const from = tube ? push : outward
					qx += from[parents[p] * 3]
					qy += from[parents[p] * 3 + 1]
					qz += from[parents[p] * 3 + 2]
				}
				const share = 1 / (last - first)
				px = tube ? (px + qx * share) / 2 : qx * share
				py = tube ? (py + qy * share) / 2 : qy * share
				pz = tube ? (pz + qz * share) / 2 : qz * share
			}
			outward[i * 3] = px
			outward[i * 3 + 1] = py
			outward[i * 3 + 2] = pz
			if (pinned[i] || !(px || py || pz)) continue
			const give = pressure * Math.max(0, 1 - stretch(i) / TAUT)
			xs[i] += px * give
			ys[i] += py * give
			zs[i] += pz * give
			if (tube && prev[i] >= start && next[i] >= start && next[i] < count && !slack[i] && !slack[next[i]]) {
				const bend = BEND * inflate
				xs[i] += ((xs[prev[i]] + xs[next[i]]) / 2 - xs[i]) * bend
				zs[i] += ((zs[prev[i]] + zs[next[i]]) / 2 - zs[i]) * bend
			}
		}
	}
}
