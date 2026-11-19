// a charm as text: a rule a colour (charm-text.js). what's typed is read as
// it's typed, and, when it reads, written into the charm (only what's
// different, so the arrangement and anyone else keep theirs). when it
// doesn't read, the line it's stuck on is marked and the charm's left alone
import {EditorState, StateEffect, StateField, Annotation} from "@codemirror/state"
import {Decoration, EditorView, highlightActiveLine, keymap, lineNumbers} from "@codemirror/view"
import {defaultKeymap, history, historyKeymap} from "@codemirror/commands"
import {stylesheet} from "../wm/ui/stylesheet.js"
import {applyCharm, parseCharm, printCharm} from "./charm-text.js"

const STYLESHEET = new URL("./patternstoat.css", import.meta.url).href
const READ_DELAY = 300

// a change that came from the charm, not from typing
const fromCharm = Annotation.define()

const setStuck = StateEffect.define()
const stuckLine = StateField.define({
	create: () => Decoration.none,
	update(marks, tr) {
		marks = marks.map(tr.changes)
		for (const effect of tr.effects) {
			if (!effect.is(setStuck)) continue
			const line = effect.value
			if (line == null || line > tr.state.doc.lines) return Decoration.none
			const at = tr.state.doc.line(line).from
			return Decoration.set([Decoration.line({class: "stoat-stuck"}).range(at)])
		}
		return marks
	},
	provide: field => EditorView.decorations.from(field),
})

const theme = EditorView.theme({
	"&": {height: "100%", background: "var(--stoat-sheet)", color: "var(--stoat-ink)"},
	".cm-content": {fontFamily: "var(--stoat-mono)", fontSize: "13px"},
	".cm-gutters": {background: "var(--stoat-chrome)", color: "var(--stoat-muted)", border: "none"},
	".cm-activeLine": {background: "color-mix(in oklab, var(--stoat-accent) 8%, transparent)"},
	".stoat-stuck": {background: "color-mix(in oklab, var(--stoat-danger) 18%, transparent)"},
	"&.cm-focused": {outline: "none"},
})

// what a charm says, without its ids' and cells' order mattering
function sameCharm(parsed, charm) {
	if (!parsed || parsed.error || !charm) return false
	const shape = c => JSON.stringify([c.rows, c.columns, Object.fromEntries(Object.entries(c.cells ?? {}).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort())]).sort())])
	return shape(parsed) === shape(charm)
}

export default function CharmTextTool(handle, element) {
	const doc = () => handle.doc()
	const ids = () => (doc()?.rows ?? []).map(row => row.id)

	const root = document.createElement("div")
	root.className = "stoat charm-text"
	const link = stylesheet(STYLESHEET, root)
	element.append(link, root)
	const host = document.createElement("div")
	host.className = "stoat-text"
	const problem = document.createElement("div")
	problem.className = "stoat-problem"
	problem.hidden = true
	root.append(host, problem)

	let timer = 0
	// typed, and not yet read into the charm
	let unread = false

	function showProblem(text) {
		problem.hidden = !text
		problem.textContent = text ?? ""
	}

	function read() {
		const text = view.state.doc.toString()
		const parsed = parseCharm(text, ids())
		if (parsed.error) {
			view.dispatch({effects: setStuck.of(parsed.error.line)})
			showProblem(`line ${parsed.error.line}: ${parsed.error.message}`)
			return
		}
		view.dispatch({effects: setStuck.of(null)})
		showProblem(null)
		unread = false
		if (!sameCharm(parsed, doc())) handle.change(d => applyCharm(d, parsed))
	}

	const view = new EditorView({
		parent: host,
		state: EditorState.create({
			doc: doc() ? printCharm(doc()) : "",
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				EditorView.lineWrapping,
				stuckLine,
				theme,
				EditorView.updateListener.of(update => {
					if (!update.docChanged || update.transactions.some(tr => tr.annotation(fromCharm))) return
					unread = true
					clearTimeout(timer)
					timer = setTimeout(read, READ_DELAY)
				}),
			],
		}),
	})

	// someone else's change (or the arrangement's): shown, unless what's typed
	// here hasn't been read yet
	function onChange() {
		const charm = doc()
		if (!charm) return
		const text = view.state.doc.toString()
		if (sameCharm(parseCharm(text, ids()), charm)) return
		if (unread) {
			showProblem("the charm's changed since you started typing: finish this line, and it'll be read in")
			return
		}
		view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: printCharm(charm)}, annotations: fromCharm.of(true)})
	}

	handle.on("change", onChange)

	return () => {
		clearTimeout(timer)
		handle.off("change", onChange)
		view.destroy()
		link.remove()
		root.remove()
	}
}
