// a text crdt's history, knitted: every character anyone ever typed is a
// stitch, in the yarn of whoever typed it. so the fabric is the document,
// tombstones and all, and shows how it was written.
//
// - each author's yarn is a carrier (in the order they first typed)
// - each line of text is a row, wrapped at `width` needles, knitted back and
//   forth the way the carriage goes; a character sits on the needle of its
//   column
// - a deleted character is a miss: no new loop, so the loop below it on that
//   needle is held, and pulled long; and the yarn floats past
// - a newline ends the row: the needles past it aren't knitted, so lines of
//   uneven length are short rows, and the fabric puckers
// - an author's yarn floats behind other authors' stitches, as in stranded
//   colourwork: text typed in runs knits clean blocks, and text whose
//   authors interleave knits speckled, with floats everywhere behind
//
// the history is automerge's: decoded changes (Automerge.decodeChange), whose
// inserts each name the character they went in after (their left origin).
// automerge orders a character's followers newest first, like rga

const MAX_CARRIERS = 6

// "12@abcd" → {counter: 12, actor: "abcd"}
function opId(id) {
	const at = id.indexOf("@")
	return {counter: Number(id.slice(0, at)), actor: id.slice(at + 1)}
}

// is op id a newer than b: by counter, then by actor
function newer(a, b) {
	const x = opId(a)
	const y = opId(b)
	return x.counter !== y.counter ? x.counter > y.counter : x.actor > y.actor
}

// every character a text object ever had, in document order, as {id, actor,
// value, deleted}: from `changes` (decoded), for the text object `obj` (its
// op id, as "1@abcd"; the first text object made, if not given)
export function textHistory(changes, obj = null) {
	const chars = new Map() // op id → character
	const after = new Map() // op id ("_head" for the start) → ids inserted after it
	const deleted = new Set()
	for (const change of changes) {
		change.ops.forEach((op, index) => {
			const id = `${change.startOp + index}@${change.actor}`
			if (op.action === "makeText" && obj == null) obj = id
			if (op.obj !== obj) return
			if (op.insert) {
				chars.set(id, {id, actor: change.actor, value: op.value, deleted: false})
				if (!after.has(op.elemId)) after.set(op.elemId, [])
				after.get(op.elemId).push(id)
			} else if (op.action === "del") {
				deleted.add(op.elemId)
			}
		})
	}
	// in order: each character, then (newest first) what went in after it
	const order = []
	const todo = [...(after.get("_head") ?? [])].sort((a, b) => (newer(a, b) ? 1 : -1))
	while (todo.length) {
		const id = todo.pop()
		const char = chars.get(id)
		char.deleted = deleted.has(id)
		order.push(char)
		const next = [...(after.get(id) ?? [])].sort((a, b) => (newer(a, b) ? 1 : -1))
		todo.push(...next)
	}
	return order
}

// the history as knitout: a .k's text
export function knitHistory(history, {width = 40, cast = true} = {}) {
	const actors = []
	for (const char of history) if (!actors.includes(char.actor)) actors.push(char.actor)
	const carrierOf = actor => String((actors.indexOf(actor) % MAX_CARRIERS) + 1)
	const carriers = [...new Set(actors.map(carrierOf))]

	// the rows: each line, wrapped at width
	const rows = [[]]
	for (const char of history) {
		const row = rows[rows.length - 1]
		if (char.value === "\n" && !char.deleted) {
			rows.push([])
			continue
		}
		if (row.length === width) rows.push([char])
		else row.push(char)
	}

	const lines = [";!knitout-2", `;;Carriers: ${[1, 2, 3, 4, 5, 6].join(" ")}`, `;;Width: ${width}`]
	for (const [index, actor] of actors.entries()) lines.push(`;; carrier ${carrierOf(actor)}: ${actor}`)
	for (const carrier of carriers) lines.push(`in ${carrier}`)
	// (a cast-on row in the first author's yarn, all the way across, so the
	// fabric has an edge to hang from)
	if (cast && actors.length) {
		const yarn = carrierOf(actors[0])
		for (let n = width; n >= 1; n--) lines.push(`knit - f${n} ${yarn}`)
	}
	rows.forEach((row, r) => {
		const dir = (r + (cast ? 1 : 0)) % 2 === 0 ? "-" : "+"
		const columns = row.map((char, column) => ({char, column}))
		if (dir === "-") columns.reverse()
		for (const {char, column} of columns) {
			const what = char.deleted ? "miss" : "knit"
			const shown = JSON.stringify(char.value)
			lines.push(`${what} ${dir} f${column + 1} ${carrierOf(char.actor)} ; ${shown} ${char.id}${char.deleted ? " deleted" : ""}`)
		}
	})
	for (const carrier of carriers) lines.push(`out ${carrier}`)
	return lines.join("\n") + "\n"
}
