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
