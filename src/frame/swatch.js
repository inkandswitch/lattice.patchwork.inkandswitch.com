// a swatch's editor (see profile-docs.js): how it was knit (on which machine,
// which yarns through which carrier, at what stitch, in what structure, over
// how many needles and rows, and how sure anyone is of that), or filled in
// from the .k that knit it; what it measures, each way it's been let relax;
// its loop length; and what follows from those. the yarns it's knitted from
// list it (their `swatches`): this keeps those lists right as its feeds
// change
import {checkKnitout} from "./knitcheck.js"
import {readSettings} from "./settings.js"
import {docText, textHash} from "./files.js"
import {texOf} from "./counts.js"
import {RELAX_STATES, STATE_NAMES, STRUCTURES, STRUCTURE_NAMES, indexChanges, profileKind, swatchDensity, swatchYarns} from "./profile-docs.js"
import {knitFromCheck} from "./swatch-fill.js"
import {choice, docChoice, editorRoot, field, note, numberInput, section, show, textInput, unit} from "./profile-form.js"

const CARRIERS = ["1", "2", "3", "4", "5", "6"]
const SURE = [
	["known", "known"],
	["believed", "believed"],
	["guessed", "guessed"],
]
const round = (value, places = 1) => Math.round(value * 10 ** places) / 10 ** places

export default function SwatchTool(handle, element, context = {}) {
	const repo = context.repo ?? element.repo
	const files = () => context.project?.files?.() ?? []
	const {root, remove} = editorRoot(element, "profile-swatch")
	const change = fn => handle.change(fn)
	const knit = key => value => change(doc => (doc.knit[key] = value))
	const offs = []

	const title = textInput({title: "what this swatch's called", onValue: value => change(doc => (doc.title = value))})
	title.className = "profile-title"

	// ── how it was knit

	const how = section("how it was knit")
	const machine = docChoice({files, kind: "machine", none: "no machine", title: "the machine it was knitted on", onValue: knit("machine")})

	// the yarns' lists of their swatches, kept as the feeds change
	async function setFeeds(mutate) {
		const before = swatchYarns(handle.doc())
		change(mutate)
		const {add, remove: gone} = indexChanges(before, swatchYarns(handle.doc()))
		await reindex(add, gone)
	}
	// (each of `add` lists this swatch, and none of `gone` does. it's done
	// again as the editor opens, in case it didn't take before: a yarn that
	// hadn't synced, say)
	async function reindex(add, gone = []) {
		if (!repo) return
		for (const url of [...add, ...gone]) {
			try {
				const yarn = await repo.find(url)
				if (profileKind(yarn.doc()) !== "yarn") continue
				yarn.change(doc => {
					doc.swatches ??= []
					const at = Array.from(doc.swatches).map(String).indexOf(handle.url)
					if (add.includes(url) && at === -1) doc.swatches.push(handle.url)
					if (gone.includes(url) && at !== -1) doc.swatches.splice(at, 1)
				})
			} catch {}
		}
	}
	const feedRows = document.createElement("div")
	feedRows.className = "profile-table"
	const addFeed = document.createElement("button")
	addFeed.type = "button"
	addFeed.textContent = "add a carrier"
	addFeed.addEventListener("click", () => setFeeds(doc => doc.knit.feeds.push({carrier: "1", yarns: [], plated: false})))
	let shownFeeds = ""
	let feedInputs = []
	function showFeeds(doc) {
		const feeds = doc.knit.feeds ?? []
		const shape = feeds.map(feed => (feed.yarns?.length > 1 ? 2 : 1)).join()
		if (shape !== shownFeeds) {
			shownFeeds = shape
			feedInputs = feeds.map((feed, i) => {
				const at = (fn) => setFeeds(target => fn(target.knit.feeds[i]))
				const carrier = choice(CARRIERS.map(c => [c, `carrier ${c}`]), value => at(f => (f.carrier = value)), "the carrier it was knitted with")
				const yarnAt = slot => value =>
					at(f => {
						const yarns = Array.from(f.yarns ?? []).map(String)
						if (value) yarns[slot] = value
						else yarns.splice(slot, 1)
						f.yarns = yarns.filter(Boolean)
					})
				const hole = docChoice({files, kind: "yarn", none: "no yarn", title: "the yarn through the carrier's knitting hole: on the face, plated", onValue: yarnAt(0)})
				const two = feed.yarns?.length > 1
				const slit = docChoice({files, kind: "yarn", none: two ? "no second yarn" : "add a second yarn", title: "the yarn through the plating slit: behind, plated", onValue: yarnAt(1)})
				const plated = choice(
					[
						["plated", "plated"],
						["held", "held together"],
					],
					value => at(f => (f.plated = value === "plated")),
					"plated: one through the knitting hole, one through the plating slit (one shows on the face, one behind). held: both through the hole",
				)
				plated.hidden = !two
				const forget = document.createElement("button")
				forget.type = "button"
				forget.textContent = "×"
				forget.title = "take this carrier out"
				forget.addEventListener("click", () => setFeeds(target => target.knit.feeds.splice(i, 1)))
				const row = field(i ? "" : "fed", "which yarns went through which carrier", carrier, unit(two ? "hole" : ""), hole.element, unit(two ? "slit" : ""), slit.element, plated, forget)
				return {carrier, hole, slit, plated, row}
			})
			feedRows.replaceChildren(...feedInputs.map(({row}) => row))
		}
		feeds.forEach((feed, i) => {
			const inputs = feedInputs[i]
			show(inputs.carrier, feed.carrier)
			inputs.hole.update(feed.yarns?.[0] ?? null)
			inputs.slit.update(feed.yarns?.[1] ?? null)
			show(inputs.plated, feed.plated ? "plated" : "held")
		})
	}

	const stitch = textInput({title: "knitout's x-stitch-number it was knitted at: 0–9 or A–Z (5, if the .k never said)", onValue: value => knit("stitch")(value.trim().toUpperCase() || "5")})
	stitch.maxLength = 1
	stitch.size = 2
	const setSize = bed => value => change(doc => ((doc.knit.stitchSize ??= {front: null, rear: null})[bed] = value))
	const front = numberInput({step: "1", max: "15", allowNought: true, title: "the machine's stitch size on the front bed, 0–15", onValue: setSize("front")})
	const rear = numberInput({step: "1", max: "15", allowNought: true, title: "the machine's stitch size on the rear bed, 0–15", onValue: setSize("rear")})
	const roller = numberInput({step: "1", allowNought: true, title: "how far the rollers pulled it down: the kniterate's roller, 0–999 (100, if the .k never said)", onValue: knit("roller")})
	const speed = numberInput({step: "1", title: "how fast the carriage went, mm/s (the kniterate's up to 800)", onValue: knit("speed")})
	const needles = numberInput({step: "1", min: "1", title: "every needle in use, both beds together", onValue: knit("needles")})
	const rows = numberInput({step: "1", min: "1", title: "rows knitted, not counting waste yarn", onValue: knit("rows")})
	const structure = choice(STRUCTURES.map(s => [s, STRUCTURE_NAMES[s]]), knit("structure"), "what's knitted: rib comes out much narrower than jersey")
	const structureNote = textInput({title: "what it is", placeholder: "what it is", onValue: knit("structureNote")})
	const sure = document.createElement("span")
	sure.className = "profile-sure"
	sure.title = "how sure anyone is of how it was knit"
	const sureName = `sure-${Math.random().toString(36).slice(2)}`
	const sureInputs = SURE.map(([value, label]) => {
		const option = document.createElement("label")
		const input = document.createElement("input")
		input.type = "radio"
		input.name = sureName
		input.value = value
		input.addEventListener("change", () => input.checked && knit("sure")(value))
		option.append(input, label)
		sure.append(option)
		return input
	})
	const sureNote = textInput({title: "what's known of it, and from whom", placeholder: "e.g. agnes's file, not certain", onValue: knit("note")})
	const fits = note("", "profile-warning")
	fits.hidden = true

	// filling it in from a .k
	const kChoice = docChoice({files, kind: "k", none: "a .k…", title: "fill this in from the .k that knit it", onValue: url => url && fillFrom(url)})
	const kNotice = document.createElement("div")
	kNotice.className = "profile-warning"
	kNotice.hidden = true
	async function fillFrom(url) {
		if (!repo) return
		const kHandle = await repo.find(url)
		const kDoc = kHandle.doc()
		const text = docText(kDoc)
		const result = checkKnitout(text, null, {...readSettings()})
		const feeds = Array.from(handle.doc()?.knit?.feeds ?? []).map(feed => ({carrier: String(feed.carrier), yarns: Array.from(feed.yarns ?? []).map(String), plated: !!feed.plated}))
		const filled = knitFromCheck(result, kDoc, url, text, feeds)
		await setFeeds(doc => Object.assign(doc.knit, filled))
	}
	async function checkK(doc) {
		const url = doc.knit.k
		kNotice.hidden = true
		if (!url || !repo) return
		try {
			const kHandle = await repo.find(url)
			if (textHash(docText(kHandle.doc())) === doc.knit.kHash) return
			const again = document.createElement("button")
			again.type = "button"
			again.textContent = "fill again"
			again.title = "if the .k was corrected, take how it's knitted now"
			again.addEventListener("click", () => fillFrom(url))
			kNotice.replaceChildren("the .k this was filled from has changed since: the swatch hasn't, so nothing's changed here ", again)
			kNotice.hidden = false
		} catch {}
	}

	how.append(
		field("machine", "the machine it was knitted on", machine.element),
		feedRows,
		field("", "", addFeed),
		field("stitch", stitch.title, stitch, unit("set to"), front, unit("front"), rear, unit("rear")),
		field("roller", roller.title, roller, unit("speed"), speed, unit("mm/s")),
		field("needles", needles.title, needles, unit("needles ×"), rows, unit("rows")),
		note("a good size for a reliable tension swatch is 80 needles by 80 rows, bigger for rib, which pulls in (the kniterate's manual)"),
		field("structure", structure.title, structure, structureNote),
		field("how sure", sure.title, sure, sureNote),
		fits,
		field("fill from", kChoice.element.title, kChoice.element),
		kNotice,
	)

	// ── what it measures, each way it's been let relax

	const measured = section("what it measures", "laid flat, without pulling or bunching it up")
	const stateInputs = {}
	for (const state of RELAX_STATES) {
		const set = key => value =>
			change(doc => {
				doc.relaxed[state] ??= {entered: "mm", width: null, height: null, wales: null, courses: null, grams: null, date: null, by: null}
				doc.relaxed[state][key] = value
			})
		const entered = choice(
			[
				["mm", "mm"],
				["per10", "per 10 cm"],
			],
			set("entered"),
			"measured as its width and height in mm, or as stitches and rows in 10 cm",
		)
		const first = numberInput({step: "any", title: "", onValue: value => set(stateInputs[state].per10 ? "wales" : "width")(value)})
		const second = numberInput({step: "any", title: "", onValue: value => set(stateInputs[state].per10 ? "courses" : "height")(value)})
		const firstUnit = unit("")
		const secondUnit = unit("")
		const derived = document.createElement("span")
		derived.className = "profile-derived"
		const grams = numberInput({step: "any", title: "what it weighs, in grams", onValue: set("grams")})
		const date = document.createElement("input")
		date.type = "date"
		date.title = "when it was measured"
		date.addEventListener("change", () => set("date")(date.value || null))
		const by = textInput({title: "who measured it", placeholder: "who", onValue: set("by")})
		by.size = 8
		stateInputs[state] = {entered, first, second, firstUnit, secondUnit, derived, grams, date, by, per10: false}
		measured.append(
			field(STATE_NAMES[state], `measured ${STATE_NAMES[state]}`, entered, first, firstUnit, second, secondUnit, derived),
			field("", "", grams, unit("g"), date, by),
		)
	}

	// ── its loop length

	const loopSection = section("loop length", "the yarn in one stitch: knit a row across 100 needles in another yarn, pull it out, measure it pulled just straight (10 g or so), ÷ 100")
	const setLoop = key => value => change(doc => ((doc.loop ??= {mm: null, date: null, by: null})[key] = value))
	const loopMm = numberInput({step: "0.1", title: "mm of yarn in a stitch", onValue: setLoop("mm")})
	const loopBy = textInput({title: "who measured it", placeholder: "who", onValue: setLoop("by")})
	loopSection.append(field("loop", loopMm.title, loopMm, unit("mm a stitch"), loopBy))

	// ── what follows from it

	const follows = section("what follows")
	const followLines = document.createElement("div")
	follows.append(followLines)
	let tex = null
	async function findTex(doc) {
		const yarns = Array.from(doc.knit.feeds?.[0]?.yarns ?? []).map(String)
		if (!repo || !yarns.length) return (tex = null)
		try {
			const texes = await Promise.all(yarns.map(url => repo.find(url).then(found => texOf(found.doc()?.count))))
			tex = texes.every(t => t > 0) ? texes.reduce((sum, t) => sum + t, 0) : null
		} catch {
			tex = null
		}
	}
	function showFollows(doc) {
		const lines = []
		const state = RELAX_STATES.find(name => swatchDensity(doc, name))
		const density = state && swatchDensity(doc, state)
		const loop = Number(doc.loop?.mm) > 0 ? Number(doc.loop.mm) : null
		const entry = state && doc.relaxed[state]
		if (entry?.grams > 0) {
			const width = entry.entered === "per10" ? (density.wales && doc.knit.needles ? (doc.knit.needles / density.wales) * 100 : null) : entry.width
			const height = entry.entered === "per10" ? (density.courses && doc.knit.rows ? (doc.knit.rows / density.courses) * 100 : null) : entry.height
			if (width > 0 && height > 0) lines.push(`${round(entry.grams / ((width / 1000) * (height / 1000)), 0)} g/m², ${STATE_NAMES[state]}`)
		}
		if (loop && tex) lines.push(`tightness factor ${round(Math.sqrt(tex) / (loop / 10))} (plain knitting's usually about 14.7)`)
		if (loop && density?.courses) lines.push(`kc ${round((loop * density.courses) / 100, 2)} (rows × loop: Munden's is 5.0 for wool, dry)`)
		if (loop && density?.wales) lines.push(`kw ${round((loop * density.wales) / 100, 2)} (stitches × loop: Munden's is 3.8 for wool, dry)`)
		followLines.replaceChildren(...(lines.length ? lines.map(line => note(line, "profile-derived")) : [note("measure it, and its loop length, to see what follows")]))
	}

	async function checkFits(doc) {
		fits.hidden = true
		if (!doc.knit.machine || !repo) return
		try {
			const machineDoc = (await repo.find(doc.knit.machine)).doc()
			if (profileKind(machineDoc) !== "machine") return
			const problems = []
			const theirs = Array.from(machineDoc.carriers ?? []).map(String)
			for (const feed of doc.knit.feeds ?? []) if (theirs.length && !theirs.includes(String(feed.carrier))) problems.push(`it has no carrier ${feed.carrier}`)
			const room = (machineDoc.needles ?? 0) * (machineDoc.beds ?? 1)
			if (room && doc.knit.needles > room) problems.push(`its beds hold ${room} needles`)
			if (problems.length) {
				fits.textContent = `that won't knit on ${machineDoc.title || "that machine"}: ${problems.join(", and ")}`
				fits.hidden = false
			}
		} catch {}
	}

	const notes = textInput({multiline: true, title: "anything else worth knowing about it", onValue: value => change(doc => (doc.notes = value))})
	const more = section("notes")
	more.append(notes)
	root.append(title, how, measured, loopSection, follows, more)

	function redraw() {
		const doc = handle.doc()
		if (!doc?.knit) return
		show(title, doc.title)
		machine.update(doc.knit.machine ?? null)
		showFeeds(doc)
		show(stitch, doc.knit.stitch)
		show(front, doc.knit.stitchSize?.front)
		show(rear, doc.knit.stitchSize?.rear)
		show(roller, doc.knit.roller)
		show(speed, doc.knit.speed)
		show(needles, doc.knit.needles)
		show(rows, doc.knit.rows)
		show(structure, doc.knit.structure)
		structureNote.hidden = doc.knit.structure !== "other"
		show(structureNote, doc.knit.structureNote)
		for (const input of sureInputs) input.checked = input.value === (doc.knit.sure || "guessed")
		show(sureNote, doc.knit.note)
		kChoice.update(doc.knit.k ?? null)

		const rib = String(doc.knit.structure).startsWith("rib")
		for (const state of RELAX_STATES) {
			const inputs = stateInputs[state]
			const entry = doc.relaxed?.[state] ?? null
			const per10 = entry?.entered === "per10"
			inputs.per10 = per10
			show(inputs.entered, per10 ? "per10" : "mm")
			show(inputs.first, per10 ? entry?.wales : entry?.width)
			show(inputs.second, per10 ? entry?.courses : entry?.height)
			inputs.firstUnit.textContent = per10 ? (rib ? "needles ×" : "wales ×") : "mm wide ×"
			inputs.secondUnit.textContent = per10 ? "courses / 10 cm" : "mm tall"
			inputs.first.title = per10 ? (rib ? "needles across 10 cm, both beds counted" : "wales (stitches) across 10 cm") : "its width, in mm"
			inputs.second.title = per10 ? "courses (rows) up 10 cm" : "its height, in mm"
			show(inputs.grams, entry?.grams)
			show(inputs.date, entry?.date)
			show(inputs.by, entry?.by)
			// the other pair, worked out
			const density = swatchDensity(doc, state)
			if (!entry) inputs.derived.textContent = ""
			else if (per10) {
				const w = density?.wales && doc.knit.needles ? round((doc.knit.needles / density.wales) * 100) : null
				const h = density?.courses && doc.knit.rows ? round((doc.knit.rows / density.courses) * 100) : null
				inputs.derived.textContent = w || h ? `= ${w ?? "?"} × ${h ?? "?"} mm` : "needles and rows turn per 10 cm into mm"
			} else {
				const w = density?.wales ? round(density.wales) : null
				const h = density?.courses ? round(density.courses) : null
				inputs.derived.textContent = w || h ? `= ${w ?? "?"} × ${h ?? "?"} per 10 cm` : "needles and rows turn mm into per 10 cm"
			}
		}
		show(loopMm, doc.loop?.mm)
		show(loopBy, doc.loop?.by)
		show(notes, doc.notes)
		showFollows(doc)
		findTex(doc).then(() => showFollows(handle.doc()))
		checkFits(doc)
		checkK(doc)
	}
	handle.on("change", redraw)
	offs.push(() => handle.off("change", redraw))
	redraw()
	if (handle.doc()?.knit) reindex(swatchYarns(handle.doc()))

	return () => {
		for (const off of offs) off()
		remove()
	}
}
