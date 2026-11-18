import {docText, moduleWorker} from "./files.js"
import {readKnitout} from "./knitting.js"
import {programOf} from "./knitscape-program.js"
import {YARNS_CHANGED, yarnPicker, yarnStrands} from "../knitoutjs/core/yarns.js"
import {withIcon} from "../wm/ui/icons.js"
import {stylesheet} from "../wm/ui/stylesheet.js"
import {generateTopology} from "./vendor/knitscape/knitbit/simulation/topology.js"
import {computeYarnPathSpline, layoutNodes} from "./vendor/knitscape/knitbit/simulation/layout.js"
import {segmentsToPoints} from "./vendor/knitscape/shared/simulation/segments.js"
import {createRelaxationDriver} from "./vendor/knitscape/shared/simulation/relaxationDriver.js"
import {DEFAULT_RELAX_SETTINGS} from "./vendor/knitscape/shared/simulation/types.js"
import {hexToRgb} from "./vendor/knitscape/shared/hexToRgb.js"

// the yarn itself: Hannah Twigg-Smith's knitscape (vendor/knitscape), its
// contact-node topology and yarn relaxation, drawn with its fibres. the .k's
// a knitscape program (knitscape-program.js); the yarn's a path through the
// points where it touches other yarn, a loop four of them, its head shared
// with the loop above and its legs with the loop below, and the path's
// relaxed, off the page's thread, as yarn would. so a tuck's half a loop, and
// tucks beside each other are less again, or a float trapped: what a loop
// for every stitch can't say
//
// the bar's the 3d view's (its stylesheet, its classes)

const STYLESHEET = new URL("./knit3d.css", import.meta.url).href
const REPARSE_DELAY = 250
// knitscape's: a yarn's 0.27 of a stitch across, a stitch as tall as it's
// wide, and the back bed's fabric a quarter of a stitch behind the front's
const YARN_DIAMETER = 0.27
const PARAMS = {YARN_RADIUS: YARN_DIAMETER / 2, STITCH_WIDTH: 1, ASPECT: 1, BED_OFFSET: 0.25}
// (compressed first: a .k's passes go front and back by turns, knitting a
// tube, and as knitted, every one of them is a row of its own)
const MODES = [
	{id: "compressed", name: "compressed", title: "rows only as tall as the stitches in them: short rows show as steps, not long loops"},
	{id: "technical", name: "as knitted", title: "each pass a row, where the machine knitted it: held loops stretch up past the rows knitted on without them"},
]

function button(text, title, onClick) {
	const element = document.createElement("button")
	element.className = "knitout-button"
	element.textContent = text
	element.title = title
	element.addEventListener("click", onClick)
	return element
}

function toggle(text, title, checked) {
	const label = document.createElement("label")
	label.className = "knit3d-toggle"
	label.title = title
	const box = document.createElement("input")
	box.type = "checkbox"
	box.checked = checked
	label.append(box, text)
	return {label, box}
}

// what knitscape's renderer draws: each yarn's path through its contact
// nodes, in its carrier's colour
export function geometryOf(program, mode, colours) {
	const topology = generateTopology(program, mode)
	const {nodes, nodeMap} = layoutNodes(topology, program, PARAMS)
	const segments = computeYarnPathSpline(topology, program, nodes, nodeMap, PARAMS)
	const yarnData = Object.entries(segments)
		.map(([yarnIndex, segmentArr]) => ({
			yarnIndex,
			pts: segmentsToPoints(segmentArr, nodes),
			diameter: YARN_DIAMETER,
			color: hexToRgb(colours[(Number(yarnIndex) - 1) % colours.length]).map(value => value / 255),
		}))
		// (the renderer draws a yarn of two points or more)
		.filter(yarn => yarn.pts.length >= 6)
	return {nodes, segments, yarnData}
}

export default function YarnPathTool(handle, element) {
	const root = document.createElement("div")
	root.className = "knit3d yarnpath"
	const link = stylesheet(STYLESHEET, root)
	element.append(link, root)

	// ── the controls

	const bar = document.createElement("div")
	bar.className = "knit3d-bar"
	root.appendChild(bar)

	const scrubber = document.createElement("input")
	scrubber.type = "range"
	scrubber.min = "0"
	scrubber.className = "knit3d-scrubber"
	scrubber.title = "how much of the knitting's done"

	const modeSelect = document.createElement("select")
	modeSelect.className = "knit3d-select"
	modeSelect.title = MODES.map(mode => `${mode.name}: ${mode.title}`).join("\n")
	for (const mode of MODES) modeSelect.append(new Option(mode.name, mode.id))

	const fibres = toggle("fibres", "the yarn's plies and fibres, and its fuzz; or a smooth noodle", true)
	const shade = toggle("shade", "darken the yarn where it goes under other yarn (ambient occlusion)", true)
	const yarns = yarnPicker({handle})

	bar.append(
		scrubber,
		modeSelect,
		fibres.label,
		shade.label,
		yarns.element,
		withIcon("restart", button("relax", "let the yarn settle again, from where it was laid out", () => driver?.restart())),
		withIcon("fit", button("reset view", "fit it all in (drag to turn it, right-drag to move, scroll to zoom)", () => driver?.fitCamera())),
	)

	const stage = document.createElement("div")
	stage.className = "knit3d-stage"
	root.appendChild(stage)
	const canvas = document.createElement("canvas")
	canvas.tabIndex = 0
	stage.appendChild(canvas)

	const empty = document.createElement("div")
	empty.className = "knit3d-empty"
	stage.appendChild(empty)

	const status = document.createElement("div")
	status.className = "knit3d-status"
	stage.appendChild(status)

	if (!canvas.getContext("webgl2")) {
		empty.textContent = "this browser can't draw in 3d (no webgl2)"
		return () => {
			yarns.destroy()
			root.remove()
			link.remove()
		}
	}

	// ── the knitting

	let knitout = {ops: [], carriers: []}
	let upTo = 0
	let mode = MODES[0].id
	let driver = null
	let shown = {rows: 0, nodes: 0, ms: 0}
	const relaxSettings = {...DEFAULT_RELAX_SETTINGS}

	function build() {
		const t0 = performance.now()
		const program = programOf(knitout, {upTo})
		const colours = yarnStrands(handle.doc()).map(({colours}) => colours[0])
		const geometry = geometryOf(program, mode, colours)
		shown = {rows: program.height, nodes: geometry.nodes.length, ms: Math.round(performance.now() - t0)}
		empty.hidden = geometry.yarnData.length > 0
		empty.textContent = knitout.ops.length ? "no stitches yet" : "nothing knitted"
		canvas.hidden = !empty.hidden
		if (!geometry.yarnData.length) return
		if (driver) {
			driver.rebuild(geometry)
		} else {
			driver = createRelaxationDriver(geometry, {canvas, resetCamera: true, relaxSettings, createWorker: moduleWorker})
			driver.setFiberMode(fibres.box.checked)
			driver.setAmbientOcclusion({enabled: shade.box.checked})
		}
		driver.relax()
	}

	// (scrubbing: one build a frame, at most)
	let building = 0
	function buildSoon() {
		if (!building) building = requestAnimationFrame(() => ((building = 0), build()))
	}

	// ── drawing: knitscape's renderer draws only when something's changed

	let frame = 0
	function tick() {
		frame = requestAnimationFrame(tick)
		if (!driver || canvas.hidden) return
		driver.draw()
		const relaxing = driver.isRelaxing()
		status.textContent = `${upTo} / ${knitout.ops.length} ops · ${shown.rows} rows · ${shown.nodes} contact nodes · ${relaxing ? "relaxing…" : "relaxed"}`
	}
	frame = requestAnimationFrame(tick)

	scrubber.addEventListener("input", () => {
		upTo = Number(scrubber.value)
		buildSoon()
	})
	modeSelect.addEventListener("change", () => {
		mode = modeSelect.value
		build()
	})
	fibres.box.addEventListener("change", () => driver?.setFiberMode(fibres.box.checked))
	shade.box.addEventListener("change", () => driver?.setAmbientOcclusion({enabled: shade.box.checked}))
	// (a yarn's colour is in its geometry: it's built again)
	const onColours = () => build()
	addEventListener(YARNS_CHANGED, onColours)

	// ── keeping up with the .k

	let timer = null
	let readText = null
	function reread() {
		const wasEnd = upTo >= knitout.ops.length
		readText = docText(handle.doc())
		knitout = readKnitout(readText)
		upTo = wasEnd ? knitout.ops.length : Math.min(upTo, knitout.ops.length)
		scrubber.max = String(knitout.ops.length)
		scrubber.value = String(upTo)
		build()
	}
	function scheduleReread() {
		if (docText(handle.doc()) === readText) return
		clearTimeout(timer)
		timer = setTimeout(reread, REPARSE_DELAY)
	}
	handle.on("change", scheduleReread)
	reread()

	return () => {
		cancelAnimationFrame(frame)
		cancelAnimationFrame(building)
		clearTimeout(timer)
		handle.off("change", scheduleReread)
		removeEventListener(YARNS_CHANGED, onColours)
		driver?.terminate()
		yarns.destroy()
		root.remove()
		link.remove()
	}
}
