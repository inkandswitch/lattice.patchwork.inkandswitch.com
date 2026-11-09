// what the machine, yarn and swatch editors are made of: a form of fields,
// each a label, its controls and what it means; boxes for numbers and words;
// choices; and a choice of a doc, from the project's files of a kind or a
// link pasted in. every control says what it is (its title) the way
// checks.js's settings do, so someone who's never seen it can tell
import {stylesheet} from "./knitoutjs/core/stylesheet.js"
import {urlFromText} from "./knitoutjs/core/patchwork-docs.js"

const STYLESHEET = new URL("./profiles.css", import.meta.url).href

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

// a part of the form, with its heading and (if there is one) a line saying
// what it's for
export function section(title, hint = null) {
	const part = document.createElement("section")
	part.className = "profile-section"
	const heading = document.createElement("h3")
	heading.textContent = title
	part.append(heading)
	if (hint) part.append(note(hint))
	return part
}

export function note(text, className = "profile-hint") {
	const line = document.createElement("p")
	line.className = className
	line.textContent = text
	return line
}

// a row: its name, its controls, and what it means (as its title, and under
// it, small, if `hint`'s long enough to want saying)
export function field(label, hint, ...controls) {
	const row = document.createElement("label")
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

// a number box: blank, nought or less is not known (`onValue(null)`)
export function numberInput({step = "any", min = "0", max = null, title = "", onValue, allowNought = false}) {
	const input = document.createElement("input")
	input.type = "number"
	input.step = step
	if (min != null) input.min = min
	if (max != null) input.max = max
	input.title = title
	input.addEventListener("change", () => {
		const value = input.value === "" ? null : Number(input.value)
		onValue(Number.isFinite(value) && (allowNought ? value >= 0 : value > 0) ? value : null)
	})
	return input
}

export function textInput({title = "", placeholder = "", multiline = false, onValue}) {
	const input = document.createElement(multiline ? "textarea" : "input")
	if (!multiline) input.type = "text"
	input.title = title
	input.placeholder = placeholder
	input.addEventListener("change", () => onValue(input.value))
	return input
}

// a select: `options`, [[value, label]]
export function choice(options, onValue, title = "") {
	const select = document.createElement("select")
	select.title = title
	for (const [value, label] of options) select.append(new Option(label, value))
	select.addEventListener("change", () => onValue(select.value))
	return select
}

// a control's value, as the doc has it: unless someone's typing in it
export function show(input, value) {
	if (document.activeElement === input) return
	if (input.type === "checkbox") input.checked = !!value
	else input.value = value == null ? "" : String(value)
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
	select.title = title
	const paste = document.createElement("input")
	paste.type = "text"
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
