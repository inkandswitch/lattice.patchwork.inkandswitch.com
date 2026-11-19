// a charm as text: a line for its rows, and a rule a colour, modal-style
//
//   rows: > +< +~[s6 v100 r100 y5]
//   <> 1 tube #8e7cc3 (k/. ./k)
//   <> 9 "ilana's tile" #4caf50 x3 *| (t/.,k/.,./. ./.,./k,t/.)
//
// - rows: a token a row. + first: a + row (else a reference row); then >
//   (going +), < (going -) or ~ (the other way from its carrier's last);
//   then, if any, [s stitch, v speed, r roller, y a fixed yarn]
// - <> colour name hex [xW] [anchor] (a group a row): a name is a word or
//   "quoted"; W the width, 1 if not given; the anchor |* (the colour's left
//   edge, the default, not written), *| (its right), ||* or *|| (the
//   pattern's left or right; ‖ reads as ||). a group has W cells, comma
//   separated, each front/back: k t m x d * co cn, or . for nothing
// - ; to the end of a line is a comment
//
// text has no row ids: parseCharm takes the ids of the charm it's from, and
// gives them to its rows in order (new ones to any more)
import {CODES, addColumn, columnsOf, removeColumn, removeRow, setColumn, setRow} from "./charm.js"

const DIRS = {">": "+", "<": "-", "~": "~"}
const DIR_TOKENS = {"+": ">", "-": "<", "~": "~"}
const ANCHOR_TOKENS = {"colour-left": "|*", "colour-right": "*|", "pattern-left": "||*", "pattern-right": "*||"}
const ANCHOR_OF = Object.fromEntries(Object.entries(ANCHOR_TOKENS).map(([anchor, token]) => [token, anchor]))
const SETTINGS = [
	["s", "stitch"],
	["v", "speed"],
	["r", "roller"],
	["y", "yarn"],
]

const cellText = cell => `${cell?.f ?? "."}/${cell?.b ?? "."}`
const nameText = name => (/^[\w-]+$/.test(name) ? name : JSON.stringify(name))

export function printCharm(charm) {
	const rows = charm.rows.map(row => {
		const settings = SETTINGS.filter(([, key]) => (key === "yarn" ? row.yarn && row.yarn !== "row" : row[key] != null)).map(([letter, key]) => letter + row[key])
		return `${row.ref ? "" : "+"}${DIR_TOKENS[row.dir] ?? "~"}${settings.length ? `[${settings.join(" ")}]` : ""}`
	})
	const lines = [`rows: ${rows.join(" ")}`]
	for (const column of columnsOf(charm)) {
		const width = Math.max(1, column.width || 1)
		const groups = charm.rows.map(row => {
			const cells = charm.cells?.[column.colour]?.[row.id]
			return Array.from({length: width}, (_, i) => cellText(cells?.[i])).join(",")
		})
		const parts = ["<>", column.colour, nameText(column.name), column.hex]
		if (width !== 1) parts.push(`x${width}`)
		if (column.anchor && column.anchor !== "colour-left") parts.push(ANCHOR_TOKENS[column.anchor])
		lines.push(`${parts.join(" ")} (${groups.join(" ")})`)
	}
	return lines.join("\n") + "\n"
}

// a line without its comment (a ; outside quotes, to the end)
function uncommented(line) {
	let quoted = false
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (c === "\\" && quoted) i++
		else if (c === '"') quoted = !quoted
		else if (c === ";" && !quoted) return line.slice(0, i)
	}
	return line
}

const ROW = /^(\+?)([<>~])(?:\[([^\]]*)\])?$/
const RULE = /^<>\s+(\d+)\s+("(?:[^"\\]|\\.)*"|[\w-]+)\s+(#[0-9a-fA-F]{6})(?:\s+x(\d+))?(?:\s+(\|\*|\*\||\|\|\*|\*\|\|))?\s+\((.*)\)$/

const newId = () => globalThis.crypto.randomUUID().slice(0, 8)
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`

// {rows, columns, cells}, or {error: {line, message}}
export function parseCharm(text, ids = []) {
	let rows = null
	const columns = []
	const cells = {}
	const fail = (line, message) => ({error: {line, message}})
	const lines = text.split("\n")
	for (let l = 0; l < lines.length; l++) {
		const line = uncommented(lines[l]).replaceAll("‖", "||").trim()
		if (!line) continue
		const at = l + 1
		if (line.startsWith("rows:")) {
			if (rows) return fail(at, "rows: twice")
			const tokens = line.slice(5).trim().split(/\s+(?![^[]*\])/).filter(Boolean)
			rows = []
			for (const token of tokens) {
				const m = token.match(ROW)
				if (!m) return fail(at, `what's "${token}"? a row is >, < or ~, + first for a + row, and [s v r y] after`)
				const row = {id: ids[rows.length] ?? newId(), ref: !m[1], dir: DIRS[m[2]], yarn: "row", stitch: null, speed: null, roller: null}
				for (const setting of (m[3] ?? "").split(/\s+/).filter(Boolean)) {
					const key = SETTINGS.find(([letter]) => letter === setting[0])?.[1]
					const value = setting.slice(1)
					if (!key || !value) return fail(at, `what's "${setting}"? a setting is s (stitch), v (speed), r (roller) or y (yarn), and its value`)
					if (key === "yarn" && !/^[1-6]$/.test(value)) return fail(at, `yarn ${value} isn't a carrier (1–6)`)
					row[key] = value
				}
				rows.push(row)
			}
			if (rows.length && !rows[0].ref) return fail(at, "the first row has to be a reference row")
			continue
		}
		if (!line.startsWith("<>")) return fail(at, `what's this? a line is rows: or a rule, <> colour name #hex (cells)`)
		if (!rows) return fail(at, "rows: has to come first")
		const m = line.match(RULE)
		if (!m) return fail(at, "a rule is <> colour name #hex [xW] [anchor] (a group of cells a row)")
		const colour = Number(m[1])
		if (colour < 1) return fail(at, "a colour's number is 1 or more")
		if (columns.some(column => column.colour === colour)) return fail(at, `colour ${colour} twice`)
		const name = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2]
		const width = m[4] ? Number(m[4]) : 1
		if (width < 1) return fail(at, "a width is 1 or more")
		const groups = m[6].trim().split(/\s+/).filter(Boolean)
		if (groups.length !== rows.length) return fail(at, `colour ${colour} has ${plural(groups.length, "row")}'s cells, the charm has ${plural(rows.length, "row")}`)
		cells[colour] = {}
		for (let r = 0; r < groups.length; r++) {
			const group = groups[r].split(",")
			if (group.length !== width) return fail(at, `colour ${colour} is ${width} wide, its row ${r + 1} has ${plural(group.length, "cell")}`)
			const parsed = []
			for (const cell of group) {
				const halves = cell.split("/")
				const [f, b] = halves
				for (const code of halves.length === 2 ? [f, b] : [cell]) {
					if (halves.length !== 2 || (code !== "." && !CODES.includes(code))) {
						return fail(at, `what's "${halves.length === 2 ? code : cell}"? a cell is front/back, each k t m x d * co cn or .`)
					}
				}
				parsed.push({f: f === "." ? null : f, b: b === "." ? null : b})
			}
			cells[colour][rows[r].id] = parsed
		}
		columns.push({colour, name, hex: m[3], width, anchor: m[5] ? ANCHOR_OF[m[5]] : "colour-left", order: columns.length})
	}
	if (!rows) return fail(1, "rows: has to come first")
	return {rows, columns, cells}
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// write a parsed charm into a charm's doc, changing only what's different:
// rows by id (text gives them by position, so they're never moved: kept,
// added at the end, or taken off it), columns by colour, put in the parsed
// order by their order fields
export function applyCharm(doc, parsed) {
	const keep = new Set(parsed.rows.map(row => row.id))
	for (const row of [...doc.rows]) if (!keep.has(row.id)) removeRow(doc, row.id)
	for (const row of parsed.rows) {
		const {id, ...fields} = row
		if (doc.rows.some(r => r.id === id)) setRow(doc, id, fields)
		else doc.rows.push({...row})
	}

	const colours = new Set(parsed.columns.map(column => column.colour))
	for (const column of columnsOf(doc)) if (!colours.has(column.colour)) removeColumn(doc, column.colour)
	parsed.columns.forEach(column => {
		const {colour, ...fields} = column
		if (!doc.columns.some(c => c.colour === colour)) addColumn(doc, column)
		else setColumn(doc, colour, fields)
		if (!doc.cells[colour]) doc.cells[colour] = {}
		const theirs = parsed.cells[colour] ?? {}
		const ours = doc.cells[colour]
		for (const id of Object.keys(ours)) if (!theirs[id]) delete ours[id]
		for (const [id, cells] of Object.entries(theirs)) {
			if (!ours[id] || ours[id].length !== cells.length) ours[id] = cells.map(cell => ({...cell}))
			else {
				cells.forEach((cell, n) => {
					if (same(ours[id][n], cell)) return
					if (ours[id][n].f !== cell.f) ours[id][n].f = cell.f
					if (ours[id][n].b !== cell.b) ours[id][n].b = cell.b
				})
			}
		}
	})
}
