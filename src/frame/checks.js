import {moduleWorker} from "./files.js"
import {KNITERATE, holdRows} from "./knitcheck.js"
import {DEFAULTS, SETTINGS_CHANGED, readSettings, storeSetting} from "./settings.js"

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
			import("./vendor/knitout-to-kcode.js"),
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
// same text, when the settings change)
export function checkPanel(stage, onPick) {
	const checks = checker()
	let text = null

	const link = document.createElement("link")
	link.rel = "stylesheet"
	link.href = STYLESHEET
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

	const results = document.createElement("div")
	results.className = "checks-results"
	panel.append(settingsBox, results)

	// ── what the check found

	function show(result) {
		if (!result) return
		const {problems, width, yarn} = result
		const count = level => problems.filter(problem => problem.level === level).reduce((sum, p) => sum + p.count, 0)
		const errors = count("error")
		const risks = count("risk")
		const all = errors + risks + count("note")
		button.dataset.level = errors ? "error" : risks ? "risk" : "ok"
		button.textContent = all ? `${all} to check` : "kniterate: ok"

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
		close.textContent = "×"
		close.title = "close"
		close.addEventListener("click", () => (panel.hidden = true))
		const facts = document.createElement("div")
		facts.className = "checks-facts"
		const metres = yarn.map(({carrier, metres}) => `carrier ${carrier} ≈ ${metres < 10 ? metres.toFixed(1) : Math.round(metres)} m`)
		facts.textContent =
			`${width} of the kniterate's ${KNITERATE.needles} needles` +
			(metres.length ? ` · yarn, at a middling stitch size: ${metres.join(", ")}` : "")
		heading.append(verdict, close, facts)

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
		checks.check(text, readSettings()).then(show)
	}

	function onSettings() {
		readBack()
		check()
	}
	addEventListener(SETTINGS_CHANGED, onSettings)

	return {
		button,
		check,
		remove() {
			removeEventListener(SETTINGS_CHANGED, onSettings)
			checks.close()
			panel.remove()
			link.remove()
		},
	}
}

// a setting's row: its name, its control, and (for a slider) what each end
// means
function setting(name, title, control, after = null, low = null, high = null) {
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
	row.append(label, field)
	return row
}
