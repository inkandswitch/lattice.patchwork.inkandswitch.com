import {StateEffect, StateField, Transaction} from "@codemirror/state"
import {EditorView, Decoration, ViewPlugin, WidgetType} from "@codemirror/view"
import {icon} from "./icons.js"

const setHoverLine = StateEffect.define()

const hoverLineDecoration = Decoration.line({class: "cm-knitout-hover-line"})

const hoverLineField = StateField.define({
	create() {
		return Decoration.none
	},
	update(decorations, tr) {
		decorations = decorations.map(tr.changes)
		for (const effect of tr.effects) {
			if (effect.is(setHoverLine)) {
				if (effect.value == null) {
					decorations = Decoration.none
				} else {
					const lineNumber = Math.max(
						1,
						Math.min(effect.value, tr.state.doc.lines)
					)
					const line = tr.state.doc.line(lineNumber)
					decorations = Decoration.set([
						hoverLineDecoration.range(line.from),
					])
				}
			}
		}
		return decorations
	},
	provide: field => EditorView.decorations.from(field),
})

// the line just jumped to: flashes, then fades. (two classes, taking turns,
// so jumping to the same line again starts the flash over)
const setFlashLine = StateEffect.define()
const FLASH_MS = 1200
const flashDecorations = [
	Decoration.line({class: "cm-knitout-flash-line cm-knitout-flash-a"}),
	Decoration.line({class: "cm-knitout-flash-line cm-knitout-flash-b"}),
]
let flashes = 0

const flashLineField = StateField.define({
	create() {
		return Decoration.none
	},
	update(decorations, tr) {
		decorations = decorations.map(tr.changes)
		for (const effect of tr.effects) {
			if (!effect.is(setFlashLine)) continue
			if (effect.value == null) {
				decorations = Decoration.none
			} else {
				const lineNumber = Math.max(1, Math.min(effect.value.line, tr.state.doc.lines))
				decorations = Decoration.set([
					flashDecorations[effect.value.turn].range(tr.state.doc.line(lineNumber).from),
				])
			}
		}
		return decorations
	},
	provide: field => EditorView.decorations.from(field),
})

/**
 * jump to a line (1-based): put the cursor there, scroll it to the middle,
 * and flash it
 */
export function goToLine(view, lineNumber) {
	const line = view.state.doc.line(Math.max(1, Math.min(lineNumber, view.state.doc.lines)))
	const turn = flashes++ % 2
	view.dispatch({
		selection: {anchor: line.from},
		effects: [
			EditorView.scrollIntoView(line.from, {y: "center"}),
			setFlashLine.of({line: line.number, turn}),
		],
	})
	view.focus()
	clearTimeout(view.knitoutFlashTimer)
	view.knitoutFlashTimer = setTimeout(() => {
		// (unless the editor's gone, or another jump's flashing since)
		if (view.dom.isConnected) view.dispatch({effects: setFlashLine.of(null)})
	}, FLASH_MS)
}

// the line a build failed on, until the code changes: tinted, with what
// went wrong written at its end
const setErrorLine = StateEffect.define()

class ErrorMessage extends WidgetType {
	constructor(message) {
		super()
		this.message = message
	}
	eq(other) {
		return other.message === this.message
	}
	toDOM() {
		const span = document.createElement("span")
		span.className = "cm-knitout-error-message"
		span.append(icon("warning"), ` ${this.message}`)
		return span
	}
}

const errorLineField = StateField.define({
	create() {
		return Decoration.none
	},
	update(decorations, tr) {
		if (tr.docChanged) decorations = Decoration.none
		for (const effect of tr.effects) {
			if (!effect.is(setErrorLine)) continue
			if (effect.value == null) {
				decorations = Decoration.none
			} else {
				const lineNumber = Math.max(1, Math.min(effect.value.line, tr.state.doc.lines))
				const line = tr.state.doc.line(lineNumber)
				decorations = Decoration.set([
					Decoration.line({
						class: "cm-knitout-error-line",
						attributes: {title: effect.value.message},
					}).range(line.from),
					Decoration.widget({
						widget: new ErrorMessage(effect.value.message),
						side: 1,
					}).range(line.to),
				])
			}
		}
		return decorations
	},
	provide: field => EditorView.decorations.from(field),
})

/**
 * mark the line a run failed on ({line, message}), or clear it (null). it
 * clears itself when the code changes. it never scrolls: a run follows
 * typing and pasting, and the editor stays where you are. the status's
 * line button goes there
 */
export function showError(view, error) {
	view.dispatch({effects: setErrorLine.of(error)})
}

/**
 * text that appears above your caret, and you didn't put there (someone
 * else's edit, an import dropped in), leaves your caret where it was on the
 * screen. codemirror on its own keeps the top line still, so text arriving
 * between the top and the caret pushes the caret down. a caret that's off
 * the screen is left to codemirror
 */
export const keepCaretInPlace = ViewPlugin.fromClass(
	class {
		constructor(view) {
			this.view = view
			// the caret's top, from the top of the scroller, or null when it's
			// out of sight
			this.offset = null
			this.onScroll = () => this.record()
			view.scrollDOM.addEventListener("scroll", this.onScroll, {passive: true})
			view.requestMeasure({key: this, read: () => this.record()})
		}

		record() {
			const view = this.view
			const coords = view.coordsAtPos(view.state.selection.main.head, 1)
			const top = coords && coords.top - view.scrollDOM.getBoundingClientRect().top
			this.offset = top != null && top >= 0 && top <= view.scrollDOM.clientHeight ? top : null
		}

		update(update) {
			// the doc changed, and nothing moved the caret: it was carried along
			const carried =
				update.docChanged && update.transactions.every(tr => !tr.docChanged || !tr.selection)
			if (carried) {
				const head = update.startState.selection.main.head
				let above = false
				update.changes.iterChangedRanges(fromA => {
					if (fromA < head) above = true
				})
				const offset = this.offset
				if (above && offset != null) {
					// (a view can't dispatch while it's updating)
					queueMicrotask(() => {
						const view = this.view
						if (!view.dom.isConnected) return
						view.dispatch({
							effects: EditorView.scrollIntoView(view.state.selection.main.head, {
								y: "start",
								// codemirror adds its scroll margins on top of this
								yMargin: Math.max(0, offset - scrollMarginTop(view)),
							}),
						})
					})
				}
				return
			}
			// your own doing, or the editor resized: where the caret is now.
			// (the scroll that follows, if any, records it again)
			if (
				update.geometryChanged ||
				update.transactions.some(tr => tr.annotation(Transaction.userEvent) != null)
			) {
				update.view.requestMeasure({key: this, read: () => this.record()})
			}
		}

		destroy() {
			this.view.scrollDOM.removeEventListener("scroll", this.onScroll)
		}
	},
)

function scrollMarginTop(view) {
	let top = 0
	for (const source of view.state.facet(EditorView.scrollMargins)) {
		const margins = source(view)
		if (margins?.top != null) top = Math.max(top, margins.top)
	}
	return top
}

const knitoutTheme = EditorView.baseTheme({
	".cm-knitout-error-line": {
		backgroundColor:
			"color-mix(in oklab, var(--knitoutjs-error) 14%, transparent)",
		boxShadow: "inset 3px 0 0 var(--knitoutjs-error)",
	},
	".cm-knitout-error-message": {
		marginLeft: "2ch",
		color: "var(--knitoutjs-error)",
		fontStyle: "italic",
	},
	".cm-knitout-hover-line": {
		backgroundColor: "rgba(255, 220, 0, 0.25)",
	},
	"&dark .cm-knitout-hover-line": {
		backgroundColor: "rgba(255, 220, 0, 0.15)",
	},
	".cm-knitout-flash-line": {
		animationDuration: `${FLASH_MS}ms`,
		animationTimingFunction: "ease-out",
		animationFillMode: "forwards",
	},
	".cm-knitout-flash-a": {animationName: "cm-knitout-flash-a"},
	".cm-knitout-flash-b": {animationName: "cm-knitout-flash-b"},
	"@keyframes cm-knitout-flash-a": {
		"0%, 25%": {backgroundColor: "rgba(255, 200, 0, 0.55)"},
		"100%": {backgroundColor: "rgba(255, 200, 0, 0)"},
	},
	"@keyframes cm-knitout-flash-b": {
		"0%, 25%": {backgroundColor: "rgba(255, 200, 0, 0.55)"},
		"100%": {backgroundColor: "rgba(255, 200, 0, 0)"},
	},
	// (no fade: lit, steady, then not)
	"@media (prefers-reduced-motion: reduce)": {
		".cm-knitout-flash-line": {animationTimingFunction: "step-end"},
	},
})

/**
 * two-way glue between a codemirror editor and knitout visualizers.
 *
 * options:
 * - events: an element the visualizers' knitout:* events reach (e.g. the
 *   frame's root element). each event says which files and lines it means,
 *   as `detail.at` ([{url, line}]) or just `detail.url` and `detail.line`;
 *   only the line for `url` moves this editor
 * - url: the automerge url of the file this editor shows
 * - onSelectLines: ({url, start, end}) => void, called with 1-based inclusive
 *   line numbers whenever the editor selection changes — forward this to the
 *   visualizers as a knitout:highlight-lines event
 */
export function knitoutEditorIntegration({events, url, onSelectLines}) {
	const plugin = ViewPlugin.define(view => {
		function lineAt(lineNumber) {
			const clamped = Math.max(1, Math.min(lineNumber, view.state.doc.lines))
			return view.state.doc.line(clamped)
		}

		// the line in this editor's file, if the event has one ({url, line},
		// or several in `at`)
		function lineFor(detail) {
			const at = detail?.at ?? [detail]
			return at.find(entry => entry?.url === url)?.line ?? null
		}

		// pointing at a stitch lights up its line, but never moves the editor:
		// scrolling along with the pointer is too much motion
		function onHover(event) {
			view.dispatch({effects: setHoverLine.of(lineFor(event.detail))})
		}

		// a click on a stitch: scroll its line into view
		function onSelect(event) {
			const lineNumber = lineFor(event.detail)
			if (lineNumber == null) return
			view.dispatch({
				effects: EditorView.scrollIntoView(lineAt(lineNumber).from, {
					y: "nearest",
					yMargin: 48,
				}),
			})
		}

		// double click on a stitch: jump to the line that made it, and put the
		// cursor there
		function onGoto(event) {
			const lineNumber = lineFor(event.detail)
			if (lineNumber == null) return
			goToLine(view, lineNumber)
		}

		events.addEventListener("knitout:hover-source", onHover)
		events.addEventListener("knitout:select-source", onSelect)
		events.addEventListener("knitout:goto-source", onGoto)

		return {
			update(update) {
				if (update.selectionSet && onSelectLines) {
					const main = update.state.selection.main
					onSelectLines({
						url,
						start: update.state.doc.lineAt(main.from).number,
						end: update.state.doc.lineAt(main.to).number,
					})
				}
			},
			destroy() {
				events.removeEventListener("knitout:hover-source", onHover)
				events.removeEventListener("knitout:select-source", onSelect)
				events.removeEventListener("knitout:goto-source", onGoto)
			},
		}
	})

	return [plugin, hoverLineField, errorLineField, flashLineField, knitoutTheme]
}
