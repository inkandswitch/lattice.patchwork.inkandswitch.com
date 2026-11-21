import {docText, knitoutOf, moduleWorker, textHash} from "./files.js"
import {buildKcode} from "../knitoutjs/core/kcode.js"
import {builtMessage, sourceKind} from "../knitoutjs/core/builder-logic.js"

// a .k as kcode, the format a Kniterate machine reads: the converter (in a
// worker where the browser allows it), a build of a .k into the .kc it goes
// in (knitoutjs's, which knows what a .kc keeps), and the .k's builder
// (knitoutjs's core/builder-logic.js) that does it. nothing here needs
// solid or automerge-repo, so it's tested in node; the wiring into the panes
// is kcode-wm.js
export {buildKcode}

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

// is the .kc behind its .k: the .k's text has moved on from what the .kc
// was built from. one never built isn't
export function kcodeBehind(kDoc, kcDoc) {
	const built = knitoutOf(kcDoc).kcodeSourceHash
	return !!built && built !== textHash(docText(kDoc))
}

// one converter for every .kc, made the first time one's built
let kniterate = null
const convert = (text, name, options) => (kniterate ??= converter()).convert(text, name, options)

// while the .k's builder is about, with autobuild on: a change to its text
// (it's usually written by a build of its own) builds it again, and so does
// finding its .kc behind it, as it's first about, as its .kc changes to
// another, and as autobuild's turned on
function watchText(builder) {
	const handle = builder.source()
	let text = textHash(docText(handle.doc()))
	let target = builder.target()
	let closed = false

	async function ifBehind() {
		const url = builder.target()
		if (!url || !builder.auto()) return
		try {
			const kc = await builder.env().repo.find(url)
			if (!closed && builder.target() === url && kcodeBehind(handle.doc(), kc.doc())) builder.edited()
		} catch {}
	}

	function onChange() {
		const now = textHash(docText(handle.doc()))
		if (now !== text) {
			text = now
			builder.edited()
		} else if (builder.target() !== target) {
			target = builder.target()
			ifBehind()
		}
	}

	handle.on("change", onChange)
	ifBehind()
	return {
		stop() {
			closed = true
			handle.off("change", onChange)
		},
		recheck: ifBehind,
	}
}

export const kcodeBuild = sourceKind("k", {
	name: "kcode",
	targetField: "kcodeTarget",
	targetExtension: "kc",
	targetName: doc => `${String(doc?.name ?? "pattern.k").replace(/\.k$/, "")}.kc`,
	targetFields: kUrl => ({kcodeSource: kUrl}),
	autobuild: {key: url => `lattice:kcode-autobuild:${url}`, default: false},
	openWith: "editor",
	titles: {
		build: "turn this into kcode, the format a Kniterate machine reads, in the .kc file chosen on the right",
		auto: "build the kcode again by itself whenever this .k changes. this browser remembers it for this file",
		target: "the .kc file this writes its kcode (what a Kniterate machine reads) into",
		open: "show that .kc file's text beside this one",
	},
	async build(kHandle, kcHandle, {signal} = {}) {
		const started = performance.now()
		const {error, stopped} = await buildKcode(kHandle, kcHandle, convert, {signal})
		if (stopped) return {error: {message: "stopped", stopped: true}}
		if (error != null) return {error: {message: String(error)}}
		return {message: builtMessage(performance.now() - started, docText(kcHandle.doc()))}
	},
	watch: watchText,
})

// the .kc's kcode to save for a .k, if it's there to save: built, and from
// the .k's text as it is now (it goes to a machine, so not one that's
// behind). null when it has to be converted now instead
export function builtKcode(kText, kcDoc) {
	const text = docText(kcDoc)
	if (!text.trim()) return null
	return knitoutOf(kcDoc).kcodeSourceHash === textHash(kText) ? text : null
}
