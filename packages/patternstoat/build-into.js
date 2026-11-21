// build a patternstoat into its .k, as knitoutjs's runInto builds a .js:
// the knitout goes in as an ImmutableString (a generated .k isn't for typing
// into), with where it came from (knitoutSource), a fingerprint of what it
// was built from (knitoutSourceHash: the design and its charm, so anyone
// can tell when either's changed since), when (knitoutBuiltAt), and which
// versions of the two (knitoutSources, and the knitout's x-patchwork-sources
// line: each pinned at its heads). a build that fails leaves the .k as it
// was. whoever calls this says how it went in the builds store
// (knitoutjs/core/builds.js), as knitoutjs's wm.js does
import {buildKnitout} from "./build.js"
import {knitoutOf, textHash} from "../knitoutjs/core/files.js"
import {withSourcesLine} from "../knitoutjs/core/sources.js"

const automergeImmutable = async () => {
	const {ImmutableString} = await import("@automerge/automerge")
	return text => new ImmutableString(text)
}

// what a patternstoat's .k is built from
export function sourceHash(stoat, charm) {
	const {colours, stitches, yarns, left, gauge} = stoat ?? {}
	const {rows, columns, cells} = charm ?? {}
	return textHash(JSON.stringify([colours, stitches, yarns, left, gauge, rows, columns, cells]))
}

// {knitout, rows, unchanged?} or {error: {row, needle, message}}. `immutable` wraps the
// knitout for the doc (automerge's ImmutableString, unless it's given)
export async function buildInto(stoatHandle, kHandle, repo, {immutable = null} = {}) {
	// each read at the heads it's pinned at, so the sources say what was built
	const stoatView = stoatHandle.view(stoatHandle.heads())
	const stoat = stoatView.doc()
	const sources = [stoatView.url]
	let charm = null
	if (stoat?.charm) {
		try {
			const charmHandle = await repo.find(stoat.charm)
			const charmView = charmHandle.view(charmHandle.heads())
			charm = charmView.doc()
			sources.push(charmView.url)
		} catch (error) {
			return {error: {row: null, needle: null, message: `couldn't load the charm: ${error?.message ?? error}`}}
		}
	}
	const built = buildKnitout(stoat, charm)
	if (built.error) return built
	const result = {...built, knitout: withSourcesLine(built.knitout, sources)}
	const hash = sourceHash(stoat, charm)
	// built from just this, at these heads, already: nothing to write
	// (unchanged: true). the same knitout at newer heads (an edit that didn't
	// change it, a title say) is written again, so the .k says which heads
	const k = kHandle.doc()
	const same =
		k?.knitoutSource === stoatHandle.url &&
		k?.knitoutSourceHash === hash &&
		knitoutOf(k).sources.join(" ") === sources.join(" ")
	if (same) return {...result, unchanged: true}
	const wrap = immutable ?? (await automergeImmutable())
	kHandle.change(doc => {
		doc.content = wrap(result.knitout)
		doc.knitoutSource = stoatHandle.url
		doc.knitoutSourceHash = hash
		doc.knitoutBuiltAt = Date.now()
		doc.knitoutSources = sources
	})
	if (stoatHandle.doc()?.knitoutTarget !== kHandle.url) {
		stoatHandle.change(doc => {
			doc.knitoutTarget = kHandle.url
		})
	}
	return result
}
