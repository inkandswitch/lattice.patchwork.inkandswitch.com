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

// the fabric under a needle: each bed knits its own (a tube's two sides, a
// jacquard's face and its backing), so they're kept apart
export function columnKey(needle) {
	return (needle.back ? "b" : "f") + needle.n
}

export function newMachine() {
	return {
		held: new Map(), // needle key → {needle, loops: [{yarn, op, tuck}]}
		columns: new Map(), // column key → {n, back, stitches: [{yarn, back, extra, op}]}
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
// stitches: [{key, n, back, stitch}], rack: bool}
export function apply(machine, op, index, yarnOf) {
	const change = {touched: [], stitches: [], rack: false}
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
	const fresh = () =>
		op.carriers.length ? [{yarn: yarnOf(op.carriers[0]), op: index, tuck: op.kind === "tuck"}] : []

	if (op.kind === "knit" || op.kind === "drop") {
		const held = heldOn(machine, op.needle)
		if (held.loops.length) {
			const [first] = held.loops
			const stitch = {yarn: first.yarn, back: op.needle.back, extra: held.loops.length - 1, op: first.op}
			const key = columnKey(op.needle)
			const column = machine.columns.get(key) ?? {n: op.needle.n, back: op.needle.back, stitches: []}
			column.stitches.push(stitch)
			machine.columns.set(key, column)
			change.stitches.push({key, n: op.needle.n, back: op.needle.back, stitch})
		}
		held.loops = fresh()
		change.touched.push(op.needle.key)
		move(op.needle, op.dir)
	} else if (op.kind === "tuck") {
		const held = heldOn(machine, op.needle)
		held.loops.push(...fresh())
		change.touched.push(op.needle.key)
		move(op.needle, op.dir)
	} else if (op.kind === "split") {
		const from = heldOn(machine, op.needle)
		const to = heldOn(machine, op.to)
		to.loops.push(...from.loops)
		from.loops = fresh()
		change.touched.push(op.needle.key, op.to.key)
		move(op.needle, op.dir)
	} else if (op.kind === "miss") {
		move(op.needle, op.dir)
	} else if (op.kind === "in") {
		for (const name of op.carriers) machine.carriers.set(name, {x: null, hang: null, last: null})
	} else if (op.kind === "out") {
		for (const name of op.carriers) machine.carriers.delete(name)
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
