// a .k built into kcode (the format a Kniterate machine reads), in a .kc of
// its own: wm's extension for it. a .k's pane has "build kcode", which makes
// the .kc beside it the first time; a .kc's says when it was built, or that
// its .k has moved on since, or why it couldn't be. autobuild is per .kc and
// only this browser's (localStorage): off unless you turn it on. like
// knitoutjs's wm.js, it imports nothing of wm's and gets `api` instead (see
// packages/wm/workspace.js)
import {createEffect, createRoot, createSignal, on, onCleanup} from "solid-js"
import {autobuildStep, buildKcode, converter} from "./kcode.js"
import {docText, fileExtension, knitoutOf, textHash} from "./files.js"

const AUTOBUILD_DELAY = 600
const autobuildKey = url => `lattice:kcode-autobuild:${url}`

function readAutobuild(url) {
	try {
		return localStorage.getItem(autobuildKey(url)) === "on"
	} catch {
		return false
	}
}

function writeAutobuild(url, auto) {
	try {
		if (auto) localStorage.setItem(autobuildKey(url), "on")
		else localStorage.removeItem(autobuildKey(url))
	} catch {}
}

// one converter for every .kc, made the first time one's built
let kniterate = null
const convert = (text, name, options) => (kniterate ??= converter()).convert(text, name, options)

// what wm keeps of a doc for us
const linksOf = (url, api) => api.docInfo(url).ext?.kcode ?? {}

// what's only this browser's, by the .kc's url: whether it's building, why
// its last build failed, whether autobuild's on, and the build going now
const local = new Map()
function localOf(url) {
	let mine = local.get(url)
	if (!mine) {
		const [running, setRunning] = createSignal(false)
		const [error, setError] = createSignal(null)
		const [auto, setAuto] = createSignal(readAutobuild(url))
		mine = {running, setRunning, error, setError, auto, setAuto, pending: null, again: false, watching: null, watchingIn: null}
		local.set(url, mine)
	}
	return mine
}

// build the .k into the .kc. one build a .kc at a time: asked again while
// it's going, it goes once more after, from the .k as it is then
function build(kUrl, kcUrl, api) {
	const mine = localOf(kcUrl)
	if (mine.pending) {
		mine.again = true
		return mine.pending
	}
	mine.setRunning(true)
	mine.pending = (async () => {
		do {
			mine.again = false
			const [kHandle, kcHandle] = await Promise.all([api.repo.find(kUrl), api.repo.find(kcUrl)])
			const {error} = await buildKcode(kHandle, kcHandle, convert)
			mine.setError(error ?? null)
		} while (mine.again)
	})()
		.catch(error => mine.setError(String(error?.message ?? error)))
		.finally(() => {
			mine.pending = null
			mine.setRunning(false)
		})
	return mine.pending
}

// the .kc a .k builds into: the one it has, or a new one beside it. pressed
// twice before that's made, it's made once
const making = new Map()
function targetFor(kUrl, api) {
	const known = linksOf(kUrl, api).kcodeTarget
	if (known) return Promise.resolve(known)
	if (!making.has(kUrl)) {
		const made = (async () => {
			const kHandle = await api.repo.find(kUrl)
			const now = knitoutOf(kHandle.doc()).kcodeTarget
			if (now) return now
			const stem = String(kHandle.doc()?.name ?? "pattern.k").replace(/\.k$/, "")
			const kcUrl = await api.createFile(`${stem}.kc`, {kcodeSource: kUrl})
			kHandle.change(doc => {
				doc.kcodeTarget = kcUrl
			})
			return kcUrl
		})()
		making.set(kUrl, made)
		made.finally(() => making.delete(kUrl)).catch(() => {})
	}
	return making.get(kUrl)
}

// "build kcode" on a .k: into its .kc (made now, if it hasn't one), shown
// beside it
async function buildFrom(kUrl, from, api) {
	try {
		const kcUrl = await targetFor(kUrl, api)
		await build(kUrl, kcUrl, api)
		await api.reveal(kcUrl, from, "right", "editor")
	} catch (error) {
		console.error("[lattice] couldn't build the kcode:", error)
	}
}

// is the .kc behind its .k (still its .k's): its text has changed since
const behind = (kcUrl, api) => {
	const kc = linksOf(kcUrl, api)
	const k = kc.kcodeSource ? linksOf(kc.kcodeSource, api) : {}
	return k.kcodeTarget === kcUrl && !!k.textHash && !!kc.kcodeSourceHash && k.textHash !== kc.kcodeSourceHash
}

// is the .kc open in a pane here (any tab of one). a workspace without
// showing() never autobuilds
const showing = (kcUrl, api) => api.showing?.(kcUrl) ?? false

// while autobuild's on and the .kc's open here: once the .k's text moves,
// wait for it to settle and build it again. started when the .kc's status is
// asked for (its pane's bar), stopped when autobuild goes off or the .kc's
// last pane closes (a closed .kc's status isn't asked for, so it starts
// again, once, when it's shown again). a workspace of its own each (another
// project's is another api)
function startAutobuild(kcUrl, api) {
	const mine = localOf(kcUrl)
	if (mine.watchingIn === api) return
	if (autobuildStep({auto: mine.auto(), showing: showing(kcUrl, api), behind: false}) === "stop") return
	stopAutobuild(kcUrl)
	mine.watchingIn = api
	mine.watching = createRoot(dispose => {
		let timer = null
		createEffect(
			on(
				() => {
					const step = autobuildStep({auto: mine.auto(), showing: showing(kcUrl, api), behind: behind(kcUrl, api)})
					if (step !== "build") return {step}
					const kUrl = linksOf(kcUrl, api).kcodeSource
					return {step, kUrl, hash: linksOf(kUrl, api).textHash}
				},
				next => {
					clearTimeout(timer)
					if (next.step === "build") timer = setTimeout(() => build(next.kUrl, kcUrl, api), AUTOBUILD_DELAY)
					// (not from inside its own effect)
					else if (next.step === "stop") {
						queueMicrotask(() => {
							if (mine.watching === dispose) stopAutobuild(kcUrl)
						})
					}
				},
			),
		)
		onCleanup(() => clearTimeout(timer))
		return dispose
	})
}

function stopAutobuild(kcUrl) {
	const mine = localOf(kcUrl)
	mine.watching?.()
	mine.watching = null
	mine.watchingIn = null
}

function toggleAutobuild(kcUrl, api) {
	const mine = localOf(kcUrl)
	const auto = !mine.auto()
	writeAutobuild(kcUrl, auto)
	mine.setAuto(auto)
	if (auto) startAutobuild(kcUrl, api)
	else stopAutobuild(kcUrl)
}

// a .kc its .k still builds into: its .k's url, or null
function kOf(kcUrl, api) {
	const kUrl = linksOf(kcUrl, api).kcodeSource
	return kUrl && linksOf(kUrl, api).kcodeTarget === kcUrl ? kUrl : null
}

const firstLine = text => String(text).split("\n")[0]

export const kcode = {
	name: "kcode",

	watch(doc) {
		const extension = fileExtension(doc)
		if (extension !== "k" && extension !== "kc") return null
		const {kcodeTarget, kcodeSource, kcodeSourceHash, kcodeBuiltAt} = knitoutOf(doc)
		return {
			kcodeTarget,
			kcodeSource,
			kcodeSourceHash,
			kcodeBuiltAt,
			// a .k's text now, to tell when its .kc is out of date
			textHash: extension === "k" && kcodeTarget ? textHash(docText(doc)) : null,
		}
	},

	// a .k and the .kc it builds into, both ways. once that .k builds
	// somewhere else, the .kc's link to it is history: a chip, but no light
	links(url, api) {
		const doc = linksOf(url, api)
		const found = []
		if (doc.kcodeTarget) found.push({url: doc.kcodeTarget, live: true})
		if (doc.kcodeSource) {
			found.push({
				url: doc.kcodeSource,
				label: "made from",
				title: "open the .k this is made from",
				live: linksOf(doc.kcodeSource, api).kcodeTarget === url,
			})
		}
		return found
	},

	// a .k builds kcode; a .kc builds itself again whenever its .k changes,
	// or doesn't
	actions(url, api) {
		const extension = api.docInfo(url).extension
		if (extension === "k") {
			return [
				{
					icon: "build",
					label: "build kcode",
					title: "turn this into kcode, the format a Kniterate machine reads, in a .kc beside it",
					run: from => buildFrom(url, from, api),
				},
			]
		}
		if (extension === "kc" && kOf(url, api)) {
			const auto = localOf(url).auto()
			return [
				{
					icon: "rebuild",
					label: auto ? "autobuild: on" : "autobuild: off",
					title: auto
						? "this builds again whenever its .k changes, while it's open here (in this browser): turn that off"
						: "build this again whenever its .k changes, while it's open here (in this browser)",
					run: () => toggleAutobuild(url, api),
				},
			]
		}
		return []
	},

	// a .kc's line: built when, building, out of date, or why it couldn't be
	// (only this browser's builds say so), while its .k still builds into it
	status(url, api) {
		const kUrl = kOf(url, api)
		if (!kUrl) return null
		const mine = localOf(url)
		if (mine.auto() && mine.watchingIn !== api && showing(url, api)) queueMicrotask(() => startAutobuild(url, api))
		const rebuild = title => ({icon: "rebuild", label: "rebuild", title, run: () => build(kUrl, url, api)})
		if (mine.running()) return {state: "running", text: "building…"}
		const error = mine.error()
		if (error) {
			return {state: "error", stuck: true, text: firstLine(error), action: rebuild(`${error}\nbuild it again from its .k`)}
		}
		if (behind(url, api)) {
			// with autobuild on, it's about to build anyway
			if (mine.auto()) return {state: "running", text: "building…"}
			return {state: "stale", stuck: true, text: "out of date —", action: rebuild("build it again from its .k")}
		}
		const {kcodeBuiltAt} = linksOf(url, api)
		return {state: "built", text: kcodeBuiltAt ? `generated ${api.ago(kcodeBuiltAt)}` : "generated"}
	},

	// a .kc is built, not edited: a new build tints its panes
	touched(url, api) {
		const {kcodeBuiltAt, kcodeSource} = linksOf(url, api)
		return kcodeSource && kcodeBuiltAt ? {verb: "built", at: kcodeBuiltAt, flash: true} : null
	},
}
