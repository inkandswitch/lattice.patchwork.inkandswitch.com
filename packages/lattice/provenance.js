import {docText, knitoutOf} from "./files.js"
import {backAt, readRows} from "./kniterate-rows.js"
import {pathText, readDocsOf, readsOf} from "../knitoutjs/core/reads.js"
import {headsOf, unpinned} from "../knitoutjs/core/sources.js"
import {tracer} from "../knitoutjs/core/trace.js"
import {stylesheet} from "../wm/ui/stylesheet.js"

const STYLESHEET = new URL("./provenance.css", import.meta.url).href
const REDRAW_DELAY = 150
// a cell's size, across, at most and at least (it's as tall as it's wide)
const BIGGEST = 22
const SMALLEST = 5
const OPS = {k: "knit", t: "tuck", m: "miss", s: "split", x: "transfer", d: "drop"}

// a doc's name, to say which it is
const nameOf = (doc, url) => doc?.name || doc?.title || doc?.["@patchwork"]?.type || String(url).slice(10, 18)
// a colour a doc's value stands for: a patternwitch's pixel is a place in its palette
function colourOf(doc, read) {
	const palette = doc?.palette
	if (!Array.isArray(palette) || !Number.isInteger(read.value)) return null
	const colour = palette[read.value]
	return typeof colour === "string" ? colour : null
}

/**
 * a .k's stitches as a chart, a row a pass of the carriage (the first at the
 * bottom), a cell a needle: and where each came from. point at one to see
 * it all: its line of the .k, the line of the .js that wrote it, the values
 * of docs that line read as it ran (a patternwitch's pixel, say: reads.js),
 * and the docs the code says it's made from, through whatever it was copied
 * into on the way (trace.js). click one to keep that open, and go to any of
 * it from there
 *
 * like the other visualisers it sends knitout:hover-source and
 * knitout:select-source, so an editor showing the .js or the .k follows
 */
export default function ProvenanceTool(handle, element, context = {}) {
	const root = document.createElement("div")
	root.className = "provenance"
	element.append(stylesheet(STYLESHEET, root), root)

	const bar = document.createElement("div")
	bar.className = "provenance-bar"
	const colourBy = document.createElement("select")
	colourBy.className = "provenance-select"
	colourBy.title = "what each stitch is coloured by"
	colourBy.append(new Option("by stitch", "stitch"), new Option("by what it read", "read"))
	colourBy.addEventListener("change", () => requestDraw())
	const status = document.createElement("span")
	status.className = "provenance-status"
	bar.append(colourBy, status)

	const scroller = document.createElement("div")
	scroller.className = "provenance-scroller"
	const canvas = document.createElement("canvas")
	canvas.className = "provenance-canvas"
	const spacer = document.createElement("div")
	spacer.className = "provenance-spacer"
	scroller.append(canvas, spacer)

	const box = document.createElement("div")
	box.className = "provenance-box"
	box.hidden = true

	const empty = document.createElement("div")
	empty.className = "provenance-empty"
	empty.textContent = "no stitches yet"

	root.append(bar, scroller, box, empty)

	// ── what's read: the .k's rows, the .js that wrote it, and the docs it read

	let text = null
	let model = {rows: [], lines: [], range: null}
	let readDocs = [] // pinned urls, as the .k's reads number them
	const found = new Map() // url (pinned or not) → {doc, name} once it's found, or a promise
	let js = null // {url, pinned, lines, trace, name}

	function find(url) {
		if (found.has(url)) return found.get(url)
		const finding = (async () => {
			const handle = await context.repo.find(unpinned(url))
			const heads = headsOf(url)
			const doc = heads ? handle.view(heads.split("|")).doc() : handle.doc()
			const info = {doc, name: nameOf(doc, url)}
			found.set(url, info)
			return info
		})().catch(() => {
			const info = {doc: null, name: nameOf(null, url)}
			found.set(url, info)
			return info
		})
		found.set(url, finding)
		return finding
	}
	const known = url => {
		const info = found.get(url)
		return info && !(info instanceof Promise) ? info : null
	}

	// the .js as it was when it wrote this .k (its first source, pinned), or
	// as it is now if that can't be found
	async function readJs() {
		const k = knitoutOf(handle.doc())
		if (!k.source || !context.repo) {
			js = null
			return
		}
		const pinned = k.sources[0] && unpinned(k.sources[0]) === unpinned(k.source) ? k.sources[0] : null
		if (js?.url === k.source && js.pinned === pinned) return
		const info = await find(pinned ?? k.source)
		const code = docText(info.doc)
		js = {url: k.source, pinned, lines: code.split("\n"), trace: tracer(code), name: info.name}
		showBox()
	}

	function reread() {
		const doc = handle.doc()
		const now = docText(doc)
		if (now === text) return
		text = now
		model = readRows(text)
		readDocs = readDocsOf(text)
		for (const url of readDocs) find(url).then(requestDraw)
		empty.hidden = model.rows.length > 0
		const reads = model.lines.filter(line => line.includes(";!read:")).length
		status.textContent = model.rows.length
			? `${model.rows.length} rows${reads ? ` · ${reads} stitches say what they read` : ""}`
			: ""
		if (pinned && !cellAt(pinned.row, pinned.col)) unpin()
		layout()
		readJs()
	}

	// ── the chart: a cell a needle (columns, from the leftmost used), a row
	//    a pass, drawn in the canvas the scroller's showing, a row at a time

	let cell = 10
	let columns = 0
	let first = 0
	let atBottom = true

	function layout() {
		const [low, high] = model.range ?? [0, 0]
		first = low
		columns = high - low + 1
		const width = scroller.clientWidth || 300
		cell = Math.max(SMALLEST, Math.min(BIGGEST, Math.floor(width / Math.max(1, columns))))
		spacer.style.width = `${columns * cell}px`
		spacer.style.height = `${model.rows.length * cell}px`
		if (atBottom) scroller.scrollTop = scroller.scrollHeight
		requestDraw()
	}

	// what's at a row and column: {front, back} (each {op, line} or null)
	function cellAt(row, col) {
		const each = model.rows[row]
		if (!each) return null
		const front = each.front.get(col) ?? null
		const back = each.back.get(backAt(each, col)) ?? null
		return front || back ? {front, back} : null
	}

	// where on the chart a point of the page is: {row, col, back}
	function pointAt(event) {
		const rect = scroller.getBoundingClientRect()
		const x = event.clientX - rect.left + scroller.scrollLeft
		const y = event.clientY - rect.top + scroller.scrollTop
		const col = Math.floor(x / cell) + first
		const fromTop = Math.floor(y / cell)
		const row = model.rows.length - 1 - fromTop
		if (row < 0 || row >= model.rows.length || col < first || col >= first + columns) return null
		const at = cellAt(row, col)
		if (!at) return null
		// both beds: the top half's the back's
		const top = y - fromTop * cell < cell / 2
		const back = at.front && at.back ? top : !at.front
		return {row, col, back}
	}

	let frame = 0
	function requestDraw() {
		if (frame) return
		frame = requestAnimationFrame(() => {
			frame = 0
			draw()
		})
	}

	const style = name => getComputedStyle(root).getPropertyValue(name).trim()

	function draw() {
		const ratio = devicePixelRatio || 1
		const width = scroller.clientWidth
		const height = scroller.clientHeight
		canvas.style.transform = `translate(${scroller.scrollLeft}px, ${scroller.scrollTop}px)`
		canvas.width = Math.max(1, Math.round(width * ratio))
		canvas.height = Math.max(1, Math.round(height * ratio))
		canvas.style.width = `${width}px`
		canvas.style.height = `${height}px`
		const g = canvas.getContext("2d")
		g.setTransform(ratio, 0, 0, ratio, 0, 0)
		g.clearRect(0, 0, width, height)
		const colours = Object.fromEntries(Object.keys(OPS).map(op => [op, style(`--provenance-${OPS[op]}`)]))
		const line = style("--provenance-line")
		const mark = style("--provenance-mark")
		const byRead = colourBy.value === "read"
		const rows = model.rows.length
		const top = Math.max(0, Math.floor(scroller.scrollTop / cell))
		const bottom = Math.min(rows, Math.ceil((scroller.scrollTop + height) / cell))
		const left = Math.max(0, Math.floor(scroller.scrollLeft / cell))
		const right = Math.min(columns, Math.ceil((scroller.scrollLeft + width) / cell))
		const gap = cell >= 8 ? 1 : 0
		const fill = (entry, x, y, w, h) => {
			let colour = colours[entry.op]
			const reads = readsOf(model.lines[entry.line] ?? "")
			if (byRead) {
				const read = reads.at(-1)
				colour = (read && colourOf(known(readDocs[read.doc])?.doc, read)) ?? style("--provenance-unread")
			}
			g.fillStyle = colour
			g.fillRect(x, y, w, h)
			// a stitch that read something says so, in its corner
			if (!byRead && reads.length && cell >= 8) {
				g.fillStyle = mark
				g.fillRect(x + w - 3, y, 3, 3)
			}
		}
		for (let fromTop = top; fromTop < bottom; fromTop++) {
			const row = model.rows[rows - 1 - fromTop]
			const y = fromTop * cell - scroller.scrollTop
			for (let c = left; c < right; c++) {
				const col = c + first
				const at = cellAt(row.index, col)
				if (!at) continue
				const x = c * cell - scroller.scrollLeft
				const size = cell - gap
				if (at.front && at.back) {
					fill(at.back, x, y, size, size / 2)
					fill(at.front, x, y + size / 2, size, size / 2)
				} else fill(at.front ?? at.back, x, y, size, size)
			}
		}
		// the stitch kept open, and the one pointed at
		for (const [at, width] of [[pinned, 2], [hovered, 1]]) {
			if (!at) continue
			const x = (at.col - first) * cell - scroller.scrollLeft
			const y = (rows - 1 - at.row) * cell - scroller.scrollTop
			g.strokeStyle = line
			g.lineWidth = width
			g.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1)
		}
	}

	// ── a stitch's provenance: everything it came from

	let hovered = null // {row, col, back}
	let pinned = null

	function provenanceOf(at) {
		const entry = at && (at.back ? cellAt(at.row, at.col)?.back : cellAt(at.row, at.col)?.front)
		if (!entry) return null
		const kText = model.lines[entry.line] ?? ""
		const code = kText.split(";")[0].trim()
		const jsLine = Number(/;!source:(-?\d+)/.exec(kText)?.[1] ?? NaN)
		const reads = readsOf(kText).map(read => ({...read, url: readDocs[read.doc] ?? null}))
		return {
			at,
			op: OPS[entry.op],
			code,
			kLine: entry.line + 1,
			jsLine: Number.isFinite(jsLine) ? jsLine : null,
			reads,
		}
	}

	function located(p) {
		const where = []
		const jsUrl = knitoutOf(handle.doc()).source
		if (p.jsLine != null && jsUrl) where.push({url: jsUrl, line: p.jsLine})
		where.push({url: handle.url, line: p.kLine})
		return {...where[0], at: where}
	}

	function dispatch(type, detail) {
		element.dispatchEvent(new CustomEvent(type, {detail, bubbles: true, composed: true}))
	}

	// a doc, open: in its own pane (beside this one, if it isn't open), and,
	// for a file, at a line
	async function go(url, line = null) {
		if (!url) return
		await (context.openIfClosed ?? context.open)?.(url, element)
		if (line == null) return
		const detail = {url, line, at: [{url, line}]}
		// (an editor just opened takes a moment to listen)
		for (const wait of [0, 120, 400]) {
			setTimeout(() => (context.events ?? element).dispatchEvent(new CustomEvent("knitout:goto-source", {detail})), wait)
		}
	}

	function link(label, url, line, title) {
		const a = document.createElement("button")
		a.className = "provenance-link"
		a.type = "button"
		a.textContent = label
		a.title = title
		a.addEventListener("click", event => {
			event.stopPropagation()
			go(url, line)
		})
		return a
	}

	function el(tag, className, ...children) {
		const node = document.createElement(tag)
		node.className = className
		node.append(...children.filter(child => child != null && child !== false))
		return node
	}

	function step(label, ...children) {
		return el("div", "provenance-step", el("span", "provenance-label", label), el("div", "provenance-body", ...children))
	}

	function showBox() {
		const at = pinned ?? hovered
		const p = provenanceOf(at)
		if (!p) {
			box.hidden = true
			return
		}
		const kName = nameOf(handle.doc(), handle.url)
		const parts = []
		parts.push(
			el(
				"div",
				"provenance-head",
				el("span", "provenance-op", p.op),
				el("span", "provenance-where", `row ${p.at.row + 1} · ${p.at.back ? "b" : "f"}${p.at.back ? backAt(model.rows[p.at.row], p.at.col) : p.at.col}`),
				pinned
					? el("button", "provenance-close", "×")
					: null,
			),
		)
		parts.push(
			step(
				".k",
				link(`${kName}:${p.kLine}`, handle.url, p.kLine, "find this line of the .k"),
				el("code", "provenance-code", p.code),
			),
		)
		if (p.jsLine != null && js) {
			const source = (js.lines[p.jsLine - 1] ?? "").trim()
			parts.push(
				step(
					".js",
					link(`${js.name}:${p.jsLine}`, js.url, p.jsLine, "go to the line of the .js that wrote it"),
					el("code", "provenance-code", source),
				),
			)
		}
		if (p.reads.length) {
			parts.push(
				step(
					"read",
					...p.reads.map(read => {
						const info = known(read.url)
						const colour = colourOf(info?.doc, read)
						const swatch = colour ? el("span", "provenance-swatch") : null
						if (swatch) swatch.style.background = colour
						return el(
							"div",
							"provenance-read",
							link(info?.name ?? "a doc", read.url && unpinned(read.url), null, `open it (this is as it was read: ${read.url})`),
							el("code", "provenance-code", `${pathText(read.path)} = ${JSON.stringify(read.value)}`),
							swatch,
						)
					}),
				),
			)
		}
		const traced = p.jsLine != null && js ? js.trace(p.jsLine) : []
		// what's read's already said; what else the code says it's made from
		const fromCode = traced.filter(each => !p.reads.some(read => read.url && unpinned(read.url) === unpinned(each.url)))
		if (fromCode.length) {
			parts.push(
				step(
					"from",
					...fromCode.map(each => {
						const info = known(each.url)
						if (!info) find(each.url).then(() => showBox())
						const via = each.via.length
							? el(
									"span",
									"provenance-via",
									"via ",
									...each.via.flatMap((step, index) => [
										index ? " ← " : "",
										link(step.name, js.url, step.line, `go to where ${step.name} is made, line ${step.line}`),
									]),
								)
							: null
						return el(
							"div",
							"provenance-read",
							link(info?.name ?? "a doc", unpinned(each.url), null, "open it"),
							each.name ? link(`imported as ${each.name}`, js.url, each.line, `go to line ${each.line}, where it's imported`) : null,
							via,
						)
					}),
				),
			)
		}
		if (!pinned) parts.push(el("div", "provenance-hint", "click to keep this open"))
		box.replaceChildren(...parts)
		box.querySelector(".provenance-close")?.addEventListener("click", event => {
			event.stopPropagation()
			unpin()
		})
		box.toggleAttribute("data-pinned", !!pinned)
		box.hidden = false
		place(at)
	}

	// beside the stitch: above it, or below if there's no room, and kept in the pane
	function place(at) {
		const rect = scroller.getBoundingClientRect()
		const outer = root.getBoundingClientRect()
		const x = (at.col - first + 0.5) * cell - scroller.scrollLeft + rect.left - outer.left
		const y = (model.rows.length - 1 - at.row) * cell - scroller.scrollTop + rect.top - outer.top
		const w = box.offsetWidth
		const h = box.offsetHeight
		const left = Math.max(4, Math.min(outer.width - w - 4, x - w / 2))
		const above = y - h - 6
		const top = above >= 4 ? above : Math.min(outer.height - h - 4, y + cell + 6)
		box.style.left = `${left}px`
		box.style.top = `${Math.max(4, top)}px`
	}

	const same = (a, b) => a && b && a.row === b.row && a.col === b.col && a.back === b.back

	function onMove(event) {
		const at = pointAt(event)
		if (same(at, hovered)) return
		hovered = at
		const p = provenanceOf(at)
		dispatch("knitout:hover-source", p ? located(p) : {url: null, at: []})
		if (!pinned) showBox()
		requestDraw()
	}

	function onLeave() {
		if (!hovered) return
		hovered = null
		dispatch("knitout:hover-source", {url: null, at: []})
		if (!pinned) showBox()
		requestDraw()
	}

	function onClick(event) {
		const at = pointAt(event)
		if (!at || same(at, pinned)) return unpin()
		pinned = at
		const p = provenanceOf(at)
		if (p) dispatch("knitout:select-source", located(p))
		showBox()
		requestDraw()
	}

	function onDoubleClick(event) {
		const p = provenanceOf(pointAt(event))
		if (p) dispatch("knitout:goto-source", located(p))
	}

	function unpin() {
		pinned = null
		showBox()
		requestDraw()
	}

	function onKey(event) {
		if (event.key === "Escape" && pinned) unpin()
	}

	function onScroll() {
		atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
		if (pinned) place(pinned)
		requestDraw()
	}

	let timer = 0
	function onChange() {
		clearTimeout(timer)
		timer = setTimeout(reread, REDRAW_DELAY)
	}

	const scheme = matchMedia("(prefers-color-scheme: dark)")
	const resizeObserver = new ResizeObserver(() => layout())
	resizeObserver.observe(scroller)
	scroller.addEventListener("pointermove", onMove)
	scroller.addEventListener("pointerleave", onLeave)
	scroller.addEventListener("click", onClick)
	scroller.addEventListener("dblclick", onDoubleClick)
	scroller.addEventListener("scroll", onScroll, {passive: true})
	root.addEventListener("keydown", onKey)
	root.tabIndex = -1
	scheme.addEventListener("change", requestDraw)
	handle.on("change", onChange)
	reread()

	return () => {
		clearTimeout(timer)
		cancelAnimationFrame(frame)
		handle.off("change", onChange)
		scheme.removeEventListener("change", requestDraw)
		resizeObserver.disconnect()
		root.remove()
	}
}
