// how big the knitting comes out, in mm: what a stitch number makes of the
// yarn, and what the yarn makes of the fabric
//
// a stitch number (x-stitch-number, 0–9 or A–Z) is only a name for a row of
// the kniterate's own stitch table: what it pulls through is the machine's,
// so it's measured, not known. what's measured is the loop: the yarn knitted
// into each stitch (knit a row across 100 needles in another yarn, pull it
// out, measure it: that ÷ 100). from the loop, plain knitting's size follows
// Munden (1959, "the geometry and dimensional properties of plain-knit
// fabrics"): relaxed, rows per mm × loop ≈ kc and stitches per mm × loop ≈
// kw, the same for any yarn of a kind, whatever its thickness. a swatch,
// measured, is better than that: it's used as it is, and (with its loop) it
// tells kc and kw for the yarn, for the stitch numbers without a swatch
//
// stretched, a stitch's yarn stays as long as it was: it's pulled from its
// rows into its width. Poincloux, Adda-Bedia & Lechenault (2018, "geometry
// and elasticity of a knitted fabric") have a stitch `c` wide and `w` tall
// keep c + δw, so stretched ε around it's (c/w)/δ × ε shorter

// kc and kw for plain-knit wool, by how far it's relaxed: as it comes off the
// machine (dry: Munden), washed and dried flat (wet: Munden), and washed hot
// and tumbled (full: Knapton et al., 1968)
export const RELAXED = {
	dry: {kc: 5.0, kw: 3.8, name: "off the machine"},
	wet: {kc: 5.3, kw: 4.1, name: "washed"},
	full: {kc: 5.5, kw: 4.2, name: "washed hot & tumbled"},
}
// δ, for plain knitting (Poincloux et al.'s, freely sliding)
export const DELTA = 0.71
// the converter's stitch number, until the .k says otherwise
export const STITCH = "5"

// what's known of the yarn and the stitches, as settings.js keeps it:
// {relax, tex (a strand's), strands, stitches: {number: {loop (mm), across
// (stitches per 10 cm, measured), up (rows per 10 cm, measured)}}, shorten
// (measured: how many times as much shorter it gets as it's stretched
// around), around (cm: what it's to go round, a foot, say)}
export const FABRIC = {relax: "dry", tex: null, strands: 1, stitches: {}, shorten: null, around: null}

export function fabricOf(settings) {
	const fabric = {...FABRIC, ...(settings?.fabric ?? {})}
	if (!RELAXED[fabric.relax]) fabric.relax = FABRIC.relax
	if (!fabric.stitches || typeof fabric.stitches !== "object") fabric.stitches = {}
	return fabric
}

const measured = value => (Number.isFinite(value) && value > 0 ? value : null)

// kc and kw for this yarn: from the swatches that have their loop, or else
// Munden's
export function constants(fabric) {
	const kcs = []
	const kws = []
	for (const entry of Object.values(fabric.stitches)) {
		const loop = measured(entry?.loop)
		if (!loop) continue
		if (measured(entry.up)) kcs.push((loop * entry.up) / 100)
		if (measured(entry.across)) kws.push((loop * entry.across) / 100)
	}
	const mean = list => list.reduce((sum, k) => sum + k, 0) / list.length
	const munden = RELAXED[fabric.relax]
	return {
		kc: kcs.length ? mean(kcs) : munden.kc,
		kw: kws.length ? mean(kws) : munden.kw,
		fitted: kcs.length > 0 || kws.length > 0,
	}
}

// a stitch number's stitch: {loop, across, up} (mm: its yarn, its width, its
// height) and where they came from: "swatch" (measured), "loop" (Munden, from
// its measured loop) or "guess" (nothing's measured: as the 3d view has it,
// a stitch as wide as the needles are apart)
export function stitchSize(fabric, number, pitch) {
	const entry = fabric.stitches[number] ?? {}
	const {kc, kw} = constants(fabric)
	const loop = measured(entry.loop)
	const across = measured(entry.across) ? 100 / entry.across : null
	const up = measured(entry.up) ? 100 / entry.up : null
	if (across && up) return {loop: loop ?? across * kw, across, up, from: "swatch"}
	if (loop) return {loop, across: across ?? loop / kw, up: up ?? loop / kc, from: across || up ? "swatch" : "loop"}
	const guess = across ? across * kw : up ? up * kc : pitch * kw
	return {loop: guess, across: guess / kw, up: guess / kc, from: across || up ? "swatch" : "guess"}
}

// how tight it's knitted: √tex / loop (cm). plain knitting's usually about
// 14.7 (Munden's commercial jersey); a lot less is sleazy, a lot more stiff
export const USUAL_TIGHTNESS = 14.7
export function tightness(fabric, size) {
	const tex = measured(fabric.tex)
	if (!tex || size.from === "guess") return null
	return Math.sqrt(tex * (measured(fabric.strands) ?? 1)) / (size.loop / 10)
}

// grams per square metre: loop × tex / (width × height)
export function grams(fabric, size) {
	const tex = measured(fabric.tex)
	if (!tex) return null
	return (size.loop * tex * (measured(fabric.strands) ?? 1)) / (size.across * size.up)
}

// how many times as much shorter it gets as it's stretched around: measured,
// or (c/w)/δ, c/w being a relaxed stitch's width over its height
export function shortening(fabric) {
	const shorten = measured(fabric.shorten)
	if (shorten) return {shorten, measured: true}
	const {kc, kw} = constants(fabric)
	return {shorten: kc / kw / DELTA, measured: false}
}

// knitting `around` mm round (relaxed) on something `body` mm round: how far
// it's stretched (ε, a share; less than 0 is loose) and how long a `length`
// of it is then. it's only so good for small stretches: pulled far enough
// that its rows lose half their height, the stitches will have jammed (the
// yarn's pressed against itself, and stretches instead of sliding) well
// before, and it's past saying (`jammed`: a rough line, not a measured one)
export function onBody(fabric, around, body, length) {
	const stretch = body / around - 1
	const {shorten} = shortening(fabric)
	const factor = 1 - shorten * Math.max(0, stretch)
	return {stretch, length: length * Math.max(0, factor), shorter: 1 - factor, jammed: factor < 0.5}
}
