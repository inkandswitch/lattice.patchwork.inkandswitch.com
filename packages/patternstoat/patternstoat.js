// a patternstoat: a design painted in colours that stand for technique,
// which a charm (charm.js) says how to knit. as create+ has it, one cell is
// one needle position on both beds
//
// - width and height, in cells and rows; left, the bed needle its left edge
//   is on; gauge, 2 (half gauge: cell x's front is needle left + 2x, its
//   back left + 2x + 1, so a bind-off has empty needles to go through) or 1
// - colours[row][x]: a colour number (the charm's column), or 0 (out of
//   work). row 0 is knitted first
// - stitches[row][x]: {f, b}, the stitch layer, painted with the kniterate
//   editor's codes where wanted. only a charm's transparent cells read it.
//   every row has its map from the start (so two people painting a row at
//   once each add a cell, never each a whole map); in it, a cell with nothing
//   painted isn't there
// - yarns[row]: the carrier ("1"–"6") a row knits in: the stripes
// - charm: the charm's url; knitoutTarget: the .k it writes, as a .js has
//
// everything here changes the doc it's given in place, only where it
// changes, so two people painting one patternstoat keep both their strokes

export const PATTERNSTOAT_TYPE = "lattice:patternstoat"

const grid = (width, height, fill) => Array.from({length: height}, () => Array.from({length: width}, () => fill))

export function newPatternstoat({charm = null, width = 40, height = 80, left = 60, gauge = 2} = {}) {
	return {
		"@patchwork": {type: PATTERNSTOAT_TYPE},
		title: "patternstoat",
		width,
		height,
		left,
		gauge,
		colours: grid(width, height, 0),
		stitches: Object.fromEntries(Array.from({length: height}, (_, row) => [row, {}])),
		yarns: Array.from({length: height}, () => "3"),
		charm,
		knitoutTarget: null,
	}
}

const inside = (doc, x, row) => x >= 0 && x < doc.width && row >= 0 && row < doc.height

// paint `colour` onto cells, each [x, row]
export function paintColours(doc, points, colour) {
	for (const [x, row] of points) {
		if (inside(doc, x, row) && x < doc.colours[row].length && doc.colours[row][x] !== colour) doc.colours[row][x] = colour
	}
}

// paint `code` onto bed `bed` ("f" or "b") of the stitch layer at cells,
// each [x, row]. null rubs it out
export function paintStitches(doc, points, bed, code) {
	if (!doc.stitches) doc.stitches = {}
	for (const [x, row] of points) {
		if (!inside(doc, x, row)) continue
		const cell = doc.stitches[row]?.[x]
		if (code == null) {
			if (!cell || cell[bed] == null) continue
			if (cell[bed === "f" ? "b" : "f"] == null) delete doc.stitches[row][x]
			else cell[bed] = null
			continue
		}
		// (a doc from before every row had its map)
		if (!doc.stitches[row]) doc.stitches[row] = {}
		if (!cell) doc.stitches[row][x] = {f: null, b: null, [bed]: code}
		else if (cell[bed] !== code) cell[bed] = code
	}
}

// rows from–to (inclusive) knit in `carrier`
export function setYarns(doc, from, to, carrier) {
	const [a, b] = from <= to ? [from, to] : [to, from]
	for (let row = Math.max(0, a); row <= Math.min(doc.height - 1, b); row++) {
		if (doc.yarns[row] !== carrier) doc.yarns[row] = carrier
	}
}

// grow or shrink, at the right and the top. new rows take the top row's
// yarn; what's painted outside is gone
export function resize(doc, width, height) {
	width = Math.max(1, Math.floor(width))
	height = Math.max(1, Math.floor(height))
	if (height < doc.height) {
		doc.colours.splice(height, doc.height - height)
		doc.yarns.splice(height, doc.yarns.length - height)
	}
	for (const row of doc.colours) {
		if (row.length > width) row.splice(width, row.length - width)
		while (row.length < width) row.push(0)
	}
	const top = doc.yarns[doc.yarns.length - 1] ?? "3"
	while (doc.colours.length < height) doc.colours.push(Array.from({length: width}, () => 0))
	while (doc.yarns.length < height) doc.yarns.push(top)
	if (!doc.stitches) doc.stitches = {}
	for (const row of Object.keys(doc.stitches)) {
		if (Number(row) >= height) {
			delete doc.stitches[row]
			continue
		}
		for (const x of Object.keys(doc.stitches[row])) if (Number(x) >= width) delete doc.stitches[row][x]
	}
	for (let row = 0; row < height; row++) if (!doc.stitches[row]) doc.stitches[row] = {}
	if (doc.width !== width) doc.width = width
	if (doc.height !== height) doc.height = height
}

// the runs of one colour along a row, {colour, start, end} (inclusive), out
// of work left out
export function fieldsOf(row) {
	const fields = []
	for (let x = 0; x < row.length; x++) {
		const colour = row[x]
		if (!colour) continue
		const last = fields[fields.length - 1]
		if (last && last.colour === colour && last.end === x - 1) last.end = x
		else fields.push({colour, start: x, end: x})
	}
	return fields
}

// the wristwarmer, on a 40 × 80 patternstoat, in the starter charm's colours
// (charm.js): cast on, waste yarn, a striped tube with a thumb slit (cast
// off on the front and cast straight back on in the next row, as a thumb
// hole knitted in the round is: held open over more rows, the front's yarn
// would float across it), and cast off at the top
export function paintWristwarmer(doc) {
	resize(doc, 40, 80)
	const all = row => Array.from({length: 40}, (_, x) => [x, row])
	const gap = row => Array.from({length: 6}, (_, i) => [4 + i, row])
	paintColours(doc, all(0), 5)
	for (let row = 1; row < 79; row++) paintColours(doc, all(row), 1)
	paintColours(doc, gap(50), 3)
	paintColours(doc, gap(51), 4)
	paintColours(doc, all(79), 6)
	setYarns(doc, 0, 9, "1")
	for (let row = 10; row < 79; row++) setYarns(doc, row, row, Math.floor((row - 10) / 6) % 2 ? "4" : "3")
	setYarns(doc, 79, 79, "3")
}
