import {apply, newMachine} from "./knitting.js"
import {WALE} from "./loopsim.js"
import {settler as newSettler} from "./settler.js"

// the animation's scrubber, on a strip of little squares, evenly along it:
// each the knitting as it is that far through. the whole .k's settled once,
// by a settler of its own (so the view's, at wherever it's got to, is left
// alone), and each square's the stitches made by then, where they end up:
// the fabric growing up from its cast on, square by square. each is the one
// before it with the stitches since drawn on, so it's one pass over them all
//
//   filmstrip({scrubber, look, request, yarnOf})
//     look()    {yarns: [colour, …], sheet: colour, ink: colour}
//     request() {squash, size}, as the view settles with
//
// .element is the scrubber in its strip; load(ops, carriers) a new .k;
// again() settings changed; redraw() colours changed; at(index, of) where
// the scrubber's got to; destroy()

// in the view's units: a needle's pitch and a row's height
const COL = 10
const ROW = 7
// how long the strip's settler settles each time it's asked (ms), and how
// many times over, at most, while it still moves
const BUDGET = 40
const TIMES = 40
// between squares (css px), and round the fabric in each (a fraction)
const GAP = 3
const PAD = 0.12

export function filmstrip({scrubber, look, request, yarnOf}) {
	const element = document.createElement("div")
	element.className = "knitout-animation-scrub"
	const canvas = document.createElement("canvas")
	canvas.className = "knitout-animation-strip"
	canvas.setAttribute("aria-hidden", "true")
	const later = document.createElement("div")
	later.className = "knitout-animation-strip-later"
	element.append(canvas, later, scrubber)

	let ops = []
	let loops = [] // every loop the .k makes, in the order it's made (and so by op)
	let fabric = null
	let drawSoon = 0

	const settler = newSettler({
		limit: TIMES,
		onUpdate() {
			if (settler.ready) fabric = settler.fabric
			soon()
			ask()
		},
	})
	function ask() {
		if (!ops.length) return
		const {squash, size} = request()
		settler.settle({upTo: ops.length, budget: BUDGET, squash, size})
	}

	function load(newOps, carriers) {
		ops = newOps
		fabric = null
		const machine = newMachine()
		ops.forEach((op, i) => apply(machine, op, i, yarnOf))
		loops = machine.loops
		settler.load(ops, carriers)
		ask()
		soon()
	}

	// (at most a few times a second, as the settling comes in)
	function soon() {
		if (drawSoon) return
		drawSoon = setTimeout(() => {
			drawSoon = 0
			draw()
		}, 120)
	}

	// how many loops are made before op k
	function madeBefore(k) {
		let lo = 0
		let hi = loops.length
		while (lo < hi) {
			const mid = (lo + hi) >> 1
			if (loops[mid].op < k) lo = mid + 1
			else hi = mid
		}
		return lo
	}

	function draw() {
		const ratio = devicePixelRatio || 1
		const {width: cssWidth, height: cssHeight} = element.getBoundingClientRect()
		const width = Math.round(cssWidth * ratio)
		const height = Math.round(cssHeight * ratio)
		if (!width || !height) return
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width
			canvas.height = height
		}
		const c = canvas.getContext("2d")
		c.clearRect(0, 0, width, height)
		if (!ops.length) return
		const {yarns, sheet, ink} = look()
		// squares as tall as the strip, as many as fit, spread from end to end
		const side = height
		const gap = GAP * ratio
		const count = Math.max(1, Math.floor((width + gap) / (side + gap)))
		const spacing = count > 1 ? (width - side) / (count - 1) : 0
		const lefts = Array.from({length: count}, (_, i) => Math.round(i * spacing))
		// each square's op: where its middle is along the strip, and the last's the end
		const opsAt = lefts.map((left, i) => (i === count - 1 ? ops.length : Math.round(((left + side / 2) / width) * ops.length)))
		const radius = Math.min(4 * ratio, side / 5)
		const square = left => {
			c.beginPath()
			c.roundRect(left + 0.5, 0.5, side - 1, side - 1, radius)
		}
		c.lineWidth = 1
		for (const left of lefts) {
			square(left)
			c.fillStyle = sheet
			c.fill()
			c.strokeStyle = ink
			c.globalAlpha = 0.18
			c.stroke()
			c.globalAlpha = 1
		}
		const settled = fabric && fabric.count > 0 ? fabric : null
		if (!settled) return
		// the whole fabric's box, as it ends up: every square's drawn to the same scale
		let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity]
		const xOf = id => settled.xs[id] * COL
		const yOf = id => (-settled.ys[id] / WALE) * ROW
		const last = Math.min(settled.count, loops.length)
		for (let id = 0; id < last; id++) {
			const x = xOf(id)
			const y = yOf(id)
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue
			left = Math.min(left, x)
			right = Math.max(right, x)
			top = Math.min(top, y)
			bottom = Math.max(bottom, y)
		}
		if (!(right >= left && bottom >= top)) return
		const inner = side * (1 - 2 * PAD)
		const scale = Math.min(inner / Math.max(COL, right - left + COL), inner / Math.max(ROW, bottom - top + ROW))
		const dot = Math.max(1, Math.min(COL, ROW) * scale * 0.9)
		const offsetX = (side - (right - left) * scale) / 2 - left * scale
		const offsetY = (side - (bottom - top) * scale) / 2 - top * scale
		let from = 0
		lefts.forEach((x0, i) => {
			// the square before, and what's been made since
			if (i > 0) c.drawImage(canvas, lefts[i - 1], 0, side, side, x0, 0, side, side)
			const to = Math.min(madeBefore(opsAt[i]), last)
			const paths = new Map() // colour → Path2D, the far bed's faint
			for (let id = from; id < to; id++) {
				const x = xOf(id)
				const y = yOf(id)
				if (!Number.isFinite(x) || !Number.isFinite(y)) continue
				const loop = loops[id]
				const key = `${loop.back ? "far" : "near"}${loop.yarn}`
				let path = paths.get(key)
				if (!path) paths.set(key, (path = new Path2D()))
				path.rect(x0 + offsetX + x * scale - dot / 2, offsetY + y * scale - dot / 2, dot, dot)
			}
			for (const [key, path] of paths) {
				c.globalAlpha = key.startsWith("far") ? 0.45 : 1
				c.fillStyle = yarns[Number(key.replace(/\D+/, ""))] ?? ink
				c.fill(path)
			}
			c.globalAlpha = 1
			from = Math.max(from, to)
		})
	}

	// what's still to come, faded
	let shownAt = -1
	function at(index, of) {
		const fraction = of ? Math.max(0, Math.min(1, index / of)) : 0
		if (fraction === shownAt) return
		shownAt = fraction
		later.style.left = `${fraction * 100}%`
	}

	const resize = new ResizeObserver(() => soon())
	resize.observe(element)

	return {
		element,
		load,
		again: ask,
		redraw: soon,
		at,
		destroy() {
			clearTimeout(drawSoon)
			resize.disconnect()
			settler.destroy()
		},
	}
}
