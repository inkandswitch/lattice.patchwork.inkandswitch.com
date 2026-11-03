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
// to be above the loop it was pulled through, and a wale at rest is one row.
//
// how big a row and a stitch are is Munden's (1959): relaxed, a loop takes
// the same shape whatever it's knitted from, so a row's as tall as its loop's
// yarn ÷ kc and a stitch as wide as it ÷ kw, and the yarn in a loop is what
// its stitch number pulls through (see size.js: measured, or else as WALE
// and a needle's pitch have it). each loop is its own size: knit a row at
// another stitch number and its rows are taller, its stitches wider. and a
// stitch keeps its yarn (Poincloux, Adda-Bedia & Lechenault 2018: its width
// and δ × its height, together, are as long as they were relaxed), so a
// stitch pulled long is drawn in narrower, and rows crowded together spread.
//
// worn (inflated), a tube's blown up round, as wide as its stitches are, and
// where one side of it has more rows than the other (a short-row heel, or
// toe), it turns: each loop's wale is as long as its rows, so a tube whose
// back's longer than its front bends round towards its front, as far as the
// back's longer, over the tube's width. short rows knitted from a tube are
// part of it, on its side: a heel cups out of the leg, not into it.

import {across} from "./knitting.js"
import {DELTA, STITCH, fabricOf, stitchSize} from "./size.js"

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
		// each loop's own size, in pitches (see size.js): how far above the
		// loops it's pulled through it sits relaxed (its row), at most (its
		// yarn's reach: half the loop, legs straight), and how wide it is; and
		// how long its wale is, relaxed, from the bottom of the fabric up to it
		wale: new Float32Array(0),
		far: new Float32Array(0),
		wide: new Float32Array(0),
		along: new Float32Array(0),
		sizeKey: "",
		poff: new Int32Array(1), // parents, flat: loop i's are pidx[poff[i]..poff[i + 1]]
		pidx: new Int32Array(0),
		// (and whether each was moved over from another needle to be pulled
		// through: it lies across, level with the loop, not under it)
		pside: new Uint8Array(0),
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
	f.wale = bigger(f.wale, Float32Array)
	f.far = bigger(f.far, Float32Array)
	f.wide = bigger(f.wide, Float32Array)
	f.along = bigger(f.along, Float32Array)
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

// a loop's size in pitches, from the settings (see size.js): `fabric` (or,
// per yarn, `yarns[yarn]`) and the gauge. as WALE and REACH have it, and a
// needle's pitch wide, till anything's measured
export function sizer({fabric = null, yarns = null, gauge = 7} = {}) {
	const pitch = 25.4 / gauge
	const known = {}
	const size = (number, yarn = 0) => {
		const key = `${number}|${yarn}`
		if (known[key]) return known[key]
		const s = stitchSize(fabricOf({fabric: yarns?.[yarn] ?? fabric}), number, pitch)
		return (known[key] = {up: s.up / pitch, far: s.loop / pitch / 2, across: s.across / pitch})
	}
	size.key = JSON.stringify([fabric, yarns, gauge])
	return size
}
const PLAIN = sizer()

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
	return Math.max(0, Math.min(1, (far - f.wale[i]) / (f.far[i] - f.wale[i])))
}

// each loop's size, from its stitch number and its yarn (`size(number,
// yarn)`: {up, far, across} in pitches): from `from` on (all of them, when
// the sizes have changed)
function sizes(f, machine, from, to, size) {
	const {loops} = machine
	const {wale, far, wide} = f
	for (let i = from; i < to; i++) {
		const s = size(loops[i].stitch ?? STITCH, loops[i].yarn)
		wale[i] = s.up
		far[i] = Math.max(s.far, s.up)
		wide[i] = s.across
	}
}

// how long each loop's wale is, relaxed, from the bottom of the fabric up to
// it: the longest of the loops it's pulled through, and its own row. (a loop
// lying across adds nothing to the wale it's on)
function alongs(f, from, to) {
	const {wale, along, poff, pidx, pside} = f
	for (let i = from; i < to; i++) {
		let below = 0
		for (let k = poff[i]; k < poff[i + 1]; k++) if (!pside[k] && along[pidx[k]] > below) below = along[pidx[k]]
		along[i] = below + wale[i]
	}
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
			const size = Math.max(4096, (at + loop.parents.length) * 2)
			const bigger = new Int32Array(size)
			bigger.set(f.pidx)
			f.pidx = bigger
			const side = new Uint8Array(size)
			side.set(f.pside)
			f.pside = side
		}
		// a loop moved over from another needle onto one whose own loop it's
		// pulled through with (a bind-off's chain, the top of a decrease)
		// lies across: the new loop's only kept within reach of it, not above
		// it. (moved with nothing else, it's the loop's wale as ever)
		const stays = loop.parents.some(p => loops[p].x === loop.x)
		for (const p of loop.parents) {
			f.pside[at] = stays && loops[p].x !== loop.x ? 1 : 0
			f.pidx[at++] = p
			if (child[p] < 0) child[p] = i
		}
		f.poff[i + 1] = at
		// the yarn before it
		if (loop.prev != null) {
			const before = loops[loop.prev]
			const dx = Math.abs(loop.x - before.x)
			if (i - loop.prev > 1) {
				// other yarns made loops in between (a stripe, a heel in
				// another colour): this one was carried up the side past
				// them, or floated behind, as far as it needed, the carrier
				// feeding it
				slack[i] = 1
			} else if (before.dir !== loop.dir) {
				// the turn at a row's end: it joins this row's end to the last's
				link[i] = loop.prev
				rest[i] = before.back === loop.back ? f.wale[i] : 0.4
				f.reach[i] = rest[i] + SLACK
			} else if (dx > MIN_COURSE) {
				slack[i] = 1
			} else {
				// (as far apart as the stitches are wide)
				link[i] = loop.prev
				rest[i] = dx * f.wide[i]
				f.reach[i] = SLACK
			}
		}
	}
	// y: a loop hangs one wale under the loop pulled through it (those are
	// later, so from the newest back); a loop on a needle is at the hooks
	for (let i = to - 1; i >= from; i--) {
		if (f.pinned[i]) continue
		if (child[i] >= 0 && child[i] < to) py[i] = py[child[i]] - f.wale[child[i]]
	}
	// a loop with nothing pulled through it: level with the loop before it
	for (let i = from; i < to; i++) {
		if (!Number.isNaN(py[i])) continue
		const l = f.link[i]
		py[i] = l >= 0 && l < i && !Number.isNaN(py[l]) ? py[l] : i > first ? py[i - 1] : 0
		if (Number.isNaN(py[i])) py[i] = 0
	}
}

// the rows' rests again, the stitches having changed size
function relink(f, machine, from, to) {
	const {loops} = machine
	for (let i = from; i < to; i++) {
		const l = f.link[i]
		if (l < 0) continue
		const before = loops[l]
		const loop = loops[i]
		if (before.dir !== loop.dir) {
			f.rest[i] = before.back === loop.back ? f.wale[i] : 0.4
			f.reach[i] = f.rest[i] + SLACK
		} else f.rest[i] = Math.abs(loop.x - before.x) * f.wide[i]
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
	// nothing on the needles: the knitting's come off. it stays as it was when
	// they let it go, hanging from the loops dropped at the end (after the
	// last loop was made), where their needles were. (with nothing to hang
	// from, there's nowhere it would settle)
	if (!now.length && n) {
		const end = machine.loops[n - 1].op
		for (let i = 0; i < n; i++) {
			const loop = machine.loops[i]
			if (loop.off > end) {
				now.push(i)
				at.push(across(machine, loop))
			}
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
	const {px, py, x0, ax, ay, link, pinned, poff, pidx, pside, wale} = f
	ax.fill(0, first, n)
	ay.fill(0, first, n)
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
					const e = ((d - courseRest(f, i, l, first)) * K_COURSE) / d / share
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
					const err = d - wale[i]
					// (a loop lying across isn't pushed under it)
					const e = ((err * (err > 0 ? K_WALE_LONG : pside[k] ? 0 : K_WALE)) / d) * w / share
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

// how far a loop sits from the loop before it on a row: its stitch's width
// (as many as there are needles between), less δ × however much longer its
// wale is than its row, relaxed: the yarn that's gone into the wale's come out
// of the stitch's width, and crowded rows give theirs back (Poincloux et al.:
// a stitch's width + δ × its height stays as long as it was). a turn at a
// row's end, a pitch across or a row up, is as it was laid out
function courseRest(f, i, l, first) {
	const {rest, wale, wide, py, px, poff, pidx, pside} = f
	const dx = Math.abs(f.x0[i] - f.x0[l])
	const {loops} = f.machine
	if (!dx || loops[i].dir !== loops[l].dir) return rest[i]
	let tall = 0
	let c = 0
	for (let k = poff[i]; k < poff[i + 1]; k++) {
		const p = pidx[k]
		if (p < first || pside[k]) continue
		tall += Math.hypot(px[i] - px[p], py[i] - py[p])
		c++
	}
	if (!c) return rest[i]
	const width = wide[i] - DELTA * (tall / c - wale[i])
	// (no narrower than a third of it, nor wider than all its yarn laid across)
	return dx * Math.min(wide[i] + DELTA * wale[i], Math.max(wide[i] / 3, width))
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
		const drop = py[c] - f.wale[c] - py[r]
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
	const {py, pinned, poff, pidx, pside} = f
	for (let i = n - 1; i >= first; i--) {
		for (let k = poff[i]; k < poff[i + 1]; k++) {
			const p = pidx[k]
			if (p < first || pinned[p] || p === grab || pside[k]) continue
			const rest = py[i] - f.wale[i]
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
//  - from a parent: a loop is above it by at least squashed and at most its
//    reach (or, from a parent lying across, within reach of it either way)
//  - from the loop before it on the yarn: at most a little way off its height
// down, from the newest: a loop below a loop is pulled up to within reach or
// pushed down to squashed, and kept with the loops on its yarn. up, from the
// oldest: a loop is held within what's below and beside it
function bounds(f, first, n, squash, grab, down) {
	const {py, pinned, poff, pidx, pside, link, wale, far} = f
	if (down) {
		for (let i = n - 1; i >= first; i--) {
			const y = py[i]
			const lo = wale[i] * squash
			const reach = far[i]
			for (let k = poff[i]; k < poff[i + 1]; k++) {
				const p = pidx[k]
				if (p < first || pinned[p] || p === grab) continue
				const top = pside[k] ? y + reach : y - lo
				if (py[p] > top) py[p] = top
				else if (py[p] < y - reach) py[p] = y - reach
			}
		}
	} else {
		for (let i = first; i < n; i++) {
			if (pinned[i] || i === grab) continue
			const lo = wale[i] * squash
			const reach = far[i]
			let up = -Infinity
			let dn = Infinity
			for (let k = poff[i]; k < poff[i + 1]; k++) {
				const p = pidx[k]
				if (p < first) continue
				const least = pside[k] ? py[p] - reach : py[p] + lo
				if (least > up) up = least
				if (py[p] + reach < dn) dn = py[p] + reach
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
	const {py, child, bulge, poff, pidx, wale} = f
	for (let i = first; i < n; i++) {
		const rest = wale[i]
		const squashed = rest * (1 - squash)
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
		const gap = c ? s / c : rest
		bulge[i] = gap < rest ? Math.min(1, (rest - gap) / squashed) : 0
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

// what's part of a tube: its loops, and what's knitted from them on one bed
// (short rows, a heel's or a toe's: they're on the tube's side, where they
// were knitted, not a cloth of their own)
function onTube(f, machine, first, n, tube) {
	const surface = new Uint8Array(n)
	for (let i = first; i < n; i++) {
		if (tube[i]) {
			surface[i] = 1
			continue
		}
		for (let k = f.poff[i]; k < f.poff[i + 1]; k++) {
			const p = f.pidx[k]
			if (p >= first && !f.pside[k] && surface[p]) surface[i] = 1
		}
	}
	return surface
}

// how a tube bends, worn: each round of it (once round, both beds) has its
// wales so long, relaxed (along), each as far out towards the back as it is
// (ρ). bent θ, a wale ρ out is ρθ longer than the tube's middle is (σ): so
// along = σ + ρθ, fitted to each round's loops. where the back's longer than
// the front (a short-row heel), θ grows, and the tube turns towards its front.
// `at(i)`: where on the middle loop i is, which way that's facing, and how far
// it's turned (from the top: the newest knitting stays as it hangs). a round's
// loops are where it is; a short row's, where along = σ + ρθ puts them
function bending(f, machine, first, n, tube, rhoOf) {
	const {loops} = machine
	const {along, py} = f
	const rounds = []
	const roundOf = new Int32Array(n).fill(-1)
	let r = null
	for (let i = first; i < n; i++) {
		if (!tube[i]) continue
		const p = loops[i].prev
		const fresh = !r || p == null || !tube[p] || (bedOf(loops[p]) < 0 && bedOf(loops[i]) > 0)
		if (fresh) rounds.push((r = {s1: 0, sr: 0, srr: 0, ss: 0, srs: 0, y: 0, front: 0, back: 0}))
		roundOf[i] = rounds.length - 1
		const rho = rhoOf(i)
		if (loops[i].back) r.back++
		else r.front++
		r.s1++
		r.sr += rho
		r.srr += rho * rho
		r.ss += along[i]
		r.srs += rho * along[i]
		r.y += py[i]
	}
	const fit = []
	// (a round's both beds: a pass along one, as a heel's last runs on into the
	// foot, is only half way round)
	for (const round of rounds) {
		const {s1, sr, srr, ss, srs, y, front, back} = round
		const det = s1 * srr - sr * sr
		if (front < 2 || back < 2 || det < 1e-6 * s1 * s1) continue
		const theta = (s1 * srs - sr * ss) / det
		fit.push((round.fit = {sigma: (ss - theta * sr) / s1, theta, y: y / s1}))
	}
	if (fit.length < 2) return null
	fit.sort((a, b) => a.sigma - b.sigma)
	// (the middle, from the top down: each round's where the one above it is,
	// less as far down the middle as they're apart, turned as they are)
	const top = fit[fit.length - 1]
	const turned = theta => theta - top.theta
	top.cy = top.y
	top.cz = 0
	for (let k = fit.length - 2; k >= 0; k--) {
		const a = fit[k]
		const b = fit[k + 1]
		const t = turned((a.theta + b.theta) / 2)
		const ds = b.sigma - a.sigma
		a.cy = b.cy - Math.cos(t) * ds
		a.cz = b.cz - Math.sin(t) * ds
	}
	const thetaAt = sigma => {
		if (sigma <= fit[0].sigma) return fit[0].theta
		if (sigma >= top.sigma) return top.theta
		let k = 0
		while (fit[k + 1].sigma < sigma) k++
		const a = fit[k]
		const b = fit[k + 1]
		return a.theta + ((b.theta - a.theta) * (sigma - a.sigma)) / (b.sigma - a.sigma || 1)
	}
	return i => {
		const fitted = roundOf[i] >= 0 ? rounds[roundOf[i]].fit : null
		let sigma = along[i]
		if (fitted) sigma = fitted.sigma
		else for (let it = 0; it < 8; it++) sigma = along[i] - rhoOf(i) * thetaAt(sigma)
		const angle = turned(thetaAt(sigma))
		// (past the first or last round: on along, straight)
		const end = sigma <= fit[0].sigma ? fit[0] : sigma >= top.sigma ? top : null
		if (end) {
			const t = turned(end.theta)
			const ds = sigma - end.sigma
			return {y: end.cy + Math.cos(t) * ds, z: end.cz + Math.sin(t) * ds, angle}
		}
		let k = 0
		while (fit[k + 1].sigma < sigma) k++
		const a = fit[k]
		const b = fit[k + 1]
		const u = (sigma - a.sigma) / (b.sigma - a.sigma || 1)
		return {y: a.cy + (b.cy - a.cy) * u, z: a.cz + (b.cz - a.cz) * u, angle}
	}
}
const bedOf = loop => (loop.back ? -1 : 1)

// show: bed side, plus bulge (smoothed along the wale so ridges are round),
// plus, worn, off the machine: a tube's beds blown round into it (and bent,
// where one side's longer), and any other fabric's beds come together into
// one cloth. (z eases there: how far it's still to go)
function show(f, machine, first, n, gap, inflate) {
	const {px, py, pz, xs, ys, zs, bed, bulge, child} = f
	const tube = inflate > 0 ? tubes(machine, first, n) : null
	const surface = tube ? onTube(f, machine, first, n, tube) : null
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
		const apart = tube && !surface[i] && !f.pinned[i] ? gap * (1 - inflate) : gap
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
			// (as big round as its stitches are wide: half way round's as many
			// stitches as a bed has)
			let wide = 0
			for (let i = first; i < n; i++) if (tube[i]) wide += f.wide[i]
			const r = (w * (wide / (front + back))) / Math.PI
			const mid = (lo + hi) / 2
			const turnOf = i => (Math.max(-1, Math.min(1, (px[i] - mid) / (w / 2))) * Math.PI) / 2
			// (how far out towards the back a loop is)
			const rhoOf = i => -bed[i] * r * Math.cos(turnOf(i))
			const bent = bending(f, machine, first, n, tube, rhoOf)
			for (let i = first; i < n; i++) {
				if (!surface[i]) continue
				const t = turnOf(i)
				const round = mid + r * Math.sin(t)
				// (round the tube's middle, between the beds: its bed's
				// side, out as far as the tube's round there, and bulging)
				const out = bed[i] * r * Math.cos(t) + (pz[i] - bed[i] * gap)
				if (bent) {
					// and the middle bent: out's along its front, turned
					const {y, z, angle} = bent(i)
					xs[i] = px[i] + (round - px[i]) * inflate
					ys[i] = py[i] + (y - Math.sin(angle) * out - py[i]) * inflate
					zs[i] = zs[i] + (z + Math.cos(angle) * out - zs[i]) * inflate
				} else {
					xs[i] = px[i] + (round - px[i]) * inflate
					zs[i] = zs[i] + (out - zs[i]) * inflate
				}
			}
		}
	}
	return easing
}

export function relax(
	f,
	machine,
	sweeps,
	{gap = 0, inflate = 0, until = Infinity, limit = 20000, squash = SQUASH, grab = null, size = PLAIN} = {},
) {
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
	const key = `${n}|${machine.rack}|${gap}|${inflate}|${limit}|${squash}|${size.key}`
	if (!grab && !f.grabbed && f.settled && f.key === key && !pinsMoved) return 0
	// (the sizes changed: every loop's resized, and its row's laid out again)
	const resized = f.sizeKey !== size.key
	f.sizeKey = size.key
	sizes(f, machine, resized ? 0 : from, n, size)
	if (resized && from > 0) relink(f, machine, 0, from)
	if (n > from) layout(f, machine, from, n, first)
	alongs(f, resized ? 0 : from, n)
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
