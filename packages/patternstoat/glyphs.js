// what the patternstoat and charm editors paint with and how they draw it:
// the kniterate editor's stitches (lattice/kniterate.js), drawn as it draws
// them, and a charm's three more (transparent, cast off, cast on)

// what can be painted: what each bed does at a needle. `key` picks it
export const STITCHES = [
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

// a charm's, besides: a code a bed
export const CHARM_STITCHES = [
	{id: "clear-f", name: "front: nothing", f: null, keepB: true},
	{id: "clear-b", name: "back: nothing", b: null, keepF: true},
	{id: "star-f", name: "front: as painted (✦, transparent: what the patternstoat's stitch layer has)", f: "*", keepB: true},
	{id: "star-b", name: "back: as painted (✦)", b: "*", keepF: true},
	{id: "co-f", name: "front: cast off", f: "co", keepB: true},
	{id: "co-b", name: "back: cast off", b: "co", keepF: true},
	{id: "cn-f", name: "front: cast on", f: "cn", keepB: true},
	{id: "cn-b", name: "back: cast on", b: "cn", keepF: true},
]

// the editors' colours, from their stylesheet's custom properties, as the
// canvas can use them
export function readColours(root) {
	const probe = document.createElement("span")
	probe.style.display = "none"
	root.append(probe)
	const resolve = value => {
		probe.style.color = ""
		probe.style.color = value
		return getComputedStyle(probe).color
	}
	const colours = {
		sheet: resolve("var(--stoat-sheet)"),
		ink: resolve("var(--stoat-ink)"),
		muted: resolve("var(--stoat-muted)"),
		grid: resolve("var(--stoat-line-soft)"),
		chrome: resolve("var(--stoat-chrome)"),
		accent: resolve("var(--stoat-accent)"),
		danger: resolve("var(--stoat-danger)"),
		highlight: resolve("var(--stoat-highlighter)"),
		ops: {
			k: resolve("var(--stoat-knit)"),
			t: resolve("var(--stoat-tuck)"),
			m: resolve("var(--stoat-miss)"),
			x: resolve("var(--stoat-xfer)"),
			d: resolve("var(--stoat-drop)"),
			"*": resolve("var(--stoat-star)"),
			co: resolve("var(--stoat-drop)"),
			cn: resolve("var(--stoat-knit)"),
		},
		mono: getComputedStyle(root).getPropertyValue("--stoat-mono").trim() || "monospace",
		sans: getComputedStyle(root).getPropertyValue("--stoat-sans").trim() || "sans-serif",
	}
	probe.remove()
	return colours
}

// draw what a bed does (`code`) in a box, as the kniterate editor does.
// `near`: the half nearest you (the front, looking from the front)
export function drawCode(ctx, code, x, y, w, h, colours, near = true) {
	if (!code) return
	const fill = colours.ops[code] ?? colours.ink
	const s = Math.min(w, h * 2)
	if (s < 5) {
		ctx.fillStyle = fill
		ctx.fillRect(x, y, w, h)
		return
	}
	const pad = s >= 10 ? 1 : 0
	ctx.lineCap = "round"
	ctx.lineJoin = "round"
	if (code === "k") {
		ctx.fillStyle = fill
		ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2)
		if (!near && s >= 8) {
			// a purl, seen from this side: a bar across
			ctx.fillStyle = colours.sheet
			ctx.globalAlpha = 0.6
			ctx.fillRect(x + w * 0.2, y + h * 0.42, w * 0.6, Math.max(1, h * 0.16))
			ctx.globalAlpha = 1
		}
	} else if (code === "t") {
		ctx.strokeStyle = fill
		ctx.lineWidth = Math.max(1, s * 0.1)
		ctx.beginPath()
		ctx.moveTo(x + w * 0.22, y + h * 0.18)
		ctx.lineTo(x + w * 0.5, y + h * 0.82)
		ctx.lineTo(x + w * 0.78, y + h * 0.18)
		ctx.stroke()
	} else if (code === "m") {
		ctx.fillStyle = fill
		ctx.fillRect(x + w * 0.15, y + h / 2 - Math.max(0.5, h * 0.08), w * 0.7, Math.max(1, h * 0.16))
	} else if (code === "x") {
		const way = near ? -1 : 1
		const cx = x + w / 2
		const tip = y + h / 2 + way * h * 0.4
		const tail = y + h / 2 - way * h * 0.4
		ctx.strokeStyle = ctx.fillStyle = fill
		ctx.lineWidth = Math.max(1, s * 0.08)
		ctx.beginPath()
		ctx.moveTo(cx, tail)
		ctx.lineTo(cx, tip)
		ctx.stroke()
		ctx.beginPath()
		ctx.moveTo(cx, tip + way)
		ctx.lineTo(cx - w * 0.2, tip - way * h * 0.35)
		ctx.lineTo(cx + w * 0.2, tip - way * h * 0.35)
		ctx.closePath()
		ctx.fill()
	} else if (code === "d") {
		ctx.strokeStyle = fill
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
	} else if (code === "*") {
		// ✦: a four-pointed star
		const cx = x + w / 2
		const cy = y + h / 2
		const r = Math.min(w, h) * 0.42
		const i = r * 0.3
		ctx.fillStyle = fill
		ctx.beginPath()
		ctx.moveTo(cx, cy - r)
		ctx.lineTo(cx + i, cy - i)
		ctx.lineTo(cx + r, cy)
		ctx.lineTo(cx + i, cy + i)
		ctx.lineTo(cx, cy + r)
		ctx.lineTo(cx - i, cy + i)
		ctx.lineTo(cx - r, cy)
		ctx.lineTo(cx - i, cy - i)
		ctx.closePath()
		ctx.fill()
	} else if (code === "co") {
		// a bind-off's chain: a row of loops lying down, and a bar
		ctx.strokeStyle = fill
		ctx.lineWidth = Math.max(1, s * 0.08)
		const cy = y + h * 0.5
		ctx.beginPath()
		ctx.ellipse(x + w * 0.32, cy, w * 0.16, h * 0.18, 0, 0, Math.PI * 2)
		ctx.ellipse(x + w * 0.68, cy, w * 0.16, h * 0.18, 0, 0, Math.PI * 2)
		ctx.stroke()
		ctx.fillStyle = fill
		ctx.fillRect(x + w * 0.1, y + h * 0.82, w * 0.8, Math.max(1, h * 0.1))
	} else if (code === "cn") {
		// a cast-on loop, new on its needle
		ctx.strokeStyle = fill
		ctx.lineWidth = Math.max(1, s * 0.09)
		ctx.beginPath()
		ctx.moveTo(x + w * 0.25, y + h * 0.2)
		ctx.bezierCurveTo(x + w * 0.25, y + h * 0.95, x + w * 0.75, y + h * 0.95, x + w * 0.75, y + h * 0.2)
		ctx.stroke()
		ctx.fillStyle = fill
		ctx.fillRect(x + w * 0.1, y + h * 0.1, w * 0.8, Math.max(1, h * 0.1))
	}
}

// a little canvas swatch of a stitch (both beds), for a palette button
export function stitchSwatch(stitch, colours, size = 20) {
	const canvas = document.createElement("canvas")
	canvas.width = canvas.height = Math.round(size * devicePixelRatio)
	canvas.style.width = canvas.style.height = `${size}px`
	const ctx = canvas.getContext("2d")
	ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
	ctx.fillStyle = colours.sheet
	ctx.fillRect(0, 0, size, size)
	drawCode(ctx, stitch.b ?? null, 1, 1, size - 2, size / 2 - 1, colours, false)
	drawCode(ctx, stitch.f ?? null, 1, size / 2, size - 2, size / 2 - 1, colours, true)
	ctx.strokeStyle = colours.grid
	ctx.strokeRect(0.5, 0.5, size - 1, size - 1)
	return canvas
}
