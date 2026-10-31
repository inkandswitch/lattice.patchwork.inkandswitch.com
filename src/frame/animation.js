import {checkPanel, checker, located, opOf} from "./checks.js"
import {docText} from "./files.js"
import {WALE, firstLoop, newFabric, relax, strain} from "./fabric.js"
import {OVERRUN, across, apply, carriageTrack, lastLoop, newMachine, readKnitout} from "./knitting.js"
import {YARNS_CHANGED, yarnColours} from "./yarns.js"

const STYLESHEET = new URL("./animation.css", import.meta.url).href
const SVG = "http://www.w3.org/2000/svg"
const REPARSE_DELAY = 250

// the machine, front on, in svg units: the back bed's needles hang down to
// BACK_HOOK, the front bed's point up to FRONT_HOOK, the carriers run along
// the gap between them, and the fabric hangs from FABRIC_TOP down
const COL = 10
const ROW = 7
const BACK_HOOK = -5
const FRONT_HOOK = 5
const NEEDLE = 20
const REACH = 15
const FEEDER = -3
const FABRIC_TOP = 30
// the carriage rides above the back bed's needles, CARRIAGE wide
const CARRIAGE_Y = -48
const CARRIAGE = 90
const TOP = -56
// needles either side of the knitting: room for the carriage to run out and
// turn
const MARGIN = Math.ceil(OVERRUN + CARRIAGE / COL / 2)
// how long the fabric gets to settle each frame (ms), playing or not
const PLAYING_BUDGET = 5
const STILL_BUDGET = 10

// how long each op takes, in steps (a stitch is one)
const DURATIONS = {knit: 1, tuck: 1, split: 1, drop: 0.6, miss: 0.35, rack: 0.6}
// and turning the carriage round at the end of a pass: shunk-shunk
const TURN = 1.4
const SPEEDS = [
	{name: "slow", perSecond: 1.5},
	{name: "walk", perSecond: 5},
	{name: "run", perSecond: 20},
	{name: "fly", perSecond: 80},
	{name: "zoom", perSecond: 400},
]

let instances = 0

const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const clamp01 = t => Math.max(0, Math.min(1, t))

function svg(name, attributes = {}, parent) {
	const element = document.createElementNS(SVG, name)
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
	parent?.appendChild(element)
	return element
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
 * the knitting of a .k, played out stitch by stitch on a little machine:
 * a latch needle comes up, catches the yarn from its carrier in its hook, and
 * pulls a new loop through the old one, which drops into the fabric below.
 *
 * the picture is an svg, animated op by op, over a canvas of the fabric. play, step and scrub through it;
 * while it plays, the line being knitted lights up in the editors. point at
 * a stitch to see which line made it (click: find it, double click: put the
 * cursor there). with the animation paused, moving the cursor in an editor
 * winds the knitting to where that line knits
 */
export default function KnitoutAnimationTool(handle, element, context = {}) {
	const events = context.events ?? element
	const id = `knit-${++instances}`

	const link = document.createElement("link")
	link.rel = "stylesheet"
	link.href = STYLESHEET
	element.appendChild(link)

	const root = document.createElement("div")
	root.className = "knitoutjs-editor-tool knitout-animation"
	element.appendChild(root)

	// ── the controls

	const bar = document.createElement("div")
	bar.className = "knitout-animation-bar"
	root.appendChild(bar)

	const playButton = button("play", "play the knitting (space)", () => (playing ? pause() : play()))
	playButton.classList.add("knitout-animation-play")
	const speedSelect = document.createElement("select")
	speedSelect.className = "knitout-animation-speed"
	speedSelect.title = "how fast the needles go"
	for (const [index, speed] of SPEEDS.entries()) {
		speedSelect.append(new Option(speed.name, String(index)))
	}
	speedSelect.value = "1"
	const scrubber = document.createElement("input")
	scrubber.type = "range"
	scrubber.min = "0"
	scrubber.className = "knitout-animation-scrubber"
	scrubber.title = "wind the knitting backwards and forwards"
	const counter = document.createElement("span")
	counter.className = "knitout-animation-counter"
	const strainLabel = document.createElement("label")
	strainLabel.className = "knitout-animation-toggle"
	strainLabel.title = "colour each stitch by how hard it's pulled: red is as long as its yarn reaches"
	const strainBox = document.createElement("input")
	strainBox.type = "checkbox"
	strainLabel.append(strainBox, "strain")

	bar.append(
		button("restart", "back to the start, before the first stitch", () => {
			pause()
			seek(0)
		}),
		button("back", "undo the last op (←)", () => {
			pause()
			stepBack()
		}),
		playButton,
		button("step", "do the next op (→)", () => {
			pause()
			stepOnce()
		}),
		speedSelect,
		scrubber,
		counter,
		strainLabel,
	)

	// ── the picture

	const stage = document.createElement("div")
	stage.className = "knitout-animation-stage"
	root.appendChild(stage)

	// the fabric's thousands of stitches are drawn on a canvas, under the
	// svg's machine: as svg they'd be far too many elements to move
	const canvas = document.createElement("canvas")
	canvas.className = "knitout-animation-fabric"
	stage.appendChild(canvas)
	const context2d = canvas.getContext("2d")
	const picture = svg("svg", {class: "knitout-animation-svg", tabindex: "0"}, stage)
	const defs = svg("defs", {}, picture)
	// a latch needle, hook at the origin and pointing up (the back bed's are
	// turned over)
	const needleShape = svg("g", {id: `${id}-needle`, class: "needle-shape"}, defs)
	svg("path", {d: `M0 3 L0 ${NEEDLE}`}, needleShape)
	svg("path", {d: "M0 3 L0 0.6 Q0 -2 -2 -2 Q-3.6 -2 -3.6 -0.2"}, needleShape)
	svg("path", {d: "M0 7.5 L-2.4 3.2", class: "latch"}, needleShape)

	const layers = {}
	for (const name of [
		"backBed",
		"backLoops",
		"frontLoops",
		"frontBed",
		"yarns",
		"carriage",
		"sprites",
	]) {
		layers[name] = svg("g", {class: `layer-${name}`}, picture)
	}
	// the needle that's moving (and, for a transfer, the one it gives to),
	// and the loop on its way across
	const sprites = [0, 1].map(() => {
		const sprite = svg("g", {class: "sprite", visibility: "hidden"}, layers.sprites)
		svg("path", {d: `M0 3 L0 ${NEEDLE + REACH}`}, sprite)
		svg("path", {d: "M0 3 L0 0.6 Q0 -2 -2 -2 Q-3.6 -2 -3.6 -0.2"}, sprite)
		svg("path", {d: `M${-2.5} ${NEEDLE + REACH - 6} h2.5 v4 h-2.5 z`, class: "butt"}, sprite)
		const latch = svg("path", {d: "M0 7.5 L-2.4 3.2", class: "latch"}, sprite)
		return {element: sprite, latch}
	})
	const travelling = svg("path", {class: "loop travelling", visibility: "hidden"}, layers.sprites)

	// the carriage: its cams push the needles up as it passes over them
	const carriage = svg("g", {class: "carriage", visibility: "hidden"}, layers.carriage)
	const carriageBody = svg("g", {}, carriage)
	svg("rect", {x: -CARRIAGE / 2, y: CARRIAGE_Y, width: CARRIAGE, height: 16, rx: 2.5, class: "body"}, carriageBody)
	svg("rect", {x: -14, y: CARRIAGE_Y - 5, width: 28, height: 5, rx: 1.5, class: "handle"}, carriageBody)
	svg("path", {d: `M-16 ${CARRIAGE_Y + 16} L0 ${CARRIAGE_Y + 22} L16 ${CARRIAGE_Y + 16}`, class: "cam"}, carriageBody)
	const carriageArrow = svg("path", {class: "arrow"}, carriageBody)

	const empty = document.createElement("div")
	empty.className = "knitout-animation-empty"
	empty.textContent = "no stitches yet"
	stage.appendChild(empty)

	const status = document.createElement("div")
	status.className = "knitout-animation-status"
	root.appendChild(status)

	// will it knit: what the check found, each problem going to its op
	const checks = checker()
	const panel = checkPanel(stage, problem => {
		const op = opOf(problem, knitout.ops)
		if (op == null) return
		pause()
		seek(op + 1)
		dispatch("knitout:select-source", located(handle, knitout.ops[op]))
	})
	bar.appendChild(panel.button)

	const errorBar = document.createElement("div")
	errorBar.className = "knitout-animation-error"
	errorBar.hidden = true
	root.appendChild(errorBar)

	// ── yarn colours: the same as the kniterate tool's

	let colours = {yarns: [], ink: "#000"}
	function readYarns() {
		yarnColours().forEach((colour, index) => root.style.setProperty(`--yarn-${index}`, colour))
		const style = getComputedStyle(root)
		colours = {
			yarns: yarnColours(),
			ink: style.color,
			danger: style.getPropertyValue("--knitoutjs-danger").trim() || "#d33a4c",
		}
	}
	readYarns()
	function onColours() {
		readYarns()
		requestFrame()
	}
	addEventListener(YARNS_CHANGED, onColours)
	const scheme = matchMedia("(prefers-color-scheme: dark)")
	scheme.addEventListener("change", onColours)

	// ── state

	let knitout = {ops: [], carriers: [], problems: [], range: [0, 20]}
	let track = [] // the carriage's run, op by op
	let machine = newMachine()
	let fabric = newFabric()
	let index = 0 // the next op to do
	let progress = 0 // how far through it, 0–1
	let playing = false
	let speed = SPEEDS[1]
	const yarnOf = name => Math.max(0, knitout.carriers.indexOf(name)) % 6

	// the page's side of the machine
	const restNeedles = new Map() // needle key → <use>
	const loopElements = new Map() // needle key → <g>
	// where each stitch is drawn, easing towards where the fabric's settled
	// it (NaN: not drawn yet)
	let shown = {xs: new Float32Array(0), ys: new Float32Array(0)}
	const pathData = new WeakMap() // a held loop's <path> → its d
	const feeders = new Map() // carrier name → {group, yarn}

	// ── drawing what's still

	// a stitch's place on the page: where the fabric's settled its loop, the
	// middle of the stitch it makes
	const pageX = id => fabric.xs[id] * COL
	const pageY = id => FABRIC_TOP + (-fabric.ys[id] / WALE - 0.5) * ROW

	// a loop held on a needle: its legs go down into the loops it was pulled
	// through (or, for a tuck, only a little way)
	function loopPath(hx, hy, foot) {
		const fy = foot ? foot.y : hy + 6
		const fl = foot ? foot.x - 3.2 : hx - 2.6
		const fr = foot ? foot.x + 3.2 : hx + 2.6
		return `M${fl} ${fy} L${hx - 1.9} ${hy} Q${hx} ${hy - 3.6} ${hx + 1.9} ${hy} L${fr} ${fy}`
	}

	function footOf(loop) {
		const parents = loop.parents.filter(id => id < fabric.count && !fabric.pinned[id])
		if (!parents.length) return null
		const x = parents.reduce((sum, id) => sum + pageX(id), 0) / parents.length
		const y = Math.min(...parents.map(pageY)) - ROW * 0.5
		return {x, y}
	}

	function hangY(needle) {
		return needle.back ? BACK_HOOK - 3 : FRONT_HOOK + 3.5
	}

	function drawHeld(key) {
		const held = machine.held.get(key)
		if (!held?.loops.length) {
			loopElements.get(key)?.remove()
			loopElements.delete(key)
			return
		}
		const {needle} = held
		let group = loopElements.get(key)
		const layer = needle.back ? layers.backLoops : layers.frontLoops
		if (!group || group.parentNode !== layer) {
			group?.remove()
			group = svg("g", {}, layer)
			loopElements.set(key, group)
		}
		while (group.childElementCount > held.loops.length) group.lastElementChild.remove()
		while (group.childElementCount < held.loops.length) svg("path", {}, group)
		const hx = across(machine, needle) * COL
		held.loops.forEach((loop, at) => {
			const path = group.children[at]
			const d = loopPath(hx, hangY(needle) - at * 1.6, loop.tuck && at > 0 ? null : footOf(loop))
			const pulled = strainBox.checked ? Math.round(strain(fabric, loop.id) * 3) : 0
			const className = `loop y${loop.yarn}${loop.tuck ? " tuck" : ""}${pulled ? ` strain-${pulled}` : ""}`
			if (pathData.get(path) === d + className) return
			pathData.set(path, d + className)
			path.setAttribute("d", d)
			path.setAttribute("class", className)
			path.setAttribute("data-op", loop.op)
		})
	}

	// every stitch where the fabric's settled it (easing there, unless
	// `instant`), and the loops on the needles reaching down to them. whether
	// anything's still on its way
	function syncFabric(instant) {
		const count = machine.loops.length
		if (shown.xs.length < count) {
			const length = Math.max(1024, fabric.xs.length)
			const grown = {xs: new Float32Array(length).fill(NaN), ys: new Float32Array(length).fill(NaN)}
			grown.xs.set(shown.xs)
			grown.ys.set(shown.ys)
			shown = grown
		}
		const {xs, ys} = shown
		let unsettled = false
		for (let id = firstLoop(machine); id < count; id++) {
			if (fabric.pinned[id]) {
				xs[id] = NaN
				continue
			}
			const x = pageX(id)
			const y = pageY(id)
			if (instant || Number.isNaN(xs[id])) {
				xs[id] = x
				ys[id] = y
				continue
			}
			const nx = xs[id] + (x - xs[id]) * 0.3
			const ny = ys[id] + (y - ys[id]) * 0.3
			if (Math.abs(x - nx) > 0.05 || Math.abs(y - ny) > 0.05) {
				unsettled = true
				xs[id] = nx
				ys[id] = ny
			} else {
				xs[id] = x
				ys[id] = y
			}
		}
		for (const key of machine.held.keys()) drawHeld(key)
		return unsettled
	}

	// the stitches, on the canvas: the back bed's faint, behind the front's.
	// a stitch is a V (or, on the back, the arc of its loop's head), batched
	// into one path for each yarn on each bed
	function drawFabric() {
		const ratio = devicePixelRatio || 1
		const width = Math.round(size.width * ratio)
		const height = Math.round(size.height * ratio)
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width
			canvas.height = height
		}
		const c = context2d
		c.setTransform(1, 0, 0, 1, 0, 0)
		c.clearRect(0, 0, width, height)
		const s = scale() * ratio
		c.setTransform(s, 0, 0, s, -camera.x * s, -camera.y * s)
		const {loops} = machine
		const {xs, ys} = shown
		const left = camera.x - COL
		const right = camera.x + size.width / scale() + COL
		const top = camera.y - ROW
		const bottom = camera.y + size.height / scale() + ROW
		// [back, front] × yarn, what's pointed at, and (showing strain) how
		// hard each is pulled
		const paths = Array.from({length: 16}, () => new Path2D())
		const showStrain = strainBox.checked
		for (let id = firstLoop(machine); id < loops.length; id++) {
			const x = xs[id]
			const y = ys[id]
			if (!(x > left && x < right && y > top && y < bottom)) continue
			const loop = loops[id]
			const pulled = showStrain ? Math.round(strain(fabric, id) * 3) : 0
			const path = paths[loop.op === pointing ? 12 : pulled ? 12 + pulled : (loop.back ? 0 : 6) + loop.yarn]
			if (loop.back) {
				path.moveTo(x - 3.8, y + 1.8)
				path.quadraticCurveTo(x, y - 4.4, x + 3.8, y + 1.8)
			} else {
				path.moveTo(x - 3.6, y - 3.6)
				path.lineTo(x - 0.5, y + 3.3)
				path.moveTo(x + 3.6, y - 3.6)
				path.lineTo(x + 0.5, y + 3.3)
			}
		}
		c.lineWidth = 2.1
		c.lineCap = "round"
		c.lineJoin = "round"
		for (let at = 0; at < 16; at++) {
			c.globalAlpha = at < 6 ? 0.4 : at > 12 ? (at - 12) / 3 : 1
			c.strokeStyle = at === 12 ? colours.ink : at > 12 ? colours.danger : colours.yarns[at % 6]
			c.stroke(paths[at])
		}
		c.globalAlpha = 1
	}

	// settle the fabric a little more, and show it: whether there's more to do
	function settle(budget) {
		const moved = relax(fabric, machine, Infinity, {until: performance.now() + budget})
		return syncFabric(false) || moved > 0.01
	}

	function drawRack() {
		layers.backBed.style.transform = `translate(${machine.rack * COL}px, 0px)`
		for (const [key, held] of machine.held) if (held.needle.back) drawHeld(key)
	}

	// the needles at rest, along both beds
	function drawBeds() {
		layers.backBed.replaceChildren()
		layers.frontBed.replaceChildren()
		restNeedles.clear()
		const [min, max] = knitout.range
		for (let n = min - MARGIN; n <= max + MARGIN; n++) {
			for (const back of [false, true]) {
				const key = (back ? "b" : "f") + n
				const transform = back
					? `translate(${n * COL} ${BACK_HOOK}) scale(1 -1)`
					: `translate(${n * COL} ${FRONT_HOOK})`
				const use = svg(
					"use",
					{href: `#${id}-needle`, transform, class: "rest"},
					back ? layers.backBed : layers.frontBed,
				)
				restNeedles.set(key, use)
			}
		}
	}

	// everything from the machine as it is: after a seek, or a new .k
	function drawAll() {
		layers.backLoops.replaceChildren()
		layers.frontLoops.replaceChildren()
		shown = {xs: new Float32Array(0), ys: new Float32Array(0)}
		loopElements.clear()
		relax(fabric, machine, 0)
		syncFabric(true)
		layers.backBed.style.transform = `translate(${machine.rack * COL}px, 0px)`
	}

	// ── drawing what moves

	function setNeedle(sprite, x, needle, ext) {
		const y = needle.back ? BACK_HOOK + ext * REACH : FRONT_HOOK - ext * REACH
		sprite.element.setAttribute(
			"transform",
			`translate(${x} ${y})${needle.back ? " scale(1 -1)" : ""}`,
		)
		// the latch swings open as the needle goes up
		sprite.latch.setAttribute("transform", `rotate(${-150 * clamp01(ext * 1.6)} 0 7.5)`)
		sprite.element.setAttribute("visibility", "visible")
		return {x, y: needle.back ? y - 2 : y + 2}
	}

	// how far out the needle is, through the op: up, a pause, and back
	function reach(t) {
		if (t < 0.15) return 0
		if (t < 0.5) return ease((t - 0.15) / 0.35)
		if (t < 0.62) return 1
		return 1 - ease((t - 0.62) / 0.38)
	}

	let busy = []
	function drawMoving() {
		for (const use of busy) use.classList.remove("busy")
		busy = []
		for (const sprite of sprites) sprite.element.setAttribute("visibility", "hidden")
		travelling.setAttribute("visibility", "hidden")

		const op = progress > 0 ? knitout.ops[index] : null
		// the carriage turns round first, if it has to, then the needles go
		const turning = op ? turnOf(index) / durationOf(index) : 0
		const t = turning ? clamp01((progress - turning) / (1 - turning)) : progress
		drawCarriage(op, turning, t)
		let caught = null // where the moving needle's hook has the yarn
		let carrierX = null

		const hide = needle => {
			const use = restNeedles.get(needle.bed[0] + needle.n)
			if (use) {
				use.classList.add("busy")
				busy.push(use)
			}
		}

		if (op && op.needle) {
			const x = across(machine, op.needle) * COL
			const to = op.needle.n + (op.dir === "-" ? -0.5 : 0.5)
			carrierX = to
			if (op.kind === "knit" || op.kind === "tuck" || op.kind === "drop") {
				hide(op.needle)
				const out = reach(t) * (op.kind === "tuck" ? 0.65 : 1)
				const hook = setNeedle(sprites[0], x, op.needle, out)
				if (op.carriers.length && t > 0.5) caught = hook
			} else if (op.kind === "split") {
				hide(op.needle)
				hide(op.to)
				const from = setNeedle(sprites[0], x, op.needle, reach(t))
				const target = setNeedle(sprites[1], across(machine, op.to) * COL, op.to, reach(t) * 0.45)
				const held = machine.held.get(op.needle.key)
				if (held?.loops.length && t > 0.35 && t < 0.8) {
					const along = ease((t - 0.35) / 0.4)
					const lx = from.x + (target.x - from.x) * along
					const ly = from.y + (target.y - from.y) * along
					travelling.setAttribute(
						"d",
						`M${lx - 2.6} ${ly + 5} L${lx - 1.9} ${ly} Q${lx} ${ly - 3.6} ${lx + 1.9} ${ly} L${lx + 2.6} ${ly + 5}`,
					)
					travelling.setAttribute("class", `loop travelling y${held.loops[0].yarn}`)
					travelling.setAttribute("visibility", "visible")
				}
				if (op.carriers.length && t > 0.5) caught = from
			}
		}
		if (op?.kind === "rack") {
			const before = machine.rack
			layers.backBed.style.transform = `translate(${(before + (op.rack - before) * ease(t)) * COL}px, 0px)`
		}

		drawYarns(op, t, carrierX, caught)
	}

	// the carriage, where the last op left it, or on its way to the next: out
	// past the end of the pass, a jolt as it turns, and back
	function drawCarriage(op, turning, t) {
		const at = op ? track[index] : track[index - 1]
		if (!at) {
			carriage.setAttribute("visibility", "hidden")
			return
		}
		let x = at.x
		let dir = at.dir
		let jolt = 0
		if (op) {
			const start = at.turn ?? at.from
			if (turning && progress < turning) {
				const u = progress / turning
				x = at.from + (at.turn - at.from) * ease(u)
				dir = at.dir === "+" ? "-" : "+"
			} else {
				x = start + (at.x - start) * ease(t / 0.5)
				// shunk: it knocks against the end of its run, and settles
				if (turning && t < 0.3) jolt = Math.sin((t / 0.3) * Math.PI * 3) * (1 - t / 0.3) * 1.6
			}
		}
		carriage.setAttribute("transform", `translate(${x * COL + jolt} 0)`)
		carriageBody.setAttribute("transform", `translate(0 ${-Math.abs(jolt) * 0.6})`)
		const head = dir === "+" ? 1 : -1
		carriageArrow.setAttribute(
			"d",
			`M${-8 * head} ${CARRIAGE_Y + 8} h${16 * head} m${-4 * head} -3.5 l${4 * head} 3.5 l${-4 * head} 3.5`,
		)
		carriage.setAttribute("visibility", "visible")
	}

	// the carriers in the gap, each with its yarn going down to the last loop
	// it made (or into the hook that's just caught it)
	function drawYarns(op, t, toX, caught) {
		const seen = new Set()
		for (const [name, carrier] of machine.carriers) {
			const moving = op && op.carriers.includes(name) && toX != null
			let x = carrier.x
			if (moving) {
				const from = carrier.x ?? toX + (op.dir === "-" ? 3 : -3)
				x = from + (toX - from) * ease(t / 0.5)
			}
			if (x == null) continue
			seen.add(name)
			let feeder = feeders.get(name)
			if (!feeder) {
				const group = svg("g", {class: `feeder y${yarnOf(name)}`}, layers.yarns)
				const yarn = svg("path", {class: "yarn"}, group)
				svg("rect", {x: -1.8, y: FEEDER - 11, width: 3.6, height: 11, rx: 1}, group)
				const label = svg("text", {x: 0, y: FEEDER - 13, "text-anchor": "middle"}, group)
				label.textContent = name
				feeder = {group, yarn}
				feeders.set(name, feeder)
			}
			const fx = x * COL
			feeder.group.setAttribute("class", `feeder y${yarnOf(name)}`)
			feeder.group.querySelector("rect").setAttribute("x", fx - 1.8)
			feeder.group.querySelector("text").setAttribute("x", fx)
			let end = null
			if (moving && caught) end = caught
			else {
				const held = lastLoop(machine, carrier)
				if (held) end = {x: across(machine, held.needle) * COL, y: hangY(held.needle)}
			}
			feeder.yarn.setAttribute(
				"d",
				end ? `M${fx} ${FEEDER} Q${fx} ${end.y} ${end.x} ${end.y}` : `M${fx} ${FEEDER} L${fx} ${FEEDER + 4}`,
			)
		}
		for (const [name, feeder] of feeders) {
			if (!seen.has(name)) {
				feeder.group.remove()
				feeders.delete(name)
			}
		}
	}

	// ── the view: fits the needles in use, and follows the moving one when
	//    they don't all fit

	const camera = {x: 0, y: TOP, zoom: 1, follow: true}
	let size = {width: 0, height: 0}

	function scale() {
		const [min, max] = knitout.range
		const fit = size.width / ((max - min + 2 * MARGIN + 1) * COL)
		return Math.max(1.4, Math.min(4.5, fit)) * camera.zoom
	}

	function placeCamera(dt) {
		if (!size.width) return
		const s = scale()
		const width = size.width / s
		const height = size.height / s
		const [min, max] = knitout.range
		const left = (min - MARGIN - 0.5) * COL
		const right = (max + MARGIN + 0.5) * COL
		if (right - left <= width) {
			camera.x = (left + right) / 2 - width / 2
		} else if (camera.follow) {
			const op = knitout.ops[Math.min(index, knitout.ops.length - 1)]
			const at = op?.needle ? op.needle.n * COL : camera.x + width / 2
			const target = Math.max(left, Math.min(right - width, at - width / 2))
			camera.x += (target - camera.x) * Math.min(1, dt * 5)
		}
		picture.setAttribute("viewBox", `${camera.x} ${camera.y} ${width} ${height}`)
	}

	// ── playing

	let frame = 0
	let lastTime = 0
	let lastSent = {line: null, at: 0}

	function turnOf(i) {
		return track[i]?.turn != null ? TURN : 0
	}

	function durationOf(i) {
		const base = DURATIONS[knitout.ops[i].kind] ?? 0
		return base && base + turnOf(i)
	}

	// finish the op that's moving, and on to the next
	function commit() {
		const op = knitout.ops[index]
		const change = apply(machine, op, index, yarnOf)
		for (const key of change.touched) drawHeld(key)
		if (change.rack) drawRack()
		index++
		progress = 0
	}

	function tick(now) {
		frame = 0
		const dt = Math.min(0.1, (now - lastTime) / 1000)
		lastTime = now
		if (playing) {
			let budget = dt * speed.perSecond
			while (budget > 0 && index < knitout.ops.length) {
				const duration = durationOf(index)
				if (!duration) {
					commit()
					continue
				}
				const need = (1 - progress) * duration
				if (budget >= need) {
					budget -= need
					commit()
				} else {
					progress += budget / duration
					budget = 0
				}
			}
			// skip over ops there's nothing to see of, so the next one's ready
			while (index < knitout.ops.length && progress === 0 && !durationOf(index)) commit()
			if (index >= knitout.ops.length) pause()
			followAlong(now)
		}
		if (settle(playing ? PLAYING_BUDGET : STILL_BUDGET)) needsFrame = true
		drawMoving()
		// at rest, the view goes straight to where it's going
		placeCamera(playing ? dt : 1)
		drawFabric()
		showWhere()
		if (playing || needsFrame) {
			needsFrame = false
			frame = requestAnimationFrame(tick)
		}
	}

	let needsFrame = false
	function requestFrame() {
		needsFrame = true
		if (!frame) {
			lastTime = performance.now()
			frame = requestAnimationFrame(tick)
		}
	}

	function play() {
		if (!knitout.ops.length) return
		if (index >= knitout.ops.length) seek(0)
		playing = true
		camera.follow = true
		playButton.textContent = "pause"
		requestFrame()
	}

	function pause() {
		playing = false
		playButton.textContent = "play"
		requestFrame()
	}

	// finish the op that's moving, or do the next one there's something to
	// see of
	function stepOnce() {
		const ops = knitout.ops
		if (progress > 0) commit()
		else {
			while (index < ops.length && !durationOf(index)) commit()
			if (index < ops.length) commit()
		}
		requestFrame()
	}

	// undo the op that's moving, or the last one there was something to see of
	function stepBack() {
		if (progress > 0) return seek(index)
		let i = index - 1
		while (i > 0 && !durationOf(i)) i--
		seek(i)
	}

	// wind the machine to just before op `to`
	function seek(to) {
		const target = Math.max(0, Math.min(knitout.ops.length, to))
		machine = newMachine()
		fabric = newFabric()
		for (let i = 0; i < target; i++) apply(machine, knitout.ops[i], i, yarnOf)
		index = target
		progress = 0
		drawAll()
		requestFrame()
	}

	// ── where we are, in words, and in the editors

	function opAt(i) {
		return knitout.ops[Math.min(i, knitout.ops.length - 1)] ?? null
	}

	function describe(op) {
		if (!op) return ""
		const jsUrl = handle.doc()?.knitoutSource
		const from =
			op.jsLine != null && jsUrl ? `from line ${op.jsLine} of the .js` : null
		return [`line ${op.kLine}`, op.text, from].filter(Boolean).join(" · ")
	}

	let pointing = null // the op of the stitch under the pointer
	function showWhere() {
		scrubber.max = String(knitout.ops.length)
		scrubber.value = String(index)
		counter.textContent = `${index} / ${knitout.ops.length}`
		if (pointing != null) return
		const op = progress > 0 ? knitout.ops[index] : index > 0 ? knitout.ops[index - 1] : null
		status.textContent = op
			? describe(op)
			: "press play to watch it knit · point at a stitch to see what made it · space plays, ← → step"
		status.classList.toggle("is-hint", !op)
	}

	function dispatch(type, detail) {
		element.dispatchEvent(new CustomEvent(type, {detail, bubbles: true, composed: true}))
	}

	// while it plays, the line being knitted lights up in the editors (not
	// every op at speed: a few times a second)
	function followAlong(now) {
		if (pointing != null) return
		const op = opAt(index)
		if (!op || op.kLine === lastSent.line || now - lastSent.at < 90) return
		lastSent = {line: op.kLine, at: now}
		dispatch("knitout:hover-source", located(handle, op))
	}

	// the op that made the loop or stitch under the pointer: the one drawn
	// there, or else the stitch whose cell it's in (the middle of a V is empty)
	function opUnder(event) {
		const target = event.target.closest?.("[data-op]")
		if (target) return Number(target.getAttribute("data-op"))
		const matrix = picture.getScreenCTM()
		if (!matrix) return null
		const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
		// the nearest stitch, the front's fabric first: it's the one in front
		let nearest = null
		let best = Infinity
		const {loops} = machine
		for (let id = firstLoop(machine); id < loops.length; id++) {
			const dx = (at.x - shown.xs[id]) / COL
			const dy = (at.y - shown.ys[id]) / ROW
			if (!(Math.abs(dx) < 1 && Math.abs(dy) < 1)) continue
			const away = Math.hypot(dx, dy) - (loops[id].back ? 0 : 0.2)
			if (away < best) {
				best = away
				nearest = id
			}
		}
		return best < 0.6 ? machine.loops[nearest].op : null
	}

	function onPointerMove(event) {
		if (drag) return onDrag(event)
		const op = opUnder(event)
		if (op === pointing) return
		pointing = op
		requestFrame()
		if (op == null) {
			dispatch("knitout:hover-source", {url: null, at: []})
			showWhere()
			return
		}
		status.textContent = describe(knitout.ops[op])
		status.classList.remove("is-hint")
		dispatch("knitout:hover-source", located(handle, knitout.ops[op]))
	}

	function onPointerLeave() {
		if (pointing == null) return
		pointing = null
		requestFrame()
		dispatch("knitout:hover-source", {url: null, at: []})
		showWhere()
	}

	// with it paused, the cursor in an editor winds the knitting to the next
	// time its line knits (from where it is now, round to the start)
	function onHighlightLines(event) {
		if (playing) return
		const {url, start, end = start} = event.detail ?? {}
		if (start == null) return
		const local = url === handle.url
		const fromJs = url != null && url === handle.doc()?.knitoutSource
		if (!local && !fromJs) return
		const hit = op => {
			const line = local ? op.kLine : op.jsLine
			return line != null && line >= start && line <= end
		}
		const current = index > 0 ? knitout.ops[index - 1] : null
		if (current && hit(current)) return
		const ops = knitout.ops
		for (let step = 0; step < ops.length; step++) {
			const i = (index + step) % ops.length
			if (hit(ops[i]) && durationOf(i)) {
				seek(i + 1)
				return
			}
		}
	}

	// ── pointer, wheel and keys

	let drag = null
	function onPointerDown(event) {
		if (event.button !== 0) return
		picture.setPointerCapture(event.pointerId)
		drag = {x: event.clientX, y: event.clientY, moved: false, op: opUnder(event)}
	}
	function onDrag(event) {
		const dx = event.clientX - drag.x
		const dy = event.clientY - drag.y
		if (!drag.moved && Math.hypot(dx, dy) < 4) return
		drag.moved = true
		camera.follow = false
		const s = scale()
		camera.x -= dx / s
		camera.y = Math.max(TOP, camera.y - dy / s)
		drag.x = event.clientX
		drag.y = event.clientY
		requestFrame()
	}
	function onPointerUp() {
		if (drag && !drag.moved && drag.op != null) {
			dispatch("knitout:select-source", located(handle, knitout.ops[drag.op]))
		}
		drag = null
	}
	function onDoubleClick(event) {
		const op = opUnder(event)
		if (op != null) dispatch("knitout:goto-source", located(handle, knitout.ops[op]))
	}
	function onWheel(event) {
		event.preventDefault()
		const s = scale()
		if (event.ctrlKey || event.metaKey) {
			camera.zoom = Math.max(0.3, Math.min(6, camera.zoom * Math.exp(-event.deltaY * 0.01)))
		} else {
			camera.follow = false
			camera.x += event.deltaX / s
			camera.y = Math.max(TOP, camera.y + event.deltaY / s)
		}
		requestFrame()
	}
	function onKeyDown(event) {
		if (event.key === " ") {
			event.preventDefault()
			playing ? pause() : play()
		} else if (event.key === "ArrowRight") {
			event.preventDefault()
			pause()
			stepOnce()
		} else if (event.key === "ArrowLeft") {
			event.preventDefault()
			pause()
			stepBack()
		}
	}

	const pictureListeners = {
		pointerdown: onPointerDown,
		pointermove: onPointerMove,
		pointerup: onPointerUp,
		pointercancel: onPointerUp,
		pointerleave: onPointerLeave,
		dblclick: onDoubleClick,
		wheel: onWheel,
		keydown: onKeyDown,
		mouseover: () => picture.focus({preventScroll: true}),
	}
	for (const [type, listener] of Object.entries(pictureListeners)) {
		picture.addEventListener(type, listener, {passive: false})
	}

	strainBox.addEventListener("change", requestFrame)
	speedSelect.addEventListener("change", () => {
		speed = SPEEDS[Number(speedSelect.value)] ?? SPEEDS[1]
	})
	scrubber.addEventListener("input", () => {
		pause()
		seek(Number(scrubber.value))
	})
	errorBar.addEventListener("click", () => {
		const line = Number(errorBar.dataset.line)
		if (line) dispatch("knitout:goto-source", {url: handle.url, line, at: [{url: handle.url, line}]})
	})

	const resizeObserver = new ResizeObserver(() => {
		const rect = picture.getBoundingClientRect()
		size = {width: rect.width, height: rect.height}
		requestFrame()
	})
	resizeObserver.observe(picture)

	// ── keeping up with the .k

	let timer = null
	function reread() {
		const text = docText(handle.doc())
		knitout = readKnitout(text)
		track = carriageTrack(knitout.ops)
		empty.hidden = knitout.ops.length > 0
		const [problem] = knitout.problems
		errorBar.hidden = !problem
		if (problem) {
			errorBar.textContent = `line ${problem.line}: ${problem.text}${knitout.problems.length > 1 ? ` (and ${knitout.problems.length - 1} more)` : ""}`
			errorBar.dataset.line = String(problem.line)
		}
		drawBeds()
		// the knitting stays where it was, if it's still that long
		seek(Math.min(index, knitout.ops.length))
		checks.check(text).then(panel.show)
	}

	function scheduleReread() {
		clearTimeout(timer)
		timer = setTimeout(reread, REPARSE_DELAY)
	}

	handle.on("change", scheduleReread)
	events.addEventListener("knitout:highlight-lines", onHighlightLines)
	reread()

	return () => {
		playing = false
		clearTimeout(timer)
		cancelAnimationFrame(frame)
		handle.off("change", scheduleReread)
		events.removeEventListener("knitout:highlight-lines", onHighlightLines)
		removeEventListener(YARNS_CHANGED, onColours)
		scheme.removeEventListener("change", onColours)
		resizeObserver.disconnect()
		for (const [type, listener] of Object.entries(pictureListeners)) {
			picture.removeEventListener(type, listener)
		}
		checks.close()
		panel.remove()
		root.remove()
		link.remove()
	}
}
