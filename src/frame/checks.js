import {moduleWorker} from "./files.js"
import {KNITERATE} from "./knitcheck.js"

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
	async function inPage(text) {
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
		return checkKnitout(text, {error, warnings})
	}
	return {
		async check(text) {
			const id = ++requests
			const result = worker
				? await new Promise(resolve => {
						waiting.set(id, resolve)
						worker.postMessage({id, text})
					})
				: await inPage(text)
			return id === requests ? result : null
		},
		close() {
			worker?.terminate()
		},
	}
}

const LEVELS = {error: "won't knit", risk: "may go wrong", note: "note"}

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

// the check's result, for a tool's bar: a button saying how it went, and a
// list (over `stage`) of what might go wrong, each going to its op when it's
// picked (`onPick(problem)`)
export function checkPanel(stage, onPick) {
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

	function show(result) {
		if (!result) return
		const {problems, width, yarn} = result
		const count = level => problems.filter(problem => problem.level === level).reduce((sum, p) => sum + p.count, 0)
		const errors = count("error")
		const risks = count("risk")
		const worst = errors ? "error" : risks ? "risk" : "ok"
		button.dataset.level = worst
		button.textContent = errors
			? `${errors} ${errors === 1 ? "error" : "errors"}`
			: risks
				? `${risks} ${risks === 1 ? "risk" : "risks"}`
				: "kniterate: ok"

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
			item.append(where, what)
			item.title = LEVELS[problem.level]
			if (problem.line != null) {
				item.tabIndex = 0
				item.addEventListener("click", () => onPick(problem))
				item.addEventListener("keydown", event => event.key === "Enter" && onPick(problem))
			}
			list.appendChild(item)
		}
		panel.replaceChildren(heading, list)
	}

	return {
		button,
		show,
		remove() {
			panel.remove()
			link.remove()
		},
	}
}
