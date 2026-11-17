// a .k as the kniterate's editor has a design: rows, one a pass of the
// carriage, the first at the bottom, and in each a cell for each needle,
// its front half what the front bed does there, its back half the back bed's
// needle across from it. and the edits made to those rows, as splices of the
// .k's text, so what's painted goes into the knitout itself, where it was
// knitted from
//
// a row is a run of knitout lines next to each other: knits, tucks and misses
// going one way with the same carriers, in needle order (a knitting row);
// transfers at one racking (a transfer row); or drops. the lines between
// rows (rack, x-speed-number, in, out, ...) set what the next rows do. an
// empty row is kept as a comment, `;!row knit + 3`, so painting can empty a
// row without losing it

// what the kniterate's converter knits with until it's told otherwise
export const DEFAULTS = {stitch: "5", speed: "100", roller: "100", rack: 0}
// the settings a row has, as the knitout lines that set them
export const SETTINGS = {speed: "x-speed-number", stitch: "x-stitch-number", roller: "x-roller-advance", rack: "rack"}
const SETTING_OF = Object.fromEntries(Object.entries(SETTINGS).map(([key, op]) => [op, key]))

// what a bed does at a needle: k knit, t tuck, m miss, s split, x transfer
// (to the other bed), d drop. each kind of row takes some of them
export const KIND_OF = {k: "knit", t: "knit", m: "knit", s: "knit", x: "xfer", d: "drop"}

const NEEDLE = /^(f|b|fs|bs)(-?\d+)$/
const STITCHES = new Set(["knit", "tuck", "miss", "split"])

// a line's knitout, without its comment, as words; and its comment
function split(line) {
	const at = line.indexOf(";")
	const code = (at === -1 ? line : line.slice(0, at)).trim()
	return {words: code ? code.split(/\s+/) : [], comment: at === -1 ? "" : line.slice(at)}
}

function needleOf(word) {
	const match = NEEDLE.exec(word ?? "")
	return match ? {back: match[1][0] === "b", slider: match[1].length > 1, n: Number(match[2])} : null
}

// one line's op, if it's one a row is made of: {kind, op (k t m s x d), dir,
// back, n, carriers, to}; a placeholder row: {placeholder, kind, dir,
// carriers}; a setting: {setting, value}; anything else: {other} (a line
// with knitout on it), or null (blank, or only a comment)
export function readLine(line) {
	const trimmed = line.trim()
	if (trimmed.startsWith(";!row")) {
		const [, kind = "knit", dir = "+", ...carriers] = trimmed.split(/\s+/)
		return {placeholder: true, kind, dir: kind === "knit" ? dir : null, carriers: kind === "knit" ? carriers.join(" ") : ""}
	}
	const {words} = split(line)
	if (!words.length) return null
	const [name, ...args] = words
	if (STITCHES.has(name)) {
		const [dir, first, ...rest] = args
		const needle = needleOf(first)
		if (!needle || (dir !== "+" && dir !== "-")) return {other: true}
		let to = null
		let carriers = rest
		if (name === "split") {
			to = needleOf(rest[0])
			carriers = rest.slice(1)
		}
		const op = {knit: "k", tuck: "t", miss: "m", split: "s"}[name]
		return {kind: "knit", op, dir, ...needle, to, carriers: carriers.join(" ")}
	}
	if (name === "xfer") {
		const from = needleOf(args[0])
		const to = needleOf(args[1])
		if (!from || !to) return {other: true}
		return {kind: "xfer", op: "x", dir: null, ...from, to, carriers: ""}
	}
	if (name === "drop") {
		const needle = needleOf(args[0])
		if (!needle) return {other: true}
		return {kind: "drop", op: "d", dir: null, ...needle, to: null, carriers: ""}
	}
	if (SETTING_OF[name]) return {setting: SETTING_OF[name], value: args[0] ?? ""}
	return {other: true, name}
}

// where on the bed a needle is, from the front's needle numbers: the back
// bed's needles sit `rack` over
const columnOf = (op, rack) => (op.back ? op.n + rack : op.n)

/**
 * the rows of a .k's text: {lines, starts (each line's offset), rows, byLine
 * (line index → {row, back, n}), range ([first, last] column used)}
 *
 * a row: {index, kind ("knit" | "xfer" | "drop"), dir, carriers, rack,
 * speed, stitch, roller (what's in effect), front, back (needle → {op, line,
 * to}), start, end (its first and last line), placeholder (its line, if it's
 * an empty row), sets ({speed: line, ...}: the lines just before it that set
 * it)}
 */
export function readRows(text) {
	const lines = text.split("\n")
	const starts = new Array(lines.length)
	let offset = 0
	for (let i = 0; i < lines.length; i++) {
		starts[i] = offset
		offset += lines[i].length + 1
	}
	const state = {...DEFAULTS}
	const rows = []
	const byLine = new Map()
	let row = null
	let sets = {}
	let min = Infinity
	let max = -Infinity

	const begin = (line, op, i) => {
		row = {
			index: rows.length,
			kind: op.kind,
			dir: op.dir,
			carriers: op.carriers,
			rack: state.rack,
			speed: state.speed,
			stitch: state.stitch,
			roller: state.roller,
			front: new Map(),
			back: new Map(),
			start: i,
			end: i,
			placeholder: null,
			sets,
			last: null,
		}
		rows.push(row)
		sets = {}
	}
	// does `op` carry on the row there is
	const fits = op => {
		if (!row || row.placeholder != null || row.kind !== op.kind) return false
		const bed = op.back ? row.back : row.front
		if (bed.has(op.n)) return false
		if (op.kind !== "knit") return true
		if (row.dir !== op.dir || row.carriers !== op.carriers) return false
		const at = columnOf(op, row.rack)
		return row.last == null || (op.dir === "+" ? at >= row.last : at <= row.last)
	}

	for (let i = 0; i < lines.length; i++) {
		const op = readLine(lines[i])
		if (!op) continue
		if (op.placeholder) {
			begin(lines[i], op, i)
			row.placeholder = i
			row = null
			continue
		}
		if (op.setting) {
			state[op.setting] = op.setting === "rack" ? Number(op.value) || 0 : op.value
			sets[op.setting] = i
			row = null
			continue
		}
		if (op.other) {
			row = null
			continue
		}
		if (op.slider) {
			// sliders aren't drawn: they end the row, as any other line would
			row = null
			continue
		}
		if (!fits(op)) begin(lines[i], op, i)
		const bed = op.back ? row.back : row.front
		bed.set(op.n, {op: op.op, line: i, to: op.to})
		row.end = i
		row.last = columnOf(op, row.rack)
		byLine.set(i, {row: row.index, back: op.back, n: op.n})
		const at = columnOf(op, row.rack)
		if (at < min) min = at
		if (at > max) max = at
	}
	for (const each of rows) delete each.last
	return {lines, starts, rows, byLine, range: min > max ? null : [Math.floor(min), Math.ceil(max)]}
}

// the needle of the back bed in column `col` of a row: the one across from
// the front's needle there (at a fractional racking, the one it's nearest,
// to its left)
export const backAt = (row, col) => col - Math.round(row.rack)
// and the column a back needle's in
export const backColumn = (row, n) => n + Math.round(row.rack)

// what a row does at column `col`: {f, b} (each an op, or null)
export function codeAt(row, col) {
	return {f: row.front.get(col)?.op ?? null, b: row.back.get(backAt(row, col))?.op ?? null}
}

// ── turning edits into splices

// lines `line`.. (`remove` of them) replaced by `insert`, as the splice of
// the text that does it, as small as it can be
function lineSplice(model, {line, remove, insert}) {
	const {lines, starts} = model
	const text = model.text
	const last = lines.length - 1
	let at
	let old
	let seg
	if (line > last) {
		// after the last line (which hasn't a newline)
		at = text.length
		old = ""
		seg = insert.length ? "\n" + insert.join("\n") : ""
	} else {
		at = starts[line]
		const end = line + remove - 1
		if (end >= last) {
			old = text.slice(at)
			seg = insert.join("\n")
		} else {
			old = text.slice(at, remove ? starts[end + 1] : at)
			seg = insert.map(l => l + "\n").join("")
		}
	}
	let pre = 0
	while (pre < old.length && pre < seg.length && old[pre] === seg[pre]) pre++
	let suf = 0
	while (suf < old.length - pre && suf < seg.length - pre && old[old.length - 1 - suf] === seg[seg.length - 1 - suf]) suf++
	if (old.length === pre + suf && seg.length === pre + suf) return null
	return {at: at + pre, remove: old.length - pre - suf, insert: seg.slice(pre, seg.length - suf)}
}

// the lines `first`..`last` of the text, changed to `next` (the lines they
// become): the line edits that do it, keeping the lines that stay as they
// were (a longest common run of them)
function blockEdits(model, first, last, next) {
	const old = model.lines.slice(first, last + 1)
	const n = old.length
	const m = next.length
	// trim what's the same at either end, then the longest common
	// subsequence of what's left
	let pre = 0
	while (pre < n && pre < m && old[pre] === next[pre]) pre++
	let suf = 0
	while (suf < n - pre && suf < m - pre && old[n - 1 - suf] === next[m - 1 - suf]) suf++
	const a = old.slice(pre, n - suf)
	const b = next.slice(pre, m - suf)
	const table = Array.from({length: a.length + 1}, () => new Uint32Array(b.length + 1))
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
		}
	}
	const edits = []
	let i = 0
	let j = 0
	let hunk = null
	const flush = () => {
		if (hunk) edits.push(hunk)
		hunk = null
	}
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			flush()
			i++
			j++
		} else if (j < b.length && (i >= a.length || table[i][j + 1] >= table[i + 1][j])) {
			hunk ??= {line: first + pre + i, remove: 0, insert: []}
			hunk.insert.push(b[j++])
		} else {
			hunk ??= {line: first + pre + i, remove: 0, insert: []}
			hunk.remove++
			i++
		}
	}
	flush()
	return edits
}

// line edits (none overlapping), as splices to make in the order given
// (from the end of the text back, so each one's offsets stay true)
function toSplices(model, edits) {
	return edits
		.map(edit => lineSplice(model, edit))
		.filter(Boolean)
		.sort((a, b) => b.at - a.at || b.remove - a.remove)
}

// the text the splices make (they're as toSplices gives them)
export function applySplices(text, splices) {
	for (const {at, remove, insert} of splices) text = text.slice(0, at) + insert + text.slice(at + remove)
	return text
}

// ── writing rows

const needleName = (back, n) => `${back ? "b" : "f"}${n}`

// a line keeping its comment (a ;!source tag, say) as it's rewritten
function withComment(model, line, code) {
	const {comment} = split(model.lines[line] ?? "")
	return comment ? `${code} ${comment}` : code
}

function stitchLine(row, op, back, n) {
	if (row.kind === "knit") {
		const name = {k: "knit", t: "tuck", m: "miss"}[op]
		return `${name} ${row.dir} ${needleName(back, n)} ${row.carriers}`.trimEnd()
	}
	if (row.kind === "xfer") {
		return back ? `xfer b${n} f${n + row.rack}` : `xfer f${n} b${n - row.rack}`
	}
	return `drop ${needleName(back, n)}`
}

const placeholderLine = row =>
	row.kind === "knit" ? `;!row knit ${row.dir} ${row.carriers}`.trimEnd() : `;!row ${row.kind}`

// the row's entries in order, each {back, n, op, line (if it's there now),
// text}
function entriesOf(model, row) {
	const entries = []
	for (const [n, cell] of row.front) entries.push({back: false, n, op: cell.op, line: cell.line, text: model.lines[cell.line]})
	for (const [n, cell] of row.back) entries.push({back: true, n, op: cell.op, line: cell.line, text: model.lines[cell.line]})
	return entries.sort((a, b) => a.line - b.line)
}

// where an entry goes, going the way the row goes
function orderOf(row) {
	const sign = row.kind === "knit" && row.dir === "-" ? -1 : 1
	return entry => sign * (entry.back ? entry.n + row.rack : entry.n) + (entry.back ? 0.001 : 0)
}

// the lines a row's block becomes, given its entries (the lines between them
// that aren't its own, comments, stay where they were)
function blockLines(model, row, entries) {
	if (!entries.length) return [placeholderLine(row)]
	if (row.placeholder != null) return entries.map(entry => entry.text)
	const mine = new Set(entriesOf(model, row).map(entry => entry.line))
	const out = []
	let next = 0
	for (let line = row.start; line <= row.end; line++) {
		if (!mine.has(line)) {
			out.push(model.lines[line])
			continue
		}
		// each of its own lines' places is taken by the next entry, in order
		if (next < entries.length) out.push(entries[next++].text)
	}
	while (next < entries.length) out.push(entries[next++].text)
	return out
}

/**
 * paint codes into rows: `cells` is Map(row index → Map(column → {f, b})),
 * each half an op (k t m x d) or null (nothing there). a code's ops go in a
 * row of their kind: an empty row takes the kind of what's painted into it.
 * gives {splices, skipped (cells that don't go in their row, as {row, col,
 * why})}
 */
export function paint(model, cells) {
	const edits = []
	const skipped = []
	for (const [index, changes] of cells) {
		const row = model.rows[index]
		if (!row) continue
		let target = row
		const kinds = new Set()
		for (const code of changes.values()) {
			for (const op of [code.f, code.b]) if (op) kinds.add(KIND_OF[op])
		}
		const empty = !row.front.size && !row.back.size
		if (empty && kinds.size === 1) {
			const [kind] = kinds
			if (kind !== row.kind) {
				target = {...row, kind, dir: kind === "knit" ? row.dir ?? "+" : null, carriers: kind === "knit" ? row.carriers || "1" : ""}
			}
		}
		let entries = entriesOf(model, row)
		const added = []
		for (const [col, code] of changes) {
			const back = backAt(target, col)
			const wanted = [
				[false, col, code.f],
				[true, back, code.b],
			]
			for (const [isBack, n, op] of wanted) {
				if (op && KIND_OF[op] !== target.kind) {
					skipped.push({row: index, col, why: `row ${index + 1} is a ${target.kind} row: ${KIND_OF[op]} goes in a ${KIND_OF[op]} row`})
					continue
				}
				if (op === "x" && !Number.isInteger(target.rack)) {
					skipped.push({row: index, col, why: `row ${index + 1} is racked ${target.rack}: transfers go between needles across from each other`})
					continue
				}
				if (op === "s") continue
				const at = entries.findIndex(entry => entry.back === isBack && entry.n === n)
				const had = at === -1 ? null : entries[at]
				if ((had?.op ?? null) === op) continue
				if (!op) {
					entries.splice(at, 1)
					continue
				}
				const code = stitchLine(target, op, isBack, n)
				if (had) entries[at] = {...had, op, text: had.line != null ? withComment(model, had.line, code) : code}
				else added.push({back: isBack, n, op, line: null, text: code})
			}
		}
		if (added.length) {
			const order = orderOf(target)
			// each new one goes before the first that comes after it, going the
			// way the row goes: the ones that are there keep their order
			for (const entry of added.sort((a, b) => order(a) - order(b))) {
				const at = entries.findIndex(other => order(other) > order(entry))
				if (at === -1) entries.push(entry)
				else entries.splice(at, 0, entry)
			}
		}
		const first = row.placeholder ?? row.start
		const last = row.placeholder ?? row.end
		edits.push(...blockEdits(model, first, last, blockLines(model, target, entries)))
	}
	return {splices: toSplices(model, edits), skipped}
}

// rows `from`..`to` (inclusive), each with what's in effect for it
const rowsIn = (model, from, to) => model.rows.slice(Math.min(from, to), Math.max(from, to) + 1)

/**
 * a setting (speed, stitch, roller, rack) for rows `from`..`to`: set before
 * the first, and put back after the last to what the row after had, so only
 * these rows change. the lines setting it between them go
 */
export function setOption(model, from, to, key, value) {
	const op = SETTINGS[key]
	const range = rowsIn(model, from, to)
	if (!op || !range.length) return []
	value = String(value).trim()
	const edits = []
	const first = range[0]
	const last = range[range.length - 1]
	const after = model.rows[last.index + 1]
	for (const row of range.slice(1)) {
		if (row.sets[key] != null) edits.push({line: row.sets[key], remove: 1, insert: []})
	}
	if (first.sets[key] != null) {
		edits.push({line: first.sets[key], remove: 1, insert: [withComment(model, first.sets[key], `${op} ${value}`)]})
	} else {
		edits.push({line: first.placeholder ?? first.start, remove: 0, insert: [`${op} ${value}`]})
	}
	if (after && after.sets[key] == null && String(after[key]) !== value) {
		edits.push({line: (last.placeholder ?? last.end) + 1, remove: 0, insert: [`${op} ${after[key]}`]})
	}
	// (two inserts at one line: the one put back comes first, it's what's
	// before the next row's own)
	return toSplices(model, merge(edits))
}

// line edits at the same line, as one
function merge(edits) {
	const byLine = new Map()
	for (const edit of edits) {
		const had = byLine.get(edit.line)
		if (!had) byLine.set(edit.line, {...edit, insert: [...edit.insert]})
		else {
			had.remove = Math.max(had.remove, edit.remove)
			had.insert.push(...edit.insert)
		}
	}
	return [...byLine.values()]
}

// a knitting row's lines, going the other way (or with other carriers)
function rewriteRow(model, row, {dir = row.dir, carriers = row.carriers}) {
	if (row.kind !== "knit") return []
	const changed = {...row, dir, carriers}
	if (row.placeholder != null) {
		return [{line: row.placeholder, remove: 1, insert: [placeholderLine(changed)]}]
	}
	const entries = entriesOf(model, row).map(entry => {
		const text = model.lines[entry.line]
		const {words, comment} = split(text)
		const [name, , needle, ...rest] = words
		const carrierWords = name === "split" ? rest.slice(1) : rest
		const kept = name === "split" ? [needle, rest[0]] : [needle]
		const code = [name, dir, ...kept, ...(carriers === row.carriers ? carrierWords : carriers.split(/\s+/).filter(Boolean))].join(" ")
		return {...entry, text: comment ? `${code} ${comment}` : code}
	})
	if (dir !== row.dir) entries.reverse()
	return blockEdits(model, row.start, row.end, blockLines(model, changed, entries))
}

// knitting rows `from`..`to`, going the other way: their lines reversed
export function flipDirection(model, from, to) {
	return toSplices(model, rowsIn(model, from, to).flatMap(row => rewriteRow(model, row, {dir: row.dir === "+" ? "-" : "+"})))
}

// knitting rows `from`..`to`, knitted with `carriers` ("3", or "3 4")
export function setCarriers(model, from, to, carriers) {
	carriers = String(carriers).trim().split(/[\s,]+/).filter(Boolean).join(" ")
	if (!carriers) return []
	return toSplices(model, rowsIn(model, from, to).flatMap(row => rewriteRow(model, row, {carriers})))
}

/**
 * a new empty row after row `after` (-1: before the first): a knitting row
 * going the other way to the one before it, with its carriers, unless
 * `kind`'s xfer or drop
 */
export function insertRow(model, after, kind = "knit") {
	const before = model.rows[after]
	const next = model.rows[after + 1]
	const like = before ?? next
	const dir = before ? (before.dir === "+" ? "-" : "+") : next?.dir ?? "+"
	const row = {kind, dir, carriers: like?.carriers || "1"}
	const line = before ? (before.placeholder ?? before.end) + 1 : next ? (next.placeholder ?? next.start) : model.lines.length
	return toSplices(model, [{line, remove: 0, insert: [placeholderLine(kind === "knit" ? row : {kind})]}])
}

// rows `from`..`to` again, after them (what's between them too)
export function repeatRows(model, from, to) {
	const range = rowsIn(model, from, to)
	if (!range.length) return []
	const first = range[0].placeholder ?? range[0].start
	const last = range[range.length - 1].placeholder ?? range[range.length - 1].end
	return toSplices(model, [{line: last + 1, remove: 0, insert: model.lines.slice(first, last + 1)}])
}

// rows `from`..`to` gone: their own lines (what's between them, settings and
// carriers in and out, stays)
export function deleteRows(model, from, to) {
	const edits = []
	for (const row of rowsIn(model, from, to)) {
		if (row.placeholder != null) {
			edits.push({line: row.placeholder, remove: 1, insert: []})
			continue
		}
		const mine = new Set(entriesOf(model, row).map(entry => entry.line))
		let run = null
		for (let line = row.start; line <= row.end + 1; line++) {
			if (mine.has(line)) {
				run ??= {line, remove: 0, insert: []}
				run.remove++
			} else if (run) {
				edits.push(run)
				run = null
			}
		}
	}
	return toSplices(model, edits)
}

// ── what's on the needles

/**
 * how many loops each needle holds after each row: [{front, back}] (each a
 * Map(needle → loops)), from what the rows do (a knit leaves one, a tuck
 * adds one, a transfer moves them, a drop lets them go)
 */
export function occupancy(model) {
	const front = new Map()
	const back = new Map()
	const after = []
	const bedOf = isBack => (isBack ? back : front)
	for (const row of model.rows) {
		const moves = []
		for (const [isBack, cells] of [
			[false, row.front],
			[true, row.back],
		]) {
			for (const [n, cell] of cells) {
				const bed = bedOf(isBack)
				const had = bed.get(n) ?? 0
				if (cell.op === "k") bed.set(n, 1)
				else if (cell.op === "t") bed.set(n, had + 1)
				else if (cell.op === "d") bed.delete(n)
				else if (cell.op === "x" || cell.op === "s") {
					if (cell.to) moves.push({to: cell.to, loops: had})
					if (cell.op === "s") bed.set(n, 1)
					else bed.delete(n)
				}
			}
		}
		for (const {to, loops} of moves) {
			const bed = bedOf(to.back)
			if (loops) bed.set(to.n, (bed.get(to.n) ?? 0) + loops)
		}
		after.push({front: new Map(front), back: new Map(back)})
	}
	return after
}

/**
 * read a .k into rows, with the text kept (for edits)
 */
export function rowsOf(text) {
	return {...readRows(text), text}
}
