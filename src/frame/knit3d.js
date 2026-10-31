import {docText} from "./files.js"
import {WALE, newFabric, relax} from "./fabric.js"
import {OVERRUN, apply, carriageTrack, newMachine, readKnitout} from "./knitting.js"
import {YARNS_CHANGED, yarnColours} from "./yarns.js"

const STYLESHEET = new URL("./knit3d.css", import.meta.url).href
const REPARSE_DELAY = 250

// the world, in needles: a needle's pitch is 1 across (x), the fabric hangs
// down (−y) from the gap between the beds, the front bed is towards you (+z)
const ROW = WALE
const YARN = 0.085
const SIDES = 6
const COS = Array.from({length: SIDES}, (_, side) => Math.cos((side / SIDES) * Math.PI * 2))
const SIN = Array.from({length: SIDES}, (_, side) => Math.sin((side / SIDES) * Math.PI * 2))
const DEPTH = 0.16 // how far a loop's legs come forward of its head
const GAP = 0.32 // each bed's fabric, either side of the middle
const NEEDLE = 6 // a needle's length, down its bed
const SLOPE = Math.SQRT1_2 // the beds lean 45° away from the gap
const BED_MARGIN = Math.ceil(OVERRUN + 6)
// frames the fabric gets to settle in, after a jump
const SETTLE = 30
// how many rows down a tube takes to open out round
const OPENING = 14
// at most this many stitches are drawn: the newest rows, when there are more
const BUDGET = 24000

const SPEEDS = [
	{name: "slow", perSecond: 40},
	{name: "run", perSecond: 300},
	{name: "fly", perSecond: 3000},
]

// a knit loop, seen from its face: from the sinker at its bottom left, up a
// leg (forward, over the head of the loop below), round its head (behind the
// legs of the loop above), down the other leg, to the sinker at its bottom
// right. as [x, y in rows, z in DEPTHs]
const LOOP = [
	[-0.5, 0, -1],
	[-0.33, 0.25, 0],
	[-0.2, 0.6, 1],
	[-0.27, 1.12, 0.2],
	[-0.2, 1.52, -1],
	[0, 1.68, -1],
	[0.2, 1.52, -1],
	[0.27, 1.12, 0.2],
	[0.2, 0.6, 1],
	[0.33, 0.25, 0],
	[0.5, 0, -1],
]
const LOOP_STEPS = 2 // points between each of LOOP's

// catmull-rom through LOOP, once
const LOOP_CURVE = (() => {
	const points = []
	for (let i = 0; i < LOOP.length - 1; i++) {
		const p0 = LOOP[Math.max(0, i - 1)]
		const p1 = LOOP[i]
		const p2 = LOOP[i + 1]
		const p3 = LOOP[Math.min(LOOP.length - 1, i + 2)]
		for (let step = 0; step < LOOP_STEPS; step++) {
			const t = step / LOOP_STEPS
			const t2 = t * t
			const t3 = t2 * t
			points.push(
				[0, 1, 2].map(
					axis =>
						0.5 *
						(2 * p1[axis] +
							(-p0[axis] + p2[axis]) * t +
							(2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
							(-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3),
				),
			)
		}
	}
	points.push(LOOP[LOOP.length - 1])
	return points
})()

function button(text, title, onClick) {
	const element = document.createElement("button")
	element.className = "knitout-button"
	element.textContent = text
	element.title = title
	element.addEventListener("click", onClick)
	return element
}

// ── a mesh, built up a triangle at a time

// (its arrays are kept from one build to the next: the fabric's about as big
// as it was last time)
class Mesh {
	constructor() {
		this.vertices = new Float32Array(9 * 4096) // position, normal, colour
		this.indices = new Uint32Array(6 * 4096)
		this.vertexCount = 0
		this.indexCount = 0
	}

	reset() {
		this.vertexCount = 0
		this.indexCount = 0
	}

	vertex(x, y, z, nx, ny, nz, colour) {
		if ((this.vertexCount + 1) * 9 > this.vertices.length) {
			const grown = new Float32Array(this.vertices.length * 2)
			grown.set(this.vertices)
			this.vertices = grown
		}
		const v = this.vertices
		const at = this.vertexCount * 9
		v[at] = x
		v[at + 1] = y
		v[at + 2] = z
		v[at + 3] = nx
		v[at + 4] = ny
		v[at + 5] = nz
		v[at + 6] = colour[0]
		v[at + 7] = colour[1]
		v[at + 8] = colour[2]
		return this.vertexCount++
	}

	triangle(a, b, c) {
		if (this.indexCount + 3 > this.indices.length) {
			const grown = new Uint32Array(this.indices.length * 2)
			grown.set(this.indices)
			this.indices = grown
		}
		this.indices[this.indexCount++] = a
		this.indices[this.indexCount++] = b
		this.indices[this.indexCount++] = c
	}

	// room for so many more vertices and indices
	reserve(vertices, indices) {
		if ((this.vertexCount + vertices) * 9 > this.vertices.length) {
			const grown = new Float32Array(Math.max(this.vertices.length * 2, (this.vertexCount + vertices) * 9))
			grown.set(this.vertices)
			this.vertices = grown
		}
		if (this.indexCount + indices > this.indices.length) {
			const grown = new Uint32Array(Math.max(this.indices.length * 2, this.indexCount + indices))
			grown.set(this.indices)
			this.indices = grown
		}
	}

	// a yarn along `count` points (x, y, z, one after another in `points`),
	// round, SIDES sided
	tube(points, count, radius, colour) {
		this.reserve(count * SIDES, (count - 1) * SIDES * 6)
		const v = this.vertices
		const first = this.vertexCount
		let at = first * 9
		for (let i = 0; i < count; i++) {
			const b = Math.max(0, i - 1) * 3
			const a = Math.min(count - 1, i + 1) * 3
			let tx = points[a] - points[b]
			let ty = points[a + 1] - points[b + 1]
			let tz = points[a + 2] - points[b + 2]
			const tl = Math.hypot(tx, ty, tz) || 1
			tx /= tl
			ty /= tl
			tz /= tl
			// normal = reference × tangent, the reference being z (or x, if the
			// yarn's going along z)
			let nx, ny, nz
			if (Math.abs(tz) < 0.9) {
				nx = -ty
				ny = tx
				nz = 0
			} else {
				nx = 0
				ny = -tz
				nz = ty
			}
			const nl = Math.hypot(nx, ny, nz) || 1
			nx /= nl
			ny /= nl
			nz /= nl
			const bx = ty * nz - tz * ny
			const by = tz * nx - tx * nz
			const bz = tx * ny - ty * nx
			const px = points[i * 3]
			const py = points[i * 3 + 1]
			const pz = points[i * 3 + 2]
			for (let side = 0; side < SIDES; side++) {
				const ox = nx * COS[side] + bx * SIN[side]
				const oy = ny * COS[side] + by * SIN[side]
				const oz = nz * COS[side] + bz * SIN[side]
				v[at] = px + ox * radius
				v[at + 1] = py + oy * radius
				v[at + 2] = pz + oz * radius
				v[at + 3] = ox
				v[at + 4] = oy
				v[at + 5] = oz
				v[at + 6] = colour[0]
				v[at + 7] = colour[1]
				v[at + 8] = colour[2]
				at += 9
			}
		}
		this.vertexCount += count * SIDES
		const indices = this.indices
		let k = this.indexCount
		for (let i = 0; i < count - 1; i++) {
			for (let side = 0; side < SIDES; side++) {
				const a = first + i * SIDES + side
				const b = first + i * SIDES + ((side + 1) % SIDES)
				indices[k++] = a
				indices[k++] = a + SIDES
				indices[k++] = b
				indices[k++] = b
				indices[k++] = a + SIDES
				indices[k++] = b + SIDES
			}
		}
		this.indexCount = k
	}

	// a box at `centre`, its half sizes along three axes
	box(centre, axes, colour) {
		for (const [index, axis] of axes.entries()) {
			const others = axes.filter((_, other) => other !== index)
			for (const sign of [1, -1]) {
				const normal = normalize(axis.map(value => value * sign))
				const face = [0, 1, 2].map(k => centre[k] + axis[k] * sign)
				const corners = [
					[-1, -1],
					[1, -1],
					[1, 1],
					[-1, 1],
				].map(([u, v]) => {
					const p = [0, 1, 2].map(k => face[k] + others[0][k] * u + others[1][k] * v)
					return this.vertex(...p, ...normal, colour)
				})
				// wound either way: the shader lights both sides
				this.triangle(corners[0], corners[1], corners[2])
				this.triangle(corners[0], corners[2], corners[3])
			}
		}
	}
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
function normalize(v) {
	const length = Math.hypot(v[0], v[1], v[2]) || 1
	return [v[0] / length, v[1] / length, v[2] / length]
}

function perspective(fov, aspect, near, far) {
	const f = 1 / Math.tan(fov / 2)
	const range = 1 / (near - far)
	return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (near + far) * range, -1, 0, 0, 2 * near * far * range, 0]
}

function lookAt(eye, target, up) {
	const z = normalize(sub(eye, target))
	const x = normalize(cross(up, z))
	const y = cross(z, x)
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
	return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]
}

function multiply(a, b) {
	const out = new Array(16).fill(0)
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 4; row++) {
			for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k]
		}
	}
	return out
}

// does this knitting look like a tube: passes on one bed and then the other,
// rather than both at once (a rib, a jacquard)
function looksLikeTube(ops) {
	let front = 0
	let back = 0
	let both = 0
	let pass = null
	const finish = () => {
		if (!pass) return
		if (pass.front && pass.back) both++
		else if (pass.front) front++
		else if (pass.back) back++
	}
	for (const op of ops) {
		if (op.kind !== "knit") continue
		const carrier = op.carriers.join(" ")
		if (!pass || pass.dir !== op.dir || pass.carrier !== carrier) {
			finish()
			pass = {dir: op.dir, carrier, front: false, back: false}
		}
		pass[op.needle.back ? "back" : "front"] = true
	}
	finish()
	return front > 2 && back > 2 && both < (front + back) / 4
}

const VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec3 normal;
in vec3 colour;
uniform mat4 viewProjection;
out vec3 vNormal;
out vec3 vColour;
out vec3 vWorld;
void main() {
	vNormal = normal;
	vColour = colour;
	vWorld = position;
	gl_Position = viewProjection * vec4(position, 1.0);
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColour;
in vec3 vWorld;
uniform vec3 eye;
out vec4 outColour;
void main() {
	vec3 n = normalize(vNormal);
	vec3 v = normalize(eye - vWorld);
	if (dot(n, v) < 0.0) n = -n;
	vec3 key = normalize(vec3(0.35, 0.8, 0.55));
	vec3 fill = normalize(vec3(-0.6, 0.15, -0.45));
	float light = max(dot(n, key), 0.0) * 0.72 + max(dot(n, fill), 0.0) * 0.22;
	float shine = pow(max(dot(n, normalize(key + v)), 0.0), 28.0) * 0.18;
	float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.12;
	outColour = vec4(vColour * (0.32 + light) + shine + rim, 1.0);
}`

/**
 * the fabric a .k makes, in 3d: every loop a little tube of yarn, hanging
 * down from the needle bed's gap. the front bed's fabric is in front, the
 * back's behind; knit a tube and it can open out round, knit a jacquard and
 * turn it round to see its backing. scrub through the knitting, or play it,
 * to watch the fabric grow
 */
export default function Knit3dTool(handle, element) {
	const link = document.createElement("link")
	link.rel = "stylesheet"
	link.href = STYLESHEET
	element.appendChild(link)

	const root = document.createElement("div")
	root.className = "knitoutjs-editor-tool knit3d"
	element.appendChild(root)

	// ── the controls

	const bar = document.createElement("div")
	bar.className = "knit3d-bar"
	root.appendChild(bar)

	const playButton = button("play", "watch the fabric grow", () => (playing ? pause() : play()))
	playButton.classList.add("knit3d-play")
	const speedSelect = document.createElement("select")
	speedSelect.className = "knit3d-select"
	speedSelect.title = "how fast it knits"
	for (const [index, speed] of SPEEDS.entries()) speedSelect.append(new Option(speed.name, String(index)))
	speedSelect.value = "1"
	const scrubber = document.createElement("input")
	scrubber.type = "range"
	scrubber.min = "0"
	scrubber.className = "knit3d-scrubber"
	scrubber.title = "how much of the knitting's done"

	const roundLabel = document.createElement("label")
	roundLabel.className = "knit3d-round"
	roundLabel.title = "open the two beds' fabric out into a tube, or lay them flat together"
	const roundSlider = document.createElement("input")
	roundSlider.type = "range"
	roundSlider.min = "0"
	roundSlider.max = "1"
	roundSlider.step = "0.01"
	roundLabel.append("flat", roundSlider, "round")

	const bedLabel = document.createElement("label")
	bedLabel.className = "knit3d-toggle"
	bedLabel.title = "show the needle beds and the carriage"
	const bedBox = document.createElement("input")
	bedBox.type = "checkbox"
	bedBox.checked = true
	bedLabel.append(bedBox, "needle bed")

	bar.append(
		playButton,
		speedSelect,
		scrubber,
		roundLabel,
		bedLabel,
		button("reset view", "look at it from the front again (drag to turn it, shift-drag to move, scroll to zoom)", () => {
			resetCamera()
			draw()
		}),
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
	root.appendChild(status)

	// ── webgl

	const gl = canvas.getContext("webgl2", {antialias: true})
	if (!gl) {
		empty.textContent = "this browser can't draw in 3d (no webgl2)"
		return () => {
			root.remove()
			link.remove()
		}
	}

	function compile(type, source) {
		const shader = gl.createShader(type)
		gl.shaderSource(shader, source)
		gl.compileShader(shader)
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
		return shader
	}
	const program = gl.createProgram()
	gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER))
	gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
	gl.linkProgram(program)
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
	const uniforms = {
		viewProjection: gl.getUniformLocation(program, "viewProjection"),
		eye: gl.getUniformLocation(program, "eye"),
	}
	const vao = gl.createVertexArray()
	const vertexBuffer = gl.createBuffer()
	const indexBuffer = gl.createBuffer()
	gl.bindVertexArray(vao)
	gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
	for (const [name, offset] of [
		["position", 0],
		["normal", 3],
		["colour", 6],
	]) {
		const location = gl.getAttribLocation(program, name)
		gl.enableVertexAttribArray(location)
		gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 36, offset * 4)
	}
	gl.bindVertexArray(null)
	let indexCount = 0

	// ── colours

	function rgb(colour) {
		const probe = document.createElement("canvas").getContext("2d")
		probe.fillStyle = colour
		const hex = probe.fillStyle
		if (!hex.startsWith("#")) return [0.5, 0.5, 0.5]
		return [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
	}
	let palette = {}
	function readColours() {
		palette = {
			yarns: yarnColours().map(rgb),
			steel: [0.62, 0.64, 0.68],
			bed: [0.3, 0.31, 0.34],
			carriage: [0.78, 0.76, 0.72],
			cam: [0.2, 0.2, 0.22],
		}
	}

	// ── the knitting

	let knitout = {ops: [], carriers: [], problems: [], range: [0, 20]}
	let track = []
	let machine = newMachine()
	let fabric = newFabric()
	let done = 0 // ops done to the machine
	let upTo = 0 // ops the picture shows
	let playing = false
	let speed = SPEEDS[1]
	let round = 0
	const yarnOf = name => Math.max(0, knitout.carriers.indexOf(name)) % 6

	function runTo(target) {
		const to = Math.max(0, Math.min(knitout.ops.length, Math.floor(target)))
		if (to < done) {
			machine = newMachine()
			fabric = newFabric()
			done = 0
		}
		for (; done < to; done++) apply(machine, knitout.ops[done], done, yarnOf)
	}

	// where a point on a bed's fabric goes: (s across, y down, z out of its
	// face) laid flat, or round a tube
	function placer() {
		const [lo, hi] = knitout.range
		const width = hi - lo + 1
		const radius = width / Math.PI
		const middle = (lo + hi) / 2
		// (written into `out` at `at`)
		return (back, s, y, z, out, at) => {
			const flatZ = back ? -GAP - z : GAP + z
			out[at + 1] = y
			// pressed flat between the beds, opening out as it hangs
			const open = round * Math.min(1, Math.max(0, -y / (OPENING * ROW)) ** 1.5)
			if (!open) {
				out[at] = s
				out[at + 2] = flatZ
				return
			}
			const along = Math.max(0, Math.min(width, s - lo + 0.5)) / width
			const angle = back ? Math.PI + Math.PI * along : Math.PI - Math.PI * along
			const r = radius + z
			const roundX = middle + r * Math.cos(angle)
			const roundZ = r * Math.sin(angle)
			out[at] = s + (roundX - s) * open
			out[at + 2] = flatZ + (roundZ - flatZ) * open
		}
	}

	let bounds = {min: [0, -10, -1], max: [20, 2, 1]}

	// every loop of the fabric, where it's settled: a knit loop facing out of
	// its bed's side, leaning with its wale and its row. a loop still on a
	// needle reaches down to the loops it was pulled through, however far
	// they've gone
	const mesh = new Mesh()
	const points = new Float64Array(LOOP_CURVE.length * 3)
	function build(sweeps) {
		mesh.reset()
		const place = placer()
		const moved = relax(fabric, machine, sweeps)
		const {xs, ys} = fabric
		const {loops} = machine
		const count = loops.length
		const start = Math.max(0, count - BUDGET)
		const next = new Int32Array(count).fill(-1)
		for (let i = start; i < count; i++) {
			const prev = loops[i].prev
			if (prev != null && prev >= start) next[prev] = i
		}

		let deepest = 0
		for (let i = start; i < count; i++) {
			const loop = loops[i]
			const x = xs[i]
			const y = ys[i]
			deepest = Math.min(deepest, y)
			// along its row, left to right
			const a = loop.prev != null && loop.prev >= start ? loop.prev : i
			const b = next[i] >= 0 ? next[i] : i
			let tx = xs[b] - xs[a]
			let ty = ys[b] - ys[a]
			if (tx < 0) {
				tx = -tx
				ty = -ty
			}
			const length = Math.hypot(tx, ty)
			// at the end of a row the yarn goes up: the loop stays upright
			if (length < 1e-6 || tx < length * 0.6) {
				tx = 1
				ty = 0
			} else {
				tx /= length
				ty /= length
			}
			// its legs reach the loops it was pulled through
			const parents = loop.parents.filter(parent => parent >= start)
			let reachX = 0
			let reachY = 0
			if (parents.length) {
				const px = parents.reduce((sum, parent) => sum + xs[parent], 0) / parents.length
				const py = parents.reduce((sum, parent) => sum + ys[parent], 0) / parents.length
				reachX = px - x
				reachY = py + WALE - y
			}
			const baseY = y - 1.6 * ROW
			LOOP_CURVE.forEach(([lx, ly, lz], k) => {
				const down = ly < 1.12 ? 1 - ly / 1.12 : 0
				const px = x + tx * lx - ty * ly * ROW + reachX * down
				const py = baseY + ty * lx + tx * ly * ROW + reachY * down
				place(loop.back, px, py, lz * DEPTH, points, k * 3)
			})
			mesh.tube(points, LOOP_CURVE.length, YARN, palette.yarns[loop.yarn] ?? palette.yarns[0])
		}

		const [lo, hi] = knitout.range
		bounds = {
			min: [lo - 1.5, deepest - 2 * ROW, -GAP - 1],
			max: [hi + 1.5, 1.5, GAP + 1],
		}
		if (bedBox.checked) buildMachine(mesh)

		gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
		gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices.subarray(0, mesh.vertexCount * 9), gl.DYNAMIC_DRAW)
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices.subarray(0, mesh.indexCount), gl.DYNAMIC_DRAW)
		indexCount = mesh.indexCount
		return moved
	}

	// the two beds, leaning away from the gap, their needles' hooks at the
	// top; and the carriage over them, where the knitting's got to
	function buildMachine(mesh) {
		const [lo, hi] = knitout.range
		const left = lo - BED_MARGIN
		const right = hi + BED_MARGIN
		const last = upTo > 0 ? knitout.ops[upTo - 1] : null
		for (const back of [false, true]) {
			const side = back ? -1 : 1
			// down the bed, away from the gap; and out of the bed's face
			const down = [0, -SLOPE, side * SLOPE]
			const face = [0, SLOPE, side * SLOPE]
			const shift = back ? machine.rack : 0
			const apex = [0, 0.25, side * (GAP + 0.35)]
			const bedCentre = [0, 1, 2].map(k => apex[k] + down[k] * (NEEDLE / 2 + 0.6) - face[k] * 0.35)
			bedCentre[0] = (left + right) / 2 + shift
			mesh.box(
				bedCentre,
				[
					[(right - left) / 2 + 1, 0, 0],
					down.map(v => v * (NEEDLE / 2 + 0.9)),
					face.map(v => v * 0.22),
				],
				palette.bed,
			)
			for (let n = left; n <= right; n++) {
				// the needle that's just knitted is still out
				const out = last?.needle && last.needle.back === back && last.needle.n === n ? 1.1 : 0
				const tip = [n + shift, apex[1] - down[1] * out, apex[2] - down[2] * out]
				const centre = [0, 1, 2].map(k => tip[k] + down[k] * (NEEDLE / 2))
				mesh.box(centre, [[0.07, 0, 0], down.map(v => v * (NEEDLE / 2)), face.map(v => v * 0.06)], palette.steel)
				const hook = [0, 1, 2].map(k => tip[k] + face[k] * 0.14 - down[k] * 0.05)
				mesh.box(hook, [[0.07, 0, 0], down.map(v => v * 0.06), face.map(v => v * 0.14)], palette.steel)
			}
		}
		const at = track[upTo - 1]
		if (at) {
			const half = 4.5
			mesh.box([at.x, 1.9, 0], [[half, 0, 0], [0, 0.55, 0], [0, 0, GAP + 3.2]], palette.carriage)
			mesh.box([at.x, 2.65, 0], [[1.4, 0, 0], [0, 0.2, 0], [0, 0, 0.5]], palette.cam)
		}
	}

	// ── the camera: it turns round the fabric

	const camera = {yaw: 0, pitch: 0.18, distance: 30, target: [10, -5, 0]}
	function resetCamera() {
		const centre = [0, 1, 2].map(k => (bounds.min[k] + bounds.max[k]) / 2)
		const size = Math.max(bounds.max[0] - bounds.min[0], (bounds.max[1] - bounds.min[1]) * 1.2)
		camera.target = centre
		camera.yaw = 0
		camera.pitch = 0.18
		camera.distance = Math.max(8, size * 1.55)
	}

	function draw() {
		const width = canvas.clientWidth
		const height = canvas.clientHeight
		if (!width || !height) return
		const ratio = devicePixelRatio || 1
		if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
			canvas.width = Math.round(width * ratio)
			canvas.height = Math.round(height * ratio)
		}
		gl.viewport(0, 0, canvas.width, canvas.height)
		// the page shows through
		gl.clearColor(0, 0, 0, 0)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
		gl.enable(gl.DEPTH_TEST)
		const {yaw, pitch, distance, target} = camera
		const eye = [
			target[0] + distance * Math.sin(yaw) * Math.cos(pitch),
			target[1] + distance * Math.sin(pitch),
			target[2] + distance * Math.cos(yaw) * Math.cos(pitch),
		]
		const projection = perspective(0.6, width / height, 0.1, distance * 10)
		gl.useProgram(program)
		gl.uniformMatrix4fv(uniforms.viewProjection, false, multiply(projection, lookAt(eye, target, [0, 1, 0])))
		gl.uniform3fv(uniforms.eye, eye)
		gl.bindVertexArray(vao)
		gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0)
		gl.bindVertexArray(null)
	}

	// ── playing: the fabric's rebuilt a few times a second

	let frame = 0
	let lastTime = 0
	let lastBuild = 0
	let dirty = false
	let playhead = 0 // where playing's got to, between ops

	// the fabric settles over a few frames after a jump (at most SETTLE)
	let settling = 0
	function show() {
		runTo(upTo)
		const moved = build(playing ? 6 : 12)
		settling = moved > 0.01 && settling < SETTLE ? settling + 1 : 0
		if (settling) dirty = true
		draw()
		scrubber.max = String(knitout.ops.length)
		scrubber.value = String(upTo)
		const op = knitout.ops[upTo - 1]
		status.textContent = op
			? `${upTo} / ${knitout.ops.length} · line ${op.kLine} · ${op.text}`
			: "drag to turn it round · shift-drag to move it · scroll to zoom · play to watch it grow"
		status.classList.toggle("is-hint", !op)
	}

	function tick(now) {
		frame = 0
		const dt = Math.min(0.1, (now - lastTime) / 1000)
		lastTime = now
		if (playing) {
			playhead = Math.min(knitout.ops.length, playhead + dt * speed.perSecond)
			upTo = Math.floor(playhead)
			if (upTo >= knitout.ops.length) pause()
			dirty = true
		}
		if (dirty && now - lastBuild > (playing ? 90 : 0)) {
			dirty = false
			lastBuild = now
			show()
		}
		if (playing || dirty) frame = requestAnimationFrame(tick)
	}

	function refresh() {
		dirty = true
		if (!frame) {
			lastTime = performance.now()
			frame = requestAnimationFrame(tick)
		}
	}

	function play() {
		if (!knitout.ops.length) return
		if (upTo >= knitout.ops.length) upTo = 0
		playhead = upTo
		playing = true
		playButton.textContent = "pause"
		refresh()
	}

	function pause() {
		playing = false
		playButton.textContent = "play"
	}

	// ── pointer and wheel

	let drag = null
	function onPointerDown(event) {
		canvas.setPointerCapture(event.pointerId)
		drag = {x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button !== 0}
	}
	function onPointerMove(event) {
		if (!drag) return
		const dx = event.clientX - drag.x
		const dy = event.clientY - drag.y
		drag.x = event.clientX
		drag.y = event.clientY
		if (drag.pan) {
			const per = camera.distance / canvas.clientHeight
			const right = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)]
			camera.target = camera.target.map((value, k) => value - right[k] * dx * per + (k === 1 ? dy * per : 0))
		} else {
			camera.yaw -= dx * 0.008
			camera.pitch = Math.max(-1.4, Math.min(1.4, camera.pitch + dy * 0.008))
		}
		draw()
	}
	function onPointerUp() {
		drag = null
	}
	function onWheel(event) {
		event.preventDefault()
		camera.distance = Math.max(2, Math.min(800, camera.distance * Math.exp(event.deltaY * 0.0015)))
		draw()
	}
	function onDoubleClick() {
		resetCamera()
		draw()
	}
	const canvasListeners = {
		pointerdown: onPointerDown,
		pointermove: onPointerMove,
		pointerup: onPointerUp,
		pointercancel: onPointerUp,
		wheel: onWheel,
		dblclick: onDoubleClick,
		contextmenu: event => event.preventDefault(),
	}
	for (const [type, listener] of Object.entries(canvasListeners)) {
		canvas.addEventListener(type, listener, {passive: false})
	}

	speedSelect.addEventListener("change", () => {
		speed = SPEEDS[Number(speedSelect.value)] ?? SPEEDS[1]
	})
	scrubber.addEventListener("input", () => {
		pause()
		upTo = Number(scrubber.value)
		refresh()
	})
	roundSlider.addEventListener("input", () => {
		round = Number(roundSlider.value)
		refresh()
	})
	bedBox.addEventListener("change", refresh)

	function onColours() {
		readColours()
		refresh()
	}
	const scheme = matchMedia("(prefers-color-scheme: dark)")
	scheme.addEventListener("change", onColours)
	addEventListener(YARNS_CHANGED, onColours)

	const resizeObserver = new ResizeObserver(() => draw())
	resizeObserver.observe(canvas)

	// ── keeping up with the .k

	let timer = null
	let fitted = false
	function reread() {
		const wasEnd = upTo >= knitout.ops.length
		knitout = readKnitout(docText(handle.doc()))
		track = carriageTrack(knitout.ops)
		machine = newMachine()
		fabric = newFabric()
		done = 0
		upTo = wasEnd ? knitout.ops.length : Math.min(upTo, knitout.ops.length)
		empty.hidden = knitout.ops.length > 0
		empty.textContent = "no stitches yet"
		if (!fitted) {
			round = looksLikeTube(knitout.ops) ? 1 : 0
			roundSlider.value = String(round)
		}
		show()
		if (!fitted && knitout.ops.length) {
			fitted = true
			resetCamera()
			draw()
		}
	}

	function scheduleReread() {
		clearTimeout(timer)
		timer = setTimeout(reread, REPARSE_DELAY)
	}

	readColours()
	handle.on("change", scheduleReread)
	reread()

	return () => {
		playing = false
		clearTimeout(timer)
		cancelAnimationFrame(frame)
		handle.off("change", scheduleReread)
		scheme.removeEventListener("change", onColours)
		removeEventListener(YARNS_CHANGED, onColours)
		resizeObserver.disconnect()
		for (const [type, listener] of Object.entries(canvasListeners)) {
			canvas.removeEventListener(type, listener)
		}
		gl.deleteBuffer(vertexBuffer)
		gl.deleteBuffer(indexBuffer)
		gl.deleteVertexArray(vao)
		gl.deleteProgram(program)
		root.remove()
		link.remove()
	}
}
