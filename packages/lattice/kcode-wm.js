// a .k built into kcode (the format a Kniterate machine reads), in a .kc of
// its own: wm's extension for it. a .k's panes have its build bar
// (knitoutjs's core/build-bar.js, as a .js's have), which builds it into its
// .kc (made beside it the first time), by hand or, with autobuild on, by
// itself whenever the .k changes, while it's shown. autobuild's off unless
// you turn it on, and that's remembered per .k in this browser
// (kcode.js's kcodeBuild). a .kc's says when it was built, or that its .k
// has moved on since, or why it couldn't be. like knitoutjs's wm.js, it
// imports nothing of wm's and gets `api` instead (see
// packages/wm/workspace.js)
import {kcodeBuild} from "./kcode.js"
import {docText, fileExtension, knitoutOf, textHash} from "./files.js"
import {builds} from "../knitoutjs/core/builds.js"
import {buildOnce} from "../knitoutjs/core/builder.js"
import {wmBuildBar} from "../knitoutjs/core/build-bar.js"

// what wm keeps of a doc for us
const linksOf = (url, api) => api.docInfo(url).ext?.kcode ?? {}

// build the .k into its .kc again: by the .k's builder, if it has one (it's
// shown somewhere), so its bar says so too, or else just this once
function rebuild(kUrl, kcUrl, api) {
	const builder = builds[kUrl]?.builder
	if (builder) return builder.now()
	return buildOnce(kcodeBuild, kUrl, kcUrl, api.repo)
}

// is the .kc behind its .k (still its .k's): its text has changed since
const behind = (kcUrl, api) => {
	const kc = linksOf(kcUrl, api)
	const k = kc.kcodeSource ? linksOf(kc.kcodeSource, api) : {}
	return k.kcodeTarget === kcUrl && !!k.textHash && !!kc.kcodeSourceHash && k.textHash !== kc.kcodeSourceHash
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

	// a .k's build bar, over whatever's showing it (it writes its .kc)
	bar(url, api) {
		return api.docInfo(url).extension === "k" ? wmBuildBar(kcodeBuild, url, api) : null
	},

	// a .kc's line: built when, building, out of date, or why it couldn't be
	// (only this browser's builds say so: its .k's builder's), while its .k
	// still builds into it
	status(url, api) {
		const kUrl = kOf(url, api)
		if (!kUrl) return null
		const build = builds[kUrl] ?? {}
		const again = title => ({icon: "rebuild", label: "rebuild", title, run: () => rebuild(kUrl, url, api)})
		if (build.state === "running") return {state: "running", text: "building…"}
		if (build.state === "error") {
			const error = String(build.message ?? "it couldn't be built")
			return {state: "error", stuck: true, text: firstLine(error), action: again(`${error}\nbuild it again from its .k`)}
		}
		if (behind(url, api)) {
			// with autobuild on, it's about to build anyway
			if (build.auto && build.builder) return {state: "running", text: "building…"}
			return {state: "stale", stuck: true, text: "out of date —", action: again("build it again from its .k")}
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
