import KnitoutAnimationTool from "./animation.js"
import {docText, knitoutOf} from "./files.js"
import {pathText, readDocsOf, readsOf} from "../knitoutjs/core/reads.js"
import {headsOf, unpinned} from "../knitoutjs/core/sources.js"
import {tracer} from "../knitoutjs/core/trace.js"
import {press, tray, trayButton} from "../wm/ui/trays.js"
import {stylesheet} from "../wm/ui/stylesheet.js"

const STYLESHEET = new URL("./provenance.css", import.meta.url).href
const OPS = {knit: "knit", tuck: "tuck", miss: "miss", split: "split", xfer: "transfer", drop: "drop", amiss: "tuck"}

// a doc's name, to say which it is
const nameOf = (doc, url) => doc?.name || doc?.title || doc?.["@patchwork"]?.type || String(url).slice(10, 18)
// a colour a doc's value stands for: a patternwitch's pixel is a place in its palette
function readColour(doc, read) {
	const palette = doc?.palette
	if (!Array.isArray(palette) || read?.path[0] !== "pixels" || !Number.isInteger(read.value)) return null
	const colour = palette[read.value]
	return typeof colour === "string" ? colour : null
}

/**
 * the animation (animation.js), and where each stitch came from. point at
 * one to see it all: its line of the .k, the line of the .js that wrote it,
 * the values of docs that line read as it ran (a patternwitch's pixel, say:
 * reads.js), and the docs the code says it's made from, through whatever it
 * was copied into on the way (trace.js). click one to keep that open (and
 * follow it as it knits on), and go to any of it from there. the stitches
 * can be coloured by what they read, in place of their yarn
 */
export default function ProvenanceTool(handle, element, context = {}) {
	const link = stylesheet(STYLESHEET)
	element.append(link)

	const box = document.createElement("div")
	box.className = "provenance-box"
	box.hidden = true

	let stage = null
	let redraw = () => {}
	let whereIs = () => null
	let byRead = false
	let unread = "#888"

	// ── what's read: the .k's lines and ops, the .js that wrote it, and the
	//    docs it read

	let lines = []
	let ops = []
	let readDocs = [] // pinned urls, as the .k's reads number them
	const found = new Map() // url (pinned or not) → {doc, name} once it's found, or a promise
	let js = null // {url, pinned, lines, trace, name}
	const colours = new Map() // op → the colour of what it read (or null)

	function find(url) {
		if (found.has(url)) return found.get(url)
		const finding = (async () => {
			// (a doc nobody here has can take forever to not be found)
			const late = new Promise((_, reject) => setTimeout(() => reject(new Error("not found")), 4000))
			const handle = await Promise.race([context.repo.find(unpinned(url)), late])
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

	function loaded(text, knitout) {
		lines = text.split("\n")
		ops = knitout.ops
		readDocs = readDocsOf(text)
		colours.clear()
		for (const url of readDocs) {
			if (known(url) || !context.repo) continue
			find(url).then(() => {
				colours.clear()
				redraw()
				showBox()
			})
		}
		if (pinned != null && !ops[pinned]) pinned = null
		if (hovered != null && !ops[hovered]) hovered = null
		showBox()
		readJs()
	}

	// a stitch's colour, by what it read: the first colour it read
	function colourOf(loop) {
		if (!byRead) return null
		if (colours.has(loop.op)) return colours.get(loop.op)
		let colour = unread
		for (const read of readsOf(lines[(ops[loop.op]?.kLine ?? 0) - 1] ?? "")) {
			const each = readColour(known(readDocs[read.doc])?.doc, read)
			if (each) {
				colour = each
				break
			}
		}
		colours.set(loop.op, colour)
		return colour
	}

	// ── a stitch's provenance: everything it came from

	let hovered = null // an op
	let pinned = null

	function provenanceOf(index) {
		const op = index == null ? null : ops[index]
		if (!op) return null
		const kText = lines[op.kLine - 1] ?? ""
		const reads = readsOf(kText).map(read => ({...read, url: readDocs[read.doc] ?? null}))
		const name = op.text.split(/\s+/)[0]
		return {op: OPS[name] ?? name, needle: op.needle?.key ?? null, code: op.text, kLine: op.kLine, jsLine: op.jsLine, reads}
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

	function linkTo(label, url, line, title) {
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
		const index = pinned ?? hovered
		const p = provenanceOf(index)
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
				el("span", "provenance-where", [p.needle, `op ${index + 1}`].filter(Boolean).join(" · ")),
				pinned != null ? el("button", "provenance-close", "×") : null,
			),
		)
		parts.push(
			step(
				".k",
				linkTo(`${kName}:${p.kLine}`, handle.url, p.kLine, "find this line of the .k"),
				el("code", "provenance-code", p.code),
			),
		)
		if (p.jsLine != null && js) {
			const source = (js.lines[p.jsLine - 1] ?? "").trim()
			parts.push(
				step(
					".js",
					linkTo(`${js.name}:${p.jsLine}`, js.url, p.jsLine, "go to the line of the .js that wrote it"),
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
						const colour = readColour(info?.doc, read)
						const swatch = colour ? el("span", "provenance-swatch") : null
						if (swatch) swatch.style.background = colour
						return el(
							"div",
							"provenance-read",
							linkTo(info?.name ?? "a doc", read.url && unpinned(read.url), null, `open it (this is as it was read: ${read.url})`),
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
						if (!info && context.repo) find(each.url).then(() => showBox())
						const via = each.via.length
							? el(
									"span",
									"provenance-via",
									"via ",
									...each.via.flatMap((step, index) => [
										index ? " ← " : "",
										step.kind
											? linkTo(`the ${step.kind} on line ${step.line}`, js.url, step.line, `go to the ${step.kind} it's in`)
											: linkTo(step.name, js.url, step.line, `go to where ${step.name} is made, line ${step.line}`),
									]),
								)
							: null
						return el(
							"div",
							"provenance-read",
							linkTo(info?.name ?? "a doc", unpinned(each.url), null, "open it"),
							each.name ? linkTo(`imported as ${each.name}`, js.url, each.line, `go to line ${each.line}, where it's imported`) : null,
							via,
						)
					}),
				),
			)
		}
		if (pinned == null) parts.push(el("div", "provenance-hint", "click to keep this open"))
		box.replaceChildren(...parts)
		box.querySelector(".provenance-close")?.addEventListener("click", event => {
			event.stopPropagation()
			unpin()
		})
		box.toggleAttribute("data-pinned", pinned != null)
		box.hidden = false
		place()
	}

	// beside its stitch: above it, or below if there's no room, and kept in
	// the stage (in its corner, if the stitch isn't knitted yet)
	function place() {
		if (box.hidden || !stage) return
		const outer = stage.getBoundingClientRect()
		const at = whereIs(pinned ?? hovered)
		const w = box.offsetWidth
		const h = box.offsetHeight
		let left = 4
		let top = 4
		if (at) {
			left = Math.max(4, Math.min(outer.width - w - 4, at.x - outer.left - w / 2))
			const above = at.top - outer.top - h - 6
			top = above >= 4 ? above : Math.min(outer.height - h - 4, at.bottom - outer.top + 6)
		}
		box.style.left = `${left}px`
		box.style.top = `${Math.max(4, top)}px`
	}

	function point(at) {
		hovered = at?.op ?? null
		if (pinned == null) showBox()
	}

	function pick(at) {
		if (!at || at.op === pinned) return unpin()
		pinned = at.op
		showBox()
		redraw()
	}

	function unpin() {
		pinned = null
		showBox()
		redraw()
	}

	function onKey(event) {
		if (event.key === "Escape" && pinned != null) unpin()
	}

	let root = null
	function mount(tool) {
		root = tool.root
		stage = tool.stage
		redraw = tool.redraw
		whereIs = tool.whereIs
		stage.append(box)
		const button = trayButton({
			icon: "eyedropper",
			label: "by what it read",
			title: "colour each stitch by what its line read (a patternwitch's pixel, say), in place of its yarn: grey's read nothing with a colour",
			onClick: () => {
				byRead = !byRead
				press(button, byRead)
				unread = getComputedStyle(box).getPropertyValue("--provenance-unread").trim() || unread
				colours.clear()
				redraw()
			},
		})
		press(button, false)
		tool.bar.append(tray(button))
		root.addEventListener("keydown", onKey)
	}

	const stop = KnitoutAnimationTool(handle, element, context, {
		mount,
		loaded,
		point,
		pick,
		colourOf,
		kept: () => pinned,
		drawn: () => place(),
	})

	return () => {
		root?.removeEventListener("keydown", onKey)
		stop()
		box.remove()
		link.remove()
	}
}
