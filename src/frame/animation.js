import {docText} from "./files.js"
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
// how much fabric each needle keeps on the page
const KEEP = 240

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
 * the picture is an svg, animated op by op. play, step and scrub through it;
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
	)

	// ── the picture

	const stage = document.createElement("div")
	stage.className = "knitout-animation-stage"
	root.appendChild(stage)

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
		"backFabric",
		"backLoops",
		"fabric",
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

	const errorBar = document.createElement("div")
	errorBar.className = "knitout-animation-error"
	errorBar.hidden = true
	root.appendChild(errorBar)

	// ── yarn colours: the same as the kniterate tool's

	function readYarns() {
		yarnColours().forEach((colour, index) => root.style.setProperty(`--yarn-${index}`, colour))
	}
	readYarns()
	addEventListener(YARNS_CHANGED, readYarns)

	// ── state

	let knitout = {ops: [], carriers: [], problems: [], range: [0, 20]}
	let track = [] // the carriage's run, op by op
	let machine = newMachine()
	let index = 0 // the next op to do
	let progress = 0 // how far through it, 0–1
	let playing = false
	let speed = SPEEDS[1]
	const yarnOf = name => Math.max(0, knitout.carriers.indexOf(name)) % 6

	// the page's side of the machine
	const restNeedles = new Map() // needle key → <use>
	const loopElements = new Map() // needle key → <g>
	const columnElements = new Map() // column key → {group, count, n}
	const feeders = new Map() // carrier name → {group, yarn}

	// ── drawing what's still

	// a loop held on a needle: its legs go down into the fabric (or, for a
	// tuck, only a little way)
	function loopPath(hx, hy, fx, tuck) {
		const fy = tuck ? hy + 6 : FABRIC_TOP
		const fl = tuck ? hx - 2.6 : fx - 3.2
		const fr = tuck ? hx + 2.6 : fx + 3.2
		return `M${fl} ${fy} L${hx - 1.9} ${hy} Q${hx} ${hy - 3.6} ${hx + 1.9} ${hy} L${fr} ${fy}`
	}

	function hangY(needle) {
		return needle.back ? BACK_HOOK - 3 : FRONT_HOOK + 3.5
	}

	function drawHeld(key) {
		const held = machine.held.get(key)
		loopElements.get(key)?.remove()
		loopElements.delete(key)
		if (!held?.loops.length) return
		const {needle} = held
		const group = svg("g", {}, needle.back ? layers.backLoops : layers.frontLoops)
		const hx = across(machine, needle) * COL
		const fx = needle.n * COL
		held.loops.forEach((loop, at) => {
			svg(
				"path",
				{
					d: loopPath(hx, hangY(needle) - at * 1.6, fx, loop.tuck && at > 0),
					class: `loop y${loop.yarn}${loop.tuck ? " tuck" : ""}`,
					"data-op": loop.op,
				},
				group,
			)
		})
		loopElements.set(key, group)
	}

	function stitchElement(stitch, k) {
		const cy = -(k + 0.5) * ROW
		const group = svg("g", {class: `stitch y${stitch.yarn}`, "data-op": stitch.op})
		if (stitch.back) {
			svg("path", {d: `M-3.8 ${cy + 1.8} Q0 ${cy - 4.4} 3.8 ${cy + 1.8}`}, group)
		} else {
			svg("path", {d: `M-3.6 ${cy - 3.6} L-0.5 ${cy + 3.3}`}, group)
			svg("path", {d: `M3.6 ${cy - 3.6} L0.5 ${cy + 3.3}`}, group)
		}
		if (stitch.extra) {
			svg("path", {d: `M-3 ${cy - 2.6} Q0 ${cy - 6.6} 3 ${cy - 2.6}`, class: "extra"}, group)
		}
		return group
	}

	// the back bed's fabric hangs behind the front's: a tube's far side, a
	// jacquard's backing
	function columnFor(key, n, back) {
		let column = columnElements.get(key)
		if (!column) {
			const group = svg("g", {class: "column"}, back ? layers.backFabric : layers.fabric)
			column = {group, count: 0, n}
			columnElements.set(key, column)
		}
		return column
	}

	function placeColumn(column) {
		column.group.style.transform = `translate(${column.n * COL}px, ${FABRIC_TOP + column.count * ROW}px)`
	}

	function addStitch({key, n, back, stitch}) {
		const column = columnFor(key, n, back)
		column.group.appendChild(stitchElement(stitch, column.count))
		column.count++
		if (column.group.childElementCount > KEEP) column.group.firstElementChild.remove()
		placeColumn(column)
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
		root.classList.add("is-instant")
		layers.fabric.replaceChildren()
		layers.backFabric.replaceChildren()
		layers.backLoops.replaceChildren()
		layers.frontLoops.replaceChildren()
		columnElements.clear()
		loopElements.clear()
		for (const [key, {n, back, stitches}] of machine.columns) {
			const column = columnFor(key, n, back)
			const from = Math.max(0, stitches.length - KEEP)
			for (let k = from; k < stitches.length; k++) {
				column.group.appendChild(stitchElement(stitches[k], k))
			}
			column.count = stitches.length
			placeColumn(column)
		}
		for (const key of machine.held.keys()) drawHeld(key)
		layers.backBed.style.transform = `translate(${machine.rack * COL}px, 0px)`
		requestAnimationFrame(() => root.classList.remove("is-instant"))
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
		for (const added of change.stitches) addStitch(added)
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
		drawMoving()
		// at rest, the view goes straight to where it's going
		placeCamera(playing ? dt : 1)
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

	// every line an op came from, as {url, line}: the .js first, then the .k
	function located(op) {
		if (!op) return null
		const jsUrl = handle.doc()?.knitoutSource
		const at = []
		if (op.jsLine != null && jsUrl) at.push({url: jsUrl, line: op.jsLine})
		at.push({url: handle.url, line: op.kLine})
		return {...at[0], at}
	}

	// while it plays, the line being knitted lights up in the editors (not
	// every op at speed: a few times a second)
	function followAlong(now) {
		if (pointing != null) return
		const op = opAt(index)
		if (!op || op.kLine === lastSent.line || now - lastSent.at < 90) return
		lastSent = {line: op.kLine, at: now}
		dispatch("knitout:hover-source", located(op))
	}

	// the op that made the loop or stitch under the pointer: the one drawn
	// there, or else the stitch whose cell it's in (the middle of a V is empty)
	function opUnder(event) {
		const target = event.target.closest?.("[data-op]")
		if (target) return Number(target.getAttribute("data-op"))
		const matrix = picture.getScreenCTM()
		if (!matrix) return null
		const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
		const n = Math.round(at.x / COL)
		const row = Math.floor((at.y - FABRIC_TOP) / ROW)
		// the front's fabric first: it's the one in front
		for (const key of ["f" + n, "b" + n]) {
			const stitches = machine.columns.get(key)?.stitches
			const k = stitches ? stitches.length - 1 - row : -1
			if (k >= 0 && k < stitches.length) return stitches[k].op
		}
		return null
	}

	function onPointerMove(event) {
		if (drag) return onDrag(event)
		const op = opUnder(event)
		if (op === pointing) return
		pointing = op
		if (op == null) {
			dispatch("knitout:hover-source", {url: null, at: []})
			showWhere()
			return
		}
		status.textContent = describe(knitout.ops[op])
		status.classList.remove("is-hint")
		dispatch("knitout:hover-source", located(knitout.ops[op]))
	}

	function onPointerLeave() {
		if (pointing == null) return
		pointing = null
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
			dispatch("knitout:select-source", located(knitout.ops[drag.op]))
		}
		drag = null
	}
	function onDoubleClick(event) {
		const op = opUnder(event)
		if (op != null) dispatch("knitout:goto-source", located(knitout.ops[op]))
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
		removeEventListener(YARNS_CHANGED, readYarns)
		resizeObserver.disconnect()
		for (const [type, listener] of Object.entries(pictureListeners)) {
			picture.removeEventListener(type, listener)
		}
		root.remove()
		link.remove()
	}
}
