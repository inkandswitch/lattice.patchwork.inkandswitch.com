// what this browser kept of the yarn, before there were profiles (size.js's
// FABRIC, as settings.js keeps it), as docs: a yarn, and a swatch for each
// stitch number something was measured of. its across and up were swatches
// measured per 10 cm, let relax as it said; its loops, loop lengths. how
// they were knit wasn't kept, so it's "believed", jersey
import {newSwatch, newYarn} from "./profile-docs.js"
import {fabricOf} from "./size.js"

const positive = value => (Number(value) > 0 ? Number(value) : null)

export function profilesFromFabric(kept) {
	const fabric = fabricOf({fabric: kept})
	const yarn = newYarn()
	yarn.title = `${fabric.fibre} (from this browser)`
	yarn.relaxesLike = fabric.fibre
	yarn.count = {system: "tex", value: positive(fabric.tex), ply: positive(fabric.strands) ?? 1}
	const swatches = Object.entries(fabric.stitches).map(([number, entry]) => {
		const swatch = newSwatch()
		swatch.title = `${fabric.fibre}, stitch ${number} (from this browser)`
		swatch.knit.stitch = number
		swatch.knit.structure = "jersey"
		swatch.knit.sure = "believed"
		swatch.knit.note = "measured before lattice kept swatches: how it was knit wasn't kept"
		swatch.loop.mm = positive(entry?.loop)
		const wales = positive(entry?.across)
		const courses = positive(entry?.up)
		if (wales || courses) {
			swatch.relaxed[fabric.relax] = {entered: "per10", wales, courses, width: null, height: null, grams: null, date: null, by: null}
		}
		return swatch
	})
	return {yarn, swatches}
}
