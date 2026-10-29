// what a viewer types, as the bytes the program reads. input is a list of
// strings (typed as they are), {key: "C-c"} (a named key, with C- ctrl, M-
// alt, S- shift in front), and {paste: "text"}. the host turns them into
// bytes because only it knows the program's modes (cursor keys, pastes)

const CURSOR = {up: "A", down: "B", right: "C", left: "D", home: "H", end: "F"}
const TILDE = {insert: 2, delete: 3, del: 3, pageup: 5, pagedown: 6}
const FUNCTION = {
	f1: "\x1bOP",
	f2: "\x1bOQ",
	f3: "\x1bOR",
	f4: "\x1bOS",
	f5: "\x1b[15~",
	f6: "\x1b[17~",
	f7: "\x1b[18~",
	f8: "\x1b[19~",
	f9: "\x1b[20~",
	f10: "\x1b[21~",
	f11: "\x1b[23~",
	f12: "\x1b[24~",
}
const PLAIN = {
	enter: "\r",
	return: "\r",
	tab: "\t",
	esc: "\x1b",
	escape: "\x1b",
	backspace: "\x7f",
	bs: "\x7f",
	space: " ",
}
const CONTROL = {"@": 0, " ": 0, "[": 27, "\\": 28, "]": 29, "^": 30, _: 31, "?": 127}

/** {ctrl, alt, shift, name} for "C-M-x", or null if it isn't a key */
export function parseKey(text) {
	const match = text.match(/^((?:[CMSA]-)*)(.+)$/)
	if (!match) return null
	const mods = match[1]
	const name = match[2].length === 1 ? match[2] : match[2].toLowerCase()
	const key = {
		ctrl: mods.includes("C-"),
		alt: mods.includes("M-") || mods.includes("A-"),
		shift: mods.includes("S-"),
		name,
	}
	if (name.length === 1) return mods ? key : null
	if (name in CURSOR || name in TILDE || name in FUNCTION || name in PLAIN) return key
	return null
}

function encodeKey({ctrl, alt, shift, name}, modes) {
	// xterm's modifier parameter: 1 + shift 1 + alt 2 + ctrl 4
	const mod = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0)
	if (name in CURSOR) {
		if (mod > 1) return `\x1b[1;${mod}${CURSOR[name]}`
		return (modes.applicationCursorKeysMode ? "\x1bO" : "\x1b[") + CURSOR[name]
	}
	if (name in TILDE) {
		return mod > 1 ? `\x1b[${TILDE[name]};${mod}~` : `\x1b[${TILDE[name]}~`
	}
	if (name in FUNCTION) return FUNCTION[name]
	if (name === "tab" && shift) return "\x1b[Z"
	let bytes = PLAIN[name] ?? name
	if (ctrl && name.length === 1) {
		const lower = name.toLowerCase()
		if (lower >= "a" && lower <= "z") bytes = String.fromCharCode(lower.charCodeAt(0) & 31)
		else if (name in CONTROL) bytes = String.fromCharCode(CONTROL[name])
	} else if (shift && name.length === 1) {
		bytes = name.toUpperCase()
	}
	return alt ? `\x1b${bytes}` : bytes
}

export function encodeInput(input, modes = {}) {
	let bytes = ""
	for (const item of Array.isArray(input) ? input : [input]) {
		if (typeof item === "string") bytes += item
		else if (typeof item?.paste === "string") {
			bytes += modes.bracketedPasteMode ? `\x1b[200~${item.paste}\x1b[201~` : item.paste
		} else if (typeof item?.key === "string") {
			const key = parseKey(item.key)
			if (key) bytes += encodeKey(key, modes)
		}
	}
	return bytes
}

/**
 * what `latticex type` is given, as input: text, with <enter>, <C-c>, <up>,
 * <M-b>… for keys. anything in <angle brackets> that isn't a key stays text
 */
export function parseTyped(text) {
	const input = []
	let at = 0
	for (const match of text.matchAll(/<([^<>\s]+)>/g)) {
		if (!parseKey(match[1])) continue
		if (match.index > at) input.push(text.slice(at, match.index))
		input.push({key: match[1]})
		at = match.index + match[0].length
	}
	if (at < text.length) input.push(text.slice(at))
	return input
}
