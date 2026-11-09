// how a swatch was knit, from the check (knitcheck.js) of the .k that knit
// it: the needles (both beds) and rows, stitch number, structure, roller and
// speed of what most of it was knitted in (the swatch, not its waste yarn);
// the carriers the .k links yarns to, and that one's, with their yarns (the
// .k's, or, where it links none, the ones the swatch already had: `existing`
// feeds); and which .k it was, as it was then (its text's fingerprint, so
// the swatch can tell when the .k's changed since)
import {RELAX_STATES} from "./profile-docs.js"
import {textHash} from "./files.js"

export function knitFromCheck(result, k, kUrl, kText, existing = []) {
	const [most] = result.size.sources ?? []
	const longest = RELAX_STATES.map(state => result.size.states?.[state]).filter(Boolean)
	const rows = most?.rows ?? Math.max(0, ...longest.map(state => state.length?.rows ?? 0))
	const linked = k?.profiles?.carriers ?? {}
	const carriers = (result.yarn ?? []).map(({carrier}) => carrier).filter(carrier => carrier === most?.carrier || linked[carrier]?.length)
	const had = carrier => existing.find(feed => String(feed?.carrier) === carrier)
	return {
		needles: most?.needles ?? (result.width || null),
		rows: rows || null,
		...(most ? {stitch: most.stitch, structure: most.structure, roller: most.kRoller, speed: most.kSpeed} : {}),
		feeds: carriers.map(carrier => {
			const yarns = Array.from(linked[carrier] ?? []).map(String)
			const before = had(carrier)
			return yarns.length
				? {carrier, yarns, plated: !!k?.yarns?.[Number(carrier) - 1]?.plated}
				: {carrier, yarns: Array.from(before?.yarns ?? []).map(String), plated: !!before?.plated}
		}),
		k: kUrl,
		kHash: textHash(kText),
	}
}
