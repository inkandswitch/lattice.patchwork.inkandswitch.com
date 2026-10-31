// a .k's knitting, op by op, on a pretend machine: what the animation and the
// 3d view both play out

const NEEDLE_RE = /^(f|b|fs|bs)(-?\d+)$/

function needleOf(token) {
	const match = NEEDLE_RE.exec(token ?? "")
	if (!match) throw `"${token}" isn't a needle`
	const bed = match[1]
	return {bed, back: bed[0] === "b", n: Number(match[2]), key: token}
}

// every op in a .k, as {kind, dir, needle, to, carriers, rack, kLine, jsLine,
// text}, with the carriers it names (in the order the header gives them) and
// the needles it uses
export function readKnitout(text) {
	const ops = []
	const carriers = []
	const problems = []
	let min = Infinity
	let max = -Infinity
	const use = needle => {
		if (needle.n < min) min = needle.n
		if (needle.n > max) max = needle.n
	}
	const yarns = names =>
		names.map(name => {
			if (!carriers.includes(name)) carriers.push(name)
			return name
		})

	text.split("\n").forEach((raw, index) => {
		const kLine = index + 1
		const header = raw.match(/^;;Carriers:\s*(.*)$/)
		if (header) {
			yarns(header[1].trim().split(/\s+/).filter(Boolean))
			return
		}
		const semi = raw.indexOf(";")
		const opText = (semi === -1 ? raw : raw.slice(0, semi)).trim()
		if (!opText) return
		const source = raw.match(/;!source:(-?\d+)/)
		const [name, ...args] = opText.split(/\s+/)
		const op = {kLine, jsLine: source ? Number(source[1]) : null, text: opText, carriers: []}
		try {
			if (name === "knit" || name === "tuck" || name === "miss") {
				op.kind = name
				op.dir = args[0]
				op.needle = needleOf(args[1])
				op.carriers = yarns(args.slice(2))
			} else if (name === "drop" || name === "amiss") {
				op.kind = name === "drop" ? "drop" : "tuck"
				op.dir = "+"
				op.needle = needleOf(args[0])
			} else if (name === "split") {
				op.kind = "split"
				op.dir = args[0]
				op.needle = needleOf(args[1])
				op.to = needleOf(args[2])
				op.carriers = yarns(args.slice(3))
			} else if (name === "xfer") {
				op.kind = "split"
				op.dir = "+"
				op.needle = needleOf(args[0])
				op.to = needleOf(args[1])
			} else if (name === "in" || name === "inhook") {
				op.kind = "in"
				op.carriers = yarns(args)
			} else if (name === "out" || name === "outhook") {
				op.kind = "out"
				op.carriers = yarns(args)
			} else if (name === "rack") {
				op.kind = "rack"
				op.rack = Number(args[0])
				if (!Number.isFinite(op.rack)) throw `"${args[0]}" isn't a racking`
			} else {
				// stitch, pause, releasehook, x-…: nothing to see
				op.kind = "other"
			}
		} catch (problem) {
			problems.push({line: kLine, text: String(problem)})
			return
		}
		if (op.kind === "knit" || op.kind === "tuck" || op.kind === "split") {
			if (op.dir !== "+" && op.dir !== "-") {
				problems.push({line: kLine, text: `"${op.dir}" isn't a direction`})
				return
			}
		}
		if (op.needle) use(op.needle)
		if (op.to) use(op.to)
		ops.push(op)
	})
	return {ops, carriers, problems, range: min > max ? [0, 20] : [min, max]}
}

// every loop the machine makes, as {id, yarn, op, tuck, n, back (the needle
// it's on now, or was let go from), x (where across the bed it was made),
// parents (the loops it was pulled through), prev (the loop its yarn came
// from), cast (made on an empty needle: the fabric's bottom edge)}: the
// fabric, as a graph
export function newMachine() {
	return {
		loops: [],
		lastLoops: new Map(), // carrier name → the last loop its yarn made
		held: new Map(), // needle key → {needle, loops: [loop]}
		carriers: new Map(), // name → {x, hang (a needle key), last (the op of its last loop)}
		rack: 0,
	}
}

export function heldOn(machine, needle) {
	let held = machine.held.get(needle.key)
	if (!held) machine.held.set(needle.key, (held = {needle, loops: []}))
	return held
}

// where a needle is, across the bed, in needles from the front bed's 0
export function across(machine, needle) {
	return needle.back ? needle.n + machine.rack : needle.n
}

// do op `index` to the machine: what it changed, as {touched: [needle keys],
// rack: bool}
export function apply(machine, op, index, yarnOf) {
	const change = {touched: [], rack: false}
	const makesLoop = op.kind === "knit" || op.kind === "tuck" || (op.kind === "split" && op.carriers.length)
	const move = (needle, dir) => {
		for (const name of op.carriers) {
			const carrier = machine.carriers.get(name) ?? {}
			carrier.x = across(machine, needle) + (dir === "-" ? -0.5 : 0.5)
			if (makesLoop) {
				carrier.hang = needle.key
				carrier.last = index
			}
			machine.carriers.set(name, carrier)
		}
	}
	// a new loop on op's needle, pulled through `parents`
	const fresh = parents => {
		if (!op.carriers.length) return []
		const [name] = op.carriers
		const loop = {
			id: machine.loops.length,
			yarn: yarnOf(name),
			op: index,
			tuck: op.kind === "tuck",
			n: op.needle.n,
			back: op.needle.back,
			x: across(machine, op.needle),
			parents: parents.map(parent => parent.id),
			prev: machine.lastLoops.get(name)?.id ?? null,
			cast: !heldOn(machine, op.needle).loops.length,
		}
		machine.loops.push(loop)
		machine.lastLoops.set(name, loop)
		return [loop]
	}

	if (op.kind === "knit" || op.kind === "drop") {
		const held = heldOn(machine, op.needle)
		held.loops = op.kind === "drop" ? [] : fresh(held.loops)
		change.touched.push(op.needle.key)
		move(op.needle, op.dir)
	} else if (op.kind === "tuck") {
		const held = heldOn(machine, op.needle)
		held.loops.push(...fresh([]))
		change.touched.push(op.needle.key)
		move(op.needle, op.dir)
	} else if (op.kind === "split") {
		const from = heldOn(machine, op.needle)
		const to = heldOn(machine, op.to)
		for (const loop of from.loops) {
			loop.n = op.to.n
			loop.back = op.to.back
		}
		const moved = from.loops
		to.loops.push(...moved)
		from.loops = fresh(moved)
		change.touched.push(op.needle.key, op.to.key)
		move(op.needle, op.dir)
	} else if (op.kind === "miss") {
		move(op.needle, op.dir)
	} else if (op.kind === "in") {
		for (const name of op.carriers) machine.carriers.set(name, {x: null, hang: null, last: null})
	} else if (op.kind === "out") {
		for (const name of op.carriers) {
			machine.carriers.delete(name)
			machine.lastLoops.delete(name)
		}
	} else if (op.kind === "rack") {
		machine.rack = op.rack
		change.rack = true
	}
	return change
}

// where a carrier's yarn goes down to: the loop it last made, if a needle
// still holds it
export function lastLoop(machine, carrier) {
	if (carrier.last == null || !carrier.hang) return null
	const held = machine.held.get(carrier.hang)
	return held?.loops.some(loop => loop.op === carrier.last) ? held : null
}

// the carriage's run: for each op, where it is across the bed once that op's
// done (in needles), which way it's going, and whether it turned round to get
// there. it runs a few needles past the end of a pass before it turns
export const OVERRUN = 4

export function carriageTrack(ops) {
	const track = []
	let rack = 0
	let at = null
	for (const op of ops) {
		if (op.kind === "rack") rack = op.rack
		if (op.needle && op.kind !== "drop") {
			const x = (op.needle.back ? op.needle.n + rack : op.needle.n) + (op.dir === "-" ? -0.5 : 0.5)
			const turn = at != null && at.dir !== op.dir ? at.x + (at.dir === "+" ? OVERRUN : -OVERRUN) : null
			at = {x, dir: op.dir, turn, from: at?.x ?? x}
		} else if (at) {
			at = {...at, turn: null, from: at.x}
		}
		track.push(at)
	}
	return track
}
