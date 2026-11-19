// a charm's arrangement: the kniterate editor (lattice/kniterate.js) made
// small. a column a colour, as wide as its tile; its passes as rows, the
// first at the bottom, reference rows numbered and + rows after them, as
// stoll numbers them; each row's settings down the side, as the kniterate
// editor's gutter has them; and along the bottom, each colour with its
// repeat anchor under it, as stoll's search area has them. cells are painted
// with the kniterate editor's brushes and stitches, and a charm's own: ✦
// (as painted), cast off, cast on
import {stylesheet} from "../wm/ui/stylesheet.js"
import {ANCHORS, addColumn, addRow, columnsOf, groupsOf, moveColumn, paintCell, removeColumn, removeRow, renumberColumn, setColumn, setRow} from "./charm.js"
import {CHARM_STITCHES, STITCHES, drawCode, readColours, stitchSwatch} from "./glyphs.js"
import {settingProblem} from "./build.js"
import {followView} from "./follow-view.js"

const STYLESHEET = new URL("./patternstoat.css", import.meta.url).href
const TOOLS = [
	{id: "brush", name: "brush", key: "b", title: "paint the stitch picked onto cells"},
	{id: "line", name: "line", key: "l", title: "paint a line of it, in one colour's column"},
	{id: "rect", name: "rect", key: "r", title: "paint a rectangle of it, in one colour's column"},
	{id: "eraser", name: "rub out", key: "e", title: "take stitches out"},
	{id: "picker", name: "pick", key: "i", title: "pick the stitch a cell has"},
]
// the gutter, as the kniterate editor's (its COLUMNS)
const GUTTER = [
	{id: "row", label: "row", width: 34},
	{id: "dir", label: "", width: 18},
	{id: "yarn", label: "yarn", width: 32},
	{id: "stitch", label: "stitch", width: 38},
	{id: "speed", label: "speed", width: 40},
	{id: "roller", label: "roller", width: 42},
]
const GUTTER_WIDTH = GUTTER.reduce((sum, column) => sum + column.width, 0)
const GAP = 10
const ANCHOR_SYMBOL = {"colour-left": "|*", "colour-right": "*|", "pattern-left": "‖*", "pattern-right": "*‖"}
const ANCHOR_NAME = {
	"colour-left": "repeats from the left edge of each field of its colour (stoll's default)",
	"colour-right": "repeats from the right edge of each field of its colour",
	"pattern-left": "repeats from the patternstoat's left edge, so tiles line up across fields",
	"pattern-right": "repeats from the patternstoat's right edge",
}
const DIR_SYMBOL = {"+": "→", "-": "←", "~": "~"}
const NEXT_DIR = {"+": "-", "-": "~", "~": "+"}
const YARNS = ["row", "1", "2", "3", "4", "5", "6"]

function button(text, title, onClick) {
	const element = document.createElement("button")
	element.type = "button"
	element.textContent = text
	element.title = title
	element.addEventListener("click", onClick)
	return element
}

function group(...children) {
	const element = document.createElement("div")
	element.className = "stoat-group"
	element.append(...children)
	return element
}

function field(label, input) {
	const wrap = document.createElement("label")
	wrap.append(label, input)
	return wrap
}

const cellKey = (colour, rowId, i) => `${colour}|${rowId}|${i}`

export default function ArrangementTool(handle, element, context = {}) {
	const doc = () => handle.doc()

	const root = document.createElement("div")
	root.className = "stoat charm-arrangement"
	const link = stylesheet(STYLESHEET, root)
	element.append(link, root)

	// ── the bar: tools, stitches, rows and colours

	const bar = document.createElement("div")
	bar.className = "stoat-edit"
	const toolButtons = new Map()
	const tools = group()
	for (const each of TOOLS) {
		const b = button(each.name, `${each.title} (${each.key})`, () => setTool(each.id))
		toolButtons.set(each.id, b)
		tools.append(b)
	}
	const palette = group()
	const rowsGroup = group(
		button("+ reference row", "a new reference row: the next design row takes it (and its + rows)", () => {
			handle.change(d => {
				const id = addRow(d, {ref: true})
				setRow(d, id, {dir: "+"})
				selectedRow = id
			})
		}),
		button("+ row", "a + row after the picked row (or at the top): another pass for the same design row", () => {
			handle.change(d => {
				selectedRow = addRow(d, {after: selectedRow ?? d.rows[d.rows.length - 1]?.id ?? null, ref: false})
			})
		}),
		button("− row", "take the picked row out", () => {
			if (!selectedRow) return
			handle.change(d => removeRow(d, selectedRow))
			selectedRow = null
		}),
		button("+ colour", "a new colour (column)", () => {
			handle.change(d => {
				const next = Math.max(0, ...d.columns.map(column => column.colour)) + 1
				addColumn(d, {colour: next, name: `colour ${next}`, hex: "#999999"})
				selectedColour = next
			})
		}),
	)
	bar.append(tools, palette, rowsGroup)
	root.append(bar)

	// the picked colour's fields
	const columnBar = document.createElement("div")
	columnBar.className = "stoat-bar"
	const numberInput = Object.assign(document.createElement("input"), {type: "number", min: "1", step: "1", title: "its number: what a patternstoat's cells say"})
	const nameInput = Object.assign(document.createElement("input"), {type: "text", title: "its name"})
	const hexInput = Object.assign(document.createElement("input"), {type: "color", title: "its colour, in the patternstoat"})
	const widthInput = Object.assign(document.createElement("input"), {type: "number", min: "1", max: "24", step: "1", title: "how many needles wide its tile is"})
	const anchorSelect = document.createElement("select")
	anchorSelect.title = "where its tile repeats from"
	for (const anchor of ANCHORS) anchorSelect.append(new Option(`${ANCHOR_SYMBOL[anchor]} ${anchor.replace("-", " ")}`, anchor))
	const changeColumn = fields => {
		if (selectedColour == null) return
		handle.change(d => setColumn(d, selectedColour, fields))
	}
	numberInput.addEventListener("change", () => {
		const next = Math.round(Number(numberInput.value))
		if (!(next >= 1) || selectedColour == null || doc().columns.some(column => column.colour === next)) return showColumnBar()
		const from = selectedColour
		handle.change(d => renumberColumn(d, from, next))
		selectedColour = next
	})
	nameInput.addEventListener("change", () => changeColumn({name: nameInput.value}))
	hexInput.addEventListener("change", () => changeColumn({hex: hexInput.value}))
	widthInput.addEventListener("change", () => {
		const width = Math.round(Number(widthInput.value))
		if (width >= 1) changeColumn({width})
	})
	anchorSelect.addEventListener("change", () => changeColumn({anchor: anchorSelect.value}))
	columnBar.append(
		group(field("colour", numberInput), field("name", nameInput), hexInput, field("width", widthInput), anchorSelect),
		group(
			button("←", "move it left", () => moveBy(-1)),
			button("→", "move it right", () => moveBy(1)),
			button("remove", "take this colour out of the charm (a patternstoat's cells of it are then an error)", () => {
				if (selectedColour == null) return
				handle.change(d => removeColumn(d, selectedColour))
				selectedColour = null
			}),
		),
	)
	root.append(columnBar)

	function moveBy(step) {
		if (selectedColour == null) return
		const at = columnsOf(doc()).findIndex(column => column.colour === selectedColour)
		handle.change(d => moveColumn(d, selectedColour, Math.max(0, at + step)))
	}

	const stage = document.createElement("div")
	stage.className = "stoat-stage"
	const canvas = document.createElement("canvas")
	canvas.tabIndex = 0
	stage.append(canvas)
	root.append(stage)
	const ctx = canvas.getContext("2d")
	// editing a row's stitch, speed or roller, in place
	const editor = Object.assign(document.createElement("input"), {type: "text"})
	editor.style.position = "absolute"
	editor.hidden = true
	stage.append(editor)

	// ── state

	let tool = "brush"
	let stitch = STITCHES[0]
	let selectedColour = null
	let selectedRow = null
	let colours = null
	let size = {width: 0, height: 0}
	const view = {cell: 22, x: 0, y: 0}
	// following someone, it's where they've moved and zoomed to (follow-view.js)
	const follow = followView(element, context.repo ?? element.repo, view, () => draw())
	let pending = new Map()
	let drag = null

	function setTool(id) {
		tool = id
		for (const [each, b] of toolButtons) b.setAttribute("aria-pressed", String(each === id))
	}

	function showPalette() {
		palette.replaceChildren()
		if (!colours) return
		for (const each of [...STITCHES, ...CHARM_STITCHES]) {
			const b = button("", each.name + (each.key ? ` (${each.key})` : ""), () => {
				stitch = each
				showPalette()
			})
			b.className = "stoat-swatch"
			b.append(stitchSwatch({f: each.f ?? null, b: each.b ?? null}, colours))
			b.setAttribute("aria-pressed", String(each.id === stitch.id))
			palette.append(b)
		}
	}

	function showColumnBar() {
		const column = doc()?.columns?.find(c => c.colour === selectedColour)
		columnBar.hidden = !column
		if (!column) return
		if (document.activeElement !== numberInput) numberInput.value = String(column.colour)
		if (document.activeElement !== nameInput) nameInput.value = column.name ?? ""
		hexInput.value = /^#[0-9a-f]{6}$/i.test(column.hex) ? column.hex : "#999999"
		if (document.activeElement !== widthInput) widthInput.value = String(column.width ?? 1)
		anchorSelect.value = column.anchor ?? "colour-left"
	}

	// ── where things are

	const s = () => view.cell
	const strip = () => s() * 2 + 6
	const rowTop = r => size.height - strip() - (r + 1) * s() + view.y
	function layout() {
		const out = []
		let x = GUTTER_WIDTH + GAP - view.x
		for (const column of columnsOf(doc())) {
			const width = Math.max(1, column.width || 1) * s()
			out.push({column, x, width})
			x += width + GAP
		}
		return out
	}
	function gutterX(id) {
		let x = 0
		for (const column of GUTTER) {
			if (column.id === id) return x
			x += column.width
		}
		return x
	}
	// what's under a point: {kind: "cell", colour, rowId, i, bed} | {kind:
	// "gutter", id, rowId} | {kind: "chip" | "anchor", colour}
	function hit(px, py) {
		const d = doc()
		if (!d) return null
		const r = Math.floor((size.height - strip() + view.y - py) / s())
		const row = d.rows[r]
		if (py > size.height - strip()) {
			for (const {column, x, width} of layout()) {
				if (px >= x && px < x + width) return {kind: py < size.height - strip() + s() + 2 ? "chip" : "anchor", colour: column.colour}
			}
			return null
		}
		if (!row) return null
		if (px < GUTTER_WIDTH) {
			let x = 0
			for (const column of GUTTER) {
				if (px < x + column.width) return {kind: "gutter", id: column.id, rowId: row.id}
				x += column.width
			}
		}
		for (const {column, x, width} of layout()) {
			if (px >= x && px < x + width) {
				const i = Math.floor((px - x) / s())
				const top = rowTop(r)
				return {kind: "cell", colour: column.colour, rowId: row.id, r, i, bed: py < top + s() / 2 ? "b" : "f"}
			}
		}
		return null
	}

	// ── drawing

	let frame = 0
	function draw() {
		cancelAnimationFrame(frame)
		frame = requestAnimationFrame(paint)
	}

	function rowLabels(d) {
		const labels = new Map()
		let ref = 0
		let plus = 0
		for (const row of d.rows) {
			if (row.ref) {
				ref++
				plus = 0
				labels.set(row.id, String(ref))
			} else labels.set(row.id, ref ? `+${++plus}` : "·")
		}
		return labels
	}

	function cellOf(d, colour, rowId, i) {
		const kept = d.cells?.[colour]?.[rowId]?.[i] ?? {f: null, b: null}
		const over = pending.get(cellKey(colour, rowId, i))
		return over ? {...kept, ...over} : kept
	}

	function paint() {
		const d = doc()
		if (!d || !colours || !size.width) return
		follow.shared()
		ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
		ctx.fillStyle = colours.sheet
		ctx.fillRect(0, 0, size.width, size.height)
		const cell = s()
		const labels = rowLabels(d)
		const grouped = new Set(groupsOf(d).flat().map(row => row.id))
		const columns = layout()

		d.rows.forEach((row, r) => {
			const top = rowTop(r)
			if (top + cell < 0 || top > size.height) return
			if (row.id === selectedRow) {
				ctx.fillStyle = colours.highlight
				ctx.fillRect(0, top, size.width, cell)
			}
			for (const {column, x} of columns) {
				const width = Math.max(1, column.width || 1)
				for (let i = 0; i < width; i++) {
					const left = x + i * cell
					const {f, b} = cellOf(d, column.colour, row.id, i)
					ctx.fillStyle = column.hex
					ctx.globalAlpha = 0.18
					ctx.fillRect(left, top, cell, cell)
					ctx.globalAlpha = grouped.has(row.id) ? 1 : 0.4
					drawCode(ctx, b, left, top, cell, cell / 2, colours, false)
					drawCode(ctx, f, left, top + cell / 2, cell, cell / 2, colours, true)
					ctx.globalAlpha = 1
					ctx.fillStyle = colours.grid
					ctx.fillRect(left, top + cell / 2, cell, 1)
					ctx.strokeStyle = colours.grid
					ctx.strokeRect(left + 0.5, top + 0.5, cell - 1, cell - 1)
				}
			}
			// the gutter
			ctx.fillStyle = colours.chrome
			ctx.fillRect(0, top, GUTTER_WIDTH, cell)
			ctx.font = `11px ${colours.mono}`
			ctx.textBaseline = "middle"
			ctx.textAlign = "center"
			const mid = top + cell / 2
			const text = (id, value, muted = false) => {
				const column = GUTTER.find(g => g.id === id)
				ctx.fillStyle = muted ? colours.muted : colours.ink
				ctx.fillText(value, gutterX(id) + column.width / 2, mid)
			}
			text("row", labels.get(row.id), !row.ref)
			text("dir", DIR_SYMBOL[row.dir] ?? "~")
			text("yarn", row.yarn && row.yarn !== "row" ? row.yarn : "row", !row.yarn || row.yarn === "row")
			text("stitch", row.stitch ?? "5", row.stitch == null)
			text("speed", row.speed ?? "100", row.speed == null)
			text("roller", row.roller ?? "100", row.roller == null)
		})

		// the search strip: each colour, and where it repeats from
		const top = size.height - strip()
		ctx.fillStyle = colours.chrome
		ctx.fillRect(0, top, size.width, strip())
		ctx.font = `11px ${colours.mono}`
		ctx.textAlign = "center"
		ctx.fillStyle = colours.muted
		for (const column of GUTTER) if (column.label) ctx.fillText(column.label, gutterX(column.id) + column.width / 2, top + cell / 2 + 3)
		ctx.fillText("repeats from", GUTTER_WIDTH / 2, top + cell * 1.5 + 4)
		for (const {column, x, width} of columns) {
			ctx.fillStyle = column.hex
			ctx.fillRect(x, top + 3, width, cell - 2)
			if (column.colour === selectedColour) {
				ctx.strokeStyle = colours.accent
				ctx.lineWidth = 2
				ctx.strokeRect(x - 1, top + 2, width + 2, cell)
				ctx.lineWidth = 1
			}
			ctx.fillStyle = colours.ink
			ctx.fillText(String(column.colour), x + width / 2, top + 3 + (cell - 2) / 2)
			ctx.fillText(ANCHOR_SYMBOL[column.anchor] ?? "|*", x + width / 2, top + cell * 1.5 + 4)
		}
	}

	// ── painting

	function stitchFor(erasing) {
		if (erasing) return {f: null, b: null}
		const out = {}
		if (!stitch.keepF) out.f = stitch.f ?? null
		if (!stitch.keepB) out.b = stitch.b ?? null
		return out
	}

	function addCells(colour, cells, erasing) {
		const value = stitchFor(erasing)
		for (const {rowId, i} of cells) pending.set(cellKey(colour, rowId, i), {...(pending.get(cellKey(colour, rowId, i)) ?? {}), ...value})
	}

	function shapeCells(a, b) {
		const d = doc()
		const rows = d.rows.map(row => row.id)
		const [r0, r1] = [Math.min(a.r, b.r), Math.max(a.r, b.r)]
		const [i0, i1] = [Math.min(a.i, b.i), Math.max(a.i, b.i)]
		const cells = []
		if (tool === "line") {
			const steps = Math.max(r1 - r0, i1 - i0)
			for (let t = 0; t <= steps; t++) {
				const r = Math.round(a.r + ((b.r - a.r) * t) / (steps || 1))
				const i = Math.round(a.i + ((b.i - a.i) * t) / (steps || 1))
				cells.push({rowId: rows[r], i})
			}
		} else {
			for (let r = r0; r <= r1; r++) for (let i = i0; i <= i1; i++) cells.push({rowId: rows[r], i})
		}
		return cells
	}

	function keep() {
		if (!pending.size) return
		const changes = [...pending]
		pending = new Map()
		handle.change(d => {
			for (const [at, value] of changes) {
				const [colour, rowId, i] = at.split("|")
				for (const bed of ["f", "b"]) if (bed in value) paintCell(d, Number(colour), rowId, Number(i), bed, value[bed])
			}
		})
	}

	function editGutter(id, rowId) {
		const d = doc()
		const row = d.rows.find(r => r.id === rowId)
		if (!row) return
		selectedRow = rowId
		if (id === "row") return draw()
		if (id === "dir") return handle.change(doc => setRow(doc, rowId, {dir: NEXT_DIR[row.dir] ?? "+"}))
		if (id === "yarn") {
			const next = YARNS[(YARNS.indexOf(row.yarn ?? "row") + 1) % YARNS.length]
			return handle.change(doc => setRow(doc, rowId, {yarn: next}))
		}
		// stitch, speed, roller: typed in place. empty is the default
		const r = d.rows.indexOf(row)
		editor.hidden = false
		editor.value = row[id] ?? ""
		editor.placeholder = id === "stitch" ? "5" : "100"
		Object.assign(editor.style, {left: `${gutterX(id)}px`, top: `${rowTop(r)}px`, width: `${GUTTER.find(g => g.id === id).width}px`, height: `${s()}px`})
		editor.focus()
		editor.select()
		editor.onkeydown = event => {
			if (event.key === "Escape") {
				editor.hidden = true
				canvas.focus()
			}
			if (event.key === "Enter") editor.blur()
		}
		editor.onblur = () => {
			if (editor.hidden) return
			const value = editor.value.trim()
			const problem = value === "" ? null : settingProblem(id, value)
			if (problem) {
				editor.title = problem
				editor.setCustomValidity(problem)
				editor.reportValidity()
				return
			}
			editor.setCustomValidity("")
			editor.hidden = true
			handle.change(doc => setRow(doc, rowId, {[id]: value === "" ? null : value}))
		}
	}

	function onPointerDown(event) {
		canvas.focus()
		const rect = canvas.getBoundingClientRect()
		const at = hit(event.clientX - rect.left, event.clientY - rect.top)
		if (!at) return
		if (at.kind === "chip") {
			selectedColour = at.colour
			showColumnBar()
			return draw()
		}
		if (at.kind === "anchor") {
			const column = doc().columns.find(c => c.colour === at.colour)
			const next = ANCHORS[(ANCHORS.indexOf(column?.anchor ?? "colour-left") + 1) % ANCHORS.length]
			canvas.title = ANCHOR_NAME[next]
			return handle.change(d => setColumn(d, at.colour, {anchor: next}))
		}
		if (at.kind === "gutter") return editGutter(at.id, at.rowId)
		if (tool === "picker") {
			const {f, b} = cellOf(doc(), at.colour, at.rowId, at.i)
			// a stitch for both beds, if it's one; else the charm's own for the bed clicked
			const code = at.bed === "f" ? f : b
			stitch = STITCHES.find(each => each.f === f && each.b === b) ?? CHARM_STITCHES.find(each => at.bed in each && each[at.bed] === code) ?? stitch
			return showPalette()
		}
		canvas.setPointerCapture(event.pointerId)
		const erasing = tool === "eraser"
		pending = new Map()
		addCells(at.colour, [at], erasing)
		drag = {from: at, erasing}
		draw()
	}

	function onPointerMove(event) {
		const rect = canvas.getBoundingClientRect()
		const at = hit(event.clientX - rect.left, event.clientY - rect.top)
		if (!drag) {
			canvas.title = at?.kind === "anchor" ? ANCHOR_NAME[doc().columns.find(c => c.colour === at.colour)?.anchor ?? "colour-left"] : ""
			return
		}
		if (!at || at.kind !== "cell" || at.colour !== drag.from.colour) return
		if (tool === "brush" || tool === "eraser") addCells(at.colour, [at], drag.erasing)
		else {
			pending = new Map()
			addCells(at.colour, shapeCells(drag.from, at), drag.erasing)
		}
		draw()
	}

	function onPointerUp() {
		if (!drag) return
		drag = null
		keep()
		draw()
	}

	function onWheel(event) {
		event.preventDefault()
		if (event.ctrlKey || event.metaKey) view.cell = Math.max(10, Math.min(48, view.cell * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
		else {
			view.x = Math.max(0, view.x + event.deltaX)
			view.y = Math.max(0, view.y - event.deltaY)
		}
		draw()
	}

	function onKey(event) {
		if (event.target !== canvas || event.metaKey || event.ctrlKey || event.altKey) return
		const each = TOOLS.find(t => t.key === event.key)
		if (each) return setTool(each.id)
		if (/^[0-9]$/.test(event.key)) {
			stitch = STITCHES.find(t => t.key === event.key) ?? stitch
			showPalette()
		}
	}

	canvas.addEventListener("pointerdown", onPointerDown)
	canvas.addEventListener("pointermove", onPointerMove)
	canvas.addEventListener("pointerup", onPointerUp)
	canvas.addEventListener("pointercancel", onPointerUp)
	canvas.addEventListener("wheel", onWheel, {passive: false})
	canvas.addEventListener("keydown", onKey)

	function resize() {
		const rect = stage.getBoundingClientRect()
		size = {width: rect.width, height: rect.height}
		canvas.width = Math.round(rect.width * devicePixelRatio)
		canvas.height = Math.round(rect.height * devicePixelRatio)
		draw()
	}

	function onTheme() {
		colours = readColours(root)
		showPalette()
		draw()
	}

	function onChange() {
		if (selectedRow && !doc().rows.some(row => row.id === selectedRow)) selectedRow = null
		if (selectedColour != null && !doc().columns.some(column => column.colour === selectedColour)) selectedColour = null
		showColumnBar()
		draw()
	}

	const scheme = matchMedia("(prefers-color-scheme: dark)")
	scheme.addEventListener("change", onTheme)
	link.addEventListener("load", onTheme, {once: true})
	const resizeObserver = new ResizeObserver(resize)
	resizeObserver.observe(stage)
	handle.on("change", onChange)

	setTool("brush")
	onTheme()
	showColumnBar()

	return () => {
		follow.stop()
		cancelAnimationFrame(frame)
		resizeObserver.disconnect()
		scheme.removeEventListener("change", onTheme)
		handle.off("change", onChange)
		link.remove()
		root.remove()
	}
}
