// a patternstoat built into its .k: the builder's kind for it (knitoutjs's
// core/builder-logic.js), so it has the same build bar as a .js and a .k.
// autobuild's on to start with, and turning it off is remembered in this
// browser, for each patternstoat. it builds after changes made in the stoat
// tool (which says so: stoat-tool.js), and whenever its charm changes,
// while it's shown anywhere. the build is build-into.js's, loaded when it's
// first wanted
import {builtMessage} from "../knitoutjs/core/builder-logic.js"

// its charm changing (here, in its arrangement, or someone's) is an edit:
// it's built again, and the .k's only written if what it's built from is
// new, or is the same at newer heads (so the .k says which heads it was
// built from)
function watchCharm(builder) {
	const handle = builder.source()
	const edited = () => builder.edited()
	let url = null
	let charm = null
	let closed = false

	async function follow() {
		const next = String(handle.doc()?.charm ?? "") || null
		if (next === url) return
		charm?.off("change", edited)
		charm = null
		url = next
		if (!next) return
		try {
			const found = await builder.env().repo.find(next)
			if (closed || url !== next) return
			charm = found
			found.on("change", edited)
		} catch (error) {
			console.warn(`patternstoat: can't watch its charm ${next}`, error)
		}
	}

	handle.on("change", follow)
	follow()
	return () => {
		closed = true
		handle.off("change", follow)
		charm?.off("change", edited)
	}
}

export const stoatBuild = {
	name: "patternstoat",
	targetField: "knitoutTarget",
	targetExtension: "k",
	targetName: doc => `${doc?.title || "patternstoat"}.k`,
	autobuild: {key: url => `patternstoat:autobuild:${url}`, default: true},
	openWith: "visualizer",
	titles: {
		build: "build the design: it writes its knitout into the .k file chosen on the right",
		auto: "build again by itself whenever this or its charm changes. this browser remembers it for this file",
		target: "the .k file this design writes its knitout (the machine's instructions) into",
		open: "show that .k file's text beside this one",
	},
	// an error says its row and needle, if it has them, and keeps them, so
	// the stoat tool can show where
	async build(stoatHandle, kHandle, {signal, repo} = {}) {
		const started = performance.now()
		const {buildInto} = await import("./build-into.js")
		const result = await buildInto(stoatHandle, kHandle, repo, {signal})
		if (result.error) {
			const {row, needle, message} = result.error
			const where = [row != null && `row ${row}`, needle != null && `needle ${needle}`].filter(Boolean).join(", ")
			return {error: {...result.error, message: where ? `${where}: ${message}` : message}}
		}
		return {message: builtMessage(performance.now() - started, result.knitout)}
	},
	watch: watchCharm,
}
