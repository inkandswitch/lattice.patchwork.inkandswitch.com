import {stylesheet} from "./stylesheet.js"

// the colours of carriers 1–6: the kniterate editor's, until someone picks
// their own. what they pick is theirs alone (it's kept in this browser), and
// every tool showing yarns hears about it
export const YARNS = ["#ec7418", "#4fc6ef", "#f8cf1d", "#f597df", "#0c56a5", "#56aa30"]
const STORE = "lattice:kniterate-yarns"
// and, fed through the same carrier with it, a second strand: its colour, and
// whether it's plated (through the plating slit: see strands.js)
const STRANDS = "lattice:kniterate-strands"
export const YARNS_CHANGED = "lattice:yarns"

// [colour or null] for carriers 1–6, as picked
export function storedYarns() {
	try {
		const yarns = JSON.parse(localStorage.getItem(STORE))
		return Array.isArray(yarns) ? yarns : []
	} catch {
		return []
	}
}

// the colours of carriers 1–6, picked or not
export function yarnColours() {
	const picked = storedYarns()
	return YARNS.map((colour, index) => picked[index] || colour)
}

// each carrier's second strand, if it has one: [{colour, plated} or null]
// for carriers 1–6
export function storedStrands() {
	try {
		const strands = JSON.parse(localStorage.getItem(STRANDS))
		if (!Array.isArray(strands)) return []
		return strands.map(strand => (strand && typeof strand.colour === "string" ? {colour: strand.colour, plated: !!strand.plated} : null))
	} catch {
		return []
	}
}

// what's in each of carriers 1–6: {colours: [the first strand's, and the
// second's, if there is one], plated}
export function yarnStrands() {
	const second = storedStrands()
	return yarnColours().map((colour, index) => ({
		colours: second[index] ? [colour, second[index].colour] : [colour],
		plated: !!second[index]?.plated,
	}))
}

export function storeStrand(index, strand) {
	const strands = storedStrands()
	strands[index] = strand
	try {
		localStorage.setItem(STRANDS, JSON.stringify(strands))
	} catch {}
	dispatchEvent(new Event(YARNS_CHANGED))
}

export function storeYarn(index, colour) {
	const yarns = storedYarns()
	yarns[index] = colour
	try {
		localStorage.setItem(STORE, JSON.stringify(yarns))
	} catch {}
	dispatchEvent(new Event(YARNS_CHANGED))
}

const STYLESHEET = new URL("./yarns.css", import.meta.url).href

// a swatch for each carrier, in its yarn's colour, for a tool's bar: click
// one to pick its colour, double click for the usual one. with `strands` (a
// tool that can show them), shift click to pick a second strand fed in with
// it, and alt click to plate it or not. `destroy()` stops it listening
export function yarnPicker({strands = false} = {}) {
	const element = document.createElement("div")
	element.className = "yarn-picker"

	const link = stylesheet(STYLESHEET)

	const picker = document.createElement("input")
	picker.type = "color"
	picker.hidden = true
	// (which carrier, and which of its strands)
	let picking = null
	const chips = YARNS.map((_, index) => {
		const chip = document.createElement("button")
		chip.className = "yarn-chip"
		chip.textContent = String(index + 1)
		chip.addEventListener("click", event => {
			const second = storedStrands()[index]
			if (strands && event.altKey) {
				if (second) storeStrand(index, {...second, plated: !second.plated})
				return
			}
			picking = {index, second: strands && event.shiftKey}
			picker.value = picking.second ? (second?.colour ?? yarnColours()[index]) : yarnColours()[index]
			picker.click()
		})
		chip.addEventListener("dblclick", () => {
			storeYarn(index, null)
			if (strands) storeStrand(index, null)
		})
		return chip
	})
	picker.addEventListener("input", () => {
		if (!picking) return
		if (picking.second) {
			const plated = !!storedStrands()[picking.index]?.plated
			storeStrand(picking.index, {colour: picker.value, plated})
		} else storeYarn(picking.index, picker.value)
	})
	element.append(link, ...chips, picker)

	function paint() {
		yarnStrands().forEach(({colours, plated}, index) => {
			const chip = chips[index]
			chip.style.setProperty("--yarn", colours[0])
			const two = strands && colours.length > 1
			chip.classList.toggle("two", two)
			chip.classList.toggle("plated", two && plated)
			if (two) chip.style.setProperty("--yarn-2", colours[1])
			chip.title = !strands
				? `carrier ${index + 1}: click to pick the colour of its yarn (double click for the usual one)`
				: `carrier ${index + 1}: ${two ? `two strands, ${plated ? "plated: the first on the face, the second behind it" : "held together"}` : "one strand"}. ` +
					`click to pick its colour, shift click to pick a second strand's, ` +
					`alt click to plate them or hold them together, double click for the usual one strand`
		})
	}
	paint()
	addEventListener(YARNS_CHANGED, paint)

	return {
		element,
		destroy: () => removeEventListener(YARNS_CHANGED, paint),
	}
}
