// a charm: lattice's colour arrangement. what each colour a patternstoat's
// painted in does on the machine, as a table: a column a colour, and rows
// shared by every column, each row a pass of the carriage. a design row
// takes one reference row and the + rows after it (stoll's +1, +2…), in
// turn: design row r takes the (r mod n)th of the n reference rows
//
// - a column: {colour (a number, and who it is: a patternstoat's cells say
//   it), name, hex, width (in needles: a tile like ilana's is 3), anchor
//   (where its tile repeats from, stoll's four: see cellAt), order (where
//   it's shown: moving a column changes this, never the list, which two
//   people moving at once would leave with it twice). read them with
//   columnsOf
// - a row: {id, ref (a reference row, or a + row after one), dir ("+" →,
//   "-" ←, "~" the other way from its carrier's last pass), yarn ("row":
//   the patternstoat's yarn column; or a carrier, "1"–"6"), stitch, speed,
//   roller (null: the kniterate's defaults)}
// - cells[colour][row id]: a column's needles on that row, each {f, b}
//   (made whenever a column or a row is, so painting only ever sets a bed):
//   what the front bed and the back bed do there. a code, as the kniterate
//   editor paints them (k knit, t tuck, m miss, x transfer, d drop), or *
//   (transparent: what the patternstoat's stitch layer has there), co (cast
//   off), cn (cast on), or null (nothing). a missing cell is nothing
//
// everything here changes the doc it's given in place, only where it
// changes, so two people editing one charm keep both their edits

export const CHARM_TYPE = "lattice:charm"

export const CODES = ["k", "t", "m", "x", "d", "*", "co", "cn"]

export const ANCHORS = ["colour-left", "colour-right", "pattern-left", "pattern-right"]

const NOTHING = Object.freeze({f: null, b: null})

const row = (id, ref, dir) => ({id, ref, dir, yarn: "row", stitch: null, speed: null, roller: null})

// the wristwarmer's colours: a half-gauge tube, and what a thumb hole and
// the ends need
const STARTER = [
	[1, "tube", "#8e7cc3", {a: {f: "k"}, b: {b: "k"}}],
	[2, "back only", "#6fa8dc", {b: {b: "k"}}],
	[3, "cast off front", "#e06c75", {a: {f: "co"}, b: {b: "k"}}],
	[4, "cast on front", "#93c47d", {a: {f: "cn"}, b: {b: "k"}}],
	[5, "cast on", "#f6b26b", {a: {f: "cn"}, b: {b: "cn"}}],
	[6, "cast off", "#c27ba0", {a: {f: "co"}, b: {b: "co"}}],
	[7, "as painted", "#a4a19a", {a: {f: "*"}, b: {b: "*"}}],
]

const blank = width => Array.from({length: Math.max(1, width || 1)}, () => ({...NOTHING}))

export function newCharm() {
	const cells = {}
	for (const [colour, , , rows] of STARTER) {
		cells[colour] = {}
		for (const id of ["a", "b"]) cells[colour][id] = [{...NOTHING, ...rows[id]}]
	}
	return {
		"@patchwork": {type: CHARM_TYPE},
		title: "charm",
		rows: [row("a", true, "+"), row("b", false, "-")],
		columns: STARTER.map(([colour, name, hex], order) => ({colour, name, hex, width: 1, anchor: "colour-left", order})),
		cells,
	}
}

// the columns, in order, each colour once
export function columnsOf(charm) {
	const seen = new Set()
	const columns = []
	;(charm?.columns ?? []).forEach((column, index) => {
		if (seen.has(column.colour)) return
		seen.add(column.colour)
		columns.push({column, index})
	})
	const key = ({column, index}) => (typeof column.order === "number" ? column.order : index)
	return columns.sort((a, b) => key(a) - key(b) || a.index - b.index).map(({column}) => column)
}

// each reference row with the + rows after it (rows before the first
// reference row belong to none)
export function groupsOf(charm) {
	const groups = []
	for (const r of charm?.rows ?? []) {
		if (r.ref) groups.push([r])
		else if (groups.length) groups[groups.length - 1].push(r)
	}
	return groups
}

export function columnOf(charm, colour) {
	return charm?.columns?.find(column => column.colour === colour)
}

const mod = (n, m) => ((n % m) + m) % m

// what a column does at pattern cell x, on row `rowId`, in a field of its
// colour (a run of it along the design row, {start, end}, inclusive): its
// tile repeats across the field from its anchor, and is cut off at the end
// away from it
export function cellAt(charm, column, rowId, x, field, patternWidth) {
	const width = Math.max(1, column.width || 1)
	let i
	if (column.anchor === "colour-right") i = width - 1 - mod(field.end - x, width)
	else if (column.anchor === "pattern-left") i = mod(x, width)
	else if (column.anchor === "pattern-right") i = width - 1 - mod(patternWidth - 1 - x, width)
	else i = mod(x - field.start, width)
	const cell = charm?.cells?.[column.colour]?.[rowId]?.[i]
	return cell ? {f: cell.f ?? null, b: cell.b ?? null} : {...NOTHING}
}

const newId = () => globalThis.crypto.randomUUID().slice(0, 8)

// a row after `after` (a row's id), or at the end; its id
export function addRow(doc, {after = null, ref = false} = {}) {
	const id = newId()
	const at = after == null ? -1 : doc.rows.findIndex(r => r.id === after)
	const added = row(id, ref, "~")
	if (at < 0) doc.rows.push(added)
	else doc.rows.splice(at + 1, 0, added)
	if (!doc.cells) doc.cells = {}
	for (const column of doc.columns) {
		if (!doc.cells[column.colour]) doc.cells[column.colour] = {}
		doc.cells[column.colour][id] = blank(column.width)
	}
	return id
}

export function removeRow(doc, id) {
	const at = doc.rows.findIndex(r => r.id === id)
	if (at >= 0) doc.rows.splice(at, 1)
	for (const colour of Object.keys(doc.cells ?? {})) {
		if (doc.cells[colour][id] !== undefined) delete doc.cells[colour][id]
	}
}

export function setRow(doc, id, fields) {
	const r = doc.rows.find(r => r.id === id)
	if (!r) return
	for (const [key, value] of Object.entries(fields)) if (r[key] !== value) r[key] = value
}

export function addColumn(doc, {colour, name = "", hex = "#888888", width = 1, anchor = "colour-left", order = null}) {
	if (columnOf(doc, colour)) return
	const last = Math.max(-1, ...doc.columns.map((column, index) => (typeof column.order === "number" ? column.order : index)))
	doc.columns.push({colour, name, hex, width, anchor, order: order ?? last + 1})
	if (!doc.cells) doc.cells = {}
	if (!doc.cells[colour]) doc.cells[colour] = Object.fromEntries(doc.rows.map(r => [r.id, blank(width)]))
}

export function removeColumn(doc, colour) {
	const at = doc.columns.findIndex(column => column.colour === colour)
	if (at >= 0) doc.columns.splice(at, 1)
	if (doc.cells?.[colour] !== undefined) delete doc.cells[colour]
}

// change a column's fields. a new width trims or pads each of its rows'
// cells to it
export function setColumn(doc, colour, fields) {
	const column = columnOf(doc, colour)
	if (!column) return
	for (const [key, value] of Object.entries(fields)) if (column[key] !== value) column[key] = value
	if (fields.width == null) return
	const width = Math.max(1, fields.width)
	for (const cells of Object.values(doc.cells?.[colour] ?? {})) {
		if (cells.length > width) cells.splice(width, cells.length - width)
		while (cells.length < width) cells.push({...NOTHING})
	}
}

// move a column to `index` among the columns: only orders change
export function moveColumn(doc, colour, index) {
	const shown = columnsOf(doc)
	const at = shown.findIndex(column => column.colour === colour)
	if (at < 0) return
	const [moving] = shown.splice(at, 1)
	shown.splice(Math.max(0, Math.min(index, shown.length)), 0, moving)
	shown.forEach((column, order) => {
		if (column.order !== order) column.order = order
	})
}

// give a colour a new number, its cells going with it
export function renumberColumn(doc, from, to) {
	const column = columnOf(doc, from)
	if (!column || from === to || columnOf(doc, to)) return
	column.colour = to
	if (!doc.cells) doc.cells = {}
	doc.cells[to] = JSON.parse(JSON.stringify(doc.cells[from] ?? {}))
	if (doc.cells[from] !== undefined) delete doc.cells[from]
}

// paint `code` onto bed `bed` ("f" or "b") of a column's needle `i`, on a
// row
export function paintCell(doc, colour, rowId, i, bed, code) {
	const column = columnOf(doc, colour)
	if (!column) return
	if (!doc.cells) doc.cells = {}
	if (!doc.cells[colour]) doc.cells[colour] = {}
	const width = Math.max(1, column.width || 1)
	// (a charm from before every row's cells were made)
	if (!doc.cells[colour][rowId]) doc.cells[colour][rowId] = blank(width)
	const cell = doc.cells[colour][rowId][i]
	if (cell && cell[bed] !== code) cell[bed] = code
}
