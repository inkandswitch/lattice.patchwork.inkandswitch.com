// how the machine and yarn are taken to be, by the views and the check: the
// kniterate's gauge, how tightly rows can bunch, and how much time the
// fabric gets to settle. what someone picks is theirs alone (it's kept in
// this browser), and every tool hears about it
export const DEFAULTS = {
	gauge: 7, // needles to the inch
	squash: 0.3, // how close bunched rows can get, as a share of a row
	speed: 1, // how long the fabric settles each frame, × the usual
}
export const SETTINGS_CHANGED = "lattice:settings"
const STORE = "lattice:knit-settings"

export function readSettings() {
	try {
		const stored = JSON.parse(localStorage.getItem(STORE))
		return {...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {})}
	} catch {
		return {...DEFAULTS}
	}
}

export function storeSetting(name, value) {
	const settings = readSettings()
	settings[name] = value
	try {
		localStorage.setItem(STORE, JSON.stringify(settings))
	} catch {}
	dispatchEvent(new Event(SETTINGS_CHANGED))
}
