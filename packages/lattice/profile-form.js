// what the machine, yarn and swatch editors are made of: a form of fields,
// each a label, its controls and what it means; boxes for numbers and words;
// choices, a row of them or a menu; a colour; and a choice of a doc, from
// the project's files of a kind or a link pasted in. every control says what
// it is (its title) the way checks.js's settings do, so someone who's never
// seen it can tell
//
// it's kept as it's typed. words go in as splices, the way codemirror's do:
// each edit is worked out from the box's text before and after it, and where
// the caret's left, and only that much changes in the doc. so two people
// typing in one box at once both keep what they typed. a box always shows
// the doc (someone else's typing comes in as it lands, the caret staying
// put), so what's spliced is always into what's there. numbers and colours
// are kept once they've stopped changing for a moment, or on leaving them
import {splice} from "@automerge/automerge"
import {stylesheet} from "../wm/ui/stylesheet.js"
import {urlFromText} from "../wm/patchwork/docs.js"
import {editBetween, moved} from "./edits.js"

const STYLESHEET = new URL("./profiles.css", import.meta.url).href
// a number or colour that's changing is kept once it's stopped this long
const KEEP_AFTER = 300

// an editor's root, in `element`, styled: {root, remove()}
export function editorRoot(element, className) {
	const root = document.createElement("div")
	root.className = `profile-editor ${className}`
	const link = stylesheet(STYLESHEET, root)
	element.append(link, root)
	return {
		root,
		remove() {
			root.remove()
			link.remove()
		},
	}
}

// a part of the form, with its heading and (if there is one) a few words on
// what it's for, and more in their title
export function section(title, hint = null, more = "") {
	const part = document.createElement("section")
	part.className = "profile-section"
	const heading = document.createElement("h3")
	heading.textContent = title
	part.append(heading)
	if (hint) {
		const line = note(hint)
		if (more) line.title = more
		part.append(line)
	}
	return part
}

export function note(text, className = "profile-hint") {
	const line = document.createElement("p")
	line.className = className
	line.textContent = text
	return line
}

// a row: its name, its controls, and what it means (its title)
export function field(label, hint, ...controls) {
	const row = document.createElement("div")
	row.className = "profile-field"
	if (hint) row.title = hint
	const name = document.createElement("span")
	name.className = "profile-field-name"
	name.textContent = label
	const box = document.createElement("span")
	box.className = "profile-field-controls"
	box.append(...controls.filter(Boolean))
	row.append(name, box)
	return row
}

export function unit(text) {
	const span = document.createElement("span")
	span.className = "profile-unit"
	span.textContent = text
	return span
}

// a button: `quiet` ones are the "+ another" kind, at the end of a list
export function button(text, title, onClick, {quiet = false} = {}) {
	const element = document.createElement("button")
	element.type = "button"
	element.className = quiet ? "profile-button profile-button-quiet" : "profile-button"
	element.textContent = text
	element.title = title
	element.addEventListener("click", onClick)
	return element
}

// the × that takes a row out
export function removeButton(title, onClick) {
	const element = document.createElement("button")
	element.type = "button"
	element.className = "profile-remove"
	element.title = title
	element.setAttribute("aria-label", title)
	element.innerHTML = `<svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
	element.addEventListener("click", onClick)
	return element
}

// kept a moment after it's stopped changing, or as soon as it's left
function keptSoon(input, keep) {
	let timer = null
	const now = () => {
		if (timer == null) return
		clearTimeout(timer)
		timer = null
		keep()
	}
	input.addEventListener("input", () => {
		clearTimeout(timer)
		timer = setTimeout(now, KEEP_AFTER)
	})
	input.addEventListener("change", () => {
		timer ??= 0
		now()
	})
}

// a number box: blank, nought or less is not known (`onValue(null)`)
export function numberInput({step = "any", min = "0", max = null, title = "", placeholder = "", onValue, allowNought = false}) {
	const input = document.createElement("input")
	input.type = "number"
	input.className = "profile-number"
	input.step = step
	if (min != null) input.min = min
	if (max != null) input.max = max
	input.title = title
	input.placeholder = placeholder
	keptSoon(input, () => {
		const value = input.value === "" ? null : Number(input.value)
		onValue(Number.isFinite(value) && (allowNought ? value >= 0 : value > 0) ? value : null)
	})
	return input
}

// boxes of words kept live with their doc, and what each last showed
const words = new WeakMap()

/**
 * a box of words. with `handle` and `path`, it's the doc's words at `path`,
 * kept as they're typed, by splices (`ready(doc)` first, to make what's
 * above `path` if it isn't there yet). or else `onValue(text)` once it's
 * been changed and left
 */
export function textInput({title = "", placeholder = "", multiline = false, handle = null, path = null, ready = null, onValue}) {
	const input = document.createElement(multiline ? "textarea" : "input")
	if (!multiline) input.type = "text"
	input.className = "profile-text"
	input.title = title
	input.placeholder = placeholder
	if (handle && path) {
		const live = {shown: ""}
		words.set(input, live)
		input.addEventListener("input", () => {
			const edit = editBetween(live.shown, input.value, input.selectionEnd ?? input.value.length)
			live.shown = input.value
			if (!edit.remove && !edit.insert) return
			handle.change(doc => {
				ready?.(doc)
				const parent = path.slice(0, -1).reduce((at, key) => at[key], doc)
				const key = path.at(-1)
				if (typeof parent[key] === "string") splice(doc, path, edit.at, edit.remove, edit.insert)
				// nothing there yet: it's what's typed, all of it
				else parent[key] = input.value
			})
		})
	} else {
		input.addEventListener("change", () => onValue(input.value))
	}
	return input
}

// a control's value, as the doc has it. a box of words always shows it, with
// whatever's changed put in around your caret; anything else waits while
// someone's in it
export function show(input, value) {
	const live = words.get(input)
	if (live) {
		const text = value == null ? "" : String(value)
		live.shown = text
		if (text === input.value) return
		const focused = document.activeElement === input
		const edit = editBetween(input.value, text)
		const [start, end, direction] = [input.selectionStart, input.selectionEnd, input.selectionDirection]
		input.value = text
		if (focused) input.setSelectionRange(moved(start, edit), moved(end, edit), direction)
		return
	}
	if (document.activeElement === input) return
	if (input.type === "checkbox") input.checked = !!value
	else input.value = value == null ? "" : String(value)
}

// a menu: `options`, [[value, label]]
export function choice(options, onValue, title = "") {
	const select = document.createElement("select")
	select.className = "profile-select"
	select.title = title
	for (const [value, label] of options) select.append(new Option(label, value))
	select.addEventListener("change", () => onValue(select.value))
	return select
}

let segmentedCount = 0
/**
 * a row of choices, one pressed: `options`, [[value, label, title?]].
 * {element, show(value)}
 */
export function segmented(options, onValue, title = "") {
	const element = document.createElement("span")
	element.className = "profile-segmented"
	element.setAttribute("role", "radiogroup")
	element.title = title
	if (title) element.setAttribute("aria-label", title)
	const name = `profile-segmented-${++segmentedCount}`
	const inputs = options.map(([value, label, hint]) => {
		const option = document.createElement("label")
		if (hint) option.title = hint
		const input = document.createElement("input")
		input.type = "radio"
		input.name = name
		input.value = value
		input.addEventListener("change", () => input.checked && onValue(value))
		option.append(input, label)
		element.append(option)
		return input
	})
	return {
		element,
		show(value) {
			for (const input of inputs) input.checked = input.value === value
		},
	}
}

// a colour, as a round well, kept once it's stopped changing. none yet, and
// it's shown empty. {element, show(value)}
export function colourWell({title = "", onValue}) {
	const element = document.createElement("span")
	element.className = "profile-colour"
	const input = document.createElement("input")
	input.type = "color"
	input.title = title
	input.setAttribute("aria-label", title)
	element.append(input)
	keptSoon(input, () => onValue(input.value))
	input.addEventListener("input", () => element.removeAttribute("data-none"))
	return {
		element,
		show(value) {
			if (document.activeElement === input) return
			if (value) {
				input.value = value
				element.removeAttribute("data-none")
			} else element.setAttribute("data-none", "")
		},
	}
}

const PASTE = "\u0000paste"
const NONE = ""

/**
 * a choice of a doc of `kind` ("machine", "yarn", "swatch", "k"): one of the
 * project's (`files()`: [{url, name, extension}], the tool context's
 * project.files), or a link pasted in. `none`: what choosing nothing's
 * called. {element, update(value)}: `update` redraws it with the doc's value
 */
export function docChoice({files = () => [], kind, none = "none", title = "", onValue}) {
	const element = document.createElement("span")
	element.className = "profile-doc-choice"
	const select = document.createElement("select")
	select.className = "profile-select"
	select.title = title
	const paste = document.createElement("input")
	paste.type = "text"
	paste.className = "profile-text"
	paste.placeholder = "paste a link to it"
	paste.hidden = true
	element.append(select, paste)

	let current = null
	function update(value = current) {
		current = value ?? null
		const mine = (files() ?? []).filter(file => file.extension === kind)
		const options = [[NONE, none], ...mine.map(file => [file.url, file.name || file.url])]
		if (current && !mine.some(file => file.url === current)) options.push([current, `linked: ${current.slice(-8)}`])
		options.push([PASTE, "paste a link…"])
		if (document.activeElement !== select) {
			select.replaceChildren(...options.map(([value, label]) => new Option(label, value)))
			select.value = current ?? NONE
		}
	}
	select.addEventListener("change", () => {
		if (select.value === PASTE) {
			paste.hidden = false
			paste.focus()
			return
		}
		paste.hidden = true
		onValue(select.value || null)
	})
	paste.addEventListener("change", () => {
		const url = urlFromText(paste.value)
		if (!url) {
			paste.setCustomValidity("that isn't a link to a doc")
			paste.reportValidity()
			return
		}
		paste.setCustomValidity("")
		paste.value = ""
		paste.hidden = true
		onValue(url)
	})
	update()
	return {element, update}
}
