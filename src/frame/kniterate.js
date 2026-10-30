import {docText, moduleWorker, saveFile} from "./files.js"

const STYLESHEET = new URL("./kniterate.css", import.meta.url).href
const WORKER_URL = new URL("./kniterate-worker.js", import.meta.url)
const REDRAW_DELAY = 250

// a kcode bed line is 15 needles of nothing either side of the bed's 253
const EDGE = 15
const NEEDLES = 253

const OPS = {Kn: "knit", Tu: "tuck", Tr: "transfer", Rr: "receive", Rl: "receive"}

// the gutter's option columns, as the kniterate's editor has them beside its
// rows. narrow panes keep only the first few
const COLUMNS = [
	{id: "pass", label: "pass", width: 38, align: "right"},
	{id: "dir", label: "", width: 16},
	{id: "yarn", label: "yarn", width: 26},
	{id: "type", label: "type", width: 48},
	{id: "stitch", label: "stitch", width: 46},
	{id: "speed", label: "speed", width: 44},
	{id: "roller", label: "roller", width: 46},
	{id: "rack", label: "rack", width: 38},
]
const NARROW = 3
// rows shorter than this have no room for words, only arrows and yarns
const TEXT_ROW = 10
const RULER = 18

// the colours of carriers 1–6 until someone picks their own: the doc colours
const YARN_TOKENS = ["cherry", "blue", "stem", "lilac", "peach", "butter"].map(
	name => `--knitoutjs-${name}`,
)
const YARN_STORE = "lattice:kniterate-yarns"

function storedYarns() {
	try {
		const yarns = JSON.parse(localStorage.getItem(YARN_STORE))
		return Array.isArray(yarns) ? yarns : []
	} catch {
		return []
	}
}

function storeYarns(yarns) {
	try {
		localStorage.setItem(YARN_STORE, JSON.stringify(yarns))
	} catch {}
}

// "12-14,20" → [12, 13, 14, 20]
function parseRanges(text) {
	const lines = []
	for (const range of text.split(",")) {
		const [a, b = a] = range.split("-").map(Number)
		if (Number.isFinite(a) && Number.isFinite(b)) for (let n = a; n <= b; n++) lines.push(n)
	}
	return lines
}

// a FRNT/REAR line: which needles are selected, and where the carriage ("/"
// and "\") and the carrier (its number) start and stop, as fractional needles
function readBed(text) {
	const selected = new Uint8Array(NEEDLES)
	const stops = []
	let at = 0
	for (const char of text) {
		if (char === "." || char === "_" || char === "-") {
			const needle = at - EDGE
			if (char === "-" && needle >= 0 && needle < NEEDLES) selected[needle] = 1
			at++
		} else {
			stops.push({char, needle: at - EDGE - 0.5})
		}
	}
	return {selected, stops}
}

// the value a stitch line has where a bed is selected, or the first there is
function stitchValue(text, selected) {
	const at = selected.indexOf(1)
	return text?.[EDGE + (at === -1 ? 0 : at)] ?? ""
}

// kcode, pass by pass, as {front, back (needles selected), frontOp, backOp,
// direction, carrier, speed, roller, rack, carriage: [l, r], carrierSpan,
// stitch, comments, kLines}
export function parseKcode(text) {
	const passes = []
	let rack = 0
	let fields = {}
	let comments = []
	let kLines = []
	for (const raw of text.split("\n")) {
		const line = raw.trim()
		if (!line || line === "HOME") continue
		if (line.startsWith("//")) {
			const comment = line.slice(2).trim()
			if (comment.startsWith("lines ")) kLines = parseRanges(comment.slice(6))
			else if (comment) comments.push(comment)
			continue
		}
		if (line.startsWith("RACK:")) {
			rack = Number(line.slice(5)) || 0
			continue
		}
		const field = line.match(/^(FRNT|STIF|REAR|STIR):(.*)$/)
		if (field) {
			fields[field[1]] = field[2]
			continue
		}
		const op = line.match(/^(<<|>>)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/)
		if (!op) {
			// a pause's message, shown on the machine before the next pass
			comments.push(`pause: ${line}`)
			continue
		}
		const front = readBed(fields.FRNT ?? "")
		const back = readBed(fields.REAR ?? "")
		const [frontOp, backOp] = op[2].split("-")
		const carrier = op[3] === "0" ? null : op[3]
		const carriage = front.stops.filter(stop => stop.char === "/" || stop.char === "\\")
		const yarn = front.stops.filter(stop => stop.char === carrier)
		const frontStitch = stitchValue(fields.STIF, front.selected)
		const backStitch = stitchValue(fields.STIR, back.selected)
		const usesFront = front.selected.includes(1)
		const usesBack = back.selected.includes(1)
		passes.push({
			index: passes.length,
			front: front.selected,
			back: back.selected,
			frontOp,
			backOp,
			type: op[2],
			direction: op[1] === ">>" ? "+" : "-",
			carrier,
			speed: op[4],
			roller: op[5],
			rack,
			carriage: carriage.length === 2 ? [carriage[0].needle, carriage[1].needle] : null,
			carrierSpan: yarn.length === 2 ? [yarn[0].needle, yarn[1].needle] : null,
			stitch:
				usesFront && usesBack && frontStitch !== backStitch
					? `${frontStitch}/${backStitch}`
					: usesBack
						? backStitch
						: frontStitch,
			empty: !usesFront && !usesBack,
			comments,
			kLines,
			jsLines: [],
		})
		fields = {}
		comments = []
		kLines = []
	}
	return passes
}

// which line of the .js wrote each line of a .k (its ";!source:24")
function jsLinesOf(text) {
	return text.split("\n").map(line => {
		const match = line.match(/;!source:(-?\d+)/)
		return match ? Number(match[1]) : null
	})
}

// kcode from knitout, in a worker where the browser allows it
function converter() {
	let worker = null
	try {
		worker = moduleWorker(WORKER_URL)
	} catch {}
	const waiting = new Map()
	let requests = 0
	if (worker) {
		worker.onmessage = ({data}) => {
			const {resolve} = waiting.get(data.id) ?? {}
			waiting.delete(data.id)
			resolve?.(data)
		}
		worker.onerror = event => {
			event.preventDefault()
			console.warn("kniterate: converting on the page instead of a worker:", event.message)
			worker.terminate()
			worker = null
			for (const [, {resolve, request}] of waiting) inPage(request).then(resolve)
			waiting.clear()
		}
	}
	async function inPage({text, name, options}) {
		const {knitoutToKcode} = await import("./vendor/knitout-to-kcode.js")
		try {
			return {kcode: knitoutToKcode(text, name, options), warnings: []}
		} catch (error) {
			return {error: String(error?.message ?? error), warnings: []}
		}
	}
	return {
		convert(text, name, options) {
			const request = {id: ++requests, text, name, options}
			if (!worker) return inPage(request)
			worker.postMessage(request)
			return new Promise(resolve => waiting.set(request.id, {resolve, request}))
		},
		destroy: () => worker?.terminate(),
	}
}

function button(text, title, onClick) {
	const element = document.createElement("button")
	element.className = "knitout-button"
	element.textContent = text
	element.title = title
	element.addEventListener("click", onClick)
	return element
}

/**
 * the passes a .k makes on a kniterate, drawn the way the kniterate's own
 * editor draws them: a row for each pass of the carriage (the first at the
 * bottom), a cell for each needle in the yarn's colour, and the pass's
 * options (direction, yarn, stitch, speed, roller, rack) down the side.
 *
 * the .k goes through knitout-to-kcode first, so what's drawn is what the
 * machine would do: transfers split into their passes, carriage moves put in.
 *
 * like the visualiser it sends knitout:hover-source, knitout:select-source and
 * knitout:goto-source (a pass knows the lines that made it), and lights up the
 * passes made by the lines in knitout:highlight-lines events
 */
export default function KniterateTool(handle, element, context = {}) {
	const events = context.events ?? element

	const link = document.createElement("link")
	link.rel = "stylesheet"
	link.href = STYLESHEET
	element.appendChild(link)

	const root = document.createElement("div")
	root.className = "knitoutjs-editor-tool kniterate"
	element.appendChild(root)

	// ── the toolbar: which side to look from, the yarns, and the buttons

	const bar = document.createElement("div")
	bar.className = "kniterate-bar"
	root.appendChild(bar)

	const sides = document.createElement("div")
	sides.className = "kniterate-sides"
	const frontButton = button("front", "look at the front bed, as you'd stand at the machine", () =>
		setSide("front"),
	)
	const rearButton = button("rear", "look at the back bed, from behind (or hold shift)", () =>
		setSide("rear"),
	)
	sides.append(frontButton, rearButton)

	const yarnChips = document.createElement("div")
	yarnChips.className = "kniterate-yarns"
	const picker = document.createElement("input")
	picker.type = "color"
	picker.hidden = true
	let picking = null
	const chips = YARN_TOKENS.map((_, index) => {
		const chip = document.createElement("button")
		chip.className = "kniterate-yarn"
		chip.textContent = String(index + 1)
		chip.title = `carrier ${index + 1}: click to pick the colour of its yarn (double click for the usual one)`
		chip.addEventListener("click", () => {
			picking = index
			picker.value = toHex(colours.yarns[index])
			picker.click()
		})
		chip.addEventListener("dblclick", () => setYarn(index, null))
		return chip
	})
	picker.addEventListener("input", () => picking != null && setYarn(picking, picker.value))
	yarnChips.append(...chips, picker)

	const spacer = document.createElement("div")
	spacer.className = "kniterate-spacer"

	// what the converter warned about, if anything
	const warningsBadge = document.createElement("span")
	warningsBadge.className = "kniterate-warnings"
	warningsBadge.hidden = true

	bar.append(
		sides,
		yarnChips,
		spacer,
		warningsBadge,
		button("reset zoom", "fit the knitting in view again (scroll to move around, pinch or ctrl+scroll to zoom)", () => {
			fit()
			requestDraw()
		}),
		button("export kcode", "save this as a .kc file: kcode, the format a Kniterate machine reads", exportKcode),
	)

	const stage = document.createElement("div")
	stage.className = "kniterate-stage"
	root.appendChild(stage)

	const canvas = document.createElement("canvas")
	canvas.tabIndex = 0
	stage.appendChild(canvas)
	const ctx = canvas.getContext("2d")

	const empty = document.createElement("div")
	empty.className = "kniterate-empty"
	empty.textContent = "no passes yet"
	stage.appendChild(empty)

	const status = document.createElement("div")
	status.className = "kniterate-status"
	root.appendChild(status)

	const errorBar = document.createElement("div")
	errorBar.className = "kniterate-error"
	errorBar.hidden = true
	root.appendChild(errorBar)

	const HINT =
		"point at a needle to see what it does · click to find its line · double click to put the cursor there · hold shift to see the rear"

	// ── colours: the theme's, read off the page so the canvas can use them

	const probe = document.createElement("span")
	probe.className = "kniterate-probe"
	root.appendChild(probe)

	function resolve(value) {
		probe.style.color = ""
		probe.style.color = value
		return getComputedStyle(probe).color
	}

	function toHex(colour) {
		const scratch = document.createElement("canvas").getContext("2d")
		scratch.fillStyle = colour
		const value = scratch.fillStyle
		return value.startsWith("#") ? value : "#888888"
	}

	let colours = null
	function readColours() {
		const chosen = storedYarns()
		colours = {
			sheet: resolve("var(--knitoutjs-sheet)"),
			ink: resolve("var(--knitoutjs-ink)"),
			muted: resolve("var(--knitoutjs-muted)"),
			grid: resolve("var(--knitoutjs-line-soft)"),
			chrome: resolve("var(--knitoutjs-chrome)"),
			highlight: resolve("var(--knitoutjs-highlighter)"),
			accent: resolve("var(--knitoutjs-accent)"),
			mono: getComputedStyle(root).getPropertyValue("--knitoutjs-mono").trim() || "monospace",
			yarns: YARN_TOKENS.map((token, index) => chosen[index] || resolve(`var(${token})`)),
		}
		chips.forEach((chip, index) => chip.style.setProperty("--yarn", colours.yarns[index]))
	}

	function setYarn(index, colour) {
		const yarns = storedYarns()
		yarns[index] = colour
		storeYarns(yarns)
		readColours()
		requestDraw()
	}

	const scheme = matchMedia("(prefers-color-scheme: dark)")
	function onScheme() {
		readColours()
		requestDraw()
	}
	scheme.addEventListener("change", onScheme)

	// ── what's drawn, and from where

	let passes = []
	let side = "front"
	let shiftHeld = false
	// view.left: the column at the grid's left edge; view.bottom: the pass at
	// its bottom edge; view.cell: a needle's size in css pixels
	const view = {left: 0, bottom: 0, cell: 12}
	let fitted = false
	let hovered = null // {pass, needle?}
	let highlighted = null // {local, start, end}
	let size = {width: 0, height: 0}

	const rear = () => (side === "rear") !== shiftHeld
	const column = needle => (rear() ? NEEDLES - 1 - needle : needle)

	// turning round to the other side keeps the same needles in view
	function turn(change) {
		const before = rear()
		change()
		if (rear() !== before) {
			view.left = NEEDLES - view.left - (size.width - gutter()) / view.cell
		}
		requestDraw()
	}

	function setSide(next) {
		turn(() => (side = next))
		frontButton.classList.toggle("is-on", side === "front")
		rearButton.classList.toggle("is-on", side === "rear")
	}

	function columns() {
		if (view.cell < TEXT_ROW) return COLUMNS.filter(col => col.id === "dir" || col.id === "yarn")
		return size.width < 520 ? COLUMNS.slice(0, NARROW) : COLUMNS
	}
	function gutter() {
		return columns().reduce((sum, col) => sum + col.width, 0) + 6
	}

	// the needles in use, so the view can fit them
	function usedNeedles() {
		let min = Infinity
		let max = -Infinity
		for (const pass of passes) {
			for (let n = 0; n < NEEDLES; n++) {
				if (pass.front[n] || pass.back[n]) {
					if (n < min) min = n
					if (n > max) max = n
				}
			}
		}
		return min > max ? [0, NEEDLES - 1] : [min, max]
	}

	function fit() {
		const [min, max] = usedNeedles()
		const span = max - min + 1 + 6
		const width = size.width - gutter()
		const height = size.height - RULER
		view.cell = Math.max(3, Math.min(24, width / span, height / Math.max(passes.length, 1)))
		const shown = width / view.cell
		const middle = (column(min) + column(max) + 1) / 2
		view.left = middle - shown / 2
		view.bottom = 0
	}

	function clampView() {
		const width = (size.width - gutter()) / view.cell
		const height = (size.height - RULER) / view.cell
		view.left = Math.max(-width / 2, Math.min(NEEDLES - width / 2, view.left))
		view.bottom = Math.max(-height / 2, Math.min(passes.length - height / 2, view.bottom))
	}

	// screen ↔ grid
	function xOf(col) {
		return gutter() + (col - view.left) * view.cell
	}
	function yOf(pass) {
		// the top of the row
		return size.height - RULER - (pass - view.bottom + 1) * view.cell
	}
	function at(x, y) {
		const pass = Math.floor(view.bottom + (size.height - RULER - y) / view.cell)
		if (y > size.height - RULER || pass < 0 || pass >= passes.length) return null
		if (x < gutter()) return {pass}
		const col = Math.floor(view.left + (x - gutter()) / view.cell)
		if (col < 0 || col >= NEEDLES) return {pass}
		return {pass, needle: column(col)}
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
		if (!fitted && passes.length) {
			fit()
			fitted = true
		}
		draw()
	}

	function isHighlighted(pass) {
		if (!highlighted) return false
		const lines = highlighted.local ? pass.kLines : pass.jsLines
		return lines.some(line => line >= highlighted.start && line <= highlighted.end)
	}

	function draw() {
		frame = 0
		if (!colours) readColours()
		const {width, height} = size
		ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
		ctx.fillStyle = colours.sheet
		ctx.fillRect(0, 0, width, height)
		if (!passes.length || !width) return

		const s = view.cell
		const left = gutter()
		const gridBottom = height - RULER
		const first = Math.max(0, Math.floor(view.bottom))
		const last = Math.min(passes.length - 1, Math.ceil(view.bottom + gridBottom / s))
		const firstCol = Math.max(0, Math.floor(view.left))
		const lastCol = Math.min(NEEDLES - 1, Math.ceil(view.left + (width - left) / s))

		ctx.save()
		ctx.beginPath()
		ctx.rect(left, 0, width - left, gridBottom)
		ctx.clip()

		// the bed itself, a shade off the sheet outside it
		ctx.fillStyle = colours.chrome
		ctx.fillRect(left, 0, width - left, gridBottom)
		ctx.fillStyle = colours.sheet
		ctx.fillRect(xOf(0), 0, NEEDLES * s, gridBottom)

		for (let p = first; p <= last; p++) drawPass(passes[p], firstCol, lastCol)

		// the grid: every needle when there's room, every tenth always
		ctx.fillStyle = colours.grid
		for (let col = firstCol; col <= lastCol + 1; col++) {
			const needle = rear() ? NEEDLES - col : col
			if (s < 6 && needle % 10) continue
			ctx.globalAlpha = needle % 10 ? 0.6 : 1
			ctx.fillRect(Math.round(xOf(col)), 0, 1, gridBottom)
		}
		for (let p = first; p <= last + 1; p++) {
			if (s < 6 && p % 10) continue
			ctx.globalAlpha = p % 10 ? 0.6 : 1
			ctx.fillRect(left, Math.round(yOf(p) + s), width - left, 1)
		}
		ctx.globalAlpha = 1

		if (hovered?.needle != null) {
			ctx.strokeStyle = colours.ink
			ctx.lineWidth = 1.5
			ctx.strokeRect(xOf(column(hovered.needle)) + 0.75, yOf(hovered.pass) + 0.75, s - 1.5, s - 1.5)
		}
		ctx.restore()

		drawGutter(first, last)
		drawRuler(firstCol, lastCol)
	}

	function drawPass(pass, firstCol, lastCol) {
		const s = view.cell
		const top = yOf(pass.index)
		const yarn = pass.carrier ? colours.yarns[Number(pass.carrier) - 1] ?? colours.ink : colours.ink
		const span = ([a, b]) => {
			const [l, r] = rear() ? [NEEDLES - 1 - b, NEEDLES - 1 - a] : [a, b]
			return [xOf(l + 0.5), xOf(r + 0.5)]
		}

		if (isHighlighted(pass)) {
			ctx.fillStyle = colours.highlight
			ctx.fillRect(gutter(), top, size.width, s)
		} else if (hovered?.pass === pass.index) {
			ctx.fillStyle = colours.grid
			ctx.globalAlpha = 0.5
			ctx.fillRect(gutter(), top, size.width, s)
			ctx.globalAlpha = 1
		}

		// where the carriage goes, and the yarn behind it (showing as floats
		// where it passes needles by)
		if (pass.carriage) {
			const [l, r] = span(pass.carriage)
			ctx.fillStyle = colours.grid
			ctx.globalAlpha = 0.35
			ctx.fillRect(l, top + s * 0.3, r - l, s * 0.4)
			ctx.globalAlpha = 1
		}
		if (pass.carrierSpan) {
			const [l, r] = span(pass.carrierSpan)
			ctx.fillStyle = yarn
			ctx.fillRect(l, top + s / 2 - Math.max(0.5, s * 0.05), r - l, Math.max(1, s * 0.1))
		}

		for (let col = firstCol; col <= lastCol; col++) {
			const needle = rear() ? NEEDLES - 1 - col : col
			const onFront = pass.front[needle] ? pass.frontOp : null
			const onBack = pass.back[needle] ? pass.backOp : null
			if (!onFront && !onBack) continue
			const [near, far] = rear() ? [onBack, onFront] : [onFront, onBack]
			drawCell(xOf(col), top, s, near, far, yarn)
		}
	}

	// a needle's stitch: knitting on the near bed fills the cell with the
	// yarn; on the far bed it's paler, with a purl's bar across. a tuck is a
	// V, a transfer an arrow towards the bed the loop goes to
	function drawCell(x, y, s, near, far, yarn) {
		const pad = s >= 8 ? 1 : 0
		if (near === "Kn") {
			ctx.fillStyle = yarn
			ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2)
		} else if (far === "Kn") {
			ctx.fillStyle = yarn
			ctx.globalAlpha = 0.4
			ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2)
			ctx.globalAlpha = 1
		}
		if (far === "Kn" && s >= 5) {
			ctx.fillStyle = near === "Kn" ? colours.sheet : yarn
			ctx.fillRect(x + s * 0.2, y + s * 0.42, s * 0.6, Math.max(1, s * 0.16))
		}
		if (near === "Tu") tuck(x, y, s, yarn, 1)
		if (far === "Tu") tuck(x, y, s, yarn, 0.45)
		if (near === "Tr") arrow(x, y, s, -1)
		if (far === "Tr") arrow(x, y, s, 1)
		if ((near === "Rr" || near === "Rl") && !far) dot(x, y, s)
		if ((far === "Rr" || far === "Rl") && !near) dot(x, y, s)
	}

	function tuck(x, y, s, yarn, alpha) {
		ctx.globalAlpha = alpha
		if (s < 5) {
			ctx.fillStyle = yarn
			ctx.fillRect(x + s * 0.25, y + s * 0.25, s * 0.5, s * 0.5)
		} else {
			ctx.strokeStyle = yarn
			ctx.lineWidth = Math.max(1, s * 0.14)
			ctx.lineCap = "round"
			ctx.beginPath()
			ctx.moveTo(x + s * 0.22, y + s * 0.22)
			ctx.lineTo(x + s * 0.5, y + s * 0.78)
			ctx.lineTo(x + s * 0.78, y + s * 0.22)
			ctx.stroke()
		}
		ctx.globalAlpha = 1
	}

	// up (-1): away, to the far bed; down (1): towards you, to the near one
	function arrow(x, y, s, way) {
		const cx = x + s / 2
		const tip = y + s / 2 + way * s * 0.36
		const tail = y + s / 2 - way * s * 0.36
		ctx.strokeStyle = colours.ink
		ctx.fillStyle = colours.ink
		ctx.lineWidth = Math.max(1, s * 0.1)
		ctx.beginPath()
		ctx.moveTo(cx, tail)
		ctx.lineTo(cx, tip)
		ctx.stroke()
		if (s >= 5) {
			ctx.beginPath()
			ctx.moveTo(cx, tip + way * s * 0.04)
			ctx.lineTo(cx - s * 0.22, tip - way * s * 0.24)
			ctx.lineTo(cx + s * 0.22, tip - way * s * 0.24)
			ctx.closePath()
			ctx.fill()
		}
	}

	// a needle a transferred loop lands on
	function dot(x, y, s) {
		ctx.fillStyle = colours.muted
		ctx.beginPath()
		ctx.arc(x + s / 2, y + s / 2, Math.max(1, s * 0.12), 0, Math.PI * 2)
		ctx.fill()
	}

	function drawGutter(first, last) {
		const s = view.cell
		const width = gutter()
		const gridBottom = size.height - RULER
		ctx.save()
		ctx.beginPath()
		ctx.rect(0, 0, width, gridBottom)
		ctx.clip()
		ctx.fillStyle = colours.chrome
		ctx.fillRect(0, 0, width, gridBottom)

		const text = s >= TEXT_ROW
		ctx.font = `${Math.min(11, s - 1)}px ${colours.mono}`
		ctx.textBaseline = "middle"
		for (let p = first; p <= last; p++) {
			const pass = passes[p]
			const top = yOf(p)
			const middle = top + s / 2
			if (isHighlighted(pass)) {
				ctx.fillStyle = colours.highlight
				ctx.fillRect(0, top, width, s)
			} else if (hovered?.pass === p) {
				ctx.fillStyle = colours.grid
				ctx.fillRect(0, top, width, s)
			}
			let x = 0
			for (const col of columns()) {
				drawOption(col, pass, x, top, s, middle, text)
				x += col.width
			}
			if (s >= 6) {
				ctx.fillStyle = colours.grid
				ctx.fillRect(0, Math.round(top + s), width, 1)
			}
		}
		ctx.fillStyle = colours.grid
		ctx.fillRect(width - 1, 0, 1, gridBottom)
		ctx.restore()
	}

	function drawOption(col, pass, x, top, s, middle, text) {
		const ink = pass.empty ? colours.muted : colours.ink
		if (col.id === "dir") {
			// the way the carriage goes, from where you're looking
			const right = (pass.direction === "+") !== rear()
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
			if (!pass.carrier) return
			const yarn = colours.yarns[Number(pass.carrier) - 1] ?? colours.ink
			ctx.fillStyle = yarn
			const inset = s >= 8 ? 2 : 0
			ctx.fillRect(x + 3, top + inset, col.width - 6, s - inset * 2)
			if (text) {
				ctx.fillStyle = colours.sheet
				ctx.textAlign = "center"
				ctx.fillText(pass.carrier, x + col.width / 2, middle + 0.5)
			}
			return
		}
		if (!text) return
		const value = {
			pass: String(pass.index + 1),
			type: pass.type,
			stitch: pass.empty ? "" : pass.stitch,
			speed: pass.speed,
			roller: pass.roller,
			rack: pass.rack ? String(pass.rack) : "",
		}[col.id]
		ctx.fillStyle = col.id === "pass" ? colours.muted : ink
		ctx.textAlign = col.align === "right" ? "right" : "left"
		ctx.fillText(value, col.align === "right" ? x + col.width - 6 : x + 4, middle + 0.5)
	}

	// needle numbers (from 1, as the machine counts them) and the gutter's
	// column names
	function drawRuler(firstCol, lastCol) {
		const s = view.cell
		const top = size.height - RULER
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
		ctx.save()
		ctx.beginPath()
		ctx.rect(gutter(), top, size.width - gutter(), RULER)
		ctx.clip()
		ctx.textAlign = "center"
		for (let col = firstCol; col <= lastCol; col++) {
			const needle = column(col) + 1
			if (needle % every) continue
			ctx.fillStyle = needle % 10 ? colours.muted : colours.ink
			ctx.fillText(String(needle), xOf(col) + s / 2, top + RULER / 2)
		}
		ctx.restore()
	}

	// ── talking to the editors

	function dispatch(type, detail) {
		element.dispatchEvent(new CustomEvent(type, {detail, bubbles: true, composed: true}))
	}

	// every line a pass came from, as {url, line}: the .js line first (if the
	// .js that wrote this is known), then this .k's
	function located(pass) {
		if (!pass) return null
		const jsUrl = handle.doc()?.knitoutSource
		const at = []
		if (pass.jsLines.length && jsUrl) at.push({url: jsUrl, line: pass.jsLines[0]})
		if (pass.kLines.length) at.push({url: handle.url, line: pass.kLines[0]})
		return at.length ? {...at[0], at} : null
	}

	// "Kn-Kn → · carrier 3 · needle 56: knit on the front · stitch 5 · speed
	// 100 · roller 100 · from line 24 of the .js"
	function describe(spot) {
		const pass = passes[spot.pass]
		const parts = [`pass ${pass.index + 1}`]
		parts.push(`${pass.type} ${pass.direction === "+" ? "→" : "←"}`)
		if (pass.carrier) parts.push(`carrier ${pass.carrier}`)
		if (spot.needle != null) {
			const does = []
			if (pass.front[spot.needle]) does.push(`${OPS[pass.frontOp] ?? pass.frontOp} on the front`)
			if (pass.back[spot.needle]) does.push(`${OPS[pass.backOp] ?? pass.backOp} on the back`)
			parts.push(`needle ${spot.needle + 1}${does.length ? ": " + does.join(", ") : ""}`)
		}
		if (!pass.empty) parts.push(`stitch ${pass.stitch}`)
		parts.push(`speed ${pass.speed}`, `roller ${pass.roller}`)
		if (pass.rack) parts.push(`rack ${pass.rack}`)
		if (pass.jsLines.length && handle.doc()?.knitoutSource) parts.push(`from line ${pass.jsLines[0]} of the .js`)
		else if (pass.kLines.length) parts.push(`line ${pass.kLines[0]} of the .k`)
		parts.push(...pass.comments)
		return parts.join(" · ")
	}

	function setHovered(spot) {
		const same =
			spot?.pass === hovered?.pass && spot?.needle === hovered?.needle
		if (same) return
		const passChanged = spot?.pass !== hovered?.pass
		hovered = spot
		status.textContent = spot ? describe(spot) : HINT
		status.classList.toggle("is-hint", !spot)
		if (passChanged) {
			dispatch("knitout:hover-source", located(passes[spot?.pass]) ?? {url: null, at: []})
		}
		requestDraw()
	}

	function onHighlightLines(event) {
		const {url, start, end} = event.detail ?? {}
		const local = url === handle.url
		const fromJs = url != null && url === handle.doc()?.knitoutSource
		highlighted = start == null || (!local && !fromJs) ? null : {local, start, end: end ?? start}
		requestDraw()
	}

	// ── pointer, wheel and keys

	const local = event => {
		const rect = canvas.getBoundingClientRect()
		return {x: event.clientX - rect.left, y: event.clientY - rect.top}
	}

	let drag = null
	function onPointerDown(event) {
		if (event.button !== 0) return
		canvas.setPointerCapture(event.pointerId)
		drag = {x: event.clientX, y: event.clientY, moved: false}
	}
	function onPointerMove(event) {
		if (drag) {
			const dx = event.clientX - drag.x
			const dy = event.clientY - drag.y
			if (drag.moved || Math.hypot(dx, dy) >= 4) {
				drag.moved = true
				view.left -= dx / view.cell
				view.bottom += dy / view.cell
				clampView()
				drag.x = event.clientX
				drag.y = event.clientY
				requestDraw()
				return
			}
		}
		const {x, y} = local(event)
		setHovered(at(x, y))
	}
	function onPointerUp() {
		if (drag && !drag.moved && hovered) {
			const where = located(passes[hovered.pass])
			if (where) dispatch("knitout:select-source", where)
		}
		drag = null
	}
	function onPointerLeave() {
		if (!drag) setHovered(null)
	}
	function onDoubleClick(event) {
		const {x, y} = local(event)
		const spot = at(x, y)
		const where = spot && located(passes[spot.pass])
		if (where) dispatch("knitout:goto-source", where)
	}
	function onWheel(event) {
		event.preventDefault()
		const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1
		if (event.ctrlKey || event.metaKey) {
			// zoom around the pointer
			const {x, y} = local(event)
			const col = view.left + (x - gutter()) / view.cell
			const row = view.bottom + (size.height - RULER - y) / view.cell
			view.cell = Math.max(2, Math.min(48, view.cell * Math.exp(-event.deltaY * scale * 0.01)))
			view.left = col - (x - gutter()) / view.cell
			view.bottom = row - (size.height - RULER - y) / view.cell
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
		if (event.key !== "Shift") return
		const held = event.type === "keydown"
		if (held === shiftHeld) return
		turn(() => (shiftHeld = held))
	}
	function onBlur() {
		if (shiftHeld) turn(() => (shiftHeld = false))
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
		mouseover: () => canvas.focus({preventScroll: true}),
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

	function docName() {
		return (handle.doc()?.name ?? "pattern.k").replace(/\.k$/, "")
	}

	async function update() {
		const gen = ++generation
		const text = docText(handle.doc())
		if (!text.trim()) {
			passes = []
			empty.hidden = false
			errorBar.hidden = true
			requestDraw()
			return
		}
		const result = await kcode.convert(text, "", {lines: true})
		if (gen !== generation) return
		empty.hidden = true
		if (result.error) {
			errorBar.textContent = result.error
			errorBar.hidden = false
			return
		}
		errorBar.hidden = true
		const jsLines = jsLinesOf(text)
		passes = parseKcode(result.kcode)
		for (const pass of passes) {
			pass.jsLines = [...new Set(pass.kLines.map(line => jsLines[line - 1]).filter(line => line != null))]
		}
		empty.hidden = passes.length > 0
		if (hovered && hovered.pass >= passes.length) hovered = null
		if (!fitted && size.width && passes.length) {
			fit()
			fitted = true
		}
		const warnings = [...new Set(result.warnings)]
		warningsBadge.hidden = !warnings.length
		warningsBadge.textContent = `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`
		warningsBadge.title = warnings.slice(0, 20).join("\n")
		requestDraw()
	}

	function scheduleUpdate() {
		clearTimeout(timer)
		timer = setTimeout(update, REDRAW_DELAY)
	}

	async function exportKcode() {
		const name = docName()
		const result = await kcode.convert(docText(handle.doc()), name, {})
		if (result.error) {
			errorBar.textContent = result.error
			errorBar.hidden = false
			return
		}
		saveFile(result.kcode, name + ".kc")
	}

	setSide("front")
	status.textContent = HINT
	status.classList.add("is-hint")

	const resizeObserver = new ResizeObserver(resize)
	resizeObserver.observe(canvas)

	handle.on("change", scheduleUpdate)
	events.addEventListener("knitout:highlight-lines", onHighlightLines)
	update()

	return () => {
		generation++
		clearTimeout(timer)
		cancelAnimationFrame(frame)
		handle.off("change", scheduleUpdate)
		events.removeEventListener("knitout:highlight-lines", onHighlightLines)
		scheme.removeEventListener("change", onScheme)
		resizeObserver.disconnect()
		for (const [type, listener] of Object.entries(canvasListeners)) {
			canvas.removeEventListener(type, listener)
		}
		kcode.destroy()
		root.remove()
		link.remove()
	}
}
