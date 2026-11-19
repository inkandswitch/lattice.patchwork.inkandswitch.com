// build a patternstoat into its .k, as knitoutjs's runInto builds a .js:
// the knitout goes in as an ImmutableString (a generated .k isn't for typing
// into), with where it came from (knitoutSource), a fingerprint of what it
// was built from (knitoutSourceHash: the design and its charm, so anyone
// can tell when either's changed since), and when (knitoutBuiltAt). a build
// that fails leaves the .k as it was. whoever calls this says how it went in
// the builds store (knitoutjs/core/builds.js), as knitoutjs's wm.js does
import {buildKnitout} from "./build.js"
import {textHash} from "../knitoutjs/core/files.js"

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
	const stoat = stoatHandle.doc()
	let charm = null
	if (stoat?.charm) {
		try {
			const charmHandle = await repo.find(stoat.charm)
			charm = charmHandle.doc()
		} catch (error) {
			return {error: {row: null, needle: null, message: `couldn't load the charm: ${error?.message ?? error}`}}
		}
	}
	const result = buildKnitout(stoat, charm)
	if (result.error) return result
	const hash = sourceHash(stoat, charm)
	// built from just this already: nothing to write (unchanged: true)
	const k = kHandle.doc()
	if (k?.knitoutSource === stoatHandle.url && k?.knitoutSourceHash === hash) return {...result, unchanged: true}
	const wrap = immutable ?? (await automergeImmutable())
	kHandle.change(doc => {
		doc.content = wrap(result.knitout)
		doc.knitoutSource = stoatHandle.url
		doc.knitoutSourceHash = hash
		doc.knitoutBuiltAt = Date.now()
	})
	if (stoatHandle.doc()?.knitoutTarget !== kHandle.url) {
		stoatHandle.change(doc => {
			doc.knitoutTarget = kHandle.url
		})
	}
	return result
}
