// a patternstoat's editor: the design painted in its charm's colours, with a
// stitch layer on top, and a yarn a row down the side (the stripes). painted
// as the kniterate editor paints (lattice/kniterate.js), and built into its
// .k (by hand, or as you go)
import {stylesheet} from "../wm/ui/stylesheet.js"
import {YARNS_CHANGED, yarnColours} from "../knitoutjs/core/yarns.js"
import {setBuild} from "../knitoutjs/core/builds.js"
import {buildInto} from "./build-into.js"
import {paintColours, paintStitches, resize as resizeStoat, setYarns} from "./patternstoat.js"
import {STITCHES, drawCode, readColours, stitchSwatch} from "./glyphs.js"

const STYLESHEET = new URL("./patternstoat.css", import.meta.url).href
const TOOLS = [
	{id: "brush", name: "brush", key: "b", title: "paint the colour (or stitch) picked onto cells (shift click: a line from the last)"},
	{id: "line", name: "line", key: "l", title: "paint a line of it"},
	{id: "rect", name: "rect", key: "r", title: "paint a rectangle of it"},
	{id: "eraser", name: "rub out", key: "e", title: "take colours out of work (or stitches off the stitch layer)"},
	{id: "picker", name: "pick", key: "i", title: "pick the colour (or stitch) a cell has"},
	{id: "hand", name: "move", key: "h", title: "move round the design (or hold space, or scroll)"},
]
const PAINTS = new Set(["brush", "line", "rect", "eraser"])
const GUTTER = 48
const YARN_STRIP = 10
const BUILD_DELAY = 500

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
	element.append(link, root)

	// ── the bar: which charm, how big, where on the bed, the gauge, building

	const bar = document.createElement("div")
	bar.className = "stoat-bar"
	const charmSelect = document.createElement("select")
	charmSelect.title = "the charm this is knitted with: what each colour does"
	charmSelect.addEventListener("change", () => {
		const url = charmSelect.value || null
		handle.change(d => {
			if (d.charm !== url) d.charm = url
		})
	})
	const width = numberField("width", "cells across", value => handle.change(d => resizeStoat(d, value, d.height)), {max: 252})
	const height = numberField("rows", "rows up", value => handle.change(d => resizeStoat(d, d.width, value)), {max: 2000})
	const left = numberField("from needle", "the bed needle its left edge is on", value => handle.change(d => {
		if (d.left !== value) d.left = value
	}))
	const gaugeSelect = document.createElement("select")
	gaugeSelect.title = "half gauge: a cell's front and back are a pair of needles, so a cast off has empty needles to go through. full: both on one"
	gaugeSelect.append(new Option("half gauge", "2"), new Option("full gauge", "1"))
	gaugeSelect.addEventListener("change", () => handle.change(d => {
		const gauge = Number(gaugeSelect.value)
		if (d.gauge !== gauge) d.gauge = gauge
	}))
	const status = document.createElement("span")
	status.className = "stoat-status"
	const autoBox = document.createElement("input")
	autoBox.type = "checkbox"
	autoBox.checked = true
	const auto = document.createElement("label")
	auto.title = "build the .k again whenever this or its charm changes"
	auto.append(autoBox, "as you go")
	const spacer = document.createElement("div")
	spacer.className = "stoat-spacer"
	bar.append(
		group(charmSelect),
		group(width.wrap, height.wrap, left.wrap, gaugeSelect),
		spacer,
		status,
		group(button("build", "build the .k this writes", () => build()), auto, button("fit", "fit the design in view", () => {
			fit()
			draw()
		})),
	)
	root.append(bar)

	// ── the editing bar: tools, which layer, what to paint, which yarn

	const editBar = document.createElement("div")
	editBar.className = "stoat-edit"
	const toolButtons = new Map()
	const tools = group()
	for (const each of TOOLS) {
		const b = button(each.name, `${each.title} (${each.key})`, () => setTool(each.id))
		toolButtons.set(each.id, b)
		tools.append(b)
	}
	const coloursButton = button("colours", "paint colours: what each cell is knitted as (c)", () => setLayer("colours"))
	const stitchesButton = button("stitches", "paint the stitch layer, on top: what a charm's ✦ cells knit (s)", () => setLayer("stitches"))
	const layers = group(coloursButton, stitchesButton)
	const palette = group()
	const yarnSelect = document.createElement("select")
	yarnSelect.title = "the yarn to give rows: click or drag down the yarn column at the left"
	for (let c = 1; c <= 6; c++) yarnSelect.append(new Option(`yarn ${c}`, String(c)))
	yarnSelect.value = "3"
	editBar.append(tools, layers, palette, group(yarnSelect))
	root.append(editBar)

	const stage = document.createElement("div")
	stage.className = "stoat-stage"
	const canvas = document.createElement("canvas")
	canvas.tabIndex = 0
	stage.append(canvas)
	root.append(stage)
	const ctx = canvas.getContext("2d")

	// ── state

	let tool = "brush"
	let layer = "colours"
	let colour = 1
	let stitch = STITCHES[0]
	const view = {cell: 12, x: 0, y: 0}
	let size = {width: 0, height: 0}
	let colours = null
	let charmHandle = null
	let charmUrl = null
	let kDoc = null
	let problem = null
	let fitted = false
	// a stroke, before it's kept: cell → what it'll be
	let pending = new Map()
	let pendingYarns = null
	let drag = null
	let last = null
	let spaceHeld = false

	const charm = () => charmHandle?.doc() ?? null
	const hexOf = c => charm()?.columns?.find(column => column.colour === c)?.hex ?? null

	function setTool(id) {
		tool = id
		for (const [each, b] of toolButtons) b.setAttribute("aria-pressed", String(each === id))
		canvas.style.cursor = id === "hand" ? "grab" : "crosshair"
	}

	function setLayer(id) {
		layer = id
		coloursButton.setAttribute("aria-pressed", String(id === "colours"))
		stitchesButton.setAttribute("aria-pressed", String(id === "stitches"))
		showPalette()
	}

	function showPalette() {
		palette.replaceChildren()
		if (layer === "colours") {
			for (const column of charm()?.columns ?? []) {
				const b = button("", `${column.colour}: ${column.name}`, () => {
					colour = column.colour
					showPalette()
				})
				b.className = "stoat-colour"
				const chip = document.createElement("i")
				chip.style.background = column.hex
				b.append(chip, String(column.colour))
				b.setAttribute("aria-pressed", String(column.colour === colour))
				palette.append(b)
			}
			if (!charm()) palette.append(Object.assign(document.createElement("span"), {className: "stoat-note", textContent: "no charm: pick one for its colours"}))
			return
		}
		if (!colours) return
		for (const each of STITCHES) {
			const b = button("", each.name + (each.key ? ` (${each.key})` : ""), () => {
				stitch = each
				showPalette()
			})
			b.className = "stoat-swatch"
			b.append(stitchSwatch(each, colours))
			b.setAttribute("aria-pressed", String(each.id === stitch.id))
			palette.append(b)
		}
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
				const c = layer === "colours" && pending.has(at) ? pending.get(at) : d.colours[row]?.[x]
				if (!c) continue
				const hex = hexOf(c)
				ctx.fillStyle = hex ?? colours.danger
				ctx.globalAlpha = hex ? 1 : 0.35
				ctx.fillRect(cellLeft(x), top, cell, cell)
				ctx.globalAlpha = 1
			}
			for (let x = firstX; x <= lastX; x++) {
				const at = key(x, row)
				const painted = layer === "stitches" && pending.has(at) ? pending.get(at) : d.stitches?.[row]?.[x]
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
			const yarn = pendingYarns?.has(row) ? pendingYarns.get(row) : d.yarns?.[row]
			ctx.fillStyle = yarnHex[Number(yarn) - 1] ?? colours.danger
			ctx.fillRect(GUTTER - YARN_STRIP, top, YARN_STRIP - 1, cell)
			if (cell >= 10 || (row + 1) % 10 === 0) {
				ctx.fillStyle = colours.muted
				ctx.fillText(String(row + 1), GUTTER - YARN_STRIP - 4, top + cell / 2)
			}
		}
	}

	// ── painting

	function valueOf(erasing) {
		if (layer === "colours") return erasing ? 0 : colour
		return erasing ? {f: null, b: null} : {f: stitch.f, b: stitch.b}
	}

	function addCells(cells, erasing) {
		const value = valueOf(erasing)
		for (const cell of cells) if (inside(cell)) pending.set(key(cell.x, cell.row), value)
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

	function keep() {
		if (!pending.size) return
		const groups = new Map()
		for (const [at, value] of pending) {
			const id = JSON.stringify(value)
			if (!groups.has(id)) groups.set(id, {value, points: []})
			groups.get(id).points.push(at.split(",").map(Number))
		}
		pending = new Map()
		handle.change(d => {
			for (const {value, points} of groups.values()) {
				if (layer === "colours") paintColours(d, points, value)
				else {
					paintStitches(d, points, "f", value.f)
					paintStitches(d, points, "b", value.b)
				}
			}
		})
	}

	function pick(cell) {
		const d = doc()
		if (!inside(cell)) return
		if (layer === "colours") {
			const c = d.colours[cell.row][cell.x]
			if (c) colour = c
		} else {
			const painted = d.stitches?.[cell.row]?.[cell.x]
			stitch = STITCHES.find(each => each.f === (painted?.f ?? null) && each.b === (painted?.b ?? null)) ?? stitch
		}
		showPalette()
	}

	function onPointerDown(event) {
		canvas.focus()
		const rect = canvas.getBoundingClientRect()
		const px = event.clientX - rect.left
		const py = event.clientY - rect.top
		canvas.setPointerCapture(event.pointerId)
		if (event.button === 1 || tool === "hand" || spaceHeld) {
			drag = {kind: "pan", px, py, x: view.x, y: view.y}
			return
		}
		if (px < GUTTER) {
			const {row} = cellAt(GUTTER, py)
			pendingYarns = new Map()
			drag = {kind: "yarn", from: row}
			pendingYarns.set(row, yarnSelect.value)
			draw()
			return
		}
		const cell = cellAt(px, py)
		if (tool === "picker") return pick(cell)
		const erasing = tool === "eraser"
		if (tool === "brush" || tool === "eraser") {
			pending = new Map()
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
			pendingYarns = new Map()
			for (let r = Math.min(drag.from, row); r <= Math.max(drag.from, row); r++) if (r >= 0 && r < doc().height) pendingYarns.set(r, yarnSelect.value)
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
		if (done.kind === "yarn") {
			const rows = [...pendingYarns.keys()]
			pendingYarns = null
			if (rows.length) handle.change(d => setYarns(d, Math.min(...rows), Math.max(...rows), yarnSelect.value))
		} else if (done.kind === "brush" || done.kind === "shape") {
			last = done.at ?? null
			keep()
		}
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
		if (event.target !== canvas) return
		if (event.key === " ") {
			spaceHeld = event.type === "keydown"
			event.preventDefault()
			return
		}
		if (event.type !== "keydown" || event.metaKey || event.ctrlKey || event.altKey) return
		const each = TOOLS.find(t => t.key === event.key)
		if (each) return setTool(each.id)
		if (event.key === "c") return setLayer("colours")
		if (event.key === "s") return setLayer("stitches")
		if (/^[0-9]$/.test(event.key)) {
			if (layer === "stitches") stitch = STITCHES.find(t => t.key === event.key) ?? stitch
			else {
				const column = charm()?.columns?.[(Number(event.key) + 9) % 10]
				if (column) colour = column.colour
			}
			showPalette()
		}
	}

	canvas.addEventListener("pointerdown", onPointerDown)
	canvas.addEventListener("pointermove", onPointerMove)
	canvas.addEventListener("pointerup", onPointerUp)
	canvas.addEventListener("pointercancel", onPointerUp)
	canvas.addEventListener("wheel", onWheel, {passive: false})
	canvas.addEventListener("keydown", onKey)
	canvas.addEventListener("keyup", onKey)

	// ── building

	let building = null
	let again = false
	let buildTimer = 0

	async function target() {
		const d = doc()
		if (d.knitoutTarget) return repo.find(d.knitoutTarget)
		if (!context.project?.createFile) return null
		const url = await context.project.createFile(`${d.title || "patternstoat"}.k`)
		handle.change(doc => {
			doc.knitoutTarget = url
		})
		context.openIfClosed?.(url, element, "right", "visualizer")
		return repo.find(url)
	}

	async function build() {
		if (building) {
			again = true
			return building
		}
		building = (async () => {
			const started = performance.now()
			setBuild(handle.url, {state: "running", message: undefined})
			showStatus("building…", "running")
			let result
			try {
				const kHandle = await target()
				if (!kHandle) result = {error: {row: null, needle: null, message: "no .k to build into: open it in a lattice project"}}
				else {
					result = await buildInto(handle, kHandle, repo)
					kDoc = kHandle.doc()
				}
			} catch (error) {
				result = {error: {row: null, needle: null, message: String(error?.message ?? error)}}
			}
			problem = result.error ?? null
			if (result.error) {
				const {row, needle, message} = result.error
				const where = [row != null && `row ${row}`, needle != null && `needle ${needle}`].filter(Boolean).join(", ")
				setBuild(handle.url, {state: "error", message})
				showStatus(where ? `${where}: ${message}` : message, "error")
			} else {
				setBuild(handle.url, {state: "ok", message: undefined})
				const lines = result.knitout.split("\n").length
				showStatus(`built in ${Math.round(performance.now() - started)}ms · ${lines.toLocaleString()} lines`, "ok")
			}
			draw()
		})()
		await building
		building = null
		if (again) {
			again = false
			build()
		}
	}

	function scheduleBuild() {
		if (!autoBox.checked) return
		clearTimeout(buildTimer)
		buildTimer = setTimeout(build, BUILD_DELAY)
	}

	function showStatus(text, state) {
		status.textContent = text
		status.title = text
		status.dataset.state = state
	}

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
		scheduleBuild()
	}

	async function watchCharm() {
		const url = doc()?.charm ?? null
		if (url === charmUrl) return
		charmHandle?.off?.("change", onCharm)
		charmHandle = null
		charmUrl = url
		if (url) {
			try {
				const found = await repo.find(url)
				if (charmUrl !== url) return
				charmHandle = found
				charmHandle.on("change", onCharm)
			} catch (error) {
				showStatus(`couldn't load the charm: ${error?.message ?? error}`, "error")
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
		scheduleBuild()
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
	setLayer("colours")
	readTheme()
	showFields()
	showCharms()
	watchCharm()
	if (doc()?.knitoutTarget) {
		repo.find(doc().knitoutTarget).then(k => {
			kDoc = k.doc()
			draw()
		}, () => {})
	}

	return () => {
		cancelAnimationFrame(frame)
		clearTimeout(buildTimer)
		resizeObserver.disconnect()
		scheme.removeEventListener("change", onTheme)
		removeEventListener(YARNS_CHANGED, onTheme)
		handle.off("change", onChange)
		charmHandle?.off?.("change", onCharm)
		link.remove()
		root.remove()
	}
}
