// what's knitted in a pass: plain jersey (one bed), or rib (both beds, the
// stitches front and back by turns, in ones or twos), or something else.
// the kniterate knits both beds in a pass at half racking (manual p.9), so
// along the row a back needle sits between two front ones: front n at n, back
// n at n + the racking

// `stitches`: [{back, x}], the stitches a pass knits, x being where along the
// row. the runs of stitches on the same bed, in order along it, say which it
// is: the ones between the edges decide (an edge can be short, the rib
// starting part way through a run)
export function structureOf(stitches) {
	if (!stitches.length) return null
	const sorted = [...stitches].sort((a, b) => a.x - b.x)
	const runs = []
	let last = null
	for (const stitch of sorted) {
		if (stitch.back === last) runs[runs.length - 1]++
		else runs.push(1)
		last = stitch.back
	}
	if (runs.length === 1) return "jersey"
	const inner = runs.slice(1, -1)
	const edges = [runs[0], runs[runs.length - 1]]
	const all = (list, test) => list.every(test)
	if (inner.length) {
		if (all(inner, run => run === 1) && all(edges, run => run <= 1)) return "rib-1x1"
		if (all(inner, run => run === 2) && all(edges, run => run <= 2)) return "rib-2x2"
		return "other"
	}
	if (all(runs, run => run === 1)) return "rib-1x1"
	if (all(runs, run => run <= 2)) return "rib-2x2"
	return "other"
}

// for each op, what's knitted in the pass it's in (null, if that pass knits
// nothing). a pass is as knitcheck.js counts them: a new one each time the
// carriage turns (`track`, from knitting.js's carriageTrack)
export function passStructures(ops, track) {
	const passOf = []
	const stitches = [] // pass → its knits
	let pass = 0
	let rack = 0
	ops.forEach((op, i) => {
		if (track[i]?.turn != null) pass++
		if (op.kind === "rack") rack = op.rack
		passOf[i] = pass
		if (op.kind === "knit" && op.needle) {
			;(stitches[pass] ??= []).push({back: op.needle.back, x: op.needle.back ? op.needle.n + rack : op.needle.n})
		}
	})
	const structures = stitches.map(list => (list ? structureOf(list) : null))
	return passOf.map(pass => structures[pass] ?? null)
}
