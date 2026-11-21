import {splice, updateText} from "@automerge/automerge"
import {checkPanel, located} from "./checks.js"
import {docText, knitoutOf, saveFile} from "./files.js"
import {builtKcode, converter} from "./kcode.js"
import {
	backAt,
	backColumn,
	codeAt,
	deleteRows,
	flipDirection,
	insertRow,
	occupancy,
	paint,
	repeatRows,
	rowsOf,
	setCarriers,
	setOption,
} from "./kniterate-rows.js"
import {YARNS_CHANGED, yarnColours, yarnPicker} from "../knitoutjs/core/yarns.js"
import {withIcon} from "../wm/ui/icons.js"
import {stylesheet} from "../wm/ui/stylesheet.js"

const STYLESHEET = new URL("./kniterate.css", import.meta.url).href
const REDRAW_DELAY = 250

// the kniterate's beds: needles 0–252 (more are drawn if a .k goes past)
const NEEDLES = 253

const OPS = {k: "knit", t: "tuck", m: "miss", s: "split", x: "transfer", d: "drop"}

// what can be painted, as the kniterate's editor has them: what each bed
// does at a needle. `key` picks it
const CODES = [
	{id: "knit-f", name: "knit front", f: "k", b: null, key: "1"},
	{id: "knit-b", name: "knit back", f: null, b: "k", key: "2"},
	{id: "knit-fb", name: "knit both", f: "k", b: "k", key: "3"},
	{id: "tuck-f", name: "tuck front", f: "t", b: null, key: "4"},
	{id: "tuck-b", name: "tuck back", f: null, b: "t", key: "5"},
	{id: "tuck-f-knit-b", name: "tuck front, knit back", f: "t", b: "k"},
	{id: "knit-f-tuck-b", name: "knit front, tuck back", f: "k", b: "t"},
	{id: "miss", name: "miss (the yarn goes by)", f: "m", b: null, key: "6"},
	{id: "xfer-fb", name: "transfer front to back", f: "x", b: null, key: "7"},
	{id: "xfer-bf", name: "transfer back to front", f: null, b: "x", key: "8"},
	{id: "drop-fb", name: "drop both", f: "d", b: "d", key: "9"},
	{id: "empty", name: "nothing (rub it out)", f: null, b: null, key: "0"},
]
const EMPTY = CODES[CODES.length - 1]

const TOOLS = [
	{id: "select", name: "select", key: "v", title: "select needles and rows (drag), and find a stitch's line (click)"},
	{id: "brush", name: "brush", key: "b", title: "paint the stitch picked below onto needles (shift click: a line from the last)"},
	{id: "line", name: "line", key: "l", title: "paint a line of it"},
	{id: "rect", name: "rect", key: "r", title: "paint a rectangle of it"},
	{id: "eraser", name: "rub out", key: "e", title: "take stitches out"},
	{id: "picker", name: "pick", key: "i", title: "pick the stitch a needle has, to paint with"},
	{id: "hand", name: "move", key: "h", title: "move round the knitting (or hold space, or scroll)"},
]
const PAINTS = new Set(["brush", "line", "rect", "eraser"])

// how it's coloured: by stitch, by yarn, by a row's setting, or by the loops
// each needle holds after it
const VIEWS = [
	{id: "stitch", name: "stitches"},
	{id: "yarn", name: "yarns"},
	{id: "speed", name: "speed"},
	{id: "roller", name: "roller"},
	{id: "stitch-size", name: "stitch size"},
	{id: "loops", name: "loops held"},
]

// the gutter's option columns, as the kniterate's editor has them beside its
// rows. narrow panes keep only the first few. `edit`: what clicking one does
const COLUMNS = [
	{id: "row", label: "row", width: 38, align: "right"},
	{id: "dir", label: "", width: 16, edit: "flip"},
	{id: "yarn", label: "yarn", width: 30, edit: "carriers"},
	{id: "kind", label: "type", width: 40},
	{id: "stitch", label: "stitch", width: 40, edit: "stitch"},
	{id: "speed", label: "speed", width: 42, edit: "speed"},
	{id: "roller", label: "roller", width: 44, edit: "roller"},
	{id: "rack", label: "rack", width: 38, edit: "rack"},
]
const NARROW = 3
// rows shorter than this have no room for words, only arrows and yarns
const TEXT_ROW = 10
const RULER = 18
const LEVELS = {error: 0, risk: 1, note: 2}

// which line of the .js wrote each line of a .k (its ";!source:24")
function jsLinesOf(text) {
	return text.split("\n").map(line => {
		const match = line.match(/;!source:(-?\d+)/)
		return match ? Number(match[1]) : null
	})
}

function button(text, title, onClick) {
	const element = document.createElement("button")
	element.className = "knitout-button"
	element.textContent = text
	element.title = title
	element.addEventListener("click", onClick)
	return element
}

function group(className, ...children) {
	const element = document.createElement("div")
	element.className = className
	element.append(...children)
	return element
}

// the cells of a line from one to another (each needle and row it crosses)
function lineCells(a, b) {
	const out = []
	let [x, y] = [a.col, a.row]
	const dx = Math.abs(b.col - x)
	const dy = -Math.abs(b.row - y)
	const sx = x < b.col ? 1 : -1
	const sy = y < b.row ? 1 : -1
	let err = dx + dy
	for (;;) {
		out.push({row: y, col: x})
		if (x === b.col && y === b.row) break
		const e2 = 2 * err
		if (e2 >= dy) {
			err += dy
			x += sx
		}
		if (e2 <= dx) {
			err += dx
			y += sy
		}
	}
	return out
}

const ordered = (a, b) => (a <= b ? [a, b] : [b, a])

/**
 * a .k the way the kniterate's own editor draws a design: a row for each pass
 * of the carriage as the knitout has it (the first at the bottom), and in each
 * a cell for each needle, split in two: what the front bed does there below,
 * and what the back bed's needle across from it does above (moved over as the
 * bed's racked). each row's options (way, yarn, type, stitch, speed, roller,
 * rack) are down the side.
 *
 * a .k that's text (not one a .js writes, stored whole) can be edited here as
 * in the kniterate's editor: painted with stitches, its rows' options
 * changed, rows put in, repeated and taken out, needles copied, pasted,
 * mirrored and flipped. each edit is a splice of the .k's knitout, so it's
 * there in the text editor too, and anyone else's edits merge with it.
 *
 * like the visualiser it sends knitout:hover-source, knitout:select-source and
 * knitout:goto-source (a needle knows the line it's knitted by), and lights
 * up the needles knitted by the lines in knitout:highlight-lines events
 */
export default function KniterateTool(handle, element, context = {}) {
	const events = context.events ?? element

	const root = document.createElement("div")
	root.className = "kniterate"
	const link = stylesheet(STYLESHEET, root)
	element.append(link, root)

	// ── the toolbar: which side to look from, the yarns, how it's coloured,
	//    and the buttons

	const bar = document.createElement("div")
	bar.className = "kniterate-bar"
	root.appendChild(bar)

	const frontButton = button("front", "look at the front bed, as you'd stand at the machine", () => setSide("front"))
	const rearButton = button("rear", "look from behind the machine", () => setSide("rear"))
	const sides = group("kniterate-sides", frontButton, rearButton)

	const yarns = yarnPicker({handle})

	const viewSelect = document.createElement("select")
	viewSelect.className = "kniterate-view"
	viewSelect.title = "colour the needles by"
	for (const each of VIEWS) viewSelect.append(new Option(each.name, each.id))
	viewSelect.addEventListener("change", () => {
		mode = viewSelect.value
		showLegend()
		requestDraw()
	})

	const spacer = document.createElement("div")
	spacer.className = "kniterate-spacer"

	// what the converter warned about, if anything
	const warningsBadge = document.createElement("span")
	warningsBadge.className = "kniterate-warnings"
	warningsBadge.hidden = true

	bar.append(
		sides,
		yarns.element,
		viewSelect,
		spacer,
		warningsBadge,
		withIcon(
			"fit",
			button("fit", "fit the knitting in view (or the selection, if there is one: z) · scroll to move round, pinch or ctrl+scroll to zoom", () => {
				if (selection) zoomTo(selection)
				else fit()
				requestDraw()
			}),
		),
		withIcon("download", button("export kcode", "save this as a .kc file: kcode, the format a Kniterate machine reads", exportKcode)),
	)

	// ── the editing bar: tools, what to paint, and what to do with what's
	//    selected (only for a .k that's text)

	const editBar = document.createElement("div")
	editBar.className = "kniterate-edit"
	root.appendChild(editBar)

	const toolButtons = new Map()
	const toolGroup = group("kniterate-tools")
	for (const each of TOOLS) {
		const element = button(each.name, `${each.title} (${each.key})`, () => setTool(each.id))
		element.dataset.tool = each.id
		toolButtons.set(each.id, element)
		toolGroup.append(element)
	}

	const codeButtons = new Map()
	const palette = group("kniterate-palette")
	for (const code of CODES) {
		const element = document.createElement("button")
		element.className = "kniterate-swatch"
		element.title = code.name + (code.key ? ` (${code.key})` : "")
		element.setAttribute("aria-label", code.name)
		const swatch = document.createElement("canvas")
		swatch.width = swatch.height = 20 * devicePixelRatio
		element.append(swatch)
		element.addEventListener("click", () => setCode(code))
		codeButtons.set(code.id, {element, swatch, code})
		palette.append(element)
	}

	const undoButton = button("undo", "undo what you last did here (ctrl+z)", () => undo())
	const redoButton = button("redo", "redo it (ctrl+shift+z)", () => redo())
	const historyGroup = group("kniterate-actions", undoButton, redoButton)

	const clip = group(
		"kniterate-actions",
		button("copy", "copy the selected needles (ctrl+c)", () => copy()),
		button("cut", "cut them (ctrl+x)", () => cut()),
		button("paste", "paste at the selection, or the needle under the pointer (ctrl+v; ctrl+shift+v to tile it over the selection)", () => pasteAt()),
		button("fill", "fill the selection with the stitch picked (f)", () => fillSelection(code)),
	)
	const shape = group(
		"kniterate-actions",
		button("mirror", "mirror the selection left to right", () => transform("mirror")),
		button("flip", "flip the selection's rows upside down", () => transform("flip")),
		button("swap beds", "swap the selection's front and back beds", () => transform("beds")),
	)
	const rowActions = group(
		"kniterate-actions",
		button("+ row", "put in an empty row above the selected one (going the other way)", () => rowsDo("insert")),
		button("+ xfer row", "put in an empty transfer row above", () => rowsDo("insert-xfer")),
		button("repeat", "repeat the selected rows above them", () => rowsDo("repeat")),
		button("turn", "knit the selected rows the other way", () => rowsDo("flip")),
		button("− rows", "take the selected rows out", () => rowsDo("delete")),
	)
	editBar.append(toolGroup, palette, historyGroup, clip, shape, rowActions)

	// a .k a .js writes is stored whole: it's read only, but can be copied
	const readOnly = document.createElement("div")
	readOnly.className = "kniterate-readonly"
	const readOnlyText = document.createElement("span")
	readOnlyText.textContent = "read only: a pattern writes this file. select and copy, or edit a copy"
	readOnly.append(
		readOnlyText,
		withIcon("pencil", button("make an editable copy", "make a copy of this .k as text you can paint on", editableCopy)),
	)
	root.appendChild(readOnly)

	const stage = document.createElement("div")
	stage.className = "kniterate-stage"
	root.appendChild(stage)

	const canvas = document.createElement("canvas")
	canvas.tabIndex = 0
	stage.appendChild(canvas)
	const ctx = canvas.getContext("2d")

	const tooltip = document.createElement("div")
	tooltip.className = "kniterate-tooltip"
	tooltip.hidden = true
	stage.appendChild(tooltip)

	const legend = document.createElement("div")
	legend.className = "kniterate-legend"
	stage.appendChild(legend)

	// an option being typed in, over its cell in the gutter
	const optionInput = document.createElement("input")
	optionInput.className = "kniterate-option-input"
	optionInput.hidden = true
	stage.appendChild(optionInput)

	// will it knit: what the check found, each problem's line picked in the
	// editors and shown here
	const panel = checkPanel(
		stage,
		problem => {
			if (problem.line == null) return
			dispatch("knitout:select-source", located(handle, {kLine: problem.line, jsLine: jsLines[problem.line - 1]}))
			const spot = cellOfLine(problem.line - 1)
			if (spot) {
				selection = {rows: [spot.row, spot.row], cols: [spot.col, spot.col]}
				reveal(spot)
				requestDraw()
			}
		},
		{handle, context, onResult: onChecked},
	)
	bar.insertBefore(panel.button, warningsBadge)

	const empty = document.createElement("div")
	empty.className = "kniterate-empty"
	empty.textContent = "no rows yet"
	stage.appendChild(empty)

	const status = document.createElement("div")
	status.className = "kniterate-status"
	root.appendChild(status)

	const errorBar = document.createElement("div")
	errorBar.className = "kniterate-error"
	errorBar.hidden = true
	root.appendChild(errorBar)

	const HINT_EDIT =
		"pick a stitch and paint with it · click a row's options to change them · drag to select, then copy, paste, mirror · space drag or scroll to move round"
	const HINT_READ = "point at a needle to see what it does · click to find its line · double click to put the cursor there"

	// ── colours: the theme's, read off the page so the canvas can use them

	const probe = document.createElement("span")
	probe.className = "kniterate-probe"
	root.appendChild(probe)

	function resolve(value) {
		probe.style.color = ""
		probe.style.color = value
		return getComputedStyle(probe).color
	}

	let colours = null
	function readColours() {
		const ramp = []
		for (let i = 0; i <= 10; i++) {
			ramp.push(resolve(`color-mix(in oklab, var(--kniterate-accent) ${8 + i * 9}%, var(--kniterate-sheet))`))
		}
		colours = {
			sheet: resolve("var(--kniterate-sheet)"),
			ink: resolve("var(--kniterate-ink)"),
			muted: resolve("var(--kniterate-muted)"),
			grid: resolve("var(--kniterate-line-soft)"),
			chrome: resolve("var(--kniterate-chrome)"),
			highlight: resolve("var(--kniterate-highlighter)"),
			accent: resolve("var(--kniterate-accent)"),
			danger: resolve("var(--kniterate-danger)"),
			risk: resolve("var(--kniterate-risk)"),
			ops: {
				k: resolve("var(--kniterate-knit)"),
				t: resolve("var(--kniterate-tuck)"),
				m: resolve("var(--kniterate-miss)"),
				s: resolve("var(--kniterate-split)"),
				x: resolve("var(--kniterate-xfer)"),
				d: resolve("var(--kniterate-drop)"),
			},
			ramp,
			mono: getComputedStyle(root).getPropertyValue("--kniterate-mono").trim() || "monospace",
			yarns: yarnColours(handle.doc()),
		}
		drawSwatches()
		showLegend()
	}

	const scheme = matchMedia("(prefers-color-scheme: dark)")
	function onScheme() {
		readColours()
		requestDraw()
	}
	scheme.addEventListener("change", onScheme)
	addEventListener(YARNS_CHANGED, onScheme)

	// ── what's drawn, and from where

	let model = rowsOf("")
	let rows = []
	let jsLines = []
	let loops = null // occupancy(model), when it's wanted
	let problems = [] // the check's, each {level, text, at: [{row, col, back}]}
	// (null until the doc's been read: then whether its text can be changed)
	let editable = null
	let side = "front"
	let mode = "stitch"
	let tool = "select"
	let code = CODES[0]
	let selection = null // {rows: [a, b], cols: [a, b] | null (all of them)}
	let clipboard = null // {rows: [[{f, b}]], width}
	let preview = null // Map(row → Map(col → code)): a stroke, before it's made
	let spaceHeld = false
	// view.left: the column at the grid's left edge; view.bottom: the row at
	// its bottom edge; view.cell: a needle's size in css pixels
	const view = {left: 0, bottom: 0, cell: 12}
	let fitted = false
	let hovered = null // {row, col?, back?, gutter?}
	let highlighted = null // {local, start, end}
	let size = {width: 0, height: 0}

	const rear = () => side === "rear"
	// the columns there are: the bed's, or as far as the .k goes past it
	const bed = () => {
		const [min, max] = model.range ?? [0, NEEDLES - 1]
		return [Math.min(0, min), Math.max(NEEDLES - 1, max)]
	}
	// where a column is across the screen (in cells, from the bed's left as
	// it's looked at): turned round, from behind
	function screenOf(col) {
		const [min, max] = bed()
		return rear() ? max - col : col - min
	}
	function colOf(screen) {
		const [min, max] = bed()
		return rear() ? max - screen : screen + min
	}

	function setSide(next) {
		const middle = colOf(view.left + (size.width - gutter()) / view.cell / 2)
		side = next
		frontButton.toggleAttribute("data-on", side === "front")
		rearButton.toggleAttribute("data-on", side === "rear")
		view.left = screenOf(middle) - (size.width - gutter()) / view.cell / 2
		requestDraw()
	}

	function setTool(next) {
		if (!editable && next !== "select" && next !== "hand") return
		tool = next
		for (const [id, element] of toolButtons) element.toggleAttribute("data-on", id === tool)
		canvas.dataset.tool = tool
	}

	function setCode(next) {
		code = next
		for (const [id, {element}] of codeButtons) element.toggleAttribute("data-on", id === code.id)
		if (!PAINTS.has(tool) || tool === "eraser") setTool("brush")
	}

	function columns() {
		if (view.cell < TEXT_ROW) return COLUMNS.filter(col => col.id === "dir" || col.id === "yarn")
		return size.width < 560 ? COLUMNS.slice(0, NARROW) : COLUMNS
	}
	function gutter() {
		return columns().reduce((sum, col) => sum + col.width, 0) + 6
	}

	function fit() {
		const [min, max] = model.range ?? [0, NEEDLES - 1]
		fitTo([0, Math.max(rows.length - 1, 0)], [min, max])
	}
	function fitTo([r0, r1], [c0, c1]) {
		const width = size.width - gutter()
		const height = size.height - RULER
		const span = c1 - c0 + 1 + 6
		view.cell = Math.max(2, Math.min(32, width / span, height / Math.max(r1 - r0 + 1 + 2, 1)))
		const shown = width / view.cell
		const middle = (screenOf(c0) + screenOf(c1) + 1) / 2
		view.left = middle - shown / 2
		view.bottom = r0 - 1
		clampView()
	}
	function zoomTo(sel) {
		const cols = sel.cols ?? model.range ?? [0, NEEDLES - 1]
		fitTo(sel.rows, cols)
	}
	// scrolled so a cell's in view
	function reveal({row, col}) {
		const width = (size.width - gutter()) / view.cell
		const height = (size.height - RULER) / view.cell
		const x = screenOf(col)
		if (x < view.left + 1 || x > view.left + width - 2) view.left = x - width / 2
		if (row < view.bottom + 1 || row > view.bottom + height - 2) view.bottom = row - height / 2
		clampView()
	}

	function clampView() {
		const [min, max] = bed()
		const width = (size.width - gutter()) / view.cell
		const height = (size.height - RULER) / view.cell
		view.left = Math.max(-width / 2, Math.min(max - min + 1 - width / 2, view.left))
		view.bottom = Math.max(-height / 2, Math.min(rows.length - height / 2, view.bottom))
	}

	// screen ↔ grid
	const gridBottom = () => size.height - RULER
	const xOf = screen => gutter() + (screen - view.left) * view.cell
	// the top of a row
	const yOf = row => gridBottom() - (row - view.bottom + 1) * view.cell
	function at(x, y) {
		if (y > gridBottom()) return null
		const fraction = view.bottom + (gridBottom() - y) / view.cell
		const row = Math.floor(fraction)
		if (row < 0 || row >= rows.length) return null
		if (x < gutter()) return {row, gutter: gutterColumn(x)}
		const screen = Math.floor(view.left + (x - gutter()) / view.cell)
		// the upper half of a cell is the far bed's
		const far = fraction - row >= 0.5
		const back = rear() ? !far : far
		return {row, col: colOf(screen), back}
	}
	function gutterColumn(x) {
		let left = 0
		for (const col of columns()) {
			if (x < left + col.width) return {...col, left}
			left += col.width
		}
		return null
	}

	// ── drawing

	let frame = 0
	function requestDraw() {
		if (!frame) frame = requestAnimationFrame(draw)
	}

	function resize() {
		const rect = canvas.getBoundingClientRect()
		size = {width: rect.width, height: rect.height}
		canvas.width = Math.round(rect.width * devicePixelRatio)
		canvas.height = Math.round(rect.height * devicePixelRatio)
		if (!fitted && rows.length) {
			fit()
			fitted = true
		}
		draw()
	}

	const yarnOf = row => {
		const carrier = row.carriers?.split(" ")[0]
		return carrier ? (colours.yarns[Number(carrier) - 1] ?? colours.ink) : colours.ink
	}

	function isHighlighted(line) {
		if (!highlighted || line == null) return false
		const at = highlighted.local ? line + 1 : jsLines[line]
		return at != null && at >= highlighted.start && at <= highlighted.end
	}
	function rowHighlighted(row) {
		if (!highlighted) return false
		for (const cells of [row.front, row.back]) for (const cell of cells.values()) if (isHighlighted(cell.line)) return true
		return false
	}

	function draw() {
		frame = 0
		if (!colours) readColours()
		const {width, height} = size
		ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
		ctx.fillStyle = colours.sheet
		ctx.fillRect(0, 0, width, height)
		if (!rows.length || !width) return

		const s = view.cell
		const left = gutter()
		const bottom = gridBottom()
		const first = Math.max(0, Math.floor(view.bottom))
		const last = Math.min(rows.length - 1, Math.ceil(view.bottom + bottom / s))
		const [min, max] = bed()

		ctx.save()
		ctx.beginPath()
		ctx.rect(left, 0, width - left, bottom)
		ctx.clip()

		// the bed itself, a shade off the sheet outside it
		ctx.fillStyle = colours.chrome
		ctx.fillRect(left, 0, width - left, bottom)
		ctx.fillStyle = colours.sheet
		ctx.fillRect(xOf(0), 0, (max - min + 1) * s, bottom)

		for (let r = first; r <= last; r++) drawRow(rows[r], r)

		drawGrid(first, last)
		drawSelection()
		drawProblems(first, last)
		drawCrosshair()
		ctx.restore()

		drawGutter(first, last)
		drawRuler()
	}

	// a row's band (its highlight, its setting's colour), and its needles
	function drawRow(row, r) {
		const s = view.cell
		const top = yOf(r)
		const left = gutter()
		if (rowHighlighted(row)) {
			ctx.fillStyle = colours.highlight
			ctx.fillRect(left, top, size.width, s)
		}
		const setting = {speed: "speed", roller: "roller", "stitch-size": "stitch"}[mode]
		if (setting) {
			ctx.fillStyle = rampOf(setting, row[setting])
			ctx.fillRect(left, top, size.width, s)
		}
		const yarn = yarnOf(row)
		const strokeRow = preview?.get(r)
		const cols = new Set()
		for (const n of row.front.keys()) cols.add(n)
		for (const n of row.back.keys()) cols.add(backColumn(row, n))
		if (strokeRow) for (const col of strokeRow.keys()) cols.add(col)
		const held = mode === "loops" ? loopsOf(r) : null
		if (held) {
			for (const [isBack, needles] of [
				[false, held.front],
				[true, held.back],
			]) {
				for (const [n, count] of needles) drawLoops(row, isBack, n, top, count)
			}
		}
		for (const col of cols) {
			const painted = strokeRow?.get(col)
			if (painted) {
				drawHalf(row, false, col, top, painted.f, yarn, null, 0.8)
				drawHalf(row, true, backAt(row, col), top, painted.b, yarn, null, 0.8)
				continue
			}
			const front = row.front.get(col)
			if (front) drawHalf(row, false, col, top, front.op, yarn, front.line)
			const back = row.back.get(backAt(row, col))
			if (back) drawHalf(row, true, backAt(row, col), top, back.op, yarn, back.line)
		}
	}

	function loopsOf(r) {
		loops ??= occupancy(model)
		return loops[r]
	}

	// value → a colour along the ramp, between the least and most there is
	const ranges = {}
	function rampOf(setting, value) {
		const range = (ranges[setting] ??= (() => {
			let lo = Infinity
			let hi = -Infinity
			for (const row of rows) {
				const v = Number(row[setting])
				if (Number.isFinite(v)) {
					lo = Math.min(lo, v)
					hi = Math.max(hi, v)
				}
			}
			return [lo, hi]
		})())
		const v = Number(value)
		if (!Number.isFinite(v) || !Number.isFinite(range[0])) return colours.ramp[0]
		const t = range[1] > range[0] ? (v - range[0]) / (range[1] - range[0]) : 0.5
		return colours.ramp[Math.round(t * 10)]
	}

	// the half of a cell a bed's needle is: the near bed's below, the far's
	// above (moved over as the beds are racked)
	function half(row, back, n, top) {
		const s = view.cell
		const at = back ? n + row.rack : n
		const x = xOf(screenOf(at))
		const near = back === rear()
		return {x, y: near ? top + s / 2 : top, w: s, h: s / 2, near}
	}

	function drawLoops(row, back, n, top, count) {
		const {x, y, w, h} = half(row, back, n, top)
		ctx.fillStyle = count >= 3 ? colours.danger : colours.ramp[count >= 2 ? 8 : 4]
		ctx.fillRect(x, y, w, h)
	}

	// a needle's stitch in its half: knitting fills it, a tuck is a V, a miss
	// a dash, a transfer an arrow to the other bed, a drop a cross
	function drawHalf(row, back, n, top, op, yarn, line, alpha = 1) {
		if (!op) {
			if (alpha < 1) {
				// rubbing out, before it's done
				const {x, y, w, h} = half(row, back, n, top)
				ctx.strokeStyle = colours.muted
				ctx.setLineDash([2, 2])
				ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3)
				ctx.setLineDash([])
			}
			return
		}
		const {x, y, w, h, near} = half(row, back, n, top)
		const s = view.cell
		const fill = mode === "yarn" ? yarn : mode === "stitch" ? colours.ops[op] : yarn
		const glyphMode = mode === "loops" || mode === "speed" || mode === "roller" || mode === "stitch-size"
		ctx.globalAlpha = alpha
		if (isHighlighted(line)) {
			ctx.fillStyle = colours.highlight
			ctx.fillRect(x, y, w, h)
		}
		const pad = s >= 10 ? 1 : 0
		if (s < 5) {
			ctx.fillStyle = fill
			ctx.fillRect(x, y, w, h)
			ctx.globalAlpha = 1
			return
		}
		if ((op === "k" || op === "s") && mode === "loops") {
			// the loops' colour is what's to see: the knitting's an outline
			ctx.strokeStyle = yarn
			ctx.lineWidth = 1
			ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3)
		} else if (op === "k" || op === "s") {
			ctx.fillStyle = fill
			if (glyphMode) ctx.globalAlpha = alpha * 0.55
			ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2)
			ctx.globalAlpha = alpha
			if (!near && s >= 8) {
				// a purl, seen from this side: a bar across
				ctx.fillStyle = colours.sheet
				ctx.globalAlpha = alpha * 0.6
				ctx.fillRect(x + w * 0.2, y + h * 0.42, w * 0.6, Math.max(1, h * 0.16))
				ctx.globalAlpha = alpha
			}
		}
		if (op === "t") {
			ctx.strokeStyle = fill
			ctx.lineWidth = Math.max(1, s * 0.1)
			ctx.lineCap = "round"
			ctx.beginPath()
			ctx.moveTo(x + w * 0.22, y + h * 0.18)
			ctx.lineTo(x + w * 0.5, y + h * 0.82)
			ctx.lineTo(x + w * 0.78, y + h * 0.18)
			ctx.stroke()
		}
		if (op === "m") {
			ctx.fillStyle = mode === "stitch" ? colours.ops.m : yarn
			ctx.fillRect(x + w * 0.15, y + h / 2 - Math.max(0.5, h * 0.08), w * 0.7, Math.max(1, h * 0.16))
		}
		if (op === "x" || op === "s") {
			// towards the other bed: up from the near one, down from the far
			const way = near ? -1 : 1
			const cx = x + w / 2
			const tip = y + h / 2 + way * h * 0.4
			const tail = y + h / 2 - way * h * 0.4
			ctx.strokeStyle = op === "x" ? (mode === "stitch" ? colours.ops.x : colours.ink) : colours.sheet
			ctx.fillStyle = ctx.strokeStyle
			ctx.lineWidth = Math.max(1, s * 0.08)
			ctx.beginPath()
			ctx.moveTo(cx, tail)
			ctx.lineTo(cx, tip)
			ctx.stroke()
			ctx.beginPath()
			ctx.moveTo(cx, tip + way * 1)
			ctx.lineTo(cx - w * 0.2, tip - way * h * 0.35)
			ctx.lineTo(cx + w * 0.2, tip - way * h * 0.35)
			ctx.closePath()
			ctx.fill()
		}
		if (op === "d") {
			ctx.strokeStyle = mode === "stitch" ? colours.ops.d : colours.danger
			ctx.lineWidth = Math.max(1, s * 0.09)
			const m = Math.min(w, h) * 0.3
			const cx = x + w / 2
			const cy = y + h / 2
			ctx.beginPath()
			ctx.moveTo(cx - m, cy - m)
			ctx.lineTo(cx + m, cy + m)
			ctx.moveTo(cx + m, cy - m)
			ctx.lineTo(cx - m, cy + m)
			ctx.stroke()
		}
		ctx.globalAlpha = 1
	}

	// every needle when there's room, every tenth always (and the bed's
	// middle); a line between each row's beds
	function drawGrid(first, last) {
		const s = view.cell
		const left = gutter()
		const bottom = gridBottom()
		const [min, max] = bed()
		const firstScreen = Math.max(0, Math.floor(view.left))
		const lastScreen = Math.min(max - min + 1, Math.ceil(view.left + (size.width - left) / s))
		ctx.fillStyle = colours.grid
		for (let screen = firstScreen; screen <= lastScreen; screen++) {
			// the line on the left of this screen column: between two needles
			const col = rear() ? colOf(screen) + 1 : colOf(screen)
			if (s < 6 && col % 10) continue
			ctx.globalAlpha = col % 10 ? 0.5 : 1
			ctx.fillRect(Math.round(xOf(screen)), 0, 1, bottom)
		}
		for (let r = first; r <= last + 1; r++) {
			if (s < 6 && r % 10) continue
			ctx.globalAlpha = r % 10 ? 0.6 : 1
			ctx.fillRect(left, Math.round(yOf(r) + s), size.width - left, 1)
		}
		if (s >= 10) {
			ctx.globalAlpha = 0.25
			for (let r = first; r <= last; r++) ctx.fillRect(left, Math.round(yOf(r) + s / 2), size.width - left, 1)
		}
		// the middle of the bed
		ctx.globalAlpha = 0.6
		ctx.fillStyle = colours.accent
		const middle = xOf(screenOf((NEEDLES - 1) / 2) + 0.5)
		for (let y = 0; y < bottom; y += 6) ctx.fillRect(Math.round(middle), y, 1, 3)
		ctx.globalAlpha = 1
	}

	// the selection's outline, a wash over it, and the rows it takes
	function drawSelection() {
		if (!selection) return
		const s = view.cell
		const [r0, r1] = selection.rows
		const top = yOf(r1)
		const height = (r1 - r0 + 1) * s
		let x
		let w
		if (selection.cols) {
			const [c0, c1] = selection.cols
			const a = xOf(screenOf(c0))
			const b = xOf(screenOf(c1))
			x = Math.min(a, b)
			w = Math.abs(b - a) + s
		} else {
			x = gutter()
			w = size.width - gutter()
		}
		ctx.fillStyle = colours.accent
		ctx.globalAlpha = 0.1
		ctx.fillRect(x, top, w, height)
		ctx.globalAlpha = 1
		ctx.strokeStyle = colours.accent
		ctx.lineWidth = 1.5
		ctx.setLineDash([4, 3])
		ctx.strokeRect(x + 0.75, top + 0.75, w - 1.5, height - 1.5)
		ctx.setLineDash([])
	}

	// where the check found something: a ring round the needle, and a line
	// to the one it's to do with (where a hold began, say)
	function drawProblems(first, last) {
		const s = view.cell
		for (const problem of problems) {
			const colour = problem.level === "error" ? colours.danger : problem.level === "risk" ? colours.risk : colours.muted
			const points = []
			for (const spot of problem.at) {
				const row = rows[spot.row]
				if (!row) continue
				const {x, y, w, h} = half(row, spot.back, spot.n, yOf(spot.row))
				points.push({x: x + w / 2, y: y + h / 2, visible: spot.row >= first - 1 && spot.row <= last + 1})
			}
			if (!points.some(point => point.visible)) continue
			ctx.strokeStyle = colour
			ctx.lineWidth = Math.max(1.5, s * 0.12)
			if (points.length > 1) {
				ctx.globalAlpha = 0.7
				ctx.setLineDash([3, 3])
				ctx.beginPath()
				ctx.moveTo(points[0].x, points[0].y)
				ctx.lineTo(points[1].x, points[1].y)
				ctx.stroke()
				ctx.setLineDash([])
				ctx.globalAlpha = 1
			}
			points.forEach((point, i) => {
				ctx.beginPath()
				ctx.arc(point.x, point.y, Math.max(3, s * (i ? 0.35 : 0.55)), 0, Math.PI * 2)
				if (i) ctx.setLineDash([2, 2])
				ctx.stroke()
				ctx.setLineDash([])
			})
		}
	}

	// the needle and row under the pointer, across the grid
	function drawCrosshair() {
		if (!hovered || hovered.gutter || hovered.col == null) return
		const s = view.cell
		const x = xOf(screenOf(hovered.col))
		ctx.fillStyle = colours.ink
		ctx.globalAlpha = 0.06
		ctx.fillRect(x, 0, s, gridBottom())
		ctx.fillRect(gutter(), yOf(hovered.row), size.width, s)
		ctx.globalAlpha = 1
		ctx.strokeStyle = colours.ink
		ctx.lineWidth = 1.5
		const row = rows[hovered.row]
		if (!row) return
		const {x: hx, y, w, h} = half(row, hovered.back, hovered.back ? backAt(row, hovered.col) : hovered.col, yOf(hovered.row))
		ctx.strokeRect(hx + 0.75, y + 0.75, w - 1.5, h - 1.5)
	}

	function drawGutter(first, last) {
		const s = view.cell
		const width = gutter()
		const bottom = gridBottom()
		ctx.save()
		ctx.beginPath()
		ctx.rect(0, 0, width, bottom)
		ctx.clip()
		ctx.fillStyle = colours.chrome
		ctx.fillRect(0, 0, width, bottom)

		const text = s >= TEXT_ROW
		ctx.font = `${Math.min(11, s - 1)}px ${colours.mono}`
		ctx.textBaseline = "middle"
		const worst = worstByRow()
		for (let r = first; r <= last; r++) {
			const row = rows[r]
			const top = yOf(r)
			const middle = top + s / 2
			const selected = selection && r >= selection.rows[0] && r <= selection.rows[1]
			if (rowHighlighted(row)) {
				ctx.fillStyle = colours.highlight
				ctx.fillRect(0, top, width, s)
			} else if (selected) {
				ctx.fillStyle = colours.accent
				ctx.globalAlpha = 0.18
				ctx.fillRect(0, top, width, s)
				ctx.globalAlpha = 1
			} else if (hovered?.row === r) {
				ctx.fillStyle = colours.grid
				ctx.fillRect(0, top, width, s)
			}
			let x = 0
			for (const col of columns()) {
				drawOption(col, row, x, top, s, middle, text)
				x += col.width
			}
			// what the check found in the row, by the row's number
			const level = worst.get(r)
			if (level != null) {
				ctx.fillStyle = level === 0 ? colours.danger : level === 1 ? colours.risk : colours.muted
				ctx.beginPath()
				ctx.arc(5, middle, Math.min(3, s * 0.3), 0, Math.PI * 2)
				ctx.fill()
			}
			if (s >= 6) {
				ctx.fillStyle = colours.grid
				ctx.fillRect(0, Math.round(top + s), width, 1)
			}
		}
		ctx.fillStyle = colours.grid
		ctx.fillRect(width - 1, 0, 1, bottom)
		ctx.restore()
	}

	let worstCache = null
	function worstByRow() {
		if (worstCache) return worstCache
		worstCache = new Map()
		for (const problem of problems) {
			for (const spot of problem.at.slice(0, 1)) {
				const level = LEVELS[problem.level] ?? 2
				if (!worstCache.has(spot.row) || worstCache.get(spot.row) > level) worstCache.set(spot.row, level)
			}
		}
		return worstCache
	}

	function kindOf(row) {
		if (row.kind !== "knit") return row.kind
		const ops = new Set()
		for (const cells of [row.front, row.back]) for (const cell of cells.values()) ops.add(cell.op)
		if (!ops.size) return "empty"
		if (ops.size === 1) return OPS[[...ops][0]]
		return [...ops].filter(op => op !== "m").map(op => OPS[op]).join("/")
	}

	function drawOption(col, row, x, top, s, middle, text) {
		const emptyRow = !row.front.size && !row.back.size
		const ink = emptyRow ? colours.muted : colours.ink
		if (col.id === "dir") {
			if (!row.dir) return
			// the way the carriage goes, from where you're looking
			const right = (row.dir === "+") !== rear()
			const cx = x + col.width / 2
			const half = Math.min(5, s * 0.35)
			ctx.fillStyle = ink
			ctx.beginPath()
			ctx.moveTo(cx + (right ? half : -half), middle)
			ctx.lineTo(cx - (right ? half : -half), middle - half)
			ctx.lineTo(cx - (right ? half : -half), middle + half)
			ctx.closePath()
			ctx.fill()
			return
		}
		if (col.id === "yarn") {
			if (!row.carriers) return
			ctx.fillStyle = yarnOf(row)
			const inset = s >= 8 ? 2 : 0
			ctx.fillRect(x + 3, top + inset, col.width - 6, s - inset * 2)
			if (text) {
				ctx.fillStyle = colours.sheet
				ctx.textAlign = "center"
				ctx.fillText(row.carriers.replace(/ /g, ""), x + col.width / 2, middle + 0.5)
			}
			return
		}
		if (!text) return
		const value = {
			row: String(row.index + 1),
			kind: kindOf(row),
			stitch: row.kind === "knit" ? row.stitch : "",
			speed: row.speed,
			roller: row.roller,
			rack: row.rack ? String(row.rack) : "",
		}[col.id]
		ctx.fillStyle = col.id === "row" ? colours.muted : ink
		ctx.textAlign = col.align === "right" ? "right" : "left"
		// (kept to its column)
		ctx.save()
		ctx.beginPath()
		ctx.rect(x, top, col.width - 2, s)
		ctx.clip()
		ctx.fillText(value, col.align === "right" ? x + col.width - 6 : x + 4, middle + 0.5)
		ctx.restore()
	}

	// needle numbers (every tenth darker), and the gutter's column names
	function drawRuler() {
		const s = view.cell
		const top = gridBottom()
		ctx.fillStyle = colours.chrome
		ctx.fillRect(0, top, size.width, RULER)
		ctx.fillStyle = colours.grid
		ctx.fillRect(0, top, size.width, 1)

		ctx.font = `10px ${colours.mono}`
		ctx.textBaseline = "middle"
		ctx.fillStyle = colours.muted
		let x = 0
		for (const col of columns()) {
			ctx.textAlign = col.align === "right" ? "right" : "left"
			ctx.fillText(col.label, col.align === "right" ? x + col.width - 6 : x + 4, top + RULER / 2)
			x += col.width
		}

		const every = s >= 22 ? 1 : s >= 10 ? 5 : s >= 4 ? 10 : 20
		const [min, max] = bed()
		ctx.save()
		ctx.beginPath()
		ctx.rect(gutter(), top, size.width - gutter(), RULER)
		ctx.clip()
		ctx.textAlign = "center"
		const firstScreen = Math.max(0, Math.floor(view.left))
		const lastScreen = Math.min(max - min, Math.ceil(view.left + (size.width - gutter()) / s))
		for (let screen = firstScreen; screen <= lastScreen; screen++) {
			const needle = colOf(screen)
			const pointed = hovered?.col === needle
			if (needle % every && !pointed) continue
			if (pointed) {
				ctx.fillStyle = colours.accent
				ctx.fillRect(xOf(screen), top + 1, s, RULER - 1)
			}
			ctx.fillStyle = pointed ? colours.sheet : needle % 10 ? colours.muted : colours.ink
			ctx.fillText(String(needle), xOf(screen) + s / 2, top + RULER / 2)
		}
		ctx.restore()
	}

	// the palette's swatches, drawn as the cells are
	function drawSwatches() {
		if (!colours) return
		for (const {swatch, code: each} of codeButtons.values()) {
			const c = swatch.getContext("2d")
			const s = 20
			c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
			c.clearRect(0, 0, s, s)
			c.fillStyle = colours.sheet
			c.fillRect(0, 0, s, s)
			c.fillStyle = colours.grid
			c.fillRect(0, s / 2, s, 1)
			drawSwatch(c, each, s)
		}
	}
	function drawSwatch(c, each, s) {
		const halves = [
			[each.b, 0, false],
			[each.f, s / 2, true],
		]
		for (const [op, y, near] of halves) {
			if (!op) continue
			const fill = colours.ops[op]
			const h = s / 2
			if (op === "k") {
				c.fillStyle = fill
				c.fillRect(2, y + 1, s - 4, h - 2)
			} else if (op === "t") {
				c.strokeStyle = fill
				c.lineWidth = 1.5
				c.beginPath()
				c.moveTo(s * 0.25, y + h * 0.2)
				c.lineTo(s * 0.5, y + h * 0.8)
				c.lineTo(s * 0.75, y + h * 0.2)
				c.stroke()
			} else if (op === "m") {
				c.fillStyle = fill
				c.fillRect(s * 0.2, y + h / 2 - 1, s * 0.6, 2)
			} else if (op === "x") {
				const way = near ? -1 : 1
				c.strokeStyle = c.fillStyle = fill
				c.lineWidth = 1.5
				c.beginPath()
				c.moveTo(s / 2, y + h / 2 - way * h * 0.35)
				c.lineTo(s / 2, y + h / 2 + way * h * 0.35)
				c.stroke()
			} else if (op === "d") {
				c.strokeStyle = fill
				c.lineWidth = 1.5
				c.beginPath()
				c.moveTo(s * 0.35, y + h * 0.2)
				c.lineTo(s * 0.65, y + h * 0.8)
				c.moveTo(s * 0.65, y + h * 0.2)
				c.lineTo(s * 0.35, y + h * 0.8)
				c.stroke()
			}
		}
		if (!each.f && !each.b) {
			c.strokeStyle = colours.muted
			c.setLineDash([2, 2])
			c.strokeRect(3.5, 3.5, s - 7, s - 7)
			c.setLineDash([])
		}
	}

	// what the colours mean, for the way it's coloured
	function showLegend() {
		if (!colours) return
		legend.replaceChildren()
		const item = (colour, label) => {
			const element = document.createElement("span")
			const chip = document.createElement("i")
			chip.style.background = colour
			element.append(chip, label)
			legend.append(element)
		}
		if (mode === "stitch") {
			for (const op of ["k", "t", "m", "x", "s", "d"]) item(colours.ops[op], OPS[op])
		} else if (mode === "yarn") {
			legend.append("knitting in its yarn's colour")
		} else if (mode === "loops") {
			item(colours.ramp[4], "1 loop")
			item(colours.ramp[8], "2")
			item(colours.danger, "3 or more")
		} else {
			const setting = {speed: "speed", roller: "roller", "stitch-size": "stitch"}[mode]
			const values = rows.map(row => Number(row[setting])).filter(Number.isFinite)
			const lo = values.length ? Math.min(...values) : 0
			const hi = values.length ? Math.max(...values) : 0
			item(colours.ramp[0], String(lo))
			item(colours.ramp[10], String(hi))
		}
	}

	// ── talking to the editors

	function dispatch(type, detail) {
		element.dispatchEvent(new CustomEvent(type, {detail, bubbles: true, composed: true}))
	}

	// the line a spot's needle was knitted by (or its row's first)
	function lineAt(spot) {
		const row = rows[spot?.row]
		if (!row) return null
		if (spot.col != null) {
			const cell = spot.back ? row.back.get(backAt(row, spot.col)) : row.front.get(spot.col)
			const other = spot.back ? row.front.get(spot.col) : row.back.get(backAt(row, spot.col))
			const line = (cell ?? other)?.line
			if (line != null) return line
		}
		return row.placeholder ?? row.start
	}
	function where(spot) {
		const line = lineAt(spot)
		return line == null ? null : located(handle, {kLine: line + 1, jsLine: jsLines[line]})
	}

	function cellOfLine(line) {
		const at = model.byLine.get(line)
		if (!at) return null
		const row = rows[at.row]
		return {row: at.row, col: at.back ? backColumn(row, at.n) : at.n, back: at.back, n: at.n}
	}

	// "row 12 ↑ knit · carrier 3 · needle 56: front knit, back — · speed 100
	// · line 24 of the .k"
	function describe(spot) {
		const row = rows[spot.row]
		const parts = [`row ${row.index + 1}`, kindOf(row) + (row.dir ? ` ${row.dir === "+" ? "→" : "←"}` : "")]
		if (row.carriers) parts.push(`carrier ${row.carriers}`)
		if (spot.col != null) {
			const {f, b} = codeAt(row, spot.col)
			parts.push(`needle ${spot.col}: front ${OPS[f] ?? "—"}, back ${OPS[b] ?? "—"}${row.rack ? ` (b${backAt(row, spot.col)})` : ""}`)
		}
		if (row.kind === "knit") parts.push(`stitch ${row.stitch}`)
		parts.push(`speed ${row.speed}`, `roller ${row.roller}`)
		if (row.rack) parts.push(`rack ${row.rack}`)
		const line = lineAt(spot)
		if (line != null) {
			if (jsLines[line] != null && knitoutOf(handle.doc()).source) parts.push(`from line ${jsLines[line]} of the .js`)
			else parts.push(`line ${line + 1} of the .k`)
		}
		return parts.join(" · ")
	}

	// what the check says of the needle under the pointer
	function problemsAt(spot) {
		if (spot?.col == null) return []
		return problems.filter(problem =>
			problem.at.some(at => at.row === spot.row && at.col === spot.col),
		)
	}

	function showTooltip(spot, x, y) {
		if (!spot || spot.col == null || drag) {
			tooltip.hidden = true
			return
		}
		const row = rows[spot.row]
		const {f, b} = codeAt(row, spot.col)
		const lines = [
			`row ${spot.row + 1} · needle ${spot.col}`,
			`front: ${OPS[f] ?? "—"} · back: ${OPS[b] ?? "—"}`,
			row.carriers ? `yarn: carrier ${row.carriers}` : row.kind,
		]
		for (const problem of problemsAt(spot).slice(0, 3)) lines.push(`⚠ ${problem.text}`)
		tooltip.textContent = lines.join("\n")
		tooltip.hidden = false
		const room = stage.getBoundingClientRect()
		const left = Math.min(x + 14, room.width - tooltip.offsetWidth - 4)
		const top = y + 18 + tooltip.offsetHeight > room.height ? y - tooltip.offsetHeight - 8 : y + 18
		tooltip.style.left = `${Math.max(4, left)}px`
		tooltip.style.top = `${Math.max(4, top)}px`
	}

	function setHovered(spot) {
		const same = spot?.row === hovered?.row && spot?.col === hovered?.col && spot?.back === hovered?.back && !!spot?.gutter === !!hovered?.gutter
		if (same) return
		const lineBefore = hovered ? lineAt(hovered) : null
		hovered = spot
		status.textContent = spot ? describe(spot) : editable ? HINT_EDIT : HINT_READ
		status.toggleAttribute("data-hint", !spot)
		const line = spot ? lineAt(spot) : null
		if (line !== lineBefore) dispatch("knitout:hover-source", (spot && where(spot)) ?? {url: null, at: []})
		requestDraw()
	}

	function onHighlightLines(event) {
		const {url, start, end} = event.detail ?? {}
		const local = url === handle.url
		const fromJs = url != null && url === knitoutOf(handle.doc()).source
		highlighted = start == null || (!local && !fromJs) ? null : {local, start, end: end ?? start}
		requestDraw()
	}

	// ── the check's problems, where they are

	let lastResult = null
	function onChecked(result) {
		lastResult = result
		placeProblems()
	}
	function placeProblems() {
		problems = []
		worstCache = null
		for (const problem of lastResult?.problems ?? []) {
			if (problem.line == null) continue
			const at = []
			for (const line of new Set([problem.line, problem.lastLine])) {
				if (line == null) continue
				const spot = cellOfLine(line - 1)
				if (spot) at.push(spot)
			}
			// a hold's other end: "held from line 12"
			const from = problem.text.match(/from lines? (\d+)/)
			if (from) {
				const spot = cellOfLine(Number(from[1]) - 1)
				if (spot) at.push(spot)
			}
			if (at.length) problems.push({level: problem.level, text: problem.text, at})
		}
		requestDraw()
	}

	// ── editing: every edit's splices of the .k's text, as one change

	const undone = []
	const done = []
	function updateHistory() {
		undoButton.disabled = !done.length
		redoButton.disabled = !undone.length
	}

	function change(splices, what) {
		if (!editable || !splices.length) return false
		const before = docText(handle.doc())
		handle.change(doc => {
			for (const {at, remove, insert} of splices) splice(doc, ["content"], at, remove, insert)
		})
		const after = docText(handle.doc())
		if (after === before) return false
		done.push({before, after, what})
		if (done.length > 200) done.shift()
		undone.length = 0
		updateHistory()
		reread()
		return true
	}

	// back to how it was before, if no one's changed it since
	function travel(from, to, key) {
		const step = from[from.length - 1]
		if (!step) return
		const now = docText(handle.doc())
		if (now !== step[key === "before" ? "after" : "before"]) {
			say("it's been changed since (by someone, or in the text): undo it there")
			from.length = 0
			updateHistory()
			return
		}
		from.pop()
		handle.change(doc => updateText(doc, ["content"], step[key]))
		to.push(step)
		updateHistory()
		reread()
		say(`${key === "before" ? "undid" : "redid"} ${step.what}`)
	}
	const undo = () => travel(done, undone, "before")
	const redo = () => travel(undone, done, "after")

	function say(text) {
		status.textContent = text
		status.toggleAttribute("data-hint", false)
	}

	// paint codes (Map(row → Map(col → code))), saying why any didn't go in
	function paintCells(cells, what) {
		if (!editable) return
		const {splices, skipped} = paint(model, cells)
		const made = change(splices, what)
		if (skipped.length) say(skipped[0].why + (skipped.length > 1 ? ` (and ${skipped.length - 1} more)` : ""))
		else if (made) say(what)
	}

	const cellsOf = (list, each) => {
		const cells = new Map()
		for (const {row, col} of list) {
			if (row < 0 || row >= rows.length) continue
			if (!cells.has(row)) cells.set(row, new Map())
			cells.get(row).set(col, each)
		}
		return cells
	}

	function selectionCols(sel) {
		return sel.cols ?? model.range ?? [0, NEEDLES - 1]
	}
	function selectionCells(sel) {
		const out = []
		const [c0, c1] = selectionCols(sel)
		for (let row = sel.rows[0]; row <= sel.rows[1]; row++) for (let col = c0; col <= c1; col++) out.push({row, col})
		return out
	}
	function fillSelection(each) {
		if (!selection) return say("select some needles first")
		paintCells(cellsOf(selectionCells(selection), each), `filled with ${each.name}`)
	}

	// what the selection has: [[{f, b}]] (rows from the bottom) and its width
	function copied(sel) {
		const [c0, c1] = selectionCols(sel)
		const out = []
		for (let r = sel.rows[0]; r <= sel.rows[1]; r++) {
			const line = []
			for (let col = c0; col <= c1; col++) line.push(codeAt(rows[r], col))
			out.push(line)
		}
		return {rows: out, width: c1 - c0 + 1}
	}
	function copy() {
		if (!selection) return say("select some needles to copy")
		clipboard = copied(selection)
		say(`copied ${clipboard.rows.length} × ${clipboard.width}`)
	}
	function cut() {
		if (!selection) return say("select some needles to cut")
		clipboard = copied(selection)
		paintCells(cellsOf(selectionCells(selection), EMPTY), "cut")
	}
	// the clipboard, its bottom left at the selection's (or the needle under
	// the pointer); tiled over the whole selection, with `tile`
	function pasteAt(tile = false) {
		if (!clipboard) return say("copy some needles first")
		const anchor = selection
			? {row: selection.rows[0], col: selectionCols(selection)[0]}
			: hovered?.col != null
				? {row: hovered.row, col: hovered.col}
				: null
		if (!anchor) return say("select where to paste, or point at it")
		const cells = new Map()
		const height = tile && selection ? selection.rows[1] - selection.rows[0] + 1 : clipboard.rows.length
		const width = tile && selection ? selectionCols(selection)[1] - selectionCols(selection)[0] + 1 : clipboard.width
		for (let i = 0; i < height; i++) {
			const row = anchor.row + i
			if (row >= rows.length) break
			const source = clipboard.rows[i % clipboard.rows.length]
			const changes = new Map()
			for (let j = 0; j < width; j++) changes.set(anchor.col + j, source[j % clipboard.width])
			cells.set(row, changes)
		}
		paintCells(cells, tile ? "tiled" : "pasted")
		selection = {rows: [anchor.row, Math.min(rows.length - 1, anchor.row + height - 1)], cols: [anchor.col, anchor.col + width - 1]}
	}

	// the selection mirrored left to right, its rows flipped, or its beds
	// swapped
	function transform(how) {
		if (!selection) return say("select some needles first")
		const {rows: grid} = copied(selection)
		const [c0] = selectionCols(selection)
		const cells = new Map()
		grid.forEach((line, i) => {
			const source = how === "flip" ? grid[grid.length - 1 - i] : line
			const changes = new Map()
			source.forEach((_, j) => {
				const from = how === "mirror" ? source[source.length - 1 - j] : source[j]
				changes.set(c0 + j, how === "beds" ? {f: from.b, b: from.f} : from)
			})
			cells.set(selection.rows[0] + i, changes)
		})
		paintCells(cells, {mirror: "mirrored", flip: "flipped", beds: "swapped beds"}[how])
	}

	// the selection's contents moved a needle (or more) along
	function shiftSelection(by) {
		if (!selection?.cols) return
		const {rows: grid} = copied(selection)
		const [c0, c1] = selection.cols
		const cells = new Map()
		grid.forEach((line, i) => {
			const changes = new Map()
			for (let col = c0; col <= c1; col++) changes.set(col, EMPTY)
			line.forEach((each, j) => changes.set(c0 + j + by, each))
			cells.set(selection.rows[0] + i, changes)
		})
		paintCells(cells, "moved")
		selection = {...selection, cols: [c0 + by, c1 + by]}
	}

	// the rows selected (or under the pointer)
	function rowRange() {
		if (selection) return selection.rows
		if (hovered) return [hovered.row, hovered.row]
		return null
	}
	function rowsDo(what) {
		if (!editable) return
		const range = rowRange()
		if (!range && what !== "insert" && what !== "insert-xfer") return say("select some rows first")
		const [a, b] = range ?? [rows.length - 1, rows.length - 1]
		if (what === "insert") change(insertRow(model, b, "knit"), "put a row in")
		else if (what === "insert-xfer") change(insertRow(model, b, "xfer"), "put a transfer row in")
		else if (what === "repeat") {
			if (change(repeatRows(model, a, b), `repeated ${b - a + 1} rows`)) selection = {rows: [b + 1, b + 1 + (b - a)], cols: selection?.cols ?? null}
		} else if (what === "flip") change(flipDirection(model, a, b), "turned round")
		else if (what === "delete") {
			if (change(deleteRows(model, a, b), `took ${b - a + 1} rows out`)) selection = null
		}
		requestDraw()
	}

	// an option typed in over its cell: for the rows selected, if it's one of
	// them, or just its own
	let editing = null
	function editOption(r, col) {
		if (!editable) return
		const row = rows[r]
		const range = selection && r >= selection.rows[0] && r <= selection.rows[1] ? selection.rows : [r, r]
		if (col.edit === "flip") {
			change(flipDirection(model, range[0], range[1]), "turned round")
			return
		}
		if (col.edit === "carriers" && row.kind !== "knit") return say("transfers and drops have no yarn")
		const value = col.edit === "carriers" ? row.carriers : String(row[col.edit])
		editing = {range, edit: col.edit}
		optionInput.value = value
		optionInput.hidden = false
		optionInput.style.left = `${col.left + 1}px`
		optionInput.style.top = `${yOf(r)}px`
		optionInput.style.width = `${col.width - 2}px`
		optionInput.style.height = `${Math.max(view.cell, 18)}px`
		optionInput.title = `${col.label} for row${range[0] === range[1] ? ` ${range[0] + 1}` : `s ${range[0] + 1}–${range[1] + 1}`}: enter to set it, escape to leave it`
		optionInput.focus()
		optionInput.select()
	}
	function commitOption() {
		if (!editing) return
		const {range, edit} = editing
		editing = null
		optionInput.hidden = true
		const value = optionInput.value.trim()
		if (!value) return
		if (edit === "carriers") {
			change(setCarriers(model, range[0], range[1], value), `yarn ${value}`)
			return
		}
		if (!/^[+-]?\d*\.?\d+$/.test(value)) return say(`${edit} is a number`)
		change(setOption(model, range[0], range[1], edit, value), `${edit} ${value}`)
	}
	optionInput.addEventListener("keydown", event => {
		event.stopPropagation()
		if (event.key === "Enter") commitOption()
		if (event.key === "Escape") {
			editing = null
			optionInput.hidden = true
			canvas.focus()
		}
	})
	optionInput.addEventListener("blur", commitOption)

	// a .k a .js writes is stored whole: a copy of it as text, to edit
	async function editableCopy() {
		const {project, open} = context
		if (!project?.createFile) return say("there's no project here to put a copy in")
		const doc = handle.doc()
		const stem = (doc?.name ?? "pattern.k").replace(/\.k$/, "")
		const copyUrl = await project.createFile(`${stem}-copy.k`, {content: docText(doc), knitoutCopyOf: handle.url})
		open?.(copyUrl, element, "right", "kniterate")
	}

	// ── pointer, wheel and keys

	const local = event => {
		const rect = canvas.getBoundingClientRect()
		return {x: event.clientX - rect.left, y: event.clientY - rect.top}
	}

	let drag = null
	let lastPainted = null
	function onPointerDown(event) {
		if (event.button !== 0 && event.button !== 1) return
		canvas.setPointerCapture(event.pointerId)
		canvas.focus({preventScroll: true})
		const {x, y} = local(event)
		const spot = at(x, y)
		const panning = event.button === 1 || spaceHeld || tool === "hand"
		drag = {x: event.clientX, y: event.clientY, moved: false, panning, start: spot, shift: event.shiftKey}
		if (panning || !spot) return
		if (spot.gutter) {
			// a row's number selects it (shift: on to it); an option's cell
			// changes it
			if (spot.gutter.edit && editable) {
				drag.option = spot
				return
			}
			const anchor = event.shiftKey && selection ? selection.rows[0] : spot.row
			selection = {rows: ordered(anchor, spot.row), cols: null}
			drag.rows = anchor
			requestDraw()
			return
		}
		if (tool === "picker") {
			const {f, b} = codeAt(rows[spot.row], spot.col)
			setCode(CODES.find(each => each.f === f && each.b === b) ?? EMPTY)
			drag = null
			return
		}
		if (PAINTS.has(tool) && editable) {
			const each = tool === "eraser" ? EMPTY : code
			drag.paint = each
			if (tool === "brush" || tool === "eraser") {
				const from = event.shiftKey && lastPainted ? lastPainted : spot
				preview = cellsOf(lineCells(from, spot), each)
			} else preview = cellsOf([spot], each)
			lastPainted = spot
			requestDraw()
			return
		}
		if (tool === "select") {
			const anchor = event.shiftKey && selection?.cols ? {row: selection.rows[0], col: selection.cols[0]} : spot
			drag.anchor = anchor
			selection = {rows: ordered(anchor.row, spot.row), cols: ordered(anchor.col, spot.col)}
			requestDraw()
		}
	}

	function onPointerMove(event) {
		const {x, y} = local(event)
		const spot = at(x, y)
		if (drag) {
			const dx = event.clientX - drag.x
			const dy = event.clientY - drag.y
			if (!drag.moved && Math.hypot(dx, dy) >= 3) drag.moved = true
			if (drag.panning) {
				if (drag.moved) {
					view.left -= dx / view.cell
					view.bottom += dy / view.cell
					clampView()
					drag.x = event.clientX
					drag.y = event.clientY
					requestDraw()
				}
				return
			}
			if (drag.rows != null && spot) {
				selection = {rows: ordered(drag.rows, spot.row), cols: null}
				setHovered(spot)
				requestDraw()
				return
			}
			if (spot?.col != null && drag.paint) {
				const target = spot
				if (tool === "brush" || tool === "eraser") {
					const extra = cellsOf(lineCells(lastPainted ?? target, target), drag.paint)
					for (const [row, changes] of extra) {
						if (!preview.has(row)) preview.set(row, new Map())
						for (const [col, each] of changes) preview.get(row).set(col, each)
					}
					lastPainted = target
				} else if (tool === "line") {
					preview = cellsOf(lineCells(drag.start, target), drag.paint)
				} else if (tool === "rect") {
					const [r0, r1] = ordered(drag.start.row, target.row)
					const [c0, c1] = ordered(drag.start.col, target.col)
					preview = cellsOf(selectionCells({rows: [r0, r1], cols: [c0, c1]}), drag.paint)
				}
				lastPainted = target
				setHovered(spot)
				requestDraw()
				return
			}
			if (drag.anchor && spot?.col != null) {
				selection = {rows: ordered(drag.anchor.row, spot.row), cols: ordered(drag.anchor.col, spot.col)}
				setHovered(spot)
				requestDraw()
				return
			}
		}
		setHovered(spot)
		showTooltip(spot, x, y)
	}

	function onPointerUp() {
		const was = drag
		drag = null
		if (!was) return
		if (was.paint && preview) {
			const stroke = preview
			preview = null
			paintCells(stroke, `painted ${was.paint.name}`)
			requestDraw()
			return
		}
		if (was.option && !was.moved) {
			editOption(was.option.row, was.option.gutter)
			return
		}
		if (!was.moved && !was.panning && hovered && tool === "select") {
			const found = where(hovered)
			if (found) dispatch("knitout:select-source", found)
		}
	}
	function onPointerLeave() {
		if (!drag) {
			setHovered(null)
			tooltip.hidden = true
		}
	}
	function onDoubleClick(event) {
		const {x, y} = local(event)
		const found = where(at(x, y))
		if (found) dispatch("knitout:goto-source", found)
	}
	function onWheel(event) {
		event.preventDefault()
		tooltip.hidden = true
		const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1
		if (event.ctrlKey || event.metaKey) {
			// zoom round the pointer
			const {x, y} = local(event)
			const col = view.left + (x - gutter()) / view.cell
			const row = view.bottom + (gridBottom() - y) / view.cell
			view.cell = Math.max(2, Math.min(48, view.cell * Math.exp(-event.deltaY * scale * 0.01)))
			view.left = col - (x - gutter()) / view.cell
			view.bottom = row - (gridBottom() - y) / view.cell
		} else {
			const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX
			const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY
			view.left += (dx * scale) / view.cell
			view.bottom -= (dy * scale) / view.cell
		}
		clampView()
		requestDraw()
	}

	function onKey(event) {
		if (event.key === " ") {
			spaceHeld = event.type === "keydown"
			canvas.toggleAttribute("data-panning", spaceHeld)
			event.preventDefault()
			return
		}
		if (event.type !== "keydown") return
		const mod = event.metaKey || event.ctrlKey
		const key = event.key.toLowerCase()
		if (mod && key === "z") {
			event.preventDefault()
			if (event.shiftKey) redo()
			else undo()
			return
		}
		if (mod && key === "y") {
			event.preventDefault()
			redo()
			return
		}
		if (mod && key === "c") {
			event.preventDefault()
			copy()
			return
		}
		if (mod && key === "x") {
			event.preventDefault()
			cut()
			return
		}
		if (mod && key === "v") {
			event.preventDefault()
			pasteAt(event.shiftKey)
			return
		}
		if (mod && key === "a") {
			event.preventDefault()
			selection = rows.length ? {rows: [0, rows.length - 1], cols: null} : null
			requestDraw()
			return
		}
		if (mod || (event.altKey && !event.key.startsWith("Arrow"))) return
		if (event.key === "Escape") {
			selection = null
			preview = null
			drag = null
			requestDraw()
			return
		}
		if (event.key === "Delete" || event.key === "Backspace") {
			event.preventDefault()
			if (selection) paintCells(cellsOf(selectionCells(selection), EMPTY), "rubbed out")
			return
		}
		if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
			event.preventDefault()
			const way = (event.key === "ArrowRight") !== rear() ? 1 : -1
			shiftSelection(way)
			return
		}
		if (key === "z") {
			if (selection) zoomTo(selection)
			else fit()
			requestDraw()
			return
		}
		if (key === "f" && editable) return fillSelection(code)
		const pickedTool = TOOLS.find(each => each.key === key)
		if (pickedTool) return setTool(pickedTool.id)
		const pickedCode = CODES.find(each => each.key === event.key)
		if (pickedCode && editable) setCode(pickedCode)
	}
	function onBlur() {
		spaceHeld = false
		canvas.toggleAttribute("data-panning", false)
	}

	const canvasListeners = {
		pointerdown: onPointerDown,
		pointermove: onPointerMove,
		pointerup: onPointerUp,
		pointercancel: onPointerUp,
		pointerleave: onPointerLeave,
		dblclick: onDoubleClick,
		wheel: onWheel,
		keydown: onKey,
		keyup: onKey,
		blur: onBlur,
		// its keys work under the pointer, so it takes the focus on hover, but
		// only when nothing has it: a keyboard user's stays where they put it
		mouseover: () => {
			const now = document.activeElement
			if (!now || now === document.body) canvas.focus({preventScroll: true})
		},
	}
	for (const [type, listener] of Object.entries(canvasListeners)) {
		canvas.addEventListener(type, listener, {passive: false})
	}

	// a knitout error says its line first: click it to go there
	errorBar.addEventListener("click", () => {
		const line = parseInt(errorBar.textContent)
		if (Number.isFinite(line)) dispatch("knitout:goto-source", {url: handle.url, line, at: [{url: handle.url, line}]})
	})

	// ── keeping up with the .k

	const kcode = converter()
	let generation = 0
	let timer = null
	let readText = null

	function docName() {
		return (handle.doc()?.name ?? "pattern.k").replace(/\.k$/, "")
	}

	// the rows, from the text as it is now
	function reread() {
		const doc = handle.doc()
		const text = docText(doc)
		const nowEditable = typeof doc?.content === "string"
		if (nowEditable !== editable) {
			editable = nowEditable
			editBar.hidden = !editable
			readOnly.hidden = editable || !doc
			if (!editable) setTool(tool === "hand" ? "hand" : "select")
			status.textContent = editable ? HINT_EDIT : HINT_READ
		}
		if (text === readText) return
		readText = text
		model = rowsOf(text)
		rows = model.rows
		jsLines = jsLinesOf(text)
		loops = null
		for (const key of Object.keys(ranges)) delete ranges[key]
		if (selection) {
			const last = rows.length - 1
			if (selection.rows[0] > last) selection = null
			else selection = {...selection, rows: [selection.rows[0], Math.min(last, selection.rows[1])]}
		}
		if (hovered && hovered.row >= rows.length) hovered = null
		empty.textContent = text.trim() ? "no rows yet: knitting, transfers and drops make rows" : editable ? "an empty .k: put a row in to start" : "no rows yet"
		empty.hidden = rows.length > 0
		if (!fitted && size.width && rows.length) {
			fit()
			fitted = true
		}
		placeProblems()
		showLegend()
		requestDraw()
	}

	// what the kniterate makes of it (its warnings and errors) and the check
	async function convert() {
		const gen = ++generation
		const text = docText(handle.doc())
		if (!text.trim()) {
			errorBar.hidden = true
			warningsBadge.hidden = true
			return
		}
		panel.check(text)
		const result = await kcode.convert(text, "", {})
		if (gen !== generation) return
		if (result.error) {
			errorBar.textContent = result.error
			errorBar.hidden = false
		} else errorBar.hidden = true
		const warnings = [...new Set(result.warnings ?? [])]
		warningsBadge.hidden = !warnings.length
		warningsBadge.textContent = `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`
		warningsBadge.title = warnings.slice(0, 20).join("\n")
	}

	function onChange() {
		clearTimeout(timer)
		// what's painted here is drawn straight away; others' edits, and the
		// check, when they've settled
		timer = setTimeout(() => {
			reread()
			convert()
		}, REDRAW_DELAY)
	}

	// a .k built into a .kc saves that, if it's built from the .k as it is
	// (it's going to a machine); any other, or one whose .kc is empty or
	// behind, is converted as it is
	async function exportKcode() {
		const name = docName()
		const text = docText(handle.doc())
		const target = knitoutOf(handle.doc()).kcodeTarget
		const repo = context.repo ?? element.repo
		if (target && repo) {
			try {
				const kc = (await repo.find(target)).doc()
				const built = builtKcode(text, kc)
				if (built != null) {
					saveFile(built, kc?.name ?? name + ".kc")
					return
				}
			} catch (error) {
				console.warn("kniterate: couldn't find its .kc, converting this instead:", error)
			}
		}
		const result = await kcode.convert(text, name, {})
		if (result.error) {
			errorBar.textContent = result.error
			errorBar.hidden = false
			return
		}
		saveFile(result.kcode, name + ".kc")
	}

	editBar.hidden = true
	readOnly.hidden = true
	setSide("front")
	setTool("select")
	setCode(CODES[0])
	setTool("select")
	updateHistory()
	status.textContent = HINT_READ
	status.toggleAttribute("data-hint", true)

	const resizeObserver = new ResizeObserver(resize)
	resizeObserver.observe(canvas)

	handle.on("change", onChange)
	events.addEventListener("knitout:highlight-lines", onHighlightLines)
	reread()
	convert()

	return () => {
		generation++
		clearTimeout(timer)
		cancelAnimationFrame(frame)
		handle.off("change", onChange)
		events.removeEventListener("knitout:highlight-lines", onHighlightLines)
		scheme.removeEventListener("change", onScheme)
		removeEventListener(YARNS_CHANGED, onScheme)
		yarns.destroy()
		resizeObserver.disconnect()
		for (const [type, listener] of Object.entries(canvasListeners)) {
			canvas.removeEventListener(type, listener)
		}
		kcode.destroy()
		panel.remove()
		root.remove()
		link.remove()
	}
}
