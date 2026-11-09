// what a .k's knitted with, found: the machine and each carrier's yarns it
// links (as `profiles`: {machine, carriers: {"3": [the knitting hole's yarn,
// the plating slit's]}}), and every swatch of those yarns, with the machines
// they were knitted on, all copied out of their docs as plain data, so the
// check can have it in a worker. see profile-docs.js for what they hold, and
// size.js for what's made of them
//
// a .k that names no machine is knitted on its project's, if the project has
// just one. a carrier it doesn't link yarns to is sized as it always was
import {profileKind, swatchDensity, swatchYarns, RELAX_STATES} from "./profile-docs.js"
import {texOf} from "./counts.js"

const text = value => (value == null ? "" : String(value))
const number = value => (value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null)
const url = value => (value ? String(value) : null)

/**
 * `find(url)`: the doc there (or null; it can reject), `k`: the .k's doc,
 * `projectFiles`: [{url, extension}], the .k's project's files. what it
 * gives: {machine, carriers: {name: {yarns, plated, tex, swatches}},
 * missing: [{url, why}], urls: every doc it read}
 */
export async function resolveProfiles({find, k, projectFiles = []}) {
	const missing = []
	const urls = []
	const found = new Map() // url → doc, or null
	const load = async target => {
		if (found.has(target)) return found.get(target)
		let doc = null
		try {
			doc = (await find(target)) ?? null
		} catch {}
		found.set(target, doc)
		if (doc) urls.push(target)
		return doc
	}
	// a doc of the kind wanted, or null and why not
	const want = async (target, kind) => {
		const doc = await load(target)
		if (!doc) {
			missing.push({url: target, why: "not found"})
			return null
		}
		if (profileKind(doc) !== kind) {
			missing.push({url: target, why: `not a ${kind}`})
			return null
		}
		return doc
	}

	const links = k?.profiles ?? {}
	const machines = projectFiles.filter(file => file.extension === "machine")
	const machineUrl = url(links.machine) ?? (machines.length === 1 ? url(machines[0].url) : null)
	const machineDoc = machineUrl ? await want(machineUrl, "machine") : null
	const machine = machineDoc ? machineOf(machineUrl, machineDoc) : null

	const carriers = {}
	for (const [name, list] of Object.entries(links.carriers ?? {})) {
		const yarns = []
		for (const target of Array.from(list ?? []).map(url).filter(Boolean)) {
			const doc = await want(target, "yarn")
			if (doc) yarns.push({url: target, doc})
		}
		if (!yarns.length) continue
		const texes = yarns.map(({doc}) => texOf(doc.count))
		const swatchUrls = []
		for (const {doc} of yarns) for (const target of Array.from(doc.swatches ?? []).map(url)) if (target && !swatchUrls.includes(target)) swatchUrls.push(target)
		const swatches = []
		for (const target of swatchUrls) {
			const doc = await want(target, "swatch")
			if (!doc) continue
			const of = swatchYarns(doc)
			if (!yarns.some(yarn => of.includes(yarn.url))) continue
			const machineAt = url(doc.knit?.machine)
			const swatchMachine = machineAt ? await load(machineAt) : null
			swatches.push(swatchOf(target, doc, profileKind(swatchMachine) === "machine" ? machineOf(machineAt, swatchMachine) : null))
		}
		carriers[String(name)] = {
			yarns: yarns.map(({url, doc}) => ({
				url,
				title: text(doc.title),
				tex: texOf(doc.count),
				relaxesLike: text(doc.relaxesLike) || "wool",
				colour: doc.colour ? text(doc.colour) : null,
			})),
			plated: yarns.length > 1 && !!k?.yarns?.[Number(name) - 1]?.plated,
			tex: texes.every(tex => tex > 0) ? texes.reduce((sum, tex) => sum + tex, 0) : null,
			swatches,
		}
	}
	return {machine, carriers, missing, urls}
}

function machineOf(at, doc) {
	const stitches = {}
	for (const [name, entry] of Object.entries(doc.stitches ?? {})) {
		stitches[text(name)] = {front: number(entry?.front), rear: number(entry?.rear), note: text(entry?.note)}
	}
	return {
		url: at,
		title: text(doc.title),
		make: text(doc.make),
		model: text(doc.model),
		gauge: number(doc.gauge),
		needles: number(doc.needles),
		carriers: Array.from(doc.carriers ?? []).map(text),
		stitches,
		floatLimit: number(doc.floatLimit),
	}
}
function swatchOf(at, doc, machine) {
	const knit = doc.knit ?? {}
	const relaxed = {}
	for (const state of RELAX_STATES) relaxed[state] = swatchDensity(doc, state)
	return {
		url: at,
		title: text(doc.title),
		sure: text(knit.sure) || "guessed",
		machine: machine && {url: machine.url, make: machine.make, model: machine.model, gauge: machine.gauge},
		stitch: text(knit.stitch) || "5",
		structure: text(knit.structure) || "jersey",
		needles: number(knit.needles),
		rows: number(knit.rows),
		feeds: Array.from(knit.feeds ?? []).map(feed => ({
			carrier: text(feed?.carrier),
			yarns: Array.from(feed?.yarns ?? []).map(url).filter(Boolean),
			plated: !!feed?.plated,
		})),
		relaxed,
		loop: number(doc.loop?.mm) > 0 ? number(doc.loop.mm) : null,
		roller: number(knit.roller),
		speed: number(knit.speed),
	}
}

// keeps a .k's profiles resolved: now, and again a little after the .k or
// any doc they came from changes. `project`: the tool context's ({files}),
// if there is one. `onChange(resolved)` each time
export function watchProfiles({repo, handle, project = null, onChange}) {
	let current = null
	let stopped = false
	let timer = null
	const handles = new Map() // url → its handle, once found
	const watching = new Map() // url → stop watching it
	const find = target =>
		repo
			.find(target)
			.then(found => {
				handles.set(target, found)
				return found.doc()
			})
			.catch(() => null)

	async function resolve() {
		const resolved = await resolveProfiles({find, k: handle.doc(), projectFiles: project?.files?.() ?? []})
		if (stopped) return
		current = resolved
		for (const [target, off] of watching) {
			if (resolved.urls.includes(target)) continue
			off()
			watching.delete(target)
		}
		for (const target of resolved.urls) {
			const found = handles.get(target)
			if (watching.has(target) || !found) continue
			found.on("change", schedule)
			watching.set(target, () => found.off("change", schedule))
		}
		onChange(resolved)
	}
	function schedule() {
		clearTimeout(timer)
		timer = setTimeout(resolve, 150)
	}

	handle.on("change", schedule)
	resolve()
	return {
		current: () => current,
		// (again now: when the project's files have changed, say)
		refresh: schedule,
		stop() {
			stopped = true
			clearTimeout(timer)
			handle.off("change", schedule)
			for (const off of watching.values()) off()
			watching.clear()
		},
	}
}
