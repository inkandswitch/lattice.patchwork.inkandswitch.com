// how thick a yarn is, as it's sold: a count in one of the systems, and how
// many plies are twisted together (Nm 2/30 is two plies of Nm 30). what's
// worked out from it is tex, grams a kilometre of the whole yarn weighs,
// since that's what size.js weighs a fabric with
//
// - Nm (metric): kilometres a kilogram of one ply runs to, so tex is 1000 ÷ it
// - Ne (english cotton): hanks of 840 yards a pound, so tex is 590.5 ÷ it
// - denier: grams 9 km of one ply weighs, so tex is it ÷ 9
// - tex: as it is
export const COUNT_SYSTEMS = ["Nm", "Ne", "tex", "denier"]

const TO_TEX = {
	Nm: value => 1000 / value,
	Ne: value => 590.5 / value,
	tex: value => value,
	denier: value => value / 9,
}

// a count, {system, value, ply}, in tex: null if it isn't one
export function texOf(count) {
	const toTex = TO_TEX[count?.system]
	const value = Number(count?.value)
	if (!toTex || !(value > 0)) return null
	const ply = Number(count.ply) > 0 ? Number(count.ply) : 1
	return toTex(value) * ply
}

export function nmOf(tex) {
	return tex > 0 ? 1000 / tex : null
}

// two yarns plated through one carrier knit best, the kniterate's manual
// says, if together they come to Nm 6–8 (p.23): from 1000 ÷ 8 tex to
// 1000 ÷ 6
export const PLATED_TEX = {low: 1000 / 8, high: 1000 / 6}
