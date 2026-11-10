import {PLATED_TEX, nmOf} from "./counts.js"

// how big the knitting comes out, in mm: what a stitch number makes of the
// yarn, and what the yarn makes of the fabric
//
// a stitch number (x-stitch-number, 0–9 or A–Z) is only a name for a row of
// the kniterate's own stitch table: what it pulls through is the machine's
// and the yarn's (its tension and friction change it as much as 20%, Munden
// found), so it's measured, not known, and measured again for another yarn.
// what's measured is the loop: the yarn knitted into each stitch (knit a row
// across 100 needles in another yarn, pull it out, measure it pulled just
// straight, under 10 g or so: that ÷ 100). from the loop, plain knitting's
// size follows Munden (1959, "the geometry and dimensional properties of
// plain-knit fabrics"): relaxed, a loop takes the same shape whatever it's
// knitted from, so rows per mm × loop ≈ kc and stitches per mm × loop ≈ kw,
// whatever the yarn's thickness, or the needles. a swatch, measured, is
// better than that: it's used as it is, and (with its loop) it tells kc and
// kw for the yarn, for the stitch numbers without a swatch. (filament nylon,
// set out of shape as it's knitted, never takes that shape: none of this
// holds for it)
//
// stretched, a stitch's yarn stays as long as it was: it's pulled from its
// rows into its width. Poincloux, Adda-Bedia & Lechenault (2018, "geometry
// and elasticity of a knitted fabric") have a stitch `c` wide and `w` tall
// keep c + δw, so stretched ε around it's (c/w)/δ × ε shorter

// kc and kw for plain-knit wool, by how far it's relaxed: as it comes off the
// machine and left to lie (dry: Munden), soaked half a day and dried flat
// (wet: Munden), and washed hot and tumbled (full: Knapton et al., 1968)
export const RELAXED = {
	dry: {kc: 5.0, kw: 3.8, name: "off the machine"},
	wet: {kc: 5.3, kw: 4.1, name: "washed"},
	full: {kc: 5.5, kw: 4.2, name: "washed hot & tumbled"},
}
// and for the rest, Munden's stitches per area × loop² (ks = kc × kw), dry
// and wet: kc and kw are wool's, in the same proportion (the loop's the same
// shape), times as much bigger as ks is. yarns that don't take up water
// relax no further for washing. (cotton never quite relaxes dry: it keeps
// some of the stretch the take-down gave it till it's washed. only wool's
// been measured fully relaxed: the rest are as washed)
export const FIBRES = {
	wool: {dry: 19.0, wet: 21.6, name: "wool"},
	cotton: {dry: 19.0, wet: 22.6, name: "cotton"},
	synthetic: {dry: 18.5, wet: 18.5, name: "acrylic, spun nylon"},
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
export const FABRIC = {relax: "dry", fibre: "wool", tex: null, strands: 1, stitches: {}, shorten: null, around: null}

export function fabricOf(settings) {
	const fabric = {...FABRIC, ...(settings?.fabric ?? {})}
	if (!RELAXED[fabric.relax]) fabric.relax = FABRIC.relax
	if (!FIBRES[fabric.fibre]) fabric.fibre = FABRIC.fibre
	if (!fabric.stitches || typeof fabric.stitches !== "object") fabric.stitches = {}
	return fabric
}

const measured = value => (Number.isFinite(value) && value > 0 ? value : null)

// Munden's kc and kw for the fibre, relaxed so far
export function munden(fabric) {
	const wool = RELAXED[fabric.relax]
	if (fabric.fibre === "wool" || !FIBRES[fabric.fibre]) return wool
	const fibre = FIBRES[fabric.fibre]
	const scale = Math.sqrt(fibre[fabric.relax === "dry" ? "dry" : "wet"] / FIBRES.wool[fabric.relax === "dry" ? "dry" : "wet"])
	const shape = fabric.relax === "full" ? RELAXED.wet : wool
	return {kc: shape.kc * scale, kw: shape.kw * scale}
}

// Munden's kc and kw for a yarn that relaxes like `relaxesLike` (one of
// FIBRES), relaxed as `state` is. steamed hasn't any: nobody's measured how
// far steaming relaxes it
export function kOf(relaxesLike, state) {
	if (!RELAXED[state]) return null
	const {kc, kw} = munden({relax: state, fibre: FIBRES[relaxesLike] ? relaxesLike : "wool"})
	return {kc, kw}
}

// a stitch's size (mm: `across`, its width, `up`, its height, and `loop`,
// its yarn) as it's let relax each way, from what's `measured` of it
// ({state: {across, up}}, either of them null if it isn't known). a state
// measured is as it was; one half measured has its other half from the
// loop's shape (Munden's), and is `estimated`; and those not measured are
// estimated from the first measured of dry, wet and full, the loop staying as
// long as it was and the stitch taking each state's shape. steamed is only
// ever as measured (and only with both halves): there's nothing to say how it
// goes from or to the others
export function statesFrom(measured, relaxesLike, loop = null) {
	const known = value => Number.isFinite(value) && value > 0
	const states = {dry: null, steamed: null, wet: null, full: null}
	for (const state of Object.keys(states)) {
		const {across = null, up = null} = measured?.[state] ?? {}
		if (!known(across) && !known(up)) continue
		if (known(across) && known(up)) {
			states[state] = {across, up, loop: null, estimated: false}
			continue
		}
		const k = kOf(relaxesLike, state)
		if (!k) continue
		states[state] = known(across)
			? {across, up: (across * k.kw) / k.kc, loop: null, estimated: true}
			: {across: (up * k.kc) / k.kw, up, loop: null, estimated: true}
	}
	const base = ["dry", "wet", "full"].find(state => states[state])
	const baseK = base && kOf(relaxesLike, base)
	const yarn = known(loop) ? loop : base ? states[base].across * baseK.kw : null
	for (const state of Object.keys(states)) {
		if (states[state]) {
			states[state].loop = yarn
			continue
		}
		const k = kOf(relaxesLike, state)
		if (!base || !k) continue
		states[state] = {
			across: (states[base].across * baseK.kw) / k.kw,
			up: (states[base].up * baseK.kc) / k.kc,
			loop: yarn,
			estimated: true,
		}
	}
	return states
}

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
	const known = munden(fabric)
	return {
		kc: kcs.length ? mean(kcs) : known.kc,
		kw: kws.length ? mean(kws) : known.kw,
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

// how tight it's knitted: √tex / loop (cm). commercial plain knitting's
// usually about 14.7 (as textile course notes have it: not Munden's 1959
// paper); a lot less is sleazy, a lot more stiff
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

// ── sizes from profiles: a machine, and each carrier's yarns and their
// swatches, as profiles.js resolves them

// does a swatch knitted on `swatchMachine` count for knitting on `machine`:
// "measured" if it's the same machine, "other-machine" if it's another of
// the same make, model and gauge (the same stitch number's near enough the
// same stitch), and not at all otherwise. with no machine, any swatch knitted
// at the gauge in use is another machine's. a swatch nobody's said the
// machine of counts too (it's most likely this one, and it's all there is):
// as this machine's if neither says, and another's if the knitting does
export function machineTier(swatchMachine, machine, gauge) {
	if (!swatchMachine) return machine ? "other-machine" : "measured"
	if (machine && swatchMachine.url === machine.url) return "measured"
	if (!machine) return swatchMachine.gauge === gauge ? "other-machine" : null
	const same = swatchMachine.make === machine.make && swatchMachine.model === machine.model && swatchMachine.gauge === machine.gauge
	return same ? "other-machine" : null
}

// was a swatch fed as the carrier is: the same yarns (which is in the hole
// and which in the slit doesn't change the size), and two of them plated if
// they're plated, held if they're held
export function feedMatches(swatch, carrier) {
	const wanted = carrier.yarns.map(yarn => yarn.url).sort()
	return (swatch.feeds ?? []).some(feed => {
		const yarns = [...(feed.yarns ?? [])].sort()
		if (yarns.length !== wanted.length || yarns.some((url, i) => url !== wanted[i])) return false
		return yarns.length < 2 || !!feed.plated === !!carrier.plated
	})
}

const mean = list => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null)
const NO_STATES = {dry: null, steamed: null, wet: null, full: null}

// a carrier's stitch, at stitch number `stitch` in `structure`, on `machine`
// (or none, at `gauge`): its size as it's let relax each way, and where
// that's from (`tier`): swatches of these yarns at this stitch, on this
// machine ("measured") or another like it ("other-machine"); a swatch's loop
// length, for jersey, by Munden ("loop"); or nothing ("guess": a stitch as
// wide as a needle). a carrier with no profiles (null) is sized from what
// this browser keeps (`fabric`), as it always was. `base` is the state that's
// its own: the kept fabric's, or the first measured; and a size that wasn't
// measured at all (a guess, or from a loop) is estimated in every state
export function stitchSizes({carrier, stitch, structure, machine, gauge, fabric}) {
	const pitch = 25.4 / gauge
	if (!carrier) {
		const kept = fabricOf({fabric})
		const s = stitchSize(kept, stitch, pitch)
		const tier = s.from === "swatch" ? "measured" : s.from
		const states = statesFrom({[kept.relax]: {across: s.across, up: s.up}}, kept.fibre, s.loop)
		return {tier, base: kept.relax, swatches: [], states: tier === "measured" ? states : estimated(states), roller: null, speed: null}
	}
	const relaxesLike = carrier.yarns[0]?.relaxesLike ?? "wool"
	const theirs = carrier.swatches.filter(
		swatch => feedMatches(swatch, carrier) && swatch.stitch === stitch && swatch.structure === structure && machineTier(swatch.machine, machine, gauge),
	)
	const measured = swatch => Object.values(swatch.relaxed ?? {}).some(Boolean)
	const best = list => {
		const here = list.filter(swatch => machineTier(swatch.machine, machine, gauge) === "measured")
		return here.length ? {tier: "measured", list: here} : {tier: "other-machine", list}
	}
	const listed = list => list.map(({url, title, sure, machine}) => ({url, title, sure, machine}))
	const result = (tier, list, states) => ({
		tier,
		base: baseOf(states),
		swatches: listed(list),
		states: tier === "measured" || tier === "other-machine" ? states : estimated(states),
		roller: list[0]?.roller ?? null,
		speed: list[0]?.speed ?? null,
	})

	// (swatches whose measurements come to no size at all, half a steamed
	// state say, are passed over for the next tier)
	const sized = theirs.filter(measured)
	if (sized.length) {
		const {tier, list} = best(sized)
		const each = {}
		for (const state of Object.keys(NO_STATES)) {
			const densities = list.map(swatch => swatch.relaxed[state]).filter(Boolean)
			if (!densities.length) continue
			each[state] = {
				across: mean(densities.filter(d => d.wales > 0).map(d => 100 / d.wales)),
				up: mean(densities.filter(d => d.courses > 0).map(d => 100 / d.courses)),
			}
		}
		const loop = mean(list.map(swatch => swatch.loop).filter(loop => loop > 0))
		const states = statesFrom(each, relaxesLike, loop)
		if (Object.values(states).some(Boolean)) return result(tier, list, states)
	}

	const looped = theirs.filter(swatch => swatch.loop > 0)
	if (structure === "jersey" && looped.length) {
		const {list} = best(looped)
		const loop = mean(list.map(swatch => swatch.loop))
		const fitted = carrier.swatches.filter(swatch => swatch.structure === "jersey" && swatch.loop > 0 && swatch.relaxed?.dry?.wales > 0 && swatch.relaxed?.dry?.courses > 0)
		const k = fitted.length
			? {kc: mean(fitted.map(s => (s.loop * s.relaxed.dry.courses) / 100)), kw: mean(fitted.map(s => (s.loop * s.relaxed.dry.wales) / 100))}
			: kOf(relaxesLike, "dry")
		return result("loop", list, statesFrom({dry: {across: loop / k.kw, up: loop / k.kc}}, relaxesLike, loop))
	}

	const k = kOf(relaxesLike, "dry")
	return result("guess", [], statesFrom({dry: {across: pitch, up: (pitch * k.kw) / k.kc}}, relaxesLike))
}

// every state there is, marked estimated
function estimated(states) {
	return Object.fromEntries(Object.entries(states).map(([state, size]) => [state, size && {...size, estimated: true}]))
}

// the first state measured, or else the first there is
function baseOf(states) {
	const names = Object.keys(NO_STATES)
	return names.find(state => states[state] && !states[state].estimated) ?? names.find(state => states[state]) ?? null
}

// two strands plated that aren't Nm 6–8 together, as the kniterate's manual
// would have them: what to say about it (or null)
export function platingNote(carrier) {
	const tex = carrier?.tex
	if (!carrier?.plated || !(tex > 0)) return null
	if (tex >= PLATED_TEX.low && tex <= PLATED_TEX.high) return null
	return `the two strands come to Nm ${nmOf(tex).toFixed(1)} together: the kniterate's manual says Nm 6–8 knits best`
}
