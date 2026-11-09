// a knitting machine's editor (see profile-docs.js for what's kept of it):
// what it is, its gauge, beds and carriers, the longest float it'll take,
// and its stitch table, what each of knitout's stitch numbers is set to on
// it. each field's its own key in the doc (and words are spliced as they're
// typed), so two people editing it at once both keep what they did
import {editorRoot, field, note, numberInput, removeButton, section, show, textInput, unit} from "./profile-form.js"

const STITCH_NAME = /^[0-9A-Z]$/

export default function MachineTool(handle, element, context = {}) {
	const {root, remove} = editorRoot(element, "profile-machine")
	const change = fn => handle.change(fn)
	const set = key => value => change(doc => (doc[key] = value))
	const words = (key, options = {}) => textInput({handle, path: [key], ...options})

	const title = words("title", {title: "what this machine's called", placeholder: "machine"})
	title.classList.add("profile-title")

	const make = words("make", {title: "who made it (Kniterate, Shima Seiki, Stoll…)"})
	const model = words("model", {title: "which of theirs it is"})
	const gauge = numberInput({step: "1", min: "1", title: "needles to the inch", onValue: set("gauge")})
	const needles = numberInput({step: "1", min: "1", title: "needles on each bed", onValue: set("needles")})
	const beds = numberInput({step: "1", min: "1", max: "2", title: "needle beds: two, front and back, for rib", onValue: set("beds")})
	const carriers = textInput({
		title: "the carriers' names, as knitout has them, with spaces between",
		onValue: value => change(doc => (doc.carriers = value.split(/\s+/).filter(Boolean))),
	})
	const floatLimit = numberInput({step: "1", min: "1", title: "the longest a float can be before it snags, in needles", onValue: set("floatLimit")})
	const notes = words("notes", {multiline: true, title: "anything else worth knowing about it", placeholder: "anything else"})

	const what = section("machine")
	what.append(
		field("make", make.title, make),
		field("model", model.title, model),
		field("gauge", gauge.title, gauge, unit("needles an inch")),
		field("needles", needles.title, needles, unit("a bed ×"), beds, unit("beds")),
		field("carriers", carriers.title, carriers),
		field("floats", floatLimit.title, floatLimit, unit("needles at most")),
	)

	// the stitch table: a row for each stitch number it has an entry for
	const table = section(
		"stitch table",
		"what each stitch number's set to",
		"knitout's x-stitch-number names an entry in the machine's own stitch table: this is what that entry's set to, on each bed",
	)
	const grid = document.createElement("div")
	grid.className = "profile-grid profile-stitches"
	grid.setAttribute("role", "table")
	grid.setAttribute("aria-label", "stitch table")
	const head = document.createElement("div")
	head.className = "profile-grid-row profile-grid-heads"
	head.setAttribute("role", "row")
	head.append(
		...["stitch", "front", "rear", "note", ""].map(text => {
			const cell = document.createElement("span")
			cell.setAttribute("role", "columnheader")
			cell.textContent = text
			return cell
		}),
	)
	const rows = document.createElement("div")
	rows.className = "profile-grid-body"
	const add = textInput({
		title: "a stitch number to add: 0–9 or A–Z",
		placeholder: "+ stitch",
		onValue: value => {
			const name = value.trim().toUpperCase()
			add.value = ""
			if (!STITCH_NAME.test(name)) return
			change(doc => {
				doc.stitches ??= {}
				doc.stitches[name] ??= {front: null, rear: null, note: ""}
			})
		},
	})
	add.maxLength = 1
	add.classList.add("profile-add-stitch")
	const empty = note("none yet")
	grid.append(head, rows)
	table.append(grid, empty, add)

	let shownNumbers = null
	let inputs = {}
	function showStitches(doc) {
		const stitches = doc.stitches ?? {}
		const numbers = Object.keys(stitches).sort()
		const max = doc.stitchSizes?.max ?? 15
		const min = doc.stitchSizes?.min ?? 0
		if (numbers.join() !== shownNumbers) {
			shownNumbers = numbers.join()
			inputs = {}
			rows.replaceChildren(
				...numbers.map(number => {
					const setOn = key => value => change(target => (target.stitches[number][key] = value))
					const range = `the stitch size it's set to, ${min}–${max}`
					const front = numberInput({step: "1", min: String(min), max: String(max), allowNought: true, title: `${range}, on the front bed`, onValue: setOn("front")})
					const rear = numberInput({step: "1", min: String(min), max: String(max), allowNought: true, title: `${range}, on the rear bed`, onValue: setOn("rear")})
					const remark = textInput({handle, path: ["stitches", number, "note"], title: "anything about it", placeholder: "note"})
					const forget = removeButton(`forget stitch ${number}`, () => change(target => delete target.stitches[number]))
					inputs[number] = {front, rear, note: remark}
					const row = document.createElement("div")
					row.className = "profile-grid-row"
					row.setAttribute("role", "row")
					const name = document.createElement("span")
					name.className = "profile-readout"
					name.setAttribute("role", "rowheader")
					name.textContent = number
					row.append(name, front, rear, remark, forget)
					return row
				}),
			)
			grid.hidden = !numbers.length
			empty.hidden = !!numbers.length
		}
		for (const [number, entry] of Object.entries(inputs)) {
			for (const key of ["front", "rear", "note"]) show(entry[key], stitches[number]?.[key])
		}
	}

	const more = section("notes")
	more.append(notes)
	root.append(title, what, table, more)
	if (!context.project) root.append(note("open it in a lattice project to use it for a .k"))

	function redraw() {
		const doc = handle.doc()
		if (!doc) return
		show(title, doc.title)
		show(make, doc.make)
		show(model, doc.model)
		show(gauge, doc.gauge)
		show(needles, doc.needles)
		show(beds, doc.beds)
		show(carriers, (doc.carriers ?? []).join(" "))
		show(floatLimit, doc.floatLimit)
		show(notes, doc.notes)
		showStitches(doc)
	}
	handle.on("change", redraw)
	redraw()

	return () => {
		handle.off("change", redraw)
		remove()
	}
}
