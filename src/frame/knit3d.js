import {checkPanel, located, opOf} from "./checks.js"
import {docText} from "./files.js"
import {WALE, firstLoop, newFabric, relax, strain} from "./fabric.js"
import {OVERRUN, apply, carriageTrack, newMachine, readKnitout} from "./knitting.js"
import {SETTINGS_CHANGED, readSettings} from "./settings.js"
import {YARNS_CHANGED, yarnColours, yarnPicker} from "./yarns.js"

const STYLESHEET = new URL("./knit3d.css", import.meta.url).href
const REPARSE_DELAY = 250

// the world, in needles: a needle's pitch is 1 across (x), the fabric hangs
// down (−y) from the gap between the beds, the front bed is towards you (+z)
const ROW = WALE
const YARN = 0.085
const SIDES = 6
const DEPTH = 0.16 // how far a loop's legs come forward of its head
const GAP = 0.32 // each bed's fabric, either side of the middle
const NEEDLE = 6 // a needle's length, down its bed
const SLOPE = Math.SQRT1_2 // the beds lean 45° away from the gap
const BED_MARGIN = Math.ceil(OVERRUN + 6)
// frames the fabric gets to settle in, after a jump; and how long it gets to
// settle each frame (ms), playing or not
const SETTLE = 150
const PLAYING_BUDGET = 6
const STILL_BUDGET = 14
// how far below its head a loop's legs start
const BASE = 1.6 * ROW

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

// what each loop tells the gpu, three floats apiece
const INSTANCE = ["head", "along", "up", "face", "reach", "colour"]
const INSTANCE_FLOATS = INSTANCE.length * 3

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

// every loop is the same few hundred triangles of yarn, bent to fit where it
// is: so the gpu has one, and each loop just says where it goes, as
// instanced attributes: its head; the way along its row, up its wale, and out
// of its face; how far its legs reach to the loops below; its colour.
// the vertices are (a point along LOOP_CURVE, a side round the yarn)
const LOOP_SHADER = `#version 300 es
in vec2 corner;
in vec3 head;
in vec3 along;
in vec3 up;
in vec3 face;
in vec3 reach;
in vec3 colour;
uniform vec4 curve[${LOOP_CURVE.length}];
uniform mat4 viewProjection;
out vec3 vNormal;
out vec3 vColour;
out vec3 vWorld;
vec3 at(int k) {
	vec4 c = curve[k];
	return head + along * c.x + up * (c.y * ${ROW.toFixed(4)} - ${BASE.toFixed(4)}) + face * (c.z * ${DEPTH.toFixed(4)}) + reach * c.w;
}
void main() {
	int k = int(corner.x);
	vec3 p = at(k);
	vec3 t = normalize(at(min(k + 1, ${LOOP_CURVE.length - 1})) - at(max(k - 1, 0)));
	vec3 reference = abs(dot(t, face)) < 0.9 ? face : up;
	vec3 n = normalize(cross(reference, t));
	vec3 b = cross(t, n);
	float angle = corner.y * ${((Math.PI * 2) / SIDES).toFixed(6)};
	vec3 o = n * cos(angle) + b * sin(angle);
	vNormal = o;
	vColour = colour;
	vWorld = p + o * ${YARN.toFixed(4)};
	gl_Position = viewProjection * vec4(vWorld, 1.0);
}`

// the machine: plain triangles
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
	roundLabel.title = "hanging on the machine, each bed's fabric flat; or off it, free to bulge, a tube blown up round as if it were worn"
	const roundSlider = document.createElement("input")
	roundSlider.type = "range"
	roundSlider.min = "0"
	roundSlider.max = "1"
	roundSlider.step = "0.01"
	roundLabel.append("on the machine", roundSlider, "worn")

	const bedLabel = document.createElement("label")
	bedLabel.className = "knit3d-toggle"
	bedLabel.title = "show the needle beds and the carriage"
	const bedBox = document.createElement("input")
	bedBox.type = "checkbox"
	bedBox.checked = true
	bedLabel.append(bedBox, "needle bed")

	const strainLabel = document.createElement("label")
	strainLabel.className = "knit3d-toggle"
	strainLabel.title = "colour each stitch by how hard it's pulled: red is as long as its yarn reaches (on the machine, that's what can break or drop)"
	const strainBox = document.createElement("input")
	strainBox.type = "checkbox"
	strainLabel.append(strainBox, "strain")
	const yarns = yarnPicker()

	bar.append(
		playButton,
		speedSelect,
		scrubber,
		roundLabel,
		bedLabel,
		strainLabel,
		yarns.element,
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

	// will it knit: what the check found, each problem going to its op
	const panel = checkPanel(stage, problem => {
		const op = opOf(problem, knitout.ops)
		if (op == null) return
		pause()
		upTo = op + 1
		refresh()
		element.dispatchEvent(
			new CustomEvent("knitout:select-source", {detail: located(handle, knitout.ops[op]), bubbles: true, composed: true}),
		)
	})
	bar.appendChild(panel.button)

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
			yarns.destroy()
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
	function linkProgram(vertex, fragment) {
		const program = gl.createProgram()
		gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex))
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment))
		gl.linkProgram(program)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
		return program
	}
	const program = linkProgram(VERTEX_SHADER, FRAGMENT_SHADER)
	const uniforms = {
		viewProjection: gl.getUniformLocation(program, "viewProjection"),
		eye: gl.getUniformLocation(program, "eye"),
	}
	const loopProgram = linkProgram(LOOP_SHADER, FRAGMENT_SHADER)
	const loopUniforms = {
		viewProjection: gl.getUniformLocation(loopProgram, "viewProjection"),
		eye: gl.getUniformLocation(loopProgram, "eye"),
		curve: gl.getUniformLocation(loopProgram, "curve"),
	}

	// the one loop: its corners, and their triangles
	const loopVao = gl.createVertexArray()
	const cornerBuffer = gl.createBuffer()
	const loopIndexBuffer = gl.createBuffer()
	const instanceBuffer = gl.createBuffer()
	const loopIndexCount = (LOOP_CURVE.length - 1) * SIDES * 6
	{
		const corners = new Float32Array(LOOP_CURVE.length * SIDES * 2)
		for (let k = 0; k < LOOP_CURVE.length; k++) {
			for (let side = 0; side < SIDES; side++) corners.set([k, side], (k * SIDES + side) * 2)
		}
		const indices = new Uint16Array(loopIndexCount)
		let at = 0
		for (let k = 0; k < LOOP_CURVE.length - 1; k++) {
			for (let side = 0; side < SIDES; side++) {
				const a = k * SIDES + side
				const b = k * SIDES + ((side + 1) % SIDES)
				indices.set([a, a + SIDES, b, b, a + SIDES, b + SIDES], at)
				at += 6
			}
		}
		gl.bindVertexArray(loopVao)
		gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer)
		gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW)
		const corner = gl.getAttribLocation(loopProgram, "corner")
		gl.enableVertexAttribArray(corner)
		gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, loopIndexBuffer)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
		for (const [offset, name] of INSTANCE.entries()) {
			const location = gl.getAttribLocation(loopProgram, name)
			gl.enableVertexAttribArray(location)
			gl.vertexAttribPointer(location, 3, gl.FLOAT, false, INSTANCE_FLOATS * 4, offset * 3 * 4)
			gl.vertexAttribDivisor(location, 1)
		}
		gl.bindVertexArray(null)
		gl.useProgram(loopProgram)
		gl.uniform4fv(
			loopUniforms.curve,
			LOOP_CURVE.flatMap(([x, y, z]) => [x, y, z, y < 1.12 ? 1 - y / 1.12 : 0]),
		)
	}
	let instances = new Float32Array(INSTANCE_FLOATS * 1024)
	let instanceCount = 0

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
			danger: rgb(getComputedStyle(root).getPropertyValue("--knitoutjs-danger").trim() || "#d33a4c"),
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

	let bounds = {min: [0, -10, -1], max: [20, 2, 1]}

	// every loop of the fabric, where it's settled: a knit loop facing out of
	// its bed's side (or out of the tube), leaning with its wale and its row. a
	// loop still on a needle reaches down to the loops it was pulled through,
	// however far they've gone
	const mesh = new Mesh()
	function build(budget) {
		const until = performance.now() + budget * settings.speed
		const moved = relax(fabric, machine, Infinity, {gap: GAP, inflate: round, until, squash: settings.squash})
		const {xs, ys, zs, slack} = fabric
		const {loops} = machine
		const count = loops.length
		// (only the loops relax lays out: the newest rows, when there are more)
		const start = firstLoop(machine)
		const next = new Int32Array(count).fill(-1)
		for (let i = start; i < count; i++) {
			const prev = loops[i].prev
			if (prev != null && prev >= start) next[prev] = i
		}
		if (instances.length < (count - start) * INSTANCE_FLOATS) {
			instances = new Float32Array(Math.max(instances.length * 2, (count - start) * INSTANCE_FLOATS))
		}

		const lo = [Infinity, Infinity, Infinity]
		const hi = [-Infinity, -Infinity, -Infinity]
		let at = 0
		for (let i = start; i < count; i++) {
			const loop = loops[i]
			const x = xs[i]
			const y = ys[i]
			const z = zs[i]
			lo[0] = Math.min(lo[0], x)
			lo[1] = Math.min(lo[1], y)
			lo[2] = Math.min(lo[2], z)
			hi[0] = Math.max(hi[0], x)
			hi[2] = Math.max(hi[2], z)
			// along its row: from the loop before to the one after, but not
			// round the turn at a row's end, or along yarn that floats
			const a =
				loop.prev != null && loop.prev >= start && loops[loop.prev].dir === loop.dir && !slack[i] ? loop.prev : i
			const b = next[i] >= 0 && loops[next[i]].dir === loop.dir && !slack[next[i]] ? next[i] : i
			let tx = xs[b] - xs[a]
			let ty = ys[b] - ys[a]
			let tz = zs[b] - zs[a]
			let tl = Math.hypot(tx, ty, tz)
			if (tl < 1e-6) {
				tx = loop.dir
				ty = tz = 0
				tl = 1
			}
			tx /= tl
			ty /= tl
			tz /= tl
			// up its wale, from the loops it was pulled through
			let px = 0
			let py = 0
			let pz = 0
			let parents = 0
			for (const parent of loop.parents) {
				if (parent < start) continue
				px += xs[parent]
				py += ys[parent]
				pz += zs[parent]
				parents++
			}
			let wx = 0
			let wy = 1
			let wz = 0
			if (parents) {
				px /= parents
				py /= parents
				pz /= parents
				const wl = Math.hypot(x - px, y - py, z - pz)
				if (wl > 1e-6) {
					wx = (x - px) / wl
					wy = (y - py) / wl
					wz = (z - pz) / wl
				}
			}
			// out of its face: the side its bed's needles pulled it to
			const side = loop.back ? -loop.dir : loop.dir
			let fx = (ty * wz - tz * wy) * side
			let fy = (tz * wx - tx * wz) * side
			let fz = (tx * wy - ty * wx) * side
			let fl = Math.hypot(fx, fy, fz)
			if (fl < 1e-3) {
				fx = fy = 0
				fz = loop.back ? -1 : 1
				fl = 1
			}
			fx /= fl
			fy /= fl
			fz /= fl
			// up, square to the other two; and along, flipped to go with it
			let ux = fy * tz - fz * ty
			let uy = fz * tx - fx * tz
			let uz = fx * ty - fy * tx
			if (ux * wx + uy * wy + uz * wz < 0) {
				ux = -ux
				uy = -uy
				uz = -uz
				tx = -tx
				ty = -ty
				tz = -tz
			}
			let colour = palette.yarns[loop.yarn] ?? palette.yarns[0]
			if (strainBox.checked) {
				const pulled = strain(fabric, i)
				colour = colour.map((value, k) => value + (palette.danger[k] - value) * pulled)
			}
			const v = instances
			v[at] = x
			v[at + 1] = y
			v[at + 2] = z
			v[at + 3] = tx
			v[at + 4] = ty
			v[at + 5] = tz
			v[at + 6] = ux
			v[at + 7] = uy
			v[at + 8] = uz
			v[at + 9] = fx
			v[at + 10] = fy
			v[at + 11] = fz
			// legs that would land a wale below, moved to land on the parents
			v[at + 12] = parents ? px + ux * WALE - x : 0
			v[at + 13] = parents ? py + uy * WALE - y : 0
			v[at + 14] = parents ? pz + uz * WALE - z : 0
			v[at + 15] = colour[0]
			v[at + 16] = colour[1]
			v[at + 17] = colour[2]
			at += INSTANCE_FLOATS
		}
		instanceCount = count - start
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
		gl.bufferData(gl.ARRAY_BUFFER, instances.subarray(0, at), gl.DYNAMIC_DRAW)

		const [left, right] = knitout.range
		bounds = {
			min: [Math.min(left, lo[0]) - 1.5, Math.min(0, lo[1]) - 2 * ROW, Math.min(-GAP, lo[2]) - 1],
			max: [Math.max(right, hi[0]) + 1.5, 1.5, Math.max(GAP, hi[2]) + 1],
		}

		mesh.reset()
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
		const viewProjection = multiply(projection, lookAt(eye, target, [0, 1, 0]))
		gl.useProgram(loopProgram)
		gl.uniformMatrix4fv(loopUniforms.viewProjection, false, viewProjection)
		gl.uniform3fv(loopUniforms.eye, eye)
		gl.bindVertexArray(loopVao)
		gl.drawElementsInstanced(gl.TRIANGLES, loopIndexCount, gl.UNSIGNED_SHORT, 0, instanceCount)
		gl.useProgram(program)
		gl.uniformMatrix4fv(uniforms.viewProjection, false, viewProjection)
		gl.uniform3fv(uniforms.eye, eye)
		gl.bindVertexArray(vao)
		gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0)
		gl.bindVertexArray(null)
	}

	// ── playing: the fabric's rebuilt every frame

	let frame = 0
	let lastTime = 0
	let dirty = false
	let playhead = 0 // where playing's got to, between ops

	// the fabric settles over a few frames after a jump (at most SETTLE)
	let settling = 0
	function show() {
		runTo(upTo)
		const moved = build(playing ? PLAYING_BUDGET : STILL_BUDGET)
		settling = moved > 0.01 && settling < SETTLE ? settling + 1 : 0
		if (settling) refresh()
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
		if (dirty) {
			dirty = false
			show()
		}
		if ((playing || dirty) && !frame) frame = requestAnimationFrame(tick)
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
	strainBox.addEventListener("change", refresh)
	// the machine and yarn, as they're set (see settings.js)
	let settings = readSettings()
	function onSettings() {
		settings = readSettings()
		settling = 0
		refresh()
	}
	addEventListener(SETTINGS_CHANGED, onSettings)

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
		panel.check(docText(handle.doc()))
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
		yarns.destroy()
		resizeObserver.disconnect()
		for (const [type, listener] of Object.entries(canvasListeners)) {
			canvas.removeEventListener(type, listener)
		}
		gl.deleteBuffer(vertexBuffer)
		gl.deleteBuffer(indexBuffer)
		gl.deleteVertexArray(vao)
		gl.deleteProgram(program)
		gl.deleteBuffer(cornerBuffer)
		gl.deleteBuffer(loopIndexBuffer)
		gl.deleteBuffer(instanceBuffer)
		gl.deleteVertexArray(loopVao)
		gl.deleteProgram(loopProgram)
		removeEventListener(SETTINGS_CHANGED, onSettings)
		panel.remove()
		root.remove()
		link.remove()
	}
}
