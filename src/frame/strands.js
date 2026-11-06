// two strands fed through one carrier together: which shows where
//
// held together, two strands lie side by side, and the pair's rolled some way
// round the yarn's middle: call it φ, 0 with the first strand out of the
// loop's face (its technical face, the side its needle pulled it to) and the
// second behind it, π the other way round, ±π/2 side by side. what's seen of
// a loop is the strand rolled towards you, and as much of the other as sin φ
// leaves showing beside it.
//
// fed through the same hole, nothing holds φ: the pair rolls as it goes
// through the carrier and round the needles, a little each loop, and which
// strand's on top comes and goes, the way marl does ("the colours appear and
// disappear randomly depending how the yarn sits when it is knitted": Duan,
// Taylor & Townsend 2013, "knitted fabric effects using two-coloured (marl)
// yarns"; and untwisted, with the tension varying, it comes and goes in bars,
// not dots). so φ is a random walk along the yarn: from loop to loop it turns
// by a normal step of TWIST radians, and over n loops it's turned √n × TWIST
// or so, which keeps a strand on top for about (π/2 ÷ TWIST)² loops at a
// time: a stitch or three, a few in a row now and then. TWIST is a guess till
// it's measured: knit a swatch held double, count how long the runs of one
// colour are, and put TWIST at π/2 ÷ √(that).
//
// plated (one strand through the carrier's hole, the other through its
// plating slit: kniterate's "plating" guide), the carrier holds φ: one's
// always on the face and the other always behind it, on the fabric's back
// (which is which is the feed's, and the tension's: EP3315642B1). here it's
// the first strand that's on the face: swap the colours for the other way.

export const TWIST = 0.9

// a step of the random walk, the same each time for the same loop (so the
// fabric doesn't flicker as it's rebuilt): a normal deviate, from the loop's
// number hashed (Box–Muller, from two of mulberry32's)
export function twistStep(id) {
	const u = hash(id * 2 + 1)
	const v = hash(id * 2 + 2)
	return TWIST * Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(2 * Math.PI * v)
}

function hash(seed) {
	let t = (seed + 0x6d2b79f5) | 0
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// how a loop's yarn's rolled: plated, not at all; held together, as the
// knitting left it
export function turnOf(loop, plated) {
	return plated ? 0 : (loop.turn ?? 0)
}
