// a bar of trays, as skitch's: rounded trays of icon buttons, round colour
// swatches, a key in the corner of a button you point at, and a popover for
// what doesn't need to be out all the time. a tool links TRAYS_STYLESHEET
// (with stylesheet.js) and builds its bar from these
import {boldIcon} from "./bold-icons.js"

export const TRAYS_STYLESHEET = new URL("./trays.css", import.meta.url).href

// how fast, slowest first: the icons a speed tray shows
export const SPEED_ICONS = ["snail", "turtle", "rabbit", "panicked"]

const el = (tag, className, ...children) => {
	const made = document.createElement(tag)
	if (className) made.className = className
	made.append(...children.filter(child => child != null))
	return made
}

export function trayBar(className = "") {
	return el("div", `trays ${className}`.trim())
}

export function tray(...children) {
	return el("div", "tray", ...children)
}

// a button that's an icon (or a few words, with `text`): its label for
// screen readers, its title (and key) for everyone else
export function trayButton({icon, text, label, title = label, key, onClick, className = ""}) {
	const button = el("button", `tray-button ${className}`.trim())
	button.type = "button"
	if (icon) button.append(boldIcon(icon))
	if (text) button.append(el("span", "tray-text", text))
	if (key) button.append(el("kbd", "", key))
	button.title = key ? `${title} · ${key}` : title
	button.setAttribute("aria-label", label)
	if (onClick) button.addEventListener("click", onClick)
	return button
}

// a round swatch of a colour (or anything drawn into it, with `content`)
export function swatch({colour, content, label, title = label, key, onClick, className = ""}) {
	const button = trayButton({label, title, key, onClick, className: `tray-swatch ${className}`.trim()})
	if (colour) button.style.setProperty("--c", colour)
	if (content) button.prepend(content)
	return button
}

export function press(button, on) {
	button.setAttribute("aria-pressed", String(!!on))
}

// a popover under a button: it opens from the button (and closes on a click
// outside, or Escape). `instant` opens it with no motion (from a key)
export function popover(button, ...content) {
	const panel = el("div", "tray-popover", ...content)
	panel.hidden = true
	let isOpen = false
	function place() {
		const bar = button.closest(".trays") ?? button.parentElement
		const at = button.getBoundingClientRect()
		const within = bar.getBoundingClientRect()
		const left = Math.max(4, Math.min(at.left - within.left, within.width - panel.offsetWidth - 4))
		panel.style.left = `${left}px`
		panel.style.top = `${at.bottom - within.top + 6}px`
		panel.style.setProperty("--origin", `${at.left - within.left - left + at.width / 2}px 0`)
	}
	function onOutside(event) {
		if (!panel.contains(event.target) && !button.contains(event.target)) close()
	}
	function onKey(event) {
		if (event.key === "Escape") close()
	}
	function open({instant = false} = {}) {
		if (isOpen) return
		isOpen = true
		panel.hidden = false
		panel.toggleAttribute("data-instant", instant)
		place()
		// a frame closed, then open: so it opens from the button
		panel.getBoundingClientRect()
		panel.dataset.open = ""
		press(button, true)
		document.addEventListener("pointerdown", onOutside, true)
		document.addEventListener("keydown", onKey, true)
	}
	function close() {
		if (!isOpen) return
		isOpen = false
		delete panel.dataset.open
		press(button, false)
		panel.hidden = true
		document.removeEventListener("pointerdown", onOutside, true)
		document.removeEventListener("keydown", onKey, true)
	}
	button.addEventListener("click", () => (isOpen ? close() : open()))
	return {element: panel, open, close, get isOpen() { return isOpen }}
}

// the speeds, as animals: `speeds` is [{name}…] slowest first (as many as
// SPEED_ICONS); onPick(index)
export function speedTray(speeds, onPick) {
	const buttons = speeds.map((speed, index) =>
		trayButton({icon: SPEED_ICONS[index], label: speed.name, title: `${speed.name}: how fast it goes`, onClick: () => onPick(index)}),
	)
	const element = tray(...buttons)
	element.classList.add("tray-speeds")
	return {
		element,
		set(index) {
			buttons.forEach((button, i) => press(button, i === index))
		},
	}
}
