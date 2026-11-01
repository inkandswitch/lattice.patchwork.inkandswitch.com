// a knit fabric's loops, laid out and settled: after Shima Seiki's loop
// simulation patents (US7386360B2, US8000829).
//
// every loop is a point (x across the bed in needle pitches, y up with the
// hooks at 0 and the fabric hanging below, z out of the bed) joined to the
// loops it was pulled through (its parents, below it: the wale), and to the
// loop before it on its yarn (the course).
//
//  - layout (the patents' "initial layout close to converged"): a loop hangs
//    one WALE under the loop that was pulled through it, so the stitch graph
//    gives plain fabric its rest shape at once;
//  - settling (the patents' course-by-course relaxation): every loop works out
//    the movement each neighbour asks of it (parent: a wale, between squashed
//    and REACH; the loop before and after: a pitch; left where it was made, a
//    little), all of them are worked out before anything moves (US8000829:
//    moving one at a time is unstable), and they're summed, limited and
//    applied together. then, loop by loop in the order they were made (bottom
//    to top, then top to bottom), y is held between the child's and the
//    parent's (US7386360: "Y stays between the child's and parent's"). that
//    pass is also the long-range attachment (Kim, Chentanez, Müller 2012):
//    a loop is never further from the loops above it than the yarn reaches,
//    and never closer than squashed, whatever is pulling it, and it carries
//    a hang or a drag all the way up or down a wale in one pass;
//  - a loop's z is the bed's side, plus how far it bulges out: rows crowded
//    together (a held loop's neighbours knitting on past it) buckle out of the
//    plane, the way the patent's bending terms curl a stitch.
//
// there's no gravity as a force: the fabric hangs because nothing is allowed
// to be above the loop it was pulled through, and a wale at rest is one WALE.

import {across} from "./knitting.js"

export const LOOP = 3.8
export const WALE = LOOP / 5
export const REACH = LOOP / 2
export const SQUASH = 0.3

const MIN_COURSE = 1.7 // yarn from the last loop further than this (in pitches) floats
const K_COURSE = 0.45
const K_WALE = 0.25
const K_WALE_LONG = 0 // (a wale pulled past its rest goes back more gently than it's pushed)
const K_SIDE = 0.1 // a loop sits over the loops it was pulled through
const K_HOME = 0.02 // and near where it was made
const K_BACK = 0.04 // pulled on, the fabric draws back to where it was settled...
const K_SPRING = 0.3 // ...and does, quickly, when it's let go
const STEP = 0.6 // the most a pass moves a loop
const HOLD = 0.35 // the most the wale limits move a loop in a pass
const SETTLED = 0.0005
const EASED = 0.01 // (z's settled closer than this to where it's going)
const BULGE = 1.1
const SLACK = 0.12 // the yarn from one loop to the next, longer than its pitch by this at most
const GRASP = 6 // taking hold of a stitch takes hold of the fabric at least this far either side (in pitches)

export function newFabric() {
	return {
		xs: new Float32Array(0),
		ys: new Float32Array(0),
		zs: new Float32Array(0),
		pinned: new Uint8Array(0),
		slack: new Uint8Array(0),
		child: new Int32Array(0),
		count: 0,
		// (what follows is relax's own)
		px: new Float32Array(0), // where each loop is, before inflating
		py: new Float32Array(0),
		pz: new Float32Array(0), // (and its z, before)
		x0: new Float32Array(0), // where each loop was made
		ax: new Float32Array(0),
		ay: new Float32Array(0),
		link: new Int32Array(0), // the loop before on its yarn, if it's a regular course
		reach: new Float32Array(0),
		rest: new Float32Array(0), // and how far it should be
		poff: new Int32Array(1), // parents, flat: loop i's are pidx[poff[i]..poff[i + 1]]
		pidx: new Int32Array(0),
		bed: new Int8Array(0), // +1 front, −1 back
		bulge: new Float32Array(0),
		py0: new Float32Array(0),
		hx: new Float32Array(0), // where it was before it was pulled on
		hy: new Float32Array(0),
		hold: new Float32Array(0), // how much of the pull each loop gets: 1 in the hand, 0 out of reach
		grasped: [], // the loops with any
		age: 0,
		released: [], // the loops that just came off needles
		homing: 0, // 1: being pulled on, 2: let go, coming back
		px0: new Float32Array(0),
		held: [], // ids of the loops on needles last time
		heldAt: new Float32Array(0),
		machine: null,
		settled: false,
		key: "",
		spare: 0,
	}
}

function grow(f, need) {
	if (f.xs.length >= need) return
	const size = Math.max(1024, need + (need >> 1))
	const bigger = (array, Type, fill) => {
		const made = new Type(size)
		if (fill !== undefined) made.fill(fill)
		made.set(array)
		return made
	}
	f.xs = bigger(f.xs, Float32Array)
	f.ys = bigger(f.ys, Float32Array)
	f.zs = bigger(f.zs, Float32Array)
	f.px = bigger(f.px, Float32Array)
	f.py = bigger(f.py, Float32Array)
	f.pz = bigger(f.pz, Float32Array)
	f.x0 = bigger(f.x0, Float32Array)
	f.ax = bigger(f.ax, Float32Array)
	f.ay = bigger(f.ay, Float32Array)
	f.rest = bigger(f.rest, Float32Array)
	f.reach = bigger(f.reach, Float32Array)
	f.bulge = bigger(f.bulge, Float32Array)
	f.py0 = bigger(f.py0, Float32Array)
	f.hx = bigger(f.hx, Float32Array)
	f.hy = bigger(f.hy, Float32Array)
	f.hold = bigger(f.hold, Float32Array)
	f.px0 = bigger(f.px0, Float32Array)
	f.pinned = bigger(f.pinned, Uint8Array)
	f.slack = bigger(f.slack, Uint8Array)
	f.bed = bigger(f.bed, Int8Array)
	f.child = bigger(f.child, Int32Array, -1)
	f.link = bigger(f.link, Int32Array, -1)
	const poff = new Int32Array(size + 1)
	poff.set(f.poff)
	f.poff = poff
}

export function firstLoop(machine, limit = 20000) {
	return Math.max(0, machine.loops.length - limit)
}

export function strain(f, i) {
	const a = f.poff[i]
	const b = f.poff[i + 1]
	if (i >= f.count || a === b) return 0
	let far = 0
	for (let k = a; k < b; k++) {
		const p = f.pidx[k]
		far += Math.hypot(f.xs[i] - f.xs[p], f.ys[i] - f.ys[p])
	}
	far /= b - a
	return Math.max(0, Math.min(1, (far - WALE) / (REACH - WALE)))
}

// loops added since last time: where they start
function layout(f, machine, from, to, first) {
	const {loops} = machine
	const {px, py, x0, link, rest, bed, child, slack} = f
	for (let i = from; i < to; i++) {
		const loop = loops[i]
		child[i] = -1
		bed[i] = loop.back ? -1 : 1
		x0[i] = loop.x
		if (!f.pinned[i]) {
			px[i] = loop.x
			py[i] = NaN
		}
		slack[i] = 0
		link[i] = -1
		// parents, flat
		let at = f.poff[i]
		if (f.pidx.length < at + loop.parents.length) {
			const bigger = new Int32Array(Math.max(4096, (at + loop.parents.length) * 2))
			bigger.set(f.pidx)
			f.pidx = bigger
		}
		for (const p of loop.parents) {
			f.pidx[at++] = p
			if (child[p] < 0) child[p] = i
		}
		f.poff[i + 1] = at
		// the yarn before it
		if (loop.prev != null) {
			const before = loops[loop.prev]
			const dx = Math.abs(loop.x - before.x)
			if (before.dir !== loop.dir) {
				// the turn at a row's end: it joins this row's end to the last's
				link[i] = loop.prev
				rest[i] = before.back === loop.back ? WALE : 0.4
				f.reach[i] = rest[i] + SLACK
			} else if (dx > MIN_COURSE) {
				slack[i] = 1
			} else {
				link[i] = loop.prev
				rest[i] = dx
				f.reach[i] = SLACK
			}
		}
	}
	// y: a loop hangs one wale under the loop pulled through it (those are
	// later, so from the newest back); a loop on a needle is at the hooks
	for (let i = to - 1; i >= from; i--) {
		if (f.pinned[i]) continue
		if (child[i] >= 0 && child[i] < to) py[i] = py[child[i]] - WALE
	}
	// a loop with nothing pulled through it: level with the loop before it
	for (let i = from; i < to; i++) {
		if (!Number.isNaN(py[i])) continue
		const l = f.link[i]
		py[i] = l >= 0 && l < i && !Number.isNaN(py[l]) ? py[l] : i > first ? py[i - 1] : 0
		if (Number.isNaN(py[i])) py[i] = 0
	}
}

// the loops on needles: held at the hooks. whether they've changed
function pin(f, machine, n) {
	f.released.length = 0
	const now = []
	const at = []
	for (const held of machine.held.values()) {
		const x = across(machine, held.needle)
		for (const loop of held.loops) {
			now.push(loop.id)
			at.push(x)
		}
	}
	let changed = now.length !== f.held.length
	if (!changed) for (let k = 0; k < now.length; k++) if (now[k] !== f.held[k] || at[k] !== f.heldAt[k]) changed = true
	if (!changed) return false
	f.released = []
	for (const id of f.held) {
		f.pinned[id] = 0
		f.released.push(id)
	}
	for (let k = 0; k < now.length; k++) {
		const id = now[k]
		if (id >= n) continue
		f.pinned[id] = 1
		f.px[id] = at[k]
		f.py[id] = 0
	}
	f.held = now
	f.heldAt = at
	return true
}

// one pass: every loop's movement from each neighbour, summed, then all moved
function pass(f, first, n, squash, grab) {
	const kBack = f.homing === 1 ? K_BACK : f.homing === 2 ? K_SPRING : 0
	const {hx, hy} = f
	const {px, py, x0, ax, ay, link, rest, pinned, poff, pidx} = f
	ax.fill(0, first, n)
	ay.fill(0, first, n)
	const lo = WALE * squash
	for (let i = first; i < n; i++) {
		const freeI = pinned[i] || i === grab ? 0 : 1
		// the yarn from the loop before
		const l = link[i]
		if (l >= first) {
			const freeL = pinned[l] || l === grab ? 0 : 1
			const share = freeI + freeL
			if (share) {
				const dx = px[i] - px[l]
				const dy = py[i] - py[l]
				const d = Math.hypot(dx, dy)
				if (d > 1e-5) {
					const e = ((d - rest[i]) * K_COURSE) / d / share
					ax[i] -= freeI * dx * e
					ay[i] -= freeI * dy * e
					ax[l] += freeL * dx * e
					ay[l] += freeL * dy * e
				}
			}
		}
		// and the loops it was pulled through
		const a = poff[i]
		const b = poff[i + 1]
		if (b > a) {
			const w = 1 / (b - a)
			for (let k = a; k < b; k++) {
				const p = pidx[k]
				if (p < first) continue
				const freeP = pinned[p] || p === grab ? 0 : 1
				const share = freeI + freeP
				if (!share) continue
				const dx = px[i] - px[p]
				const dy = py[i] - py[p]
				const d = Math.hypot(dx, dy)
				if (d > 1e-5) {
					const err = d - WALE
					const e = ((err * (err > 0 ? K_WALE_LONG : K_WALE)) / d) * w / share
					ax[i] -= freeI * (dx * e)
					ay[i] -= freeI * dy * e
					ax[p] += freeP * (dx * e)
					ay[p] += freeP * dy * e
				}
				const s = (dx * K_SIDE * w) / share
				ax[i] -= freeI * s
				ax[p] += freeP * s
			}
		}
	}
	let most = 0
	for (let i = first; i < n; i++) {
		if (pinned[i] || i === grab) continue
		let mx = ax[i] + (x0[i] - px[i]) * K_HOME
		let my = ay[i]
		if (kBack) {
			mx += (hx[i] - px[i]) * kBack
			my += (hy[i] - py[i]) * kBack
		}
		const m = Math.hypot(mx, my)
		if (m > STEP) {
			mx *= STEP / m
			my *= STEP / m
		}
		px[i] += mx
		py[i] += my
		if (m > most) most = m
	}
	return Math.min(most, STEP)
}

// a loop that's come off its needle drops to a wale under the loop pulled
// through it, and the fabric hanging from it goes down with it, just as far
// (so settled loops stay as they are, only moved by what's changed)
function carry(f, first, n) {
	const {py, child, poff, pidx, ax} = f
	let top = -1
	ax.fill(0, first, n)
	for (const r of f.released) {
		if (r < first || r >= n || f.pinned[r]) continue
		const c = child[r]
		if (c < 0 || c >= n) continue
		const drop = py[c] - WALE - py[r]
		if (drop < 0) {
			ax[r] = drop
			if (r > top) top = r
		}
	}
	// (ax: how far each loop goes down; zero for the rest)
	for (let i = top; i >= first; i--) {
		const d = ax[i]
		if (d === 0) continue
		py[i] += d
		ax[i] = 0
		for (let k = poff[i]; k < poff[i + 1]; k++) {
			const p = pidx[k]
			if (p >= first && !f.pinned[p] && child[p] === i && (ax[p] === 0 || ax[p] > d)) ax[p] = d
		}
	}
}

// being pulled on: what hangs from a loop that's been pulled down goes down
// with it, as far as it's moved from where it was settled (and no further:
// the bunched rows stay as they were)
function dragCarry(f, first, n, grab) {
	const {py, hy, pinned, poff, pidx, child} = f
	for (let i = n - 1; i >= first; i--) {
		const d = py[i] - hy[i]
		if (d >= 0) continue
		for (let k = poff[i]; k < poff[i + 1]; k++) {
			const p = pidx[k]
			if (p < first || pinned[p] || p === grab || child[p] !== i) continue
			if (py[p] > hy[p] + d) py[p] = hy[p] + d
		}
	}
}

// taking hold of a stitch takes hold of the fabric round it, the way a hand
// pulling on a hanging sheet does: what's above the hand is stretched evenly
// up to the needles (so a loop goes as far as it hangs from them, of how far
// the hand's gone), what hangs below it goes with it, and either side it
// tails off, as far out as the hand is down
function grasp(f, first, n, grab) {
	const {hx, hy, hold, pinned} = f
	for (const i of f.grasped) hold[i] = 0
	f.grasped = []
	const hand = Math.min(hy[grab], -WALE)
	const spread = Math.max(GRASP, -hand)
	for (let i = first; i < n; i++) {
		if (pinned[i]) continue
		const u = Math.abs(hx[i] - hx[grab]) / spread
		if (u >= 1) continue
		const down = hy[i] > hand ? Math.max(0, hy[i] / hand) : 1
		if (down <= 0) continue
		hold[i] = down * (1 - u * u) * (1 - u * u)
		f.grasped.push(i)
	}
}

// and pulling it: what's in the hand goes as far as the stitch was moved,
// as much as it's held (and the yarn round it follows, as it can)
function haul(f, grab) {
	const {px, py, hx, hy, hold} = f
	const ox = px[grab] - hx[grab]
	const oy = py[grab] - hy[grab]
	for (const i of f.grasped) {
		const w = hold[i]
		px[i] += (hx[i] + ox * w - px[i]) * w
		py[i] += (hy[i] + oy * w - py[i]) * w
	}
}

// hang: from the newest loop down, a loop falls to one wale under the loop
// pulled through it, if it's above that. the whole fabric hangs in one pass
function fall(f, first, n, grab) {
	const {py, pinned, poff, pidx} = f
	for (let i = n - 1; i >= first; i--) {
		for (let k = poff[i]; k < poff[i + 1]; k++) {
			const p = pidx[k]
			if (p < first || pinned[p] || p === grab) continue
			const rest = py[i] - WALE
			if (py[p] > rest) py[p] = rest
		}
	}
}

// the limits (US7386360: y stays between the child's and parent's), solved
// by sweeping along the order loops were made, up and down, each loop held
// within its neighbours' reach. (this is also the long-range attachment of
// Kim, Chentanez and Müller 2012: a loop's never further from the loops
// above than the yarn reaches, whatever's pulling it, and a hang or a drag
// goes all the way up or down a wale in one sweep.)
//  - from a parent: a loop is above it by at least squashed and at most REACH
//  - from the loop before it on the yarn: at most a little way off its height
// down, from the newest: a loop below a loop is pulled up to within REACH or
// pushed down to squashed, and kept with the loops on its yarn. up, from the
// oldest: a loop is held within what's below and beside it
function bounds(f, first, n, squash, grab, down) {
	const {py, pinned, poff, pidx, link} = f
	const lo = WALE * squash
	if (down) {
		for (let i = n - 1; i >= first; i--) {
			const y = py[i]
			for (let k = poff[i]; k < poff[i + 1]; k++) {
				const p = pidx[k]
				if (p < first || pinned[p] || p === grab) continue
				if (py[p] > y - lo) py[p] = y - lo
				else if (py[p] < y - REACH) py[p] = y - REACH
			}
		}
	} else {
		for (let i = first; i < n; i++) {
			if (pinned[i] || i === grab) continue
			let up = -Infinity
			let dn = Infinity
			for (let k = poff[i]; k < poff[i + 1]; k++) {
				const p = pidx[k]
				if (p < first) continue
				if (py[p] + lo > up) up = py[p] + lo
				if (py[p] + REACH < dn) dn = py[p] + REACH
			}
			if (py[i] < up) py[i] = up
			else if (py[i] > dn) py[i] = dn
			// the yarn from the loop before it: they're not further apart than
			// it reaches; both come in
			const l = link[i]
			if (l >= first) {
				const e = Math.abs(py[i] - py[l]) - f.reach[i]
				if (e > 0) {
					const lFree = !pinned[l] && l !== grab
					const m = lFree ? e / 2 : e
					const dir = py[i] > py[l] ? -1 : 1
					py[i] += dir * m
					if (lFree) py[l] -= dir * m
				}
			}
		}
	}
}

function moved(f, first, n) {
	let most = 0
	for (let i = first; i < n; i++) {
		const m = Math.abs(f.py[i] - f.py0[i]) + Math.abs(f.px[i] - f.px0[i])
		if (m > most) most = m
	}
	return most
}

// how far each loop bulges out of its bed: rows crowded together buckle
function buckle(f, first, n, squash) {
	const {py, child, bulge, poff, pidx} = f
	const squashed = WALE * (1 - squash)
	for (let i = first; i < n; i++) {
		// the gap to the loop above and below
		let s = 0
		let c = 0
		if (child[i] >= first && child[i] < n) {
			s += py[child[i]] - py[i]
			c++
		}
		if (poff[i + 1] > poff[i] && pidx[poff[i]] >= first) {
			s += py[i] - py[pidx[poff[i]]]
			c++
		}
		const gap = c ? s / c : WALE
		bulge[i] = gap < WALE ? Math.min(1, (WALE - gap) / squashed) : 0
	}
}

// which loops are in a tube: a tube's yarn goes round both beds without
// turning, so (which way it's knitted) × (which bed) stays the same along it.
// each run of yarn going round one way (a row that turns at its end is a
// run; a tube's spiral is one long run) is a tube if it goes all the way
// round, from one bed to the other and back. (a row knitted across both beds
// at once, as a rib or an ottoman's join is, turns round at every loop: it's
// one fabric. and a row along the front and then one back along the back is
// only half way round: as often as not it's moved onto one bed after)
function tubes(machine, first, n) {
	const {loops} = machine
	const run = new Int32Array(n)
	const crossed = new Uint8Array(n)
	const way = i => loops[i].dir * (loops[i].back ? -1 : 1)
	for (let i = first; i < n; i++) {
		const p = loops[i].prev
		const on = p != null && p >= first && way(p) === way(i)
		run[i] = on ? run[p] : i
		if (on && loops[p].back !== loops[i].back && crossed[run[i]] < 2) crossed[run[i]]++
	}
	const tube = new Uint8Array(n)
	for (let i = first; i < n; i++) tube[i] = crossed[run[i]] === 2 ? 1 : 0
	return tube
}

// show: bed side, plus bulge (smoothed along the wale so ridges are round),
// plus, worn, off the machine: a tube's beds blown round into it, and any
// other fabric's beds come together into one cloth. (z eases there: how far
// it's still to go)
function show(f, machine, first, n, gap, inflate) {
	const {px, py, pz, xs, ys, zs, bed, bulge, child} = f
	const tube = inflate > 0 ? tubes(machine, first, n) : null
	let easing = 0
	for (let i = first; i < n; i++) {
		let b = bulge[i]
		const c = child[i]
		if (c >= first && c < n) b = b * 0.5 + bulge[c] * 0.25
		else b *= 0.75
		const p = f.poff[i] < f.poff[i + 1] ? f.pidx[f.poff[i]] : -1
		if (p >= first) b += bulge[p] * 0.25
		else b += bulge[i] * 0.25
		// (a held loop: flat)
		const apart = tube && !tube[i] && !f.pinned[i] ? gap * (1 - inflate) : gap
		const target = bed[i] * (apart + BULGE * b * (f.pinned[i] ? 0 : 1))
		pz[i] = f.settledZ ? pz[i] + (target - pz[i]) * 0.35 : target
		easing = Math.max(easing, Math.abs(target - pz[i]))
		zs[i] = pz[i]
		xs[i] = px[i]
		ys[i] = py[i]
	}
	if (inflate > 0) {
		let lo = Infinity
		let hi = -Infinity
		let front = 0
		let back = 0
		for (let i = first; i < n; i++) {
			if (!tube[i]) continue
			if (px[i] < lo) lo = px[i]
			if (px[i] > hi) hi = px[i]
			if (bed[i] > 0) front++
			else back++
		}
		const w = hi - lo
		if (front && back && w > 2) {
			const r = w / Math.PI
			const mid = (lo + hi) / 2
			for (let i = first; i < n; i++) {
				if (!tube[i]) continue
				const u = (px[i] - mid) / (w / 2)
				const t = (u * Math.PI) / 2
				const round = mid + r * Math.sin(t)
				// (round the tube's middle, between the beds: its bed's
				// side, out as far as the tube's round there, and bulging)
				const out = bed[i] * r * Math.cos(t) + (pz[i] - bed[i] * gap)
				xs[i] = px[i] + (round - px[i]) * inflate
				zs[i] = zs[i] + (out - zs[i]) * inflate
			}
		}
	}
	return easing
}

export function relax(f, machine, sweeps, {gap = 0, inflate = 0, until = Infinity, limit = 20000, squash = SQUASH, grab = null} = {}) {
	const n = machine.loops.length
	let fresh = false
	if (n < f.count || f.machine !== machine) {
		const keep = newFabric()
		for (const k of Object.keys(keep)) f[k] = keep[k]
		f.machine = machine
		fresh = true
	}
	const first = Math.max(0, n - limit)
	const from = f.count
	grow(f, n)
	const pinsMoved = pin(f, machine, n)
	const key = `${n}|${machine.rack}|${gap}|${inflate}|${limit}|${squash}`
	if (!grab && !f.grabbed && f.settled && f.key === key && !pinsMoved) return 0
	if (n > from) layout(f, machine, from, n, first)
	f.count = n
	f.settledZ = !fresh
	f.settled = false
	f.grabbed = !!grab
	// (a setting's changed: it all starts settling again)
	if (f.key !== key) f.age = 0
	f.key = key
	const grabbed = grab && grab.id >= first && grab.id < n ? grab.id : -1
	const added = n - from
	if (grab && !f.grabbed0) {
		f.hx.set(f.px.subarray(first, n), first)
		f.hy.set(f.py.subarray(first, n), first)
		f.homing = 1
		if (grabbed >= 0) grasp(f, first, n, grabbed)
	} else if (!grab && f.grabbed0) {
		f.homing = 2
		for (const i of f.grasped) f.hold[i] = 0
		f.grasped = []
	}
	f.grabbed0 = !!grab
	if (grabbed >= 0) {
		f.px[grabbed] = grab.x
		f.py[grabbed] = grab.y
	}
	if (added > 0) f.homing = 0
	if (pinsMoved) carry(f, first, n)
	// (a jump: it has to be good at once)
	const passes = sweeps === 0 ? (added > 0 ? Math.min(40, Math.ceil(added / 400)) : 0) : sweeps
	// (new loops: the limits alone, over and over, to get ties and bunching
	// down the fabric before anything's smoothed)
	if (added > 0 && passes > 0) {
		const rounds = Math.min(30, 4 + (added >> 4))
		for (let r = 0; r < rounds; r++) {
			bounds(f, first, n, squash, grabbed, false)
			bounds(f, first, n, squash, grabbed, true)
		}
	}
	let most = 0
	let last = Infinity
	let ran = 0
	for (let s = 0; s < passes; s++) {
		ran++
		f.px0.set(f.px.subarray(first, n), first)
		f.py0.set(f.py.subarray(first, n), first)
		if (grabbed >= 0) dragCarry(f, first, n, grabbed)
		pass(f, first, n, squash, grabbed)
		bounds(f, first, n, squash, grabbed, false)
		bounds(f, first, n, squash, grabbed, true)
		if (grabbed >= 0) haul(f, grabbed)
		last = moved(f, first, n)
		if (last > most) most = last
		if (last < SETTLED) break
		if (until !== Infinity && performance.now() >= until) break
	}
	if (passes === 0 && added > 0) {
		fall(f, first, n, grabbed)
		bounds(f, first, n, squash, grabbed, true)
	}
	f.age = added > 0 || pinsMoved || grabbed >= 0 || f.homing ? 0 : f.age + ran
	if ((last < SETTLED || f.age > 400) && grabbed < 0) {
		f.settled = true
		f.homing = 0
	}
	buckle(f, first, n, squash)
	// (and not settled till its z is where it's going)
	const easing = show(f, machine, first, n, gap, inflate)
	if (easing > EASED && f.age <= 400) f.settled = false
	return Math.max(most, easing > EASED ? easing : 0)
}
