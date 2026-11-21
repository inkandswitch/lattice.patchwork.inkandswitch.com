// painting a patternstoat, as a pixel painter does: pouring a fill, and
// taking back a stroke. a record is what some cells hold, {kind, cells: [[x,
// row, value]…]}: kind "colours" (a colour number), "stitches" ({f, b}) or
// "yarns" (x is 0, the row's yarn). a stroke is {before, after}: the record
// of its cells before it, and after
import {paintColours, paintStitches, setYarns} from "./patternstoat.js"

// the cells joined to (x, row), four ways, that hold what it holds. a stack,
// not recursion: a big grid is a lot of cells
export function floodCells(grid, x, row) {
	const at = (x, row) => grid[row]?.[x]
	const start = at(x, row)
	if (start === undefined) return []
	const out = []
	const seen = new Set()
	const stack = [[x, row]]
	while (stack.length) {
		const [cx, cr] = stack.pop()
		const key = cr * 65536 + cx
		if (seen.has(key) || at(cx, cr) !== start) continue
		seen.add(key)
		out.push([cx, cr])
		stack.push([cx + 1, cr], [cx - 1, cr], [cx, cr + 1], [cx, cr - 1])
	}
	return out
}

function valueAt(doc, kind, x, row) {
	if (kind === "colours") return doc.colours?.[row]?.[x] ?? 0
	if (kind === "yarns") return doc.yarns?.[row] ?? null
	const cell = doc.stitches?.[row]?.[x]
	return {f: cell?.f ?? null, b: cell?.b ?? null}
}

const same = (a, b) => (a && typeof a === "object" ? a.f === b?.f && a.b === b?.b : a === b)

// what `points` (each [x, row]) hold now
export function recordOf(doc, kind, points) {
	return {kind, cells: points.map(([x, row]) => [x, row, valueAt(doc, kind, x, row)])}
}

// what puts a stroke's cells back as they were before it: only those still
// as it left them (someone else's since are theirs). null if there are none.
// (redo is the same, the other way: {before: after, after: before})
export function undoOf(doc, {before, after}) {
	const cells = before.cells.filter(([x, row], i) => same(valueAt(doc, before.kind, x, row), after.cells[i][2]))
	return cells.length ? {kind: before.kind, cells} : null
}

// the yarn the strip at the left paints in: the last yarn picked, kept while
// a colour or a stitch is picked
export function yarnAfterPick(yarn, picked) {
	return picked.kind === "yarn" ? picked.value : yarn
}

// write a record into the doc, a call a value
export function applyRecord(doc, record) {
	if (!record) return
	const byValue = new Map()
	for (const [x, row, value] of record.cells) {
		const id = JSON.stringify(value)
		if (!byValue.has(id)) byValue.set(id, {value, points: []})
		byValue.get(id).points.push([x, row])
	}
	for (const {value, points} of byValue.values()) {
		if (record.kind === "colours") paintColours(doc, points, value)
		else if (record.kind === "yarns") for (const [, row] of points) setYarns(doc, row, row, value)
		else {
			paintStitches(doc, points, "f", value?.f ?? null)
			paintStitches(doc, points, "b", value?.b ?? null)
		}
	}
}
