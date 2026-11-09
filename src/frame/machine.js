// a knitting machine's editor (see profile-docs.js for what's kept of it):
// what it is, its gauge, beds and carriers, the longest float it'll take,
// and its stitch table, what each of knitout's stitch numbers is set to on
// it. each field's its own key in the doc, so two people editing it at once
// both keep what they did
import {editorRoot, field, note, numberInput, section, show, textInput, unit} from "./profile-form.js"

const STITCH_NAME = /^[0-9A-Z]$/

export default function MachineTool(handle, element, context = {}) {
	const {root, remove} = editorRoot(element, "profile-machine")
	const change = fn => handle.change(fn)
	const set = key => value => change(doc => (doc[key] = value))

	const title = textInput({title: "what this machine's called", onValue: set("title")})
	title.className = "profile-title"

	const make = textInput({title: "who made it (Kniterate, Shima Seiki, Stoll…)", onValue: set("make")})
	const model = textInput({title: "which of theirs it is", onValue: set("model")})
	const gauge = numberInput({step: "1", min: "1", title: "needles to the inch", onValue: set("gauge")})
	const needles = numberInput({step: "1", min: "1", title: "needles on each bed", onValue: set("needles")})
	const beds = numberInput({step: "1", min: "1", max: "2", title: "needle beds: two, front and back, for rib", onValue: set("beds")})
	const carriers = textInput({
		title: "the carriers' names, as knitout has them, with spaces between",
		onValue: value => change(doc => (doc.carriers = value.split(/\s+/).filter(Boolean))),
	})
	const floatLimit = numberInput({step: "1", min: "1", title: "the longest a float can be before it snags, in needles", onValue: set("floatLimit")})
	const notes = textInput({multiline: true, title: "anything else worth knowing about it", onValue: set("notes")})

	const what = section("the machine")
	what.append(
		field("make", make.title, make),
		field("model", model.title, model),
		field("gauge", gauge.title, gauge, unit("needles to the inch")),
		field("needles", needles.title, needles, unit("on each bed ×"), beds, unit("beds")),
		field("carriers", carriers.title, carriers),
		field("floats", floatLimit.title, floatLimit, unit("needles at most")),
	)

	// the stitch table: a row for each stitch number it has an entry for
	const table = section(
		"stitch table",
		"knitout's x-stitch-number names an entry in the kniterate's own stitch table: what that entry's set to, on each bed",
	)
	const rows = document.createElement("div")
	rows.className = "profile-table"
	const add = textInput({
		title: "a stitch number: 0–9 or A–Z",
		placeholder: "add a stitch number",
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
	table.append(rows, field("", add.title, add))
	let shownNumbers = ""
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
					const remark = textInput({title: "anything about it", placeholder: "note", onValue: setOn("note")})
					const forget = document.createElement("button")
					forget.type = "button"
					forget.textContent = "×"
					forget.title = `forget stitch number ${number}'s entry`
					forget.addEventListener("click", () => change(target => delete target.stitches[number]))
					inputs[number] = {front, rear, note: remark}
					return field(`stitch ${number}`, `what stitch number ${number} is set to on this machine`, unit("front"), front, unit("rear"), rear, remark, forget)
				}),
			)
		}
		for (const [number, entry] of Object.entries(inputs)) {
			for (const key of ["front", "rear", "note"]) show(entry[key], stitches[number]?.[key])
		}
	}

	const more = section("notes")
	more.append(notes)
	root.append(title, what, table, more)
	if (!context.project) root.append(note("(open it in a lattice project to use it for a .k)"))

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
