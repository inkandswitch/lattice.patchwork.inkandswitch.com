// a yarn's editor (see profile-docs.js): what it is, what it's spun from, its
// count (and the tex that comes to), where it came from; and the swatches
// knitted from it, each in a line, with a way to start another
import {COUNT_SYSTEMS, texOf} from "./counts.js"
import {FIBRES} from "./size.js"
import {newSwatch, swatchSummary} from "./profile-docs.js"
import {choice, editorRoot, field, note, numberInput, section, show, textInput, unit} from "./profile-form.js"

export {swatchSummary}

export default function YarnTool(handle, element, context = {}) {
	const repo = context.repo ?? element.repo
	const {root, remove} = editorRoot(element, "profile-yarn")
	const change = fn => handle.change(fn)
	const set = key => value => change(doc => (doc[key] = value))
	const setCount = key => value =>
		change(doc => {
			doc.count ??= {system: "Nm", value: null, ply: 1}
			doc.count[key] = value
		})

	const title = textInput({title: "what this yarn's called", onValue: set("title")})
	title.className = "profile-title"

	// what it's spun from: a row for each fibre, and its share
	const fibreRows = document.createElement("div")
	fibreRows.className = "profile-table"
	const addFibre = document.createElement("button")
	addFibre.type = "button"
	addFibre.textContent = "add a fibre"
	addFibre.addEventListener("click", () => change(doc => (doc.fibres ??= []).push({fibre: "", percent: null})))
	let shownFibres = -1
	let fibreInputs = []
	function showFibres(doc) {
		const fibres = doc.fibres ?? []
		if (fibres.length !== shownFibres) {
			shownFibres = fibres.length
			fibreInputs = fibres.map((_, i) => {
				const setOn = key => value => change(target => (target.fibres[i][key] = value))
				const name = textInput({title: "the fibre: lambswool, merino, cotton…", placeholder: "lambswool", onValue: setOn("fibre")})
				const percent = numberInput({step: "1", max: "100", title: "how much of the yarn it is, in %", onValue: setOn("percent")})
				const forget = document.createElement("button")
				forget.type = "button"
				forget.textContent = "×"
				forget.title = "take this fibre out"
				forget.addEventListener("click", () => change(target => target.fibres.splice(i, 1)))
				return {name, percent, row: field(i ? "" : "fibres", "what it's spun from", name, percent, unit("%"), forget)}
			})
			fibreRows.replaceChildren(...fibreInputs.map(({row}) => row))
		}
		fibres.forEach((fibre, i) => {
			show(fibreInputs[i].name, fibre?.fibre)
			show(fibreInputs[i].percent, fibre?.percent)
		})
	}

	const relaxesLike = choice(
		Object.entries(FIBRES).map(([value, {name}]) => [value, name]),
		set("relaxesLike"),
		"which yarns it takes after, as it relaxes: it changes how much it relaxes washed (Munden's, and Knapton's)",
	)

	const countValue = numberInput({title: "its count, in the system beside it (Nm 2/30: 30)", onValue: setCount("value")})
	const countSystem = choice(
		COUNT_SYSTEMS.map(system => [system, system]),
		setCount("system"),
		"Nm: km a kg of one ply runs to · Ne: english cotton count · tex: grams a km weighs · denier: grams 9 km weighs",
	)
	const ply = numberInput({step: "1", min: "1", title: "plies twisted together (Nm 2/30: 2)", onValue: setCount("ply")})
	const tex = document.createElement("span")
	tex.className = "profile-derived"

	const supplier = textInput({title: "who sells it, or spun it", onValue: set("supplier")})
	const colourway = textInput({title: "the colour, as they call it", onValue: set("colourway")})
	const colour = document.createElement("input")
	colour.type = "color"
	colour.title = "a colour to show it in: the carriers linked to it take it, till someone picks their own"
	colour.addEventListener("change", () => change(doc => (doc.colour = colour.value)))
	const lot = textInput({title: "the dye lot, or batch: yarn from another lot can knit a little differently", onValue: set("lot")})
	const notes = textInput({multiline: true, title: "anything else worth knowing about it", onValue: set("notes")})

	const what = section("the yarn")
	what.append(
		fibreRows,
		field("", "", addFibre),
		field("relaxes like", relaxesLike.title, relaxesLike),
		field("count", "its count: tex is worked out from it", countSystem, countValue, unit("×"), ply, unit("ply"), tex),
		field("supplier", supplier.title, supplier),
		field("colourway", colourway.title, colourway, colour),
		field("lot", lot.title, lot),
	)

	// its swatches
	const swatches = section("swatches", "what's been knitted from it, and measured")
	const list = document.createElement("ul")
	list.className = "profile-list"
	const newOne = document.createElement("button")
	newOne.type = "button"
	newOne.textContent = "new swatch with this yarn"
	newOne.title = "start a swatch of this yarn: say how it was knit, then what it measures"
	newOne.disabled = !repo
	newOne.addEventListener("click", async () => {
		const swatch = newSwatch()
		swatch.title = `${handle.doc()?.title || "yarn"} swatch`
		swatch.knit.feeds = [{carrier: "1", yarns: [handle.url], plated: false}]
		const made = await repo.create2(swatch)
		change(doc => (doc.swatches ??= []).push(made.url))
		openDoc(made.url)
	})
	swatches.append(list, newOne)

	const more = section("notes")
	more.append(notes)
	root.append(title, what, swatches, more)

	function openDoc(url) {
		if (context.open) context.open(url, element)
		else location.hash = `doc=${url}`
	}

	// each swatch's line, kept up to date as it changes
	const watched = new Map() // url → {handle, line, off}
	function showSwatches(doc) {
		const urls = Array.from(doc.swatches ?? []).map(String)
		for (const [url, entry] of watched) {
			if (urls.includes(url)) continue
			entry.off?.()
			watched.delete(url)
		}
		for (const url of urls) {
			if (watched.has(url) || !repo) continue
			const item = document.createElement("li")
			const line = document.createElement("button")
			line.type = "button"
			line.className = "profile-link"
			line.textContent = "…"
			line.title = "open this swatch"
			line.addEventListener("click", () => openDoc(url))
			item.append(line)
			const entry = {item, off: null}
			watched.set(url, entry)
			repo
				.find(url)
				.then(found => {
					const draw = () => (line.textContent = `${found.doc()?.title || "swatch"}: ${swatchSummary(found.doc())}`)
					found.on("change", draw)
					entry.off = () => found.off("change", draw)
					draw()
				})
				.catch(() => (line.textContent = "a swatch that can't be found"))
		}
		list.replaceChildren(...urls.map(url => watched.get(url)?.item).filter(Boolean))
		if (!urls.length) list.replaceChildren(note("none yet"))
	}

	function redraw() {
		const doc = handle.doc()
		if (!doc) return
		show(title, doc.title)
		showFibres(doc)
		show(relaxesLike, doc.relaxesLike ?? "wool")
		show(countValue, doc.count?.value)
		show(countSystem, doc.count?.system ?? "Nm")
		show(ply, doc.count?.ply)
		const tx = texOf(doc.count)
		tex.textContent = tx ? `= ${Math.round(tx * 10) / 10} tex` : ""
		show(supplier, doc.supplier)
		show(colourway, doc.colourway)
		if (doc.colour) show(colour, doc.colour)
		show(lot, doc.lot)
		show(notes, doc.notes)
		showSwatches(doc)
	}
	handle.on("change", redraw)
	redraw()

	return () => {
		handle.off("change", redraw)
		for (const entry of watched.values()) entry.off?.()
		remove()
	}
}
