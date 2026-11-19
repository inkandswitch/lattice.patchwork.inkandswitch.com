// what a .k leaves on the needles: each needle (its key, "f12") and how many
// loops it holds, replayed as lattice's knitting.js does. a transfer between
// needles that aren't across from each other at the rack it's done at throws
import {across, apply, newMachine, readKnitout} from "../../lattice/knitting.js"

export function holding(lines) {
	const text = Array.isArray(lines) ? lines.join("\n") : lines
	const {ops} = readKnitout(text)
	const machine = newMachine()
	ops.forEach((op, i) => {
		if (op.kind === "split" && op.to && across(machine, op.needle) !== across(machine, op.to)) {
			throw new Error(`${op.needle.key} isn't across from ${op.to.key} at rack ${machine.rack}`)
		}
		apply(machine, op, i, () => null)
	})
	const held = new Map()
	for (const [key, {loops}] of machine.held) if (loops.length) held.set(key, loops.length)
	return held
}
