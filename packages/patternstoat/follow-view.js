// a canvas editor's pan and zoom ({cell, x, y}), as wm's view state for its
// pane (wm/view-state.js): where you've moved and zoomed to goes to anyone
// following you, and following someone, it's where they are you see (and
// yours again once you stop)
import {viewStateOf} from "../wm/view-state.js"

const KEYS = ["cell", "x", "y"]
const pick = view => Object.fromEntries(KEYS.map(key => [key, view[key]]))

/**
 * `view` is changed in place as theirs comes, and `onTheirs()` hears that
 * it has (to draw it). returns {shared(), stop()}: shared, after drawing,
 * sends what's changed since
 */
export function followView(element, repo, view, onTheirs) {
	if (!repo) return {shared() {}, stop() {}}
	let last = JSON.stringify(pick(view))
	const state = viewStateOf(element, repo, theirs => {
		// yours, empty (the pane's only just asked): it starts as you are
		if (!KEYS.every(key => Number.isFinite(theirs[key]))) return state.set(pick(view))
		Object.assign(view, pick(theirs))
		last = JSON.stringify(pick(view))
		onTheirs()
	})
	return {
		shared() {
			const now = JSON.stringify(pick(view))
			if (now === last) return
			last = now
			state.set(pick(view))
		},
		stop: () => state.stop(),
	}
}
