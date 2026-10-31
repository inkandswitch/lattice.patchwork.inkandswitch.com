import {LOOP, REACH, SQUASH, WALE} from "./fabric.js"
import {across, apply, carriageTrack, newMachine, readKnitout} from "./knitting.js"

// will a .k knit on a kniterate, and where might it go wrong: it's played on
// a pretend machine, looking for what drops stitches, breaks yarn, or stops
// the machine. what the kniterate's own converter says of it comes
// in too (`converted`: {error, warnings}, its messages as it gives them)
//
// a problem is {level: "error" (it won't knit) | "risk" (it may go wrong) |
// "note", text, op, line, count (of the like, together), lastLine}

// the kniterate: beds 252 needles wide, carriers 1–6 (as its converter has
// them). its gauge (7 needles to the inch, as it comes) is a setting
export const KNITERATE = {needles: 252, carriers: ["1", "2", "3", "4", "5", "6"]}
// loops on one needle it mightn't clear, knitting them together
const STACK = 3
// how long (mm) a float gets before it snags
const FLOAT = 25
// rows the needles beside a held loop can knit before there's no room for
// them: the held loop's yarn reaches REACH down, and the rows beside it,
// bunched up as tight as they go, are `squash` of a wale apart. any more and
// they ride up the needles, instead of being pulled down to knit off
export function holdRows(squash = SQUASH) {
	return Math.floor(REACH / (squash * WALE))
}
// needles further apart than they were knitted that yarn across the gap
// between the beds can be racked before it's pulled tight
const RACK_SLACK = 2
// at most so many problems are kept
const MOST = 300

// `settings`: {gauge (needles to the inch), squash}, as settings.js has them
export function checkKnitout(text, converted = null, {gauge = 7, squash = SQUASH} = {}) {
	const pitch = 25.4 / gauge // mm
	const HOLD_ROWS = holdRows(squash)
	const knitout = readKnitout(text)
	const {ops} = knitout
	const problems = []
	const report = (level, i, text, kind = text) => {
		const op = i == null ? null : ops[i]
		const last = problems[problems.length - 1]
		// the like of the last one, in the same pass: counted with it
		if (last && last.kind === kind && i != null && last.pass === pass) {
			last.count++
			last.lastLine = op.kLine
			return
		}
		if (problems.length >= MOST) return
		problems.push({level, kind, text, op: i, line: op?.kLine ?? null, lastLine: op?.kLine ?? null, count: 1, pass})
	}

	for (const problem of knitout.problems) {
		problems.push({level: "error", kind: "read", text: problem.text, op: null, line: problem.line, lastLine: problem.line, count: 1})
	}
	if (converted?.error) {
		const {line, text} = message(converted.error)
		problems.push({level: "error", kind: "kniterate", text: `the kniterate's converter stops here: ${text}`, op: null, line, lastLine: line, count: 1})
	}
	for (const warning of converted?.warnings ?? []) {
		const {line, text} = message(warning)
		problems.push({level: "note", kind: "kniterate", text: `the kniterate's converter says: ${text}`, op: null, line, lastLine: line, count: 1})
	}

	const track = carriageTrack(ops)
	const machine = newMachine()
	const yarnOf = name => Math.max(0, knitout.carriers.indexOf(name)) % 6
	const children = [] // loop id → loops pulled through it, still there
	const gone = new Set() // loops dropped, or unravelled
	const knitsOn = new Map() // needle key → knits it's done
	const besideAt = new Map() // loop id → [knits on the needles beside it, when it was made]
	const active = new Set()
	const yarn = new Map() // carrier → {loops, floats (needles)}
	let pass = 0
	let lastMaking = -1
	ops.forEach((op, i) => {
		if (makesLoop(op)) lastMaking = i
	})

	const keyOf = loop => (loop.back ? "b" : "f") + loop.n
	const heldNow = loop => machine.held.get(keyOf(loop))?.loops.includes(loop)

	// a loop let go, with nothing through it: it opens, and so does each loop
	// it was pulled through that nothing else holds, on down the wale
	function unravel(loop) {
		let opened = 0
		const open = [loop]
		while (open.length) {
			const next = open.pop()
			gone.add(next.id)
			for (const parent of next.parents) {
				if (gone.has(parent)) continue
				children[parent]--
				const below = machine.loops[parent]
				if (children[parent] <= 0 && !heldNow(below)) {
					opened++
					open.push(below)
				}
			}
		}
		return opened
	}

	// loops coming off a needle (knitted, moved or dropped), or left on at the
	// end: were any held while the needles beside them knit more rows than
	// there's room for
	function heldTooLong(loops, i, ending) {
		let worst = null
		let found = 0
		for (const loop of loops) {
			const rows = rowsBeside(loop)
			if (rows <= HOLD_ROWS) continue
			found++
			if (!worst || rows > worst.rows) worst = {loop, rows}
		}
		if (!found) return
		const {loop, rows} = worst
		const since = ops[loop.op].kLine
		report(
			"risk",
			i,
			`${keyOf(loop)}${found > 1 ? ` (and ${found - 1} more)` : ""} ${ending ? "is" : "was"} held from line ${since} while the needles beside it knit ${rows} rows: ` +
				`a held loop's yarn reaches about ${REACH.toFixed(1)} needles, room for ${HOLD_ROWS} rows bunched beside it. ` +
				`past that they ride up the needles instead of knitting off: hold fewer rows, or knit the held needles in between`,
			"held",
		)
	}

	function rowsBeside(loop) {
		const at = besideAt.get(loop.id)
		if (!at) return 0
		const bed = loop.back ? "b" : "f"
		return Math.max((knitsOn.get(bed + (loop.n - 1)) ?? 0) - at[0], (knitsOn.get(bed + (loop.n + 1)) ?? 0) - at[1])
	}

	ops.forEach((op, i) => {
		const at = track[i]
		if (at?.turn != null) pass++

		// carriers
		const name = op.text.split(/\s+/)[0]
		if (name === "inhook" || name === "outhook" || name === "releasehook") {
			report("error", i, `the kniterate has no yarn inserting hook: use ${name === "inhook" ? "in" : "out"} instead of ${name}`, "hook")
		}
		if (op.kind === "in") {
			for (const c of op.carriers) {
				if (active.has(c)) report("note", i, `carrier ${c} is already in`)
				active.add(c)
			}
		} else if (op.kind === "out") {
			for (const c of op.carriers) {
				if (!active.has(c)) report("error", i, `carrier ${c} isn't in, to take out`)
				active.delete(c)
			}
		}
		for (const c of op.carriers) {
			if (!KNITERATE.carriers.includes(c)) report("error", i, `the kniterate has carriers 1–6: there's no carrier ${c}`, "carrier-name")
			else if (makesLoop(op) && !active.has(c)) report("error", i, `carrier ${c} isn't in: bring it in first`, "carrier-out")
		}

		// what's on the needles
		const held = op.needle ? (machine.held.get(op.needle.key)?.loops ?? []) : []
		if (op.kind === "knit" || op.kind === "split" || op.kind === "drop") heldTooLong(held, i, false)
		if (op.kind === "split") {
			if (op.needle.back === op.to.back) report("error", i, `${op.needle.key} and ${op.to.key} are on the same bed: loops only go between beds`)
			else if (across(machine, op.needle) !== across(machine, op.to)) {
				report("error", i, `${op.needle.key} and ${op.to.key} aren't across from each other at racking ${machine.rack}`, "align")
			}
		}
		if ((op.kind === "knit" || op.kind === "split") && held.length >= STACK) {
			report("risk", i, `${held.length} loops knitted together on ${op.needle.key}: the needle mightn't clear them all`, "stack")
		}
		if (op.kind === "knit" && !held.length && op.carriers.some(c => !machine.lastLoops.has(c))) {
			report("note", i, `the first stitches are knitted on empty needles: a tucked cast-on holds better`, "cast")
		}
		if (op.kind === "drop" && held.length) {
			if (i > lastMaking) {
				report("note", i, `stitches dropped live at the end: they can unravel unless they're bound off or there's waste yarn`, "end")
			} else {
				let opened = 0
				for (const loop of held) opened += unravel(loop)
				if (opened) {
					report(
						"risk",
						i,
						`dropping ${op.needle.key} ladders ${opened} ${opened === 1 ? "stitch" : "stitches"} down its wale`,
						"ladder",
					)
				}
			}
		}

		// floats: how far each carrier's yarn goes from its last loop
		if (makesLoop(op)) {
			for (const c of op.carriers.slice(0, 1)) {
				const last = machine.lastLoops.get(c)
				const usage = yarn.get(c) ?? {loops: 0, floats: 0}
				usage.loops++
				if (last) {
					const gap = Math.abs(across(machine, op.needle) - last.x)
					usage.floats += Math.max(0, gap - 1)
					if (gap * pitch > FLOAT && last.dir === (op.dir === "-" ? -1 : 1)) {
						report(
							"note",
							i,
							`carrier ${c} floats ${gap} needles (${Math.round(gap * pitch)} mm): long floats snag`,
							"float",
						)
					}
				}
				yarn.set(c, usage)
			}
		}

		const before = machine.loops.length
		const rackBefore = machine.rack
		apply(machine, op, i, yarnOf)

		// how much the needles beside a loop have knitted, as it comes onto its
		// needle: made there, or moved there
		const arrive = loop => {
			const bed = loop.back ? "b" : "f"
			besideAt.set(loop.id, [knitsOn.get(bed + (loop.n - 1)) ?? 0, knitsOn.get(bed + (loop.n + 1)) ?? 0])
		}
		for (let id = before; id < machine.loops.length; id++) {
			const loop = machine.loops[id]
			children[id] = 0
			for (const parent of loop.parents) children[parent] = (children[parent] ?? 0) + 1
			arrive(loop)
		}
		if (op.kind === "split") for (const loop of held) arrive(loop)
		if (op.kind === "knit") knitsOn.set(op.needle.key, (knitsOn.get(op.needle.key) ?? 0) + 1)
		if (op.kind === "split") {
			const stacked = machine.held.get(op.to.key)?.loops.length ?? 0
			if (stacked >= STACK) report("risk", i, `the transfer leaves ${stacked} loops on ${op.to.key}`, "stack")
		}
		if (op.kind === "rack" && op.rack !== rackBefore) {
			// yarn running between loops on the two beds, pulled further apart
			let worst = 0
			for (const held of machine.held.values()) {
				for (const loop of held.loops) {
					const prev = loop.prev != null ? machine.loops[loop.prev] : null
					if (!prev || prev.back === loop.back || !heldNow(prev)) continue
					const now = Math.abs(across(machine, loop) - across(machine, prev))
					const knitted = Math.max(Math.abs(loop.x - prev.x), WALE)
					worst = Math.max(worst, now - knitted)
				}
			}
			if (worst > RACK_SLACK) {
				report(
					"risk",
					i,
					`racking to ${op.rack} pulls yarn between the beds ${worst.toFixed(1)} needles further than it was knitted: it may break, or pull stitches off`,
					"rack",
				)
			}
		}
	})

	// at the end
	const ending = ops.length - 1
	for (const c of active) report("note", ending, `carrier ${c} is still in at the end: take it out`, `still-${c}`)
	let live = 0
	for (const held of machine.held.values()) {
		live += held.loops.length
		heldTooLong(held.loops, ending, true)
	}
	if (live) {
		report(
			"note",
			ending,
			`${live} stitches are still on the needles at the end: they'll unravel when the knitting comes off, unless they're bound off`,
			"live",
		)
	}

	const [min, max] = knitout.range
	const width = ops.some(op => op.needle) ? max - min + 1 : 0
	if (width > KNITERATE.needles) {
		problems.push({level: "error", kind: "width", text: `it's ${width} needles wide: the kniterate's beds are ${KNITERATE.needles}`, op: null, line: null, lastLine: null, count: 1})
	}

	const order = {error: 0, risk: 1, note: 2}
	problems.sort((a, b) => order[a.level] - order[b.level] || (a.line ?? 0) - (b.line ?? 0))
	return {
		problems,
		width,
		holdRows: HOLD_ROWS,
		// yarn each carrier uses: its loops, and its floats
		yarn: [...yarn].map(([carrier, {loops, floats}]) => ({
			carrier,
			metres: ((loops * LOOP + floats) * pitch) / 1000,
		})),
	}
}

function makesLoop(op) {
	return op.kind === "knit" || op.kind === "tuck" || (op.kind === "split" && op.carriers.length > 0)
}

// "123 ERROR: something" → {line: 123, text: "something"}
function message(raw) {
	const match = String(raw).match(/^(\d+) (?:ERROR|WARNING): (.*)$/s)
	return match ? {line: Number(match[1]), text: match[2]} : {line: null, text: String(raw).replace(/^(ERROR|WARNING): /, "")}
}
