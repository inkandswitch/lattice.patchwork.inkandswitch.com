// what the knitting's shown on, in the animation and the 3d views: the
// theme's sheet, usually, or a colour someone's picked. it's kept in the .k,
// as `background` (a #rrggbb), beside its yarns, so it travels with them, and
// both views show the same one

const isColour = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
// (dragging about in a colour picker: how long it waits, after the last
// colour, to keep it)
const KEEP_DELAY = 120

// the .k's background: a colour, or null for the theme's
export function backdropOf(doc) {
	return isColour(doc?.background) ? doc.background : null
}

// any css colour as #rrggbb, if it's one a colour input can show
function hex(colour) {
	const probe = document.createElement("canvas").getContext("2d")
	probe.fillStyle = colour
	return isColour(probe.fillStyle) ? probe.fillStyle : null
}

function storeBackdrop(handle, colour) {
	handle.change(doc => {
		if (colour) doc.background = colour
		else delete doc.background
	})
}

/**
 * a swatch for a tool's bar: click it to pick what `stage` is shown on, ×
 * to go back to the theme's. `stage` gets `data-backdrop` and the colour as
 * `--${prefix}-backdrop` (the tool's css takes it from there), and
 * `onChange()` is told, as it's picked and when someone else picks.
 * `destroy()` stops it listening
 */
export function backdropPicker({handle, stage, prefix, onChange = () => {}}) {
	const element = document.createElement("span")
	element.className = `${prefix}-backdrop`

	const label = document.createElement("label")
	label.title = "the background: pick a colour to show it on"
	const input = document.createElement("input")
	input.type = "color"
	input.setAttribute("aria-label", "background colour")
	label.append(input)

	const reset = document.createElement("button")
	reset.type = "button"
	reset.className = `${prefix}-backdrop-reset`
	reset.textContent = "×"
	reset.title = "back to the theme's background"
	reset.setAttribute("aria-label", "background: the theme's")
	reset.addEventListener("click", () => {
		clearTimeout(timer)
		pending = undefined
		storeBackdrop(handle, null)
	})
	element.append(label, reset)

	// a colour, while it's being picked: shown at once, kept once it stops
	let pending
	let timer = null
	function flush() {
		clearTimeout(timer)
		if (pending === undefined) return
		const colour = pending
		pending = undefined
		storeBackdrop(handle, colour)
	}
	input.addEventListener("input", () => {
		pending = input.value
		paint()
		clearTimeout(timer)
		timer = setTimeout(flush, KEEP_DELAY)
	})
	input.addEventListener("change", flush)

	let shown
	function paint() {
		const colour = pending !== undefined ? pending : backdropOf(handle.doc())
		if (colour === shown) return
		shown = colour
		if (colour) {
			stage.dataset.backdrop = ""
			stage.style.setProperty(`--${prefix}-backdrop`, colour)
			if (document.activeElement !== input) input.value = colour
		} else {
			delete stage.dataset.backdrop
			stage.style.removeProperty(`--${prefix}-backdrop`)
			// (the picker opens on the theme's)
			const sheet = hex(getComputedStyle(stage.parentElement ?? stage).backgroundColor)
			if (sheet) input.value = sheet
		}
		reset.hidden = !colour
		if (told) onChange(colour)
	}
	let told = false
	paint()
	told = true
	// (someone else's pick, in the same .k: or an undo)
	const onDocChange = () => paint()
	handle.on("change", onDocChange)

	return {
		element,
		destroy() {
			flush()
			handle.off("change", onDocChange)
		},
	}
}
