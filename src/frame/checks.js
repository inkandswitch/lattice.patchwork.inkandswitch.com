import {moduleWorker} from "./files.js"
import {icon} from "./knitoutjs/core/icons.js"
import {holdRows, machineLimits} from "./knitcheck.js"
import {watchProfiles} from "./profiles.js"
import {profilesFromFabric} from "./migrate-fabric.js"
import {RELAX_STATES, STATE_NAMES, STRUCTURE_NAMES} from "./profile-docs.js"
import {docChoice} from "./profile-form.js"
import {DEFAULTS, SETTINGS_CHANGED, readSettings, storeSetting} from "./settings.js"
import {FIBRES, RELAXED, STITCH, USUAL_TIGHTNESS, fabricOf, shortening} from "./size.js"
import {stylesheet} from "./knitoutjs/core/stylesheet.js"

const WORKER_URL = new URL("./knitcheck-worker.js", import.meta.url)
const STYLESHEET = new URL("./checks.css", import.meta.url).href

// checks .k text (see knitcheck.js), in a worker where the browser allows
// it: the newest text's result, or null if newer text came since
export function checker() {
	let worker = null
	try {
		worker = moduleWorker(WORKER_URL)
	} catch {}
	let requests = 0
	const waiting = new Map()
	if (worker) {
		worker.onmessage = ({data}) => {
			waiting.get(data.id)?.(data.result ?? null)
			waiting.delete(data.id)
		}
		worker.onerror = event => {
			event.preventDefault()
			console.warn("checks: checking on the page instead of a worker:", event.message)
			worker.terminate()
			worker = null
			for (const [, resolve] of waiting) resolve(null)
			waiting.clear()
		}
	}
	async function inPage(text, settings) {
		const [{checkKnitout}, {knitoutToKcode}] = await Promise.all([
			import("./knitcheck.js"),
			import("./knitoutjs/core/vendor/knitout-to-kcode.js"),
		])
		let error = null
		const {log, warn} = console
		const warnings = []
		console.log = () => {}
		console.warn = (...args) => warnings.push(args.join(" "))
		try {
			knitoutToKcode(text, "check.k", {})
		} catch (thrown) {
			error = String(thrown?.message ?? thrown)
		} finally {
			console.log = log
			console.warn = warn
		}
		return checkKnitout(text, {error, warnings}, settings)
	}
	return {
		async check(text, settings) {
			const id = ++requests
			const result = worker
				? await new Promise(resolve => {
						waiting.set(id, resolve)
						worker.postMessage({id, text, settings})
					})
				: await inPage(text, settings)
			return id === requests ? result : null
		},
		close() {
			worker?.terminate()
		},
	}
}

const LEVELS = {error: "won't knit", risk: "potential issue", note: "advice"}
const SPEEDS = [
	{name: "light", value: 0.5},
	{name: "usual", value: 1},
	{name: "thorough", value: 2},
	{name: "most", value: 4},
]

// the op a problem's about: its own, or the first on (or after) its line
export function opOf(problem, ops) {
	if (problem.op != null) return problem.op
	if (problem.line == null) return null
	const index = ops.findIndex(op => op.kLine >= problem.line)
	return index === -1 ? null : index
}

// where an op came from, as the editors take it ({url, line, at}): the .js
// first, then the .k
export function located(handle, op) {
	if (!op) return null
	const jsUrl = handle.doc()?.knitoutSource
	const at = []
	if (op.jsLine != null && jsUrl) at.push({url: jsUrl, line: op.jsLine})
	at.push({url: handle.url, line: op.kLine})
	return {...at[0], at}
}

// the check, for a tool's bar: a button saying how it went, and a panel
// (over `stage`) with what the check takes the machine and yarn to be, and
// what might go wrong, each going to its op when it's picked
// (`onPick(problem)`). `check(text)` checks some .k (and again, with the
// same text, when the settings change). given the .k's `handle` (and the
// tool's `context`), it reads the machine and yarns the .k's knitted with
// (profiles.js), says which they are, lets them be chosen, and tells
// `onProfiles(resolved)` whenever they change
export function checkPanel(stage, onPick, {handle = null, context = {}, onProfiles = null} = {}) {
	const checks = checker()
	let text = null
	let resolved = null
	let lastResult = null

	const link = stylesheet(STYLESHEET)
	stage.appendChild(link)

	const button = document.createElement("button")
	button.className = "knitout-button checks-button"
	button.textContent = "checking…"
	button.title = "will it knit on a kniterate? what might go wrong, and where"

	const panel = document.createElement("div")
	panel.className = "checks-panel"
	panel.hidden = true
	stage.appendChild(panel)
	button.addEventListener("click", () => {
		panel.hidden = !panel.hidden
	})

	// ── the settings: kept as they are while the rest of the panel's redone

	const settingsBox = document.createElement("div")
	settingsBox.className = "checks-settings"

	const gauge = document.createElement("input")
	gauge.type = "number"
	gauge.min = "2"
	gauge.max = "20"
	gauge.step = "1"
	gauge.addEventListener("change", () => {
		const value = Number(gauge.value)
		if (value >= 2 && value <= 20) storeSetting("gauge", value)
	})

	const squash = document.createElement("input")
	squash.type = "range"
	squash.min = "0.15"
	squash.max = "0.6"
	squash.step = "0.05"
	squash.addEventListener("change", () => storeSetting("squash", Number(squash.value)))
	const room = document.createElement("span")
	room.className = "checks-hint"
	squash.addEventListener("input", () => (room.textContent = roomFor(Number(squash.value))))

	const speed = document.createElement("select")
	for (const {name, value} of SPEEDS) speed.append(new Option(name, String(value)))
	speed.addEventListener("change", () => storeSetting("speed", Number(speed.value)))

	const reset = document.createElement("button")
	reset.className = "checks-reset"
	reset.textContent = "as it comes"
	reset.title = "a kniterate as it comes: 7 gauge, rows bunching to 0.3 of a row, the usual settling"
	// (the machine's settings: not what's been measured of the yarn)
	reset.addEventListener("click", () => {
		for (const [name, value] of Object.entries(DEFAULTS)) storeSetting(name, value)
	})

	settingsBox.append(
		setting("gauge", "needles to the inch: sets the mm of floats and the metres of yarn", gauge, "needles to the inch"),
		setting(
			"bunching",
			"how close rows can bunch, beside a held needle, before they ride up the needles: tighter leaves room for more rows",
			squash,
			room,
			"tight",
			"loose",
		),
		setting("physics", "how long the fabric gets to settle, each frame: more is closer to how it hangs, but slower", speed),
		reset,
	)

	function roomFor(value) {
		const rows = holdRows(value)
		return `room for ${rows} rows beside a held needle`
	}

	function readBack() {
		const settings = readSettings()
		gauge.value = String(settings.gauge)
		squash.value = String(settings.squash)
		room.textContent = roomFor(settings.squash)
		speed.value = String(SPEEDS.reduce((best, s) => (Math.abs(s.value - settings.speed) < Math.abs(best.value - settings.speed) ? s : best)).value)
	}
	readBack()

	// ── the yarn, and what's been measured of it: kept, whatever the reset

	const fabricBox = document.createElement("details")
	fabricBox.className = "checks-settings checks-fabric"
	const fabricSummary = document.createElement("summary")
	fabricSummary.textContent = "the yarn, and how big it comes out"
	fabricSummary.title = "measure a swatch, or a loop, and say so here: the sizes come from it"

	const storeFabric = patch => storeSetting("fabric", {...fabricOf(readSettings()), ...patch})
	// a number box, blank for not known
	const amount = (step, title, onValue) => {
		const input = document.createElement("input")
		input.type = "number"
		input.min = "0"
		input.step = step
		input.title = title
		input.addEventListener("change", () => {
			const value = input.value === "" ? null : Number(input.value)
			onValue(Number.isFinite(value) && value > 0 ? value : null)
		})
		return input
	}
	const unit = text => {
		const span = document.createElement("span")
		span.className = "checks-hint"
		span.textContent = text
		return span
	}
	const setValue = (input, value) => {
		if (document.activeElement !== input) input.value = value == null ? "" : String(value)
	}

	const relax = document.createElement("select")
	for (const [name, {name: label}] of Object.entries(RELAXED)) relax.append(new Option(label, name))
	relax.addEventListener("change", () => storeFabric({relax: relax.value}))
	relax.title =
		"off the machine: left to lie a day or two. washed: soaked half a day in lukewarm water, spun, dried flat (as Munden did). washed hot & tumbled: as far as it'll go"

	const fibre = document.createElement("select")
	for (const [name, {name: label}] of Object.entries(FIBRES)) fibre.append(new Option(label, name))
	fibre.addEventListener("change", () => storeFabric({fibre: fibre.value}))
	fibre.title = "what it's spun from: it changes how much it relaxes washed. (filament nylon never relaxes to the usual shape: measure it)"

	const tex = amount("any", "the yarn's tex: grams a kilometre of it weighs (Nm 2/30 is 67 tex; tex = 1000 ÷ Nm)", value => storeFabric({tex: value}))
	const strands = amount("1", "strands knitted together", value => storeFabric({strands: value ?? 1}))

	const stitchRows = document.createElement("div")
	stitchRows.className = "checks-stitches"
	let stitchNumbers = ""
	let stitchInputs = {} // stitch number → {loop, across, up}
	function showStitches(used) {
		const fabric = fabricOf(readSettings())
		const numbers = [...used, ...Object.keys(fabric.stitches)].filter((number, i, all) => all.indexOf(number) === i).sort()
		if (numbers.join() !== stitchNumbers) {
			stitchNumbers = numbers.join()
			stitchInputs = {}
			stitchRows.replaceChildren(
				...numbers.map(number => {
					const store = (key, value) => {
						const stitches = {...fabricOf(readSettings()).stitches}
						const entry = {...stitches[number], [key]: value}
						if (Object.values(entry).every(v => v == null)) delete stitches[number]
						else stitches[number] = entry
						storeFabric({stitches})
					}
					const inputs = {
						loop: amount(
							"0.1",
							`the yarn in one stitch at stitch number ${number}, in mm: knit a row across 100 needles in another yarn, pull it out, measure it pulled just straight (10 g or so), ÷ 100. it's this yarn's: measure again for another`,
							v => store("loop", v),
						),
						across: amount("0.5", `a swatch at stitch number ${number}, relaxed: stitches across 10 cm`, v => store("across", v)),
						up: amount("0.5", `a swatch at stitch number ${number}, relaxed: rows up 10 cm`, v => store("up", v)),
					}
					stitchInputs[number] = inputs
					return setting(`stitch ${number}`, `what's measured of stitch number ${number}`, inputs.loop, null, null, null, [
						unit("mm a loop ·"),
						inputs.across,
						unit("stitches,"),
						inputs.up,
						unit("rows in 10 cm"),
					])
				}),
			)
		}
		for (const [number, inputs] of Object.entries(stitchInputs)) {
			const entry = fabric.stitches[number] ?? {}
			for (const key of ["loop", "across", "up"]) setValue(inputs[key], entry[key])
		}
	}
	let used = [STITCH]

	const shorten = amount("1", "stretch a swatch 10% wider, and measure how much shorter it gets, in %", value =>
		storeFabric({shorten: value == null ? null : value / 10}),
	)
	const around = amount("0.5", "what it's to go round, relaxed, in cm: a foot, round the ball of it, say", value => storeFabric({around: value}))

	fabricBox.append(
		fabricSummary,
		setting("relaxed", "how it's been let relax before it's measured: the sizes are for the same", relax),
		setting("yarn", "the yarn: what it's spun from, and its tex (for its tightness, and what it weighs)", fibre, null, null, null, [
			tex,
			unit("tex ×"),
			strands,
			unit("strands"),
		]),
		stitchRows,
		setting("stretched", "how much shorter a tube gets as it's stretched round something", unit("10% wider, it's"), null, null, null, [shorten, unit("% shorter")]),
		setting("goes round", "what a tube's to go round", around, unit("cm (a foot, say)")),
	)

	function readFabric() {
		const fabric = fabricOf(readSettings())
		relax.value = fabric.relax
		fibre.value = fabric.fibre
		setValue(tex, fabric.tex)
		setValue(strands, fabric.strands)
		setValue(shorten, fabric.shorten == null ? null : Math.round(fabric.shorten * 100) / 10)
		shorten.placeholder = String(Math.round(shortening(fabric).shorten * 10))
		setValue(around, fabric.around)
		showStitches(used)
	}
	readFabric()

	// ── what it's knitted with: the .k's machine, and each carrier's yarns

	const loadedBox = document.createElement("div")
	loadedBox.className = "checks-settings checks-loaded"
	loadedBox.hidden = !handle
	const files = () => context.project?.files?.() ?? []
	const linkProfiles = fn =>
		handle.change(doc => {
			doc.profiles ??= {machine: null, carriers: {}}
			doc.profiles.carriers ??= {}
			fn(doc.profiles)
		})
	const machineChoice = docChoice({
		files,
		kind: "machine",
		none: "no machine (7 gauge)",
		title: "the machine it's knitted on: its gauge, and the swatches knitted on it",
		onValue: url => linkProfiles(profiles => (profiles.machine = url)),
	})
	const carrierRows = document.createElement("div")
	carrierRows.className = "checks-carriers"
	const loadedState = document.createElement("div")
	loadedState.className = "checks-hint"
	loadedState.textContent = "loading profiles…"
	loadedBox.append(setting("machine", "the machine it's knitted on", machineChoice.element), carrierRows, loadedState)

	let shownCarriers = ""
	let carrierChoices = {}
	function showLoaded() {
		if (!handle) return
		const doc = handle.doc()
		machineChoice.update(doc?.profiles?.machine ?? resolved?.machine?.url ?? null)
		const carriers = (lastResult?.yarn ?? []).map(({carrier}) => carrier)
		const strandsOf = carrier => (doc?.yarns?.[Number(carrier) - 1]?.colours?.length > 1 ? 2 : 1)
		const shape = carriers.map(carrier => `${carrier}:${strandsOf(carrier)}`).join()
		if (shape !== shownCarriers) {
			shownCarriers = shape
			carrierChoices = {}
			carrierRows.replaceChildren(
				...carriers.map(carrier => {
					const two = strandsOf(carrier) > 1
					const choices = [0, ...(two ? [1] : [])].map(slot =>
						docChoice({
							files,
							kind: "yarn",
							none: "not said",
							title: two ? (slot ? "the yarn through the plating slit" : "the yarn through the knitting hole") : "the yarn in this carrier",
							onValue: url =>
								linkProfiles(profiles => {
									const list = Array.from(profiles.carriers[carrier] ?? []).map(String)
									if (url) list[slot] = url
									else list.splice(slot, 1)
									const kept = list.filter(Boolean)
									if (kept.length) profiles.carriers[carrier] = kept
									else delete profiles.carriers[carrier]
								}),
						}),
					)
					carrierChoices[carrier] = choices
					const parts = choices.flatMap((choice, slot) => (two ? [slot ? "slit" : "hole", choice.element] : [choice.element]))
					return setting(`carrier ${carrier}`, "the yarn knitted from this carrier", parts[0], null, null, null, parts.slice(1))
				}),
			)
		}
		for (const [carrier, choices] of Object.entries(carrierChoices)) {
			const linked = doc?.profiles?.carriers?.[carrier] ?? []
			choices.forEach((choice, slot) => choice.update(linked[slot] ?? null))
		}
		const missing = resolved?.missing ?? []
		loadedState.textContent = !resolved
			? "loading profiles…"
			: missing.length
				? missing.map(({url, why}) => `couldn't load …${url.slice(-8)}: ${why}`).join(" · ")
				: ""
		gauge.disabled = !!resolved?.machine
		gauge.title = resolved?.machine ? `from ${resolved.machine.title || "the machine"}` : ""
		fabricBox.hidden = !!handle && !!doc?.profiles
		migrate.hidden = !handle || !context.repo
	}

	// what this browser kept, as profiles: a yarn, and a swatch for each
	// stitch number, linked to every carrier the .k knits with
	const migrate = document.createElement("button")
	migrate.type = "button"
	migrate.className = "checks-reset"
	migrate.textContent = "make profiles from this"
	migrate.title = "keep what's measured here as a yarn and its swatches, which anyone you share them with can see, and link them to this .k"
	migrate.hidden = true
	migrate.addEventListener("click", async () => {
		const {yarn, swatches} = profilesFromFabric(readSettings().fabric ?? {})
		const yarnHandle = await context.repo.create2(yarn)
		const made = await Promise.all(
			swatches.map(swatch => {
				swatch.knit.feeds = [{carrier: "1", yarns: [yarnHandle.url], plated: false}]
				return context.repo.create2(swatch)
			}),
		)
		yarnHandle.change(doc => (doc.swatches = made.map(found => found.url)))
		linkProfiles(profiles => {
			for (const {carrier} of lastResult?.yarn ?? []) profiles.carriers[carrier] = [yarnHandle.url]
		})
		context.open?.(yarnHandle.url, stage)
	})
	fabricBox.append(migrate)

	const results = document.createElement("div")
	results.className = "checks-results"
	panel.append(loadedBox, settingsBox, fabricBox, results)

	// ── what the check found

	function show(result) {
		if (!result) return
		const {problems, width, yarn} = result
		const count = level => problems.filter(problem => problem.level === level).reduce((sum, p) => sum + p.count, 0)
		const errors = count("error")
		const risks = count("risk")
		const all = errors + risks + count("note")
		button.dataset.level = errors ? "error" : risks ? "risk" : all ? "note" : "ok"
		button.replaceChildren(icon(all ? "warning" : "check"), all ? ` ${all} to check` : " kniterate: ok")

		const heading = document.createElement("div")
		heading.className = "checks-heading"
		const verdict = document.createElement("strong")
		verdict.textContent = errors
			? "the kniterate won't knit this as it is"
			: risks
				? "the kniterate will knit this, but some of it may go wrong"
				: "nothing here should trouble a kniterate"
		const close = document.createElement("button")
		close.className = "checks-close"
		close.append(icon("close", 14))
		close.title = "close"
		close.setAttribute("aria-label", "close")
		close.addEventListener("click", () => (panel.hidden = true))
		const facts = document.createElement("div")
		facts.className = "checks-facts"
		lastResult = result
		const limits = machineLimits(resolved)
		const guessed = result.size.sources.some(source => source.tier === "guess")
		const metres = yarn.map(
			({carrier, metres, grams}) =>
				`carrier ${carrier} ≈ ${metres < 10 ? metres.toFixed(1) : Math.round(metres)} m` +
				(grams == null ? "" : ` (${grams < 10 ? grams.toFixed(1) : Math.round(grams)} g)`),
		)
		facts.textContent =
			`${width} of ${limits.name}'s ${limits.needles} needles` +
			(metres.length ? ` · yarn${guessed ? ", at a middling stitch size" : ""}: ${metres.join(", ")}` : "")
		heading.append(verdict, close, facts, sizeFacts(result, context, stage))
		used = [...new Set(result.size.sources.map(source => source.stitch))]
		showStitches(used)
		showLoaded()

		const list = document.createElement("ol")
		list.className = "checks-list"
		for (const problem of problems) {
			const item = document.createElement("li")
			item.className = "checks-item"
			item.dataset.level = problem.level
			const where = document.createElement("span")
			where.className = "checks-where"
			where.textContent =
				problem.line == null
					? LEVELS[problem.level]
					: `line ${problem.line}${problem.count > 1 && problem.lastLine !== problem.line ? `–${problem.lastLine}` : ""}`
			const what = document.createElement("span")
			what.className = "checks-what"
			what.textContent = problem.text + (problem.count > 1 ? ` (×${problem.count})` : "")
			const kind = document.createElement("span")
			kind.className = "checks-kind"
			kind.textContent = LEVELS[problem.level]
			what.prepend(kind)
			item.append(where, what)
			if (problem.line != null) {
				item.tabIndex = 0
				item.addEventListener("click", () => onPick(problem))
				item.addEventListener("keydown", event => event.key === "Enter" && onPick(problem))
			}
			list.appendChild(item)
		}
		results.replaceChildren(heading, list)
	}

	function check(next = text) {
		text = next
		if (text == null) return
		checks.check(text, {...readSettings(), profiles: resolved}).then(show)
	}

	const watcher =
		handle && context.repo
			? watchProfiles({
					repo: context.repo,
					handle,
					project: context.project,
					onChange(next) {
						resolved = next
						showLoaded()
						onProfiles?.(next)
						check()
					},
				})
			: null
	const onDocChange = () => showLoaded()
	handle?.on("change", onDocChange)

	function onSettings() {
		readBack()
		readFabric()
		check()
	}
	addEventListener(SETTINGS_CHANGED, onSettings)

	return {
		button,
		check,
		remove() {
			removeEventListener(SETTINGS_CHANGED, onSettings)
			watcher?.stop()
			handle?.off("change", onDocChange)
			checks.close()
			panel.remove()
			link.remove()
		},
	}
}

// how big it comes out, for the panel's heading: a row for each way it's
// let relax that there's a size for (an estimated one says so), what it
// weighs; then each carrier's stitch, and what it's sized from (a swatch
// links to it, through `context.open`); then anything to know, and, round
// what it's to go round, how stretched it is and how long that leaves it
const TIERS = {
	measured: "measured",
	"other-machine": "measured on another machine",
	loop: "from its loop length, by Munden's constants",
	guess: "a guess",
}
function sizeFacts(result, context, stage) {
	const {size, yarn} = result
	const box = document.createElement("div")
	box.className = "checks-size"
	const cm = mm => (mm / 10).toFixed(mm < 100 ? 1 : 0)
	const line = (...parts) => {
		const div = document.createElement("div")
		div.append(...parts)
		box.appendChild(div)
		return div
	}
	const grams = yarn.every(each => each.grams != null) && yarn.length ? yarn.reduce((sum, each) => sum + each.grams, 0) : null

	const table = document.createElement("table")
	table.className = "checks-size-table"
	for (const state of RELAX_STATES) {
		const piece = size.states[state]
		if (!piece?.length?.mm) continue
		const row = table.insertRow()
		row.insertCell().textContent = STATE_NAMES[state]
		const across = piece.around
			? `${cm(piece.around.mm)} cm round`
			: piece.width
				? `${cm(piece.width.mm)} cm wide`
				: ""
		const dims = row.insertCell()
		dims.textContent = `${across ? `${across} × ` : ""}${cm(piece.length.mm)} cm long`
		if (piece.estimated) {
			const chip = document.createElement("span")
			chip.className = "checks-chip"
			chip.textContent = "estimated"
			chip.title = "not measured so: worked out from another way it was let relax, by Munden's constants"
			dims.append(" ", chip)
		}
		row.insertCell().textContent = grams == null ? "" : `${grams < 10 ? grams.toFixed(1) : Math.round(grams)} g`
	}
	if (table.rows.length) box.append(table)

	for (const source of size.sources) {
		const where = `carrier ${source.carrier}, st ${source.stitch}, ${STRUCTURE_NAMES[source.structure] ?? source.structure}: `
		const parts = [where, TIERS[source.tier]]
		if (source.swatches.length) {
			parts.push(" from ")
			source.swatches.forEach((swatch, i) => {
				if (i) parts.push(", ")
				const link = document.createElement("a")
				link.href = "#"
				link.textContent = swatch.title || "a swatch"
				link.addEventListener("click", event => {
					event.preventDefault()
					context.open?.(swatch.url, stage)
				})
				parts.push(link, ` (${swatch.sure})`)
			})
			const machine = source.swatches[0].machine
			if (source.tier === "other-machine" && machine) parts.push(`, on another kniterate`)
		}
		if (source.tier === "guess") {
			parts.push(`: knit a swatch at stitch ${source.stitch} in ${STRUCTURE_NAMES[source.structure] ?? source.structure}`)
			if (source.structure === "jersey") parts.push(", or measure its loop length")
			if (String(source.structure).startsWith("rib")) parts.push(". relaxed rib comes out much narrower than this")
		}
		if (source.tightness != null) parts.push(` · tightness ${source.tightness.toFixed(1)} (plain knitting's usually about ${USUAL_TIGHTNESS})`)
		if (source.gsm != null) parts.push(` · ${Math.round(source.gsm)} g/m²`)
		line(...parts).dataset.from = source.tier
	}
	for (const note of size.notes) line(note).className = "checks-size-note"
	if (size.on) {
		const {body, stretch, length, shorter, jammed} = size.on
		line(
			stretch <= 0
				? `on ${cm(body)} cm round: ${Math.round(-stretch * 100)}% looser than it, not stretched`
				: jammed
					? `on ${cm(body)} cm round: stretched ${Math.round(stretch * 100)}%, further than it'll go: the stitches jam`
					: `on ${cm(body)} cm round: stretched ${Math.round(stretch * 100)}%, so about ${Math.round(shorter * 100)}% shorter: ${cm(length)} cm long`,
		).className = "checks-size-on"
	}
	return box
}

// a setting's row: its name, its control, and (for a slider) what each end
// means; and anything to go after it (`more`)
function setting(name, title, control, after = null, low = null, high = null, more = []) {
	const row = document.createElement("label")
	row.className = "checks-setting"
	row.title = title
	const label = document.createElement("span")
	label.className = "checks-setting-name"
	label.textContent = name
	const field = document.createElement("span")
	field.className = "checks-setting-field"
	if (low) field.append(low)
	field.append(control)
	if (high) field.append(high)
	if (after) field.append(after)
	field.append(...more)
	row.append(label, field)
	return row
}
