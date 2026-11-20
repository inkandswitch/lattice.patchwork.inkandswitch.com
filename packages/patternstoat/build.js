// a patternstoat and its charm, as knitout: each design row, bottom up,
// takes its reference row of the charm and the + rows after it, and each of
// those is a pass: what every cell's column does there (its tile from its
// anchor), in the row's direction and yarn, with the stitch layer on top: a
// stitch painted on a bed is what that bed does, in every pass the charm
// does something on it (and in the first, if it does nothing on it at all).
// a pass with nothing in it is left out
//
// what the kniterate can't knit isn't fixed here: it's built as it is, and
// checks (lattice's checks.js) say so, as they do for a .js's .k
import {cellAt, columnOf, groupsOf} from "./charm.js"
import {castOff, castOn} from "./castings.js"
import {fieldsOf} from "./patternstoat.js"
import {DEFAULTS} from "../lattice/kniterate-rows.js"

const CARRIERS = ["1", "2", "3", "4", "5", "6"]
const SETTINGS = [
	["stitch", "x-stitch-number"],
	["speed", "x-speed-number"],
	["roller", "x-roller-advance"],
]
const STITCH_OP = {k: "knit", t: "tuck", m: "miss"}

const fail = (row, needle, message) => ({error: {row, needle, message}})

// a pass's settings, as the kniterate takes them: a stitch number is digits
// or a letter A–Z (lattice's machine profiles), speed and roller digits
export function settingProblem(key, value) {
	if (value == null) return null
	const ok = key === "stitch" ? /^(\d+|[A-Z])$/.test(value) : /^\d+$/.test(value)
	return ok ? null : `${key} ${value} isn't a number`
}

// at full gauge, a cell's back is across from its front: these would land on
// the other bed's own loops
const NEEDS_HALF_GAUGE = {co: "cast off", x: "transfer"}

// cell x's needles, front and back, at the patternstoat's gauge
function needlesOf(stoat, x) {
	const gauge = stoat.gauge === 1 ? 1 : 2
	const front = stoat.left + gauge * x
	return {f: front, b: front + gauge - 1}
}

// {knitout, rows} (rows[r]: the .k line design row r starts on), or {error}
export function buildKnitout(stoat, charm, {needles = 252} = {}) {
	if (!charm) return fail(null, null, "no charm linked")
	const groups = groupsOf(charm)
	if (!groups.length) return fail(null, null, "the charm has no reference rows")
	const height = stoat.colours?.length ?? 0

	// first what each design row's passes are, so a carrier can go out after
	// its last
	const plan = []
	const lastDir = new Map()
	const lastRow = new Map()
	for (let r = 0; r < height; r++) {
		const yarn = String(stoat.yarns?.[r] ?? "")
		if (!CARRIERS.includes(yarn)) return fail(r + 1, null, `yarn ${yarn} isn't a carrier (1–6)`)
		const fields = fieldsOf(stoat.colours[r])
		for (const field of fields) {
			for (let x = field.start; x <= field.end; x++) {
				const {f, b} = needlesOf(stoat, x)
				if (!columnOf(charm, field.colour)) return fail(r + 1, f, `colour ${field.colour} isn't in the charm`)
				for (const n of [f, b]) if (!(n >= 1 && n <= needles)) return fail(r + 1, Number.isFinite(n) ? n : null, `past the bed (1–${needles})`)
			}
		}
		const passes = []
		const group = groups.length ? groups[r % groups.length] : []
		// which beds the charm does something on, at each cell, in any of
		// the group's passes: a stitch painted on a bed it never uses goes in
		// the first
		const used = new Map()
		for (const field of fields) {
			const column = columnOf(charm, field.colour)
			for (let x = field.start; x <= field.end; x++) {
				const beds = {f: false, b: false}
				for (const row of group) {
					const cell = cellAt(charm, column, row.id, x, field, stoat.width)
					if (cell.f != null) beds.f = true
					if (cell.b != null) beds.b = true
				}
				used.set(x, beds)
			}
		}
		for (const [index, row] of group.entries()) {
			const cells = []
			for (const field of fields) {
				const column = columnOf(charm, field.colour)
				for (let x = field.start; x <= field.end; x++) {
					const cell = cellAt(charm, column, row.id, x, field, stoat.width)
					const painted = stoat.stitches?.[r]?.[x]
					// a painted stitch is what its bed does wherever the charm
					// does something on it (✦ included), or in the first pass
					const onBed = bed => {
						const mine = painted?.[bed] ?? null
						if (cell[bed] != null) return mine ?? (cell[bed] === "*" ? null : cell[bed])
						return index === 0 && !used.get(x)[bed] ? mine : null
					}
					const f = onBed("f")
					const b = onBed("b")
					if (stoat.gauge === 1) {
						const half = NEEDS_HALF_GAUGE[f] ?? NEEDS_HALF_GAUGE[b]
						if (half) return fail(r + 1, needlesOf(stoat, x).f, `${half} needs half gauge: at full gauge it transfers onto the other bed's loops`)
					}
					if (f || b) cells.push({x, f, b, ...prefix(needlesOf(stoat, x))})
				}
			}
			if (!cells.length) continue
			const carrier = row.yarn && row.yarn !== "row" ? String(row.yarn) : yarn
			const knits = cells.some(c => knitting(c.f) || knitting(c.b))
			let dir = row.dir
			if (dir !== "+" && dir !== "-") dir = lastDir.get(carrier) === "+" ? "-" : "+"
			if (knits) {
				if (!CARRIERS.includes(carrier)) return fail(r + 1, null, `yarn ${carrier} isn't a carrier (1–6)`)
				lastDir.set(carrier, dir)
				lastRow.set(carrier, r)
			}
			for (const [key] of SETTINGS) {
				const problem = settingProblem(key, row[key] == null ? null : String(row[key]))
				if (problem) return fail(r + 1, null, problem)
			}
			const settings = Object.fromEntries(SETTINGS.map(([key]) => [key, String(row[key] ?? DEFAULTS[key])]))
			passes.push({dir, carrier: knits ? carrier : null, settings, cells})
		}
		plan.push(passes)
	}

	// then the lines
	const lines = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6"]
	const written = {}
	for (const [key, op] of SETTINGS) {
		written[key] = String(DEFAULTS[key])
		lines.push(`${op} ${written[key]}`)
	}
	const rows = []
	const inside = new Set()
	plan.forEach((passes, r) => {
		rows.push(lines.length)
		lines.push(`;; row ${r + 1}`)
		for (const pass of passes) {
			for (const [key, op] of SETTINGS) {
				if (pass.settings[key] !== written[key]) {
					written[key] = pass.settings[key]
					lines.push(`${op} ${written[key]}`)
				}
			}
			if (pass.carrier && !inside.has(pass.carrier)) {
				inside.add(pass.carrier)
				lines.push(`in ${pass.carrier}`)
			}
			lines.push(...passLines(pass))
		}
		for (const carrier of [...inside]) {
			if (lastRow.get(carrier) === r) {
				lines.push(`out ${carrier}`)
				inside.delete(carrier)
			}
		}
	})
	return {knitout: lines.join("\n") + "\n", rows}
}

const knitting = code => code === "k" || code === "t" || code === "m" || code === "co" || code === "cn"
const prefix = ({f, b}) => ({nf: f, nb: b})

// a pass's lines: its transfers first (each at the rack it needs), then its
// knitting in needle order, front then back, casting off and on where their
// runs fall, then its drops
function passLines({dir, carrier, cells}) {
	const lines = []
	const byNeedle = [...cells].sort((a, b) => a.x - b.x)

	let rack = 0
	for (const cell of byNeedle) {
		for (const [bed, from, to] of [["f", `f${cell.nf}`, `b${cell.nb}`], ["b", `b${cell.nb}`, `f${cell.nf}`]]) {
			if (cell[bed] !== "x") continue
			const need = cell.nf - cell.nb // at rack r, back n is across from front n + r
			if (need !== rack) lines.push(`rack ${(rack = need)}`)
			lines.push(`xfer ${from} ${to}`)
		}
	}
	if (rack !== 0) lines.push("rack 0")

	const ordered = dir === "-" ? [...byNeedle].reverse() : byNeedle
	// each bed's needles in the pass, in order, with what they do
	const steps = []
	for (const cell of ordered) {
		for (const bed of ["f", "b"]) {
			const code = cell[bed]
			if (knitting(code)) steps.push({bed, n: bed === "f" ? cell.nf : cell.nb, code})
		}
	}
	const done = new Set()
	for (let i = 0; i < steps.length; i++) {
		if (done.has(i)) continue
		const step = steps[i]
		if (step.code !== "co" && step.code !== "cn") {
			lines.push(`${STITCH_OP[step.code]} ${dir} ${step.bed}${step.n} ${carrier}`)
			continue
		}
		// a run: the steps after it on its bed doing the same (the other bed's
		// steps between them come after it)
		const run = [i]
		for (let j = i + 1; j < steps.length; j++) {
			if (steps[j].bed !== step.bed) continue
			if (steps[j].code !== step.code) break
			run.push(j)
		}
		for (const j of run) done.add(j)
		const needles = run.map(j => steps[j].n)
		if (step.code === "cn") {
			lines.push(...castOn({bed: step.bed, needles, dir, carrier}))
			continue
		}
		const next = steps.slice(run[run.length - 1] + 1).find(s => s.bed === step.bed && (s.code === "k" || s.code === "t"))
		lines.push(...castOff({bed: step.bed, needles, next: next?.n ?? null, dir, carrier, other: step.bed === "f" ? "b" : "f"}))
	}

	for (const cell of byNeedle) {
		if (cell.f === "d") lines.push(`drop f${cell.nf}`)
		if (cell.b === "d") lines.push(`drop b${cell.nb}`)
	}
	return lines
}
