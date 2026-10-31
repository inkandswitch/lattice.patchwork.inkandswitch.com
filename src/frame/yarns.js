// the colours of carriers 1–6: the kniterate editor's, until someone picks
// their own. what they pick is theirs alone (it's kept in this browser), and
// every tool showing yarns hears about it
export const YARNS = ["#ec7418", "#4fc6ef", "#f8cf1d", "#f597df", "#0c56a5", "#56aa30"]
const STORE = "lattice:kniterate-yarns"
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
// one to pick its colour, double click for the usual one. `destroy()` stops
// it listening
export function yarnPicker() {
	const element = document.createElement("div")
	element.className = "yarn-picker"

	const link = document.createElement("link")
	link.rel = "stylesheet"
	link.href = STYLESHEET

	const picker = document.createElement("input")
	picker.type = "color"
	picker.hidden = true
	let picking = null
	const chips = YARNS.map((_, index) => {
		const chip = document.createElement("button")
		chip.className = "yarn-chip"
		chip.textContent = String(index + 1)
		chip.title = `carrier ${index + 1}: click to pick the colour of its yarn (double click for the usual one)`
		chip.addEventListener("click", () => {
			picking = index
			picker.value = yarnColours()[index]
			picker.click()
		})
		chip.addEventListener("dblclick", () => storeYarn(index, null))
		return chip
	})
	picker.addEventListener("input", () => picking != null && storeYarn(picking, picker.value))
	element.append(link, ...chips, picker)

	function paint() {
		yarnColours().forEach((colour, index) => chips[index].style.setProperty("--yarn", colour))
	}
	paint()
	addEventListener(YARNS_CHANGED, paint)

	return {
		element,
		destroy: () => removeEventListener(YARNS_CHANGED, paint),
	}
}
