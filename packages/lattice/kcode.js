import {docText, knitoutOf, moduleWorker, textHash} from "./files.js"

// a .k as kcode, the format a Kniterate machine reads: the converter (in a
// worker where the browser allows it), and a build of a .k into the .kc it
// goes in (knitoutjs's, which knows what a .kc keeps). nothing here needs
// solid or automerge-repo, so it's tested in node; the wiring into the panes
// is kcode-wm.js
export {buildKcode} from "../knitoutjs/core/kcode.js"

const WORKER_URL = new URL("./kniterate-worker.js", import.meta.url)

// kcode from knitout, in a worker where the browser allows it
export function converter() {
	let worker = null
	try {
		worker = moduleWorker(WORKER_URL)
	} catch {}
	const waiting = new Map()
	let requests = 0
	if (worker) {
		worker.onmessage = ({data}) => {
			const {resolve} = waiting.get(data.id) ?? {}
			waiting.delete(data.id)
			resolve?.(data)
		}
		worker.onerror = event => {
			event.preventDefault()
			console.warn("kniterate: converting on the page instead of a worker:", event.message)
			worker.terminate()
			worker = null
			for (const [, {resolve, request}] of waiting) inPage(request).then(resolve)
			waiting.clear()
		}
	}
	async function inPage({text, name, options}) {
		const {knitoutToKcode} = await import("../knitoutjs/core/vendor/knitout-to-kcode.js")
		try {
			return {kcode: knitoutToKcode(text, name, options), warnings: []}
		} catch (error) {
			return {error: String(error?.message ?? error), warnings: []}
		}
	}
	return {
		convert(text, name, options) {
			const request = {id: ++requests, text, name, options}
			if (!worker) return inPage(request)
			worker.postMessage(request)
			return new Promise(resolve => waiting.set(request.id, {resolve, request}))
		},
		destroy: () => worker?.terminate(),
	}
}

// what a .kc's autobuild does now, in this browser: "build" it (it's behind
// its .k), "wait" for the .k to move, or "stop" listening: autobuild's off,
// or the .kc isn't open here (shown again, it starts again)
export function autobuildStep({auto, showing, behind}) {
	if (!auto || !showing) return "stop"
	return behind ? "build" : "wait"
}

// the .kc's kcode to save for a .k, if it's there to save: built, and from
// the .k's text as it is now (it goes to a machine, so not one that's
// behind). null when it has to be converted now instead
export function builtKcode(kText, kcDoc) {
	const text = docText(kcDoc)
	if (!text.trim()) return null
	return knitoutOf(kcDoc).kcodeSourceHash === textHash(kText) ? text : null
}
