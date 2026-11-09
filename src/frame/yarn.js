// a yarn's editor (see profile-docs.js): what it is, what it's spun from, its
// count (and the tex that comes to), where it came from; and the swatches
// knitted from it, each in a line, with a way to start another. words are
// spliced in as they're typed
import {COUNT_SYSTEMS, texOf} from "./counts.js"
import {FIBRES} from "./size.js"
import {newSwatch, swatchSummary} from "./profile-docs.js"
import {button, choice, colourWell, editorRoot, field, note, numberInput, removeButton, section, show, textInput, unit} from "./profile-form.js"

export {swatchSummary}

export default function YarnTool(handle, element, context = {}) {
	const repo = context.repo ?? element.repo
	const {root, remove} = editorRoot(element, "profile-yarn")
	const change = fn => handle.change(fn)
	const set = key => value => change(doc => (doc[key] = value))
	const words = (key, options = {}) => textInput({handle, path: [key], ...options})
	const setCount = key => value =>
		change(doc => {
			doc.count ??= {system: "Nm", value: null, ply: 1}
			doc.count[key] = value
		})

	const title = words("title", {title: "what this yarn's called", placeholder: "yarn"})
	title.classList.add("profile-title")

	// what it's spun from: a row for each fibre, and its share
	const fibreRows = document.createElement("span")
	fibreRows.className = "profile-rows"
	const addFibre = button("+ fibre", "add a fibre it's spun from", () => change(doc => (doc.fibres ??= []).push({fibre: "", percent: null})), {quiet: true})
	let shownFibres = -1
	let fibreInputs = []
	function showFibres(doc) {
		const fibres = doc.fibres ?? []
		if (fibres.length !== shownFibres) {
			shownFibres = fibres.length
			fibreInputs = fibres.map((_, i) => {
				const name = textInput({handle, path: ["fibres", i, "fibre"], title: "the fibre: lambswool, merino, cotton…", placeholder: "lambswool"})
				const percent = numberInput({step: "1", max: "100", title: "how much of the yarn it is, in %", onValue: value => change(target => (target.fibres[i].percent = value))})
				const forget = removeButton("take this fibre out", () => change(target => target.fibres.splice(i, 1)))
				const row = document.createElement("span")
				row.className = "profile-row"
				row.append(name, percent, unit("%"), forget)
				return {name, percent, row}
			})
			fibreRows.replaceChildren(...fibreInputs.map(({row}) => row), addFibre)
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

	const countSystem = choice(
		COUNT_SYSTEMS.map(system => [system, system]),
		setCount("system"),
		"Nm: km a kg of one ply runs to · Ne: english cotton count · tex: grams a km weighs · denier: grams 9 km weighs",
	)
	const ply = numberInput({step: "1", min: "1", title: "plies twisted together (Nm 2/30: 2)", onValue: setCount("ply")})
	const countValue = numberInput({title: "its count, in the system before it (Nm 2/30: 30)", onValue: setCount("value")})
	const tex = document.createElement("span")
	tex.className = "profile-readout"

	const supplier = words("supplier", {title: "who sells it, or spun it"})
	const colourway = words("colourway", {title: "the colour, as they call it"})
	const colour = colourWell({title: "a colour to show it in: the carriers linked to it take it, till someone picks their own", onValue: set("colour")})
	const lot = words("lot", {title: "the dye lot, or batch: yarn from another lot can knit a little differently"})
	const notes = words("notes", {multiline: true, title: "anything else worth knowing about it", placeholder: "anything else"})

	const what = section("yarn")
	what.append(
		field("fibres", "what it's spun from", fibreRows),
		field("relaxes like", relaxesLike.title, relaxesLike),
		field("count", "its count: tex is worked out from it", countSystem, ply, unit("/"), countValue, tex),
		field("supplier", supplier.title, supplier),
		field("colourway", colourway.title, colourway, colour.element),
		field("lot", lot.title, lot),
	)

	// its swatches
	const swatches = section("swatches", "knitted from it")
	const list = document.createElement("ul")
	list.className = "profile-list"
	const newOne = button("+ swatch", "start a swatch of this yarn: say how it was knit, then what it measures", async () => {
		const swatch = newSwatch()
		swatch.title = `${handle.doc()?.title || "yarn"} swatch`
		swatch.knit.feeds = [{carrier: "1", yarns: [handle.url], plated: false}]
		const made = await repo.create2(swatch)
		change(doc => (doc.swatches ??= []).push(made.url))
		openDoc(made.url)
	}, {quiet: true})
	newOne.disabled = !repo
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
			line.title = "open this swatch"
			const name = document.createElement("span")
			name.className = "profile-link-name"
			name.textContent = "…"
			const summary = document.createElement("span")
			summary.className = "profile-link-summary"
			line.append(name, summary)
			line.addEventListener("click", () => openDoc(url))
			item.append(line)
			const entry = {item, off: null}
			watched.set(url, entry)
			repo
				.find(url)
				.then(found => {
					const draw = () => {
						name.textContent = found.doc()?.title || "swatch"
						summary.textContent = swatchSummary(found.doc())
					}
					found.on("change", draw)
					entry.off = () => found.off("change", draw)
					draw()
				})
				.catch(() => (name.textContent = "a swatch that can't be found"))
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
		tex.textContent = tx ? `${Math.round(tx * 10) / 10} tex` : ""
		show(supplier, doc.supplier)
		show(colourway, doc.colourway)
		colour.show(doc.colour)
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
