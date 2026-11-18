import {Op} from "./vendor/knitscape/shared/opData.js"

// a .k's ops (knitting.js's readKnitout) as a knitscape knitting program, for
// its contact-node topology (vendor/knitscape): a row for each pass, a cell
// for each needle in it, and for each row its yarn (1 up, the carrier's place
// in the .k's carriers; null for a row of transfers or drops), its direction
// and its racking.
//
// knitout's a list of ops, the program's a chart, so:
// - a pass is the ops one after another with the same carrier, going the
//   same way at the same racking. a needle comes up twice in one (its front
//   and its back, knitting all the needles) and it's two rows, the same way
// - transfers are rows of no yarn, one for each racking they're at; and
//   drops, and knits with no yarn, are drops in a row of no yarn
// - its back needle n is opposite front n − racking, knitout's n + racking:
//   so its racking is knitout's, the other way round
// - an op with two carriers (plated) is the first one's yarn: the program has
//   one yarn a row
// - a split's the knit it makes; the loops it moves stay where they were
// - the needles start empty (`castOn: false`): knitscape's own programs
//   start with a loop on every front needle
//
// the program's as wide as the .k's needles, all of them (so it doesn't
// move as it grows): `min` is the needle its first cell is

// a knitscape chart, as its Bimp has it (pixel(x, y), x along a row)
function grid(width, rows) {
	const height = rows.length
	const pixels = new Uint8Array(width * height).fill(Op.EMPTY)
	rows.forEach((cells, y) => {
		for (const [x, op] of cells) pixels[x + y * width] = op
	})
	return {
		width,
		height,
		pixels,
		pixel(x, y) {
			if (x > width - 1 || x < 0 || y > height - 1 || y < 0) return -1
			return pixels[x + y * width]
		},
	}
}

function needlesOf(ops) {
	let min = Infinity
	let max = -Infinity
	for (const op of ops) {
		for (const needle of [op.needle, op.to]) {
			if (!needle) continue
			if (needle.n < min) min = needle.n
			if (needle.n > max) max = needle.n
		}
	}
	return min > max ? {min: 0, max: 0} : {min, max}
}

const flip = dir => (dir === "right" ? "left" : "right")

export function programOf(knitout, {upTo = Infinity} = {}) {
	const {min, max} = needlesOf(knitout.ops)
	const width = max - min + 1
	const rows = [] // [{cells: Map(x → op), yarn, dir, rack, kind}]
	const yarnOf = name => Math.max(0, knitout.carriers.indexOf(name)) + 1
	let rack = 0 // the machine's, as knitout has it
	const theirs = () => (rack ? -rack : 0) // (knitscape's: and no −0)
	let current = null

	// the row for a cell at x: the current one, if it's the same kind of row
	// and x's free in it, or a new one
	function rowFor(x, kind, yarn, dir, rowRack) {
		const fits =
			current &&
			current.kind === kind &&
			current.yarn === yarn &&
			(dir == null || current.dir === dir) &&
			(kind === "drop" || current.rack === rowRack) &&
			!current.cells.has(x)
		if (!fits) {
			const before = rows[rows.length - 1]
			current = {cells: new Map(), kind, yarn, dir: dir ?? (before ? flip(before.dir) : "right"), rack: rowRack}
			rows.push(current)
		}
		return current
	}
	// (transfers and drops can share a row: both are rows of no yarn)
	const noYarn = kind => (current?.kind === "drop" || current?.kind === "xfer" ? current.kind : kind)

	const ops = knitout.ops.slice(0, Math.min(upTo, knitout.ops.length))
	for (const op of ops) {
		if (op.kind === "rack") {
			rack = op.rack
			continue
		}
		if (!op.needle) continue
		const x = op.needle.n - min
		const back = op.needle.back
		const yarned = op.carriers.length > 0
		if (op.kind === "split" && !yarned) {
			// a transfer: racked to where it goes
			const to = op.to
			if (to.back === back) continue
			const rowRack = back ? op.needle.n - to.n : to.n - op.needle.n
			const row = rowFor(x, "xfer", null, null, rowRack)
			if (row.kind === "drop") row.kind = "xfer"
			row.cells.set(x, back ? Op.BTF : Op.FTB)
		} else if (op.kind === "drop" || (op.kind === "knit" && !yarned)) {
			const kind = noYarn("drop")
			const row = rowFor(x, kind, null, null, kind === "xfer" ? current.rack : theirs())
			row.cells.set(x, back ? Op.BDROP : Op.FDROP)
		} else if (yarned && (op.kind === "knit" || op.kind === "tuck" || op.kind === "miss" || op.kind === "split")) {
			const dir = op.dir === "-" ? "left" : "right"
			const row = rowFor(x, "yarn", yarnOf(op.carriers[0]), dir, theirs())
			const cell =
				op.kind === "miss" ? Op.MISS : op.kind === "tuck" ? (back ? Op.BTUCK : Op.FTUCK) : back ? Op.BKNIT : Op.FKNIT
			row.cells.set(x, cell)
		}
	}

	return {
		width,
		height: rows.length,
		min,
		ops: grid(width, rows.map(row => row.cells)),
		yarnFeeder: rows.map(row => row.yarn),
		direction: rows.map(row => row.dir),
		racking: rows.map(row => row.rack),
		castOn: false,
	}
}
