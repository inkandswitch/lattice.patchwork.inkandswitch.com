// how a swatch was knit, from the check (knitcheck.js) of the .k that knit
// it: its needles and rows, the stitch number, structure, roller and speed
// most of it was knitted at, each carrier it used and the yarns the .k says
// were in it, and which .k it was, as it was then (its text's fingerprint,
// so the swatch can tell when the .k's changed since)
import {RELAX_STATES} from "./profile-docs.js"
import {textHash} from "./files.js"

export function knitFromCheck(result, k, kUrl, kText) {
	const [most] = result.size.sources ?? []
	const longest = RELAX_STATES.map(state => result.size.states?.[state]).filter(Boolean)
	const rows = Math.max(0, ...longest.map(state => state.length?.rows ?? 0))
	return {
		needles: result.width || null,
		rows: rows || null,
		...(most ? {stitch: most.stitch, structure: most.structure, roller: most.kRoller, speed: most.kSpeed} : {}),
		feeds: (result.yarn ?? []).map(({carrier}) => ({
			carrier,
			yarns: Array.from(k?.profiles?.carriers?.[carrier] ?? []).map(String),
			plated: !!k?.yarns?.[Number(carrier) - 1]?.plated,
		})),
		k: kUrl,
		kHash: textHash(kText),
	}
}
