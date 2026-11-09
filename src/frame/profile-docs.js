// what's kept of a knitting machine, a yarn, and a swatch knitted from them:
// each its own doc, so anyone it's shared with can see it, fix it, and
// comment on it, and the same one can be in any number of projects
//
// - a machine: what it is (make, model), its gauge, beds and carriers, and its
//   stitch table: what each of knitout's stitch numbers (x-stitch-number,
//   0–9 or A–Z, the kniterate's converter writes straight into the machine's
//   code) is set to on the machine, on each bed
// - a yarn: what it is, what it's spun from, its count, and where it came
//   from; and (`swatches`) the swatches knitted from it, so they can be found
// - a swatch: how it was knit (on what, from which yarns, at what stitch, in
//   what structure, how many needles and rows), and what was measured of it,
//   in each of the ways it's been let relax. it's the swatch that says which
//   yarns it's of: a yarn's `swatches` is only an index, kept by the swatch
//   editor
//
// a .k says which it's knitted with as `profiles` (see profiles.js)

export const MACHINE_TYPE = "lattice:machine"
export const YARN_TYPE = "lattice:yarn"
export const SWATCH_TYPE = "lattice:swatch"

// how a swatch has been let relax before it's measured: off the machine and
// left to lie (dry), steamed (the kniterate manual's way, p.41), soaked and
// dried flat (wet), washed hot and tumbled (full). see size.js's RELAXED
export const RELAX_STATES = ["dry", "steamed", "wet", "full"]
export const STRUCTURES = ["jersey", "rib-1x1", "rib-2x2", "other"]

const KINDS = {[MACHINE_TYPE]: "machine", [YARN_TYPE]: "yarn", [SWATCH_TYPE]: "swatch"}

// a kniterate, as it comes
export function newMachine() {
	return {
		"@patchwork": {type: MACHINE_TYPE},
		title: "kniterate",
		make: "Kniterate",
		model: "Kniterate",
		gauge: 7,
		needles: 252,
		beds: 2,
		carriers: ["1", "2", "3", "4", "5", "6"],
		// what the machine calls its stitch size, and its range (manual p.36)
		stitchSizes: {min: 0, max: 15},
		// stitch number → {front, rear, note}: what it's set to on each bed
		stitches: {},
		// the longest float, in needles (manual p.25: "6-7 stitches")
		floatLimit: 7,
		notes: "",
	}
}

export function newYarn() {
	return {
		"@patchwork": {type: YARN_TYPE},
		title: "yarn",
		fibres: [], // [{fibre, percent}]
		relaxesLike: "wool", // which of size.js's FIBRES it takes after
		count: {system: "Nm", value: null, ply: 1},
		supplier: "",
		colourway: "",
		colour: null,
		lot: "",
		swatches: [],
		notes: "",
	}
}

export function newSwatch() {
	return {
		"@patchwork": {type: SWATCH_TYPE},
		title: "swatch",
		knit: {
			machine: null,
			// [{carrier, yarns: [the knitting hole's, the plating slit's], plated}]
			feeds: [],
			stitch: "5",
			stitchSize: {front: null, rear: null},
			roller: null,
			speed: null,
			// every needle in use, both beds together
			needles: null,
			rows: null,
			structure: "jersey",
			structureNote: "",
			k: null,
			kHash: null,
			sure: "guessed", // known | believed | guessed
			note: "",
		},
		// each state: null, or {entered: "mm" | "per10", width, height (mm),
		// wales, courses (per 10 cm), grams, date, by}
		relaxed: {dry: null, steamed: null, wet: null, full: null},
		loop: {mm: null, date: null, by: null},
		photos: [],
		notes: "",
	}
}

const NEW = {[MACHINE_TYPE]: newMachine, [YARN_TYPE]: newYarn, [SWATCH_TYPE]: newSwatch}

// a datatype for patchwork, for one of the three
export function datatypeFor(type) {
	const make = NEW[type]
	return {
		init(doc) {
			const {"@patchwork": _, ...fields} = make()
			Object.assign(doc, fields)
		},
		getTitle(doc) {
			return doc?.title || KINDS[type]
		},
		setTitle(doc, title) {
			doc.title = title
		},
	}
}

export function profileKind(doc) {
	return KINDS[doc?.["@patchwork"]?.type] ?? null
}

const positive = value => (Number(value) > 0 ? Number(value) : null)

// stitches and rows per 10 cm, as a state of a swatch measured: as entered,
// or from the mm across its needles and rows. what can't be known (mm, with
// the needles or rows not known) is null; and if neither is, null
export function swatchDensity(swatch, state) {
	const entry = swatch?.relaxed?.[state]
	if (!entry) return null
	let wales = null
	let courses = null
	if (entry.entered === "per10") {
		wales = positive(entry.wales)
		courses = positive(entry.courses)
	} else {
		const needles = positive(swatch.knit?.needles)
		const rows = positive(swatch.knit?.rows)
		const width = positive(entry.width)
		const height = positive(entry.height)
		if (needles && width) wales = (needles / width) * 100
		if (rows && height) courses = (rows / height) * 100
	}
	return wales == null && courses == null ? null : {wales, courses}
}

// the yarns a swatch was knitted from, once each
export function swatchYarns(swatch) {
	const yarns = []
	for (const feed of swatch?.knit?.feeds ?? []) {
		for (const yarn of feed?.yarns ?? []) if (yarn && !yarns.includes(String(yarn))) yarns.push(String(yarn))
	}
	return yarns
}

// what's in `after` and not `before`, and the other way round
export function indexChanges(before, after) {
	return {add: after.filter(url => !before.includes(url)), remove: before.filter(url => !after.includes(url))}
}

// what each state and structure's called, where people read them
export const STATE_NAMES = {dry: "off the machine", steamed: "steamed", wet: "washed", full: "washed hot & tumbled"}
export const STRUCTURE_NAMES = {jersey: "jersey", "rib-1x1": "1×1 rib", "rib-2x2": "2×2 rib", other: "other"}

const number = value => String(Math.round(Number(value) * 10) / 10)

// a swatch in a line: its structure, stitch, how it was fed, its needles and
// rows, the first of what it measures, and how sure anyone is of how it was
// knit. "2×2 rib · st 5 · plated · 48 × 100 · steamed: 98 × 142 mm · guessed"
export function swatchSummary(swatch) {
	const knit = swatch?.knit ?? {}
	const parts = []
	parts.push(knit.structure === "other" && knit.structureNote ? String(knit.structureNote) : (STRUCTURE_NAMES[knit.structure] ?? "jersey"))
	parts.push(`st ${knit.stitch ?? "5"}`)
	const feed = knit.feeds?.[0]
	if (feed?.yarns?.length > 1) parts.push(feed.plated ? "plated" : "held")
	if (positive(knit.needles) && positive(knit.rows)) parts.push(`${knit.needles} × ${knit.rows}`)
	const state = RELAX_STATES.find(name => swatch?.relaxed?.[name])
	if (state) {
		const entry = swatch.relaxed[state]
		const measure =
			entry.entered === "per10"
				? positive(entry.wales) || positive(entry.courses)
					? `${number(entry.wales ?? 0)} × ${number(entry.courses ?? 0)} per 10 cm`
					: null
				: positive(entry.width) || positive(entry.height)
					? `${number(entry.width ?? 0)} × ${number(entry.height ?? 0)} mm`
					: null
		if (measure) parts.push(`${STATE_NAMES[state]}: ${measure}`)
	}
	parts.push(knit.sure || "guessed")
	return parts.join(" · ")
}
