// casting off and on, in place, inside a pass: the knitout lines for a run
// of needles, to go where the run falls in the pass's needle order, so the
// pass knits up to it, does it, and knits on, and its carrier ends where it
// would have anyway

// bind off `needles` (bed needle numbers, in the pass's order) on `bed` ("f"
// or "b"), going `dir`: knit a needle, move its loop to the next needle
// through the other bed (at the same needle there: empty, at half gauge),
// knit that one through both, and so on. the last loop goes onto `next`
// (the next needle in the pass knitting on this bed, which the pass then
// knits), or, with nowhere to go, stays where it is. ends at rack 0
export function castOff({bed, needles, next = null, dir, carrier, other}) {
	const lines = []
	needles.forEach((n, i) => {
		lines.push(`knit ${dir} ${bed}${n} ${carrier}`)
		const target = i < needles.length - 1 ? needles[i + 1] : next
		if (target == null) return
		// at rack r, back needle n is across from front needle n + r
		const rack = bed === "f" ? target - n : n - target
		lines.push(`xfer ${bed}${n} ${other}${n}`, `rack ${rack}`, `xfer ${other}${n} ${bed}${target}`, "rack 0")
	})
	return lines
}

// new loops on empty `needles` (in the pass's order) on `bed`, going `dir`:
// a tuck on each, for the next pass to knit
export function castOn({bed, needles, dir, carrier}) {
	return needles.map(n => `tuck ${dir} ${bed}${n} ${carrier}`)
}
