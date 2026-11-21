// a patternstoat's editor, as a pixel painter: a bar of trays (skitch's,
// wm/ui/trays.js) with the tools, one palette (the charm's colours, then
// stitches, then yarns: what's picked is what's painted), undo, and the
// setup out of the way under ⚙. a stitch painted anywhere is what that bed
// knits (build.js). built into its .k by its builder (build-kind.js), with
// the build bar a .js and a .k have: wm draws it over this, and where
// nothing does, this draws it itself
import {stylesheet} from "../wm/ui/stylesheet.js"
import {TRAYS_STYLESHEET, popover, press, swatch, tray, trayBar, trayButton} from "../wm/ui/trays.js"
import {YARNS_CHANGED, yarnColours} from "../knitoutjs/core/yarns.js"
import {takeBuilder} from "../knitoutjs/core/builder.js"
import {mountBuildBar} from "../knitoutjs/core/build-bar.js"
import {stoatBuild} from "./build-kind.js"
import {resize as resizeStoat} from "./patternstoat.js"
import {applyRecord, floodCells, recordOf, undoOf, yarnAfterPick} from "./painting.js"
import {columnsOf} from "./charm.js"
import {followView} from "./follow-view.js"
import {STITCHES, drawCode, readColours, stitchSwatch} from "./glyphs.js"

const STYLESHEET = new URL("./patternstoat.css", import.meta.url).href
const TOOLS = [
	{id: "brush", icon: "pencil", name: "pencil", key: "b", title: "paint what's picked onto cells (shift click: a line from the last)"},
	{id: "line", icon: "line", name: "line", key: "l", title: "a line of it"},
	{id: "rect", icon: "rect", name: "box", key: "r", title: "a box of it"},
	{id: "fill", icon: "fill", name: "fill", key: "f", title: "pour it into the cells joined to this one that are the same"},
	{id: "eraser", icon: "eraser", name: "rub out", key: "e", title: "rub out colours (or, with a stitch picked, stitches)"},
	{id: "picker", icon: "eyedropper", name: "pick", key: "i", title: "pick what a cell has: its stitch, or else its colour"},
	{id: "hand", icon: "hand", name: "move", key: "h", title: "move round the design (or hold space, or scroll)"},
]
const GUTTER = 48
const YARN_STRIP = 10
const HISTORY = 200
// what each kind of thing picked paints, in painting.js's records
const KIND = {colour: "colours", stitch: "stitches", yarn: "yarns"}

function numberField(label, title, onValue, {min = 1, max = 252} = {}) {
	const input = document.createElement("input")
	input.type = "number"
	input.min = String(min)
	input.max = String(max)
	input.step = "1"
	input.title = title
	input.addEventListener("change", () => {
		const value = Math.round(Number(input.value))
		if (Number.isFinite(value) && value >= min && value <= max) onValue(value)
	})
	const wrap = document.createElement("label")
	wrap.append(label, input)
	return {wrap, input}
}

// the cells of a line from one to another
function lineCells(a, b) {
	const out = []
	let [x, y] = [a.x, a.row]
	const dx = Math.abs(b.x - x)
	const dy = -Math.abs(b.row - y)
	const sx = x < b.x ? 1 : -1
	const sy = y < b.row ? 1 : -1
	let err = dx + dy
	for (;;) {
		out.push({x, row: y})
		if (x === b.x && y === b.row) break
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

const key = (x, row) => `${x},${row}`

export default function StoatTool(handle, element, context = {}) {
	const repo = context.repo ?? element.repo
	const doc = () => handle.doc()

	const root = document.createElement("div")
	root.className = "stoat patternstoat"
	const link = stylesheet(STYLESHEET, root)
	const traysLink = stylesheet(TRAYS_STYLESHEET, root)
	element.append(link, traysLink, root)

	// ── the setup, under ⚙: which charm, how big, where on the bed, the
	// gauge

	const charmSelect = document.createElement("select")
	charmSelect.title = "the charm this is knitted with: what each colour does"
	charmSelect.addEventListener("change", () => {
		const url = charmSelect.value || null
		changeHere(d => {
			if (d.charm !== url) d.charm = url
		})
	})
	const charmLabel = document.createElement("label")
	charmLabel.append("charm", charmSelect)
	const width = numberField("width", "cells across", value => changeHere(d => resizeStoat(d, value, d.height)), {max: 252})
	const height = numberField("rows", "rows up", value => changeHere(d => resizeStoat(d, d.width, value)), {max: 2000})
	const left = numberField("from needle", "the bed needle its left edge is on", value => changeHere(d => {
		if (d.left !== value) d.left = value
	}))
	const gaugeSelect = document.createElement("select")
	gaugeSelect.title = "half gauge: a cell's front and back are a pair of needles, so a cast off has empty needles to go through. full: both on one"
	gaugeSelect.append(new Option("half gauge", "2"), new Option("full gauge", "1"))
	gaugeSelect.addEventListener("change", () => changeHere(d => {
		const gauge = Number(gaugeSelect.value)
		if (d.gauge !== gauge) d.gauge = gauge
	}))
	const gaugeLabel = document.createElement("label")
	gaugeLabel.append("gauge", gaugeSelect)

	// ── the bar: tools, the palette, yarns, undo, setup

	const bar = trayBar("stoat-trays")
	const toolButtons = new Map()
	const tools = tray()
	for (const each of TOOLS) {
		const b = trayButton({icon: each.icon, label: each.name, title: `${each.name}: ${each.title}`, key: each.key, onClick: () => setTool(each.id)})
		toolButtons.set(each.id, b)
		tools.append(b)
	}
	const palette = tray()
	palette.classList.add("stoat-palette")
	const yarns = tray()
	const undoButton = trayButton({icon: "undo", label: "undo", title: "undo what you painted", key: "⌘z", onClick: () => undo()})
	const redoButton = trayButton({icon: "redo", label: "redo", title: "redo it", key: "⇧⌘z", onClick: () => redo()})
	const setupButton = trayButton({icon: "gear", label: "setup", title: "the charm, the size, where it's knitted"})
	const fitButton = trayButton({icon: "fit", text: "fit", label: "fit", title: "fit the design in view", onClick: () => {
		fit()
		draw()
		setup.close()
	}})
	const setup = popover(setupButton, charmLabel, width.wrap, height.wrap, left.wrap, gaugeLabel, fitButton)
	const spacer = document.createElement("div")
	spacer.className = "tray-spacer"
	bar.append(tools, palette, yarns, tray(undoButton, redoButton), spacer, tray(setupButton), setup.element)
	root.append(bar)

	const stage = document.createElement("div")
	stage.className = "stoat-stage"
	const canvas = document.createElement("canvas")
	canvas.tabIndex = 0
	stage.append(canvas)
	root.append(stage)
	const ctx = canvas.getContext("2d")

	// ── state

	let tool = "brush"
	// what's painted: {kind: "colour", value: 1} | {kind: "stitch", value:
	// one of STITCHES} | {kind: "yarn", value: "3"}
	let picked = {kind: "colour", value: 1}
	// what the yarn strip paints in: the last yarn picked
	let stripYarn = "3"
	const view = {cell: 12, x: 0, y: 0}
	let size = {width: 0, height: 0}
	let colours = null
	let charmHandle = null
	let charmUrl = null
	let kDoc = null
	let problem = null
	let fitted = false
	// following someone, it's where they've moved and zoomed to (follow-view.js)
	const follow = followView(element, repo, view, () => {
		fitted = true
		draw()
	})
	// a stroke, before it's kept: cell → what it'll be, of `pendingKind`
	let pending = new Map()
	let pendingKind = "colours"
	let drag = null
	let last = null
	let spaceHeld = false
	// strokes, to take back and do again: {before, after} (painting.js)
	const history = []
	const future = []
	// closed: anything still on its way is dropped
	let disposed = false

	const charm = () => charmHandle?.doc() ?? null
	const hexOf = c => charm()?.columns?.find(column => column.colour === c)?.hex ?? null

	function setTool(id) {
		tool = id
		for (const [each, b] of toolButtons) press(b, each === id)
		canvas.style.cursor = id === "hand" ? "grab" : "crosshair"
	}

	function pick(next) {
		picked = next
		stripYarn = yarnAfterPick(stripYarn, next)
		showPalette()
	}

	const isPicked = (kind, value) => picked.kind === kind && (kind === "stitch" ? picked.value.id === value.id : picked.value === value)

	function showPalette() {
		palette.replaceChildren()
		columnsOf(charm()).forEach((column, i) => {
			const b = swatch({
				colour: column.hex,
				label: `${column.colour}: ${column.name}`,
				key: i < 9 ? String(i + 1) : undefined,
				onClick: () => pick({kind: "colour", value: column.colour}),
			})
			press(b, isPicked("colour", column.colour))
			palette.append(b)
		})
		if (!charm()) palette.append(Object.assign(document.createElement("span"), {className: "stoat-note", textContent: "no charm: pick one under ⚙"}))
		if (colours) {
			const divider = document.createElement("span")
			divider.className = "tray-divider"
			palette.append(divider)
			for (const each of STITCHES) {
				if (!each.f && !each.b) continue
				const b = swatch({content: stitchSwatch(each, colours, 22), label: each.name, className: "stoat-stitch", onClick: () => pick({kind: "stitch", value: each})})
				press(b, isPicked("stitch", each))
				palette.append(b)
			}
		}
		yarns.replaceChildren()
		const hexes = yarnColours(kDoc)
		for (let c = 1; c <= 6; c++) {
			const yarn = String(c)
			const number = document.createElement("span")
			number.className = "stoat-yarn-number"
			number.textContent = yarn
			const b = swatch({colour: hexes[c - 1], content: number, label: `yarn ${c}`, title: `yarn ${c}: paint rows in it (or drag down the strip at the left)`, onClick: () => pick({kind: "yarn", value: yarn})})
			press(b, isPicked("yarn", yarn))
			yarns.append(b)
		}
		undoButton.disabled = !history.length
		redoButton.disabled = !future.length
	}

	function readTheme() {
		colours = readColours(root)
		showPalette()
	}

	// ── where things are

	const s = () => view.cell
	const cellLeft = x => GUTTER - view.x + x * s()
	const rowTop = row => size.height + view.y - (row + 1) * s()
	function cellAt(px, py) {
		return {x: Math.floor((px - GUTTER + view.x) / s()), row: Math.floor((size.height + view.y - py) / s())}
	}
	const inside = ({x, row}) => {
		const d = doc()
		return d && x >= 0 && row >= 0 && x < d.width && row < d.height
	}

	function fit() {
		const d = doc()
		if (!d || !size.width) return
		const across = (size.width - GUTTER - 8) / d.width
		const up = (size.height - 8) / d.height
		view.cell = Math.max(2, Math.min(40, Math.floor(Math.min(across, up))))
		view.x = 0
		view.y = 0
	}

	// ── drawing

	let frame = 0
	function draw() {
		cancelAnimationFrame(frame)
		frame = requestAnimationFrame(paint)
	}

	function paint() {
		const d = doc()
		if (!d || !colours || !size.width) return
		follow.shared()
		ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
		ctx.fillStyle = colours.sheet
		ctx.fillRect(0, 0, size.width, size.height)
		const cell = s()
		const firstX = Math.max(0, Math.floor(view.x / cell))
		const lastX = Math.min(d.width - 1, Math.ceil((view.x + size.width - GUTTER) / cell))
		const firstRow = Math.max(0, Math.floor(view.y / cell))
		const lastRow = Math.min(d.height - 1, Math.ceil((view.y + size.height) / cell))

		for (let row = firstRow; row <= lastRow; row++) {
			const top = rowTop(row)
			for (let x = firstX; x <= lastX; x++) {
				const at = key(x, row)
				const c = pendingKind === "colours" && pending.has(at) ? pending.get(at) : d.colours[row]?.[x]
				if (!c) continue
				const hex = hexOf(c)
				ctx.fillStyle = hex ?? colours.danger
				ctx.globalAlpha = hex ? 1 : 0.35
				ctx.fillRect(cellLeft(x), top, cell, cell)
				ctx.globalAlpha = 1
			}
			for (let x = firstX; x <= lastX; x++) {
				const at = key(x, row)
				const painted = pendingKind === "stitches" && pending.has(at) ? pending.get(at) : d.stitches?.[row]?.[x]
				if (!painted || (!painted.f && !painted.b)) continue
				const half = cell / 2
				const pad = cell >= 10 ? 1 : 0
				ctx.fillStyle = colours.sheet
				ctx.globalAlpha = 0.85
				ctx.fillRect(cellLeft(x) + pad, top + pad, cell - pad * 2, cell - pad * 2)
				ctx.globalAlpha = 1
				drawCode(ctx, painted.b, cellLeft(x), top, cell, half, colours, false)
				drawCode(ctx, painted.f, cellLeft(x), top + half, cell, half, colours, true)
			}
		}

		if (cell >= 6) {
			ctx.fillStyle = colours.grid
			for (let x = firstX; x <= lastX + 1; x++) ctx.fillRect(Math.round(cellLeft(x)), Math.max(0, rowTop(d.height - 1)), 1, Math.min(size.height, d.height * cell))
			for (let row = firstRow; row <= lastRow + 1; row++) ctx.fillRect(GUTTER, Math.round(rowTop(row - 1)), Math.min(size.width, d.width * cell - view.x), 1)
		}

		if (problem && problem.row != null) {
			const row = problem.row - 1
			const gauge = d.gauge === 1 ? 1 : 2
			const x = problem.needle == null ? null : Math.floor((problem.needle - d.left) / gauge)
			ctx.strokeStyle = colours.danger
			ctx.lineWidth = 2
			if (x == null) ctx.strokeRect(GUTTER, rowTop(row), d.width * cell - view.x, cell)
			else ctx.strokeRect(cellLeft(x) + 1, rowTop(row) + 1, cell - 2, cell - 2)
		}

		// the gutter: row numbers, and each row's yarn
		ctx.fillStyle = colours.chrome
		ctx.fillRect(0, 0, GUTTER, size.height)
		const yarnHex = yarnColours(kDoc)
		ctx.font = `10px ${colours.mono}`
		ctx.textAlign = "right"
		ctx.textBaseline = "middle"
		for (let row = firstRow; row <= lastRow; row++) {
			const top = rowTop(row)
			const yarn = pendingKind === "yarns" && pending.has(key(0, row)) ? pending.get(key(0, row)) : d.yarns?.[row]
			ctx.fillStyle = yarnHex[Number(yarn) - 1] ?? colours.danger
			ctx.fillRect(GUTTER - YARN_STRIP, top, YARN_STRIP - 1, cell)
			if (cell >= 10 || (row + 1) % 10 === 0) {
				ctx.fillStyle = colours.muted
				ctx.fillText(String(row + 1), GUTTER - YARN_STRIP - 4, top + cell / 2)
			}
		}
	}

	// ── painting

	// what a stroke paints, and as what kind (rubbing out with a yarn picked
	// rubs out colours: a row has to have a yarn)
	function strokeKind(erasing) {
		if (erasing) return picked.kind === "stitch" ? "stitches" : "colours"
		return KIND[picked.kind]
	}
	function valueOf(kind, erasing) {
		if (kind === "colours") return erasing ? 0 : picked.value
		if (kind === "stitches") return erasing ? {f: null, b: null} : {f: picked.value.f, b: picked.value.b}
		return picked.value
	}

	// cells into the stroke: a yarn's are their rows (each kept at x 0)
	function addCells(cells, erasing) {
		pendingKind = strokeKind(erasing)
		const value = valueOf(pendingKind, erasing)
		for (const cell of cells) {
			if (!inside(cell)) continue
			pending.set(pendingKind === "yarns" ? key(0, cell.row) : key(cell.x, cell.row), value)
		}
	}

	function previewShape(a, b, erasing) {
		pending = new Map()
		if (tool === "line") addCells(lineCells(a, b), erasing)
		else {
			const cells = []
			for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
				for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) cells.push({x, row})
			}
			addCells(cells, erasing)
		}
	}

	// the cells a fill pours into: the same colour (with a stitch picked, the
	// same colour and stitch; with a yarn, the run of rows in the same yarn)
	function fillCells(cell) {
		const d = doc()
		if (picked.kind === "yarn") return floodCells(d.yarns.map(yarn => [yarn]), 0, cell.row).map(([, row]) => ({x: 0, row}))
		const grid =
			picked.kind === "stitch"
				? d.colours.map((row, r) => row.map((c, x) => `${c}|${d.stitches?.[r]?.[x]?.f ?? ""}|${d.stitches?.[r]?.[x]?.b ?? ""}`))
				: d.colours
		return floodCells(grid, cell.x, cell.row).map(([x, row]) => ({x, row}))
	}

	// the stroke, into the doc in one change, kept to take back
	function keep() {
		if (!pending.size) return
		const kind = pendingKind
		const record = {kind, cells: [...pending].map(([at, value]) => [...at.split(",").map(Number), value])}
		pending = new Map()
		const points = record.cells.map(([x, row]) => [x, row])
		const before = recordOf(doc(), kind, points)
		changeHere(d => applyRecord(d, record))
		remember({before, after: recordOf(doc(), kind, points)})
	}

	function remember(stroke) {
		history.push(stroke)
		if (history.length > HISTORY) history.shift()
		future.length = 0
		showPalette()
	}

	// take back the last stroke (what's still as it left it), or do it again
	function undo() {
		while (history.length) {
			const stroke = history.pop()
			const record = undoOf(doc(), stroke)
			if (!record) continue
			changeHere(d => applyRecord(d, record))
			future.push(stroke)
			break
		}
		showPalette()
		draw()
	}
	function redo() {
		while (future.length) {
			const stroke = future.pop()
			const record = undoOf(doc(), {before: stroke.after, after: stroke.before})
			if (!record) continue
			changeHere(d => applyRecord(d, record))
			history.push(stroke)
			break
		}
		showPalette()
		draw()
	}

	// pick what a cell has: its stitch, if it has one, or its colour
	function pickFrom(cell) {
		const d = doc()
		if (!inside(cell)) return
		const painted = d.stitches?.[cell.row]?.[cell.x]
		const stitch = (painted?.f || painted?.b) && STITCHES.find(each => each.f === (painted.f ?? null) && each.b === (painted.b ?? null))
		if (stitch) return pick({kind: "stitch", value: stitch})
		const c = d.colours[cell.row][cell.x]
		if (c) pick({kind: "colour", value: c})
	}

	function onPointerDown(event) {
		canvas.focus()
		setup.close()
		const rect = canvas.getBoundingClientRect()
		const px = event.clientX - rect.left
		const py = event.clientY - rect.top
		canvas.setPointerCapture(event.pointerId)
		if (event.button === 1 || tool === "hand" || spaceHeld) {
			drag = {kind: "pan", px, py, x: view.x, y: view.y}
			return
		}
		if (event.button !== 0) return
		if (px < GUTTER) {
			// the yarn strip: rows in the last yarn picked
			const {row} = cellAt(GUTTER, py)
			const yarn = stripYarn
			pending = new Map()
			pendingKind = "yarns"
			if (row >= 0 && row < doc().height) pending.set(key(0, row), yarn)
			drag = {kind: "yarn", from: row, yarn}
			draw()
			return
		}
		const cell = cellAt(px, py)
		if (tool === "picker") return pickFrom(cell)
		const erasing = tool === "eraser"
		pending = new Map()
		if (tool === "fill") {
			if (inside(cell)) addCells(fillCells(cell), false)
			keep()
			draw()
			return
		}
		if (tool === "brush" || tool === "eraser") {
			addCells(event.shiftKey && last ? lineCells(last, cell) : [cell], erasing)
			drag = {kind: "brush", erasing, at: cell}
		} else {
			drag = {kind: "shape", erasing, from: cell}
			previewShape(cell, cell, erasing)
		}
		draw()
	}

	function onPointerMove(event) {
		if (!drag) return
		const rect = canvas.getBoundingClientRect()
		const px = event.clientX - rect.left
		const py = event.clientY - rect.top
		if (drag.kind === "pan") {
			view.x = Math.max(-GUTTER, drag.x - (px - drag.px))
			view.y = drag.y + (py - drag.py)
		} else if (drag.kind === "yarn") {
			const {row} = cellAt(GUTTER, py)
			pending = new Map()
			for (let r = Math.min(drag.from, row); r <= Math.max(drag.from, row); r++) if (r >= 0 && r < doc().height) pending.set(key(0, r), drag.yarn)
		} else if (drag.kind === "brush") {
			const cell = cellAt(px, py)
			addCells(lineCells(drag.at, cell), drag.erasing)
			drag.at = cell
		} else previewShape(drag.from, cellAt(px, py), drag.erasing)
		draw()
	}

	function onPointerUp() {
		if (!drag) return
		const done = drag
		drag = null
		if (done.kind === "brush" || done.kind === "shape") last = done.at ?? null
		if (done.kind !== "pan") keep()
		draw()
	}

	function onWheel(event) {
		event.preventDefault()
		if (event.ctrlKey || event.metaKey) {
			const rect = canvas.getBoundingClientRect()
			const px = event.clientX - rect.left
			const py = event.clientY - rect.top
			const before = cellAt(px, py)
			view.cell = Math.max(2, Math.min(60, view.cell * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
			const after = cellAt(px, py)
			view.x += (before.x - after.x) * view.cell
			view.y -= (before.row - after.row) * view.cell
		} else {
			view.x = Math.max(-GUTTER, view.x + event.deltaX)
			view.y = view.y - event.deltaY
		}
		draw()
	}

	function onKey(event) {
		if (event.target.closest?.("input, select, textarea")) return
		if (event.key === " " && event.target === canvas) {
			spaceHeld = event.type === "keydown"
			event.preventDefault()
			return
		}
		if (event.type !== "keydown" || event.altKey) return
		const mod = event.metaKey || event.ctrlKey
		if (mod && event.key.toLowerCase() === "z") {
			event.preventDefault()
			return event.shiftKey ? redo() : undo()
		}
		if (mod) return
		const each = TOOLS.find(t => t.key === event.key)
		if (each) return setTool(each.id)
		if (/^[1-9]$/.test(event.key)) {
			const column = columnsOf(charm())[Number(event.key) - 1]
			if (column) pick({kind: "colour", value: column.colour})
		}
	}

	canvas.addEventListener("pointerdown", onPointerDown)
	canvas.addEventListener("pointermove", onPointerMove)
	canvas.addEventListener("pointerup", onPointerUp)
	canvas.addEventListener("pointercancel", onPointerUp)
	canvas.addEventListener("wheel", onWheel, {passive: false})
	root.addEventListener("keydown", onKey)
	root.addEventListener("keyup", onKey)

	// ── building: its builder, shared with its bar (over this in wm, or
	// drawn here where there's none) and whatever else shows it. a change
	// made here is an edit, so autobuild builds it; the builder watches its
	// charm itself. how a build went is drawn here too: the row (and
	// needle) it went wrong at, and the .k's yarns once it's built

	const taken = takeBuilder(stoatBuild, handle.url, {
		repo,
		createFile: context.project?.createFile,
		openIfClosed: context.openIfClosed && ((url, tool) => context.openIfClosed(url, element, "right", tool)),
	}, {source: handle})
	const builder = taken.builder
	// a build that went wrong before this was open (from its bar, over this)
	if (builder.status().state === "error") problem = builder.status().error ?? null
	const unheard = builder.subscribe(status => {
		if (status.state === "error") {
			problem = status.error ?? null
			draw()
		} else if (status.state === "ok") {
			problem = null
			draw()
			const url = builder.target()
			if (url) {
				repo.find(url).then(k => {
					if (disposed) return
					kDoc = k.doc()
					draw()
				}, () => {})
			}
		}
	})
	// the bar, unless whoever's showing this draws it over it
	const holder = document.createElement("div")
	holder.style.display = "contents"
	root.prepend(holder)
	const unmountBar = mountBuildBar(holder, builder, {
		files: () => context.project?.files?.() ?? [],
		open: (url, tool) => context.open?.(url, element, "right", tool),
		hover: url => context.hover?.(url),
		docColour: url => context.docColour?.(url) ?? "transparent",
	}, {when: () => !context.bars?.(handle.url)})

	// ── keeping up: the doc, its charm, the project's charms

	function showCharms() {
		const d = doc()
		const files = context.project?.files?.() ?? []
		const charms = files.filter(file => file.extension === "charm")
		charmSelect.replaceChildren(new Option("no charm", ""))
		for (const file of charms) charmSelect.append(new Option(file.name || "charm", file.url))
		if (d?.charm && !charms.some(file => file.url === d.charm)) charmSelect.append(new Option("its charm", d.charm))
		charmSelect.value = d?.charm ?? ""
	}

	function onCharm() {
		showPalette()
		draw()
	}

	// the charm changed (here, in its arrangement, or someone's): its
	// builder builds it again (build-kind.js)
	function onCharmChange() {
		onCharm()
	}

	async function watchCharm() {
		const url = doc()?.charm ?? null
		if (url === charmUrl) return
		charmHandle?.off?.("change", onCharmChange)
		charmHandle = null
		charmUrl = url
		if (url) {
			try {
				const found = await repo.find(url)
				if (charmUrl !== url || disposed) return
				charmHandle = found
				charmHandle.on("change", onCharmChange)
			} catch (error) {
				console.warn(`patternstoat: couldn't load the charm ${url}`, error)
			}
		}
		onCharm()
	}

	function showFields() {
		const d = doc()
		if (!d) return
		if (document.activeElement !== width.input) width.input.value = String(d.width)
		if (document.activeElement !== height.input) height.input.value = String(d.height)
		if (document.activeElement !== left.input) left.input.value = String(d.left)
		gaugeSelect.value = String(d.gauge === 1 ? 1 : 2)
	}

	function onChange() {
		showFields()
		showCharms()
		watchCharm()
		draw()
	}

	// a change made here: autobuild builds it (other people's edits are
	// built by them, as knitoutjs's editor only autobuilds your own)
	function changeHere(fn) {
		handle.change(fn)
		builder.edited()
	}

	function resize() {
		const rect = stage.getBoundingClientRect()
		size = {width: rect.width, height: rect.height}
		canvas.width = Math.round(rect.width * devicePixelRatio)
		canvas.height = Math.round(rect.height * devicePixelRatio)
		if (!fitted && rect.width) {
			fit()
			fitted = true
		}
		draw()
	}

	function onTheme() {
		readTheme()
		draw()
	}

	const scheme = matchMedia("(prefers-color-scheme: dark)")
	scheme.addEventListener("change", onTheme)
	addEventListener(YARNS_CHANGED, onTheme)
	link.addEventListener("load", onTheme, {once: true})
	const resizeObserver = new ResizeObserver(resize)
	resizeObserver.observe(stage)
	handle.on("change", onChange)

	setTool("brush")
	readTheme()
	showFields()
	showCharms()
	watchCharm()
	if (doc()?.knitoutTarget) {
		repo.find(doc().knitoutTarget).then(k => {
			kDoc = k.doc()
			showPalette()
			draw()
		}, () => {})
	}

	return () => {
		disposed = true
		follow.stop()
		cancelAnimationFrame(frame)
		unheard()
		unmountBar()
		taken.drop()
		resizeObserver.disconnect()
		scheme.removeEventListener("change", onTheme)
		removeEventListener(YARNS_CHANGED, onTheme)
		handle.off("change", onChange)
		charmHandle?.off?.("change", onCharmChange)
		link.remove()
		traysLink.remove()
		root.remove()
	}
}
