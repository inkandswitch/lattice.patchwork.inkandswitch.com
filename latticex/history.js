// history: what's scrolled off the top of a terminal's screen. its lines are
// numbered, so a viewer can ask for them and keep them: the screen's top row
// is `top()`, the line above it top() - 1, and so on, back to
// top() - count(). a marker on the newest line of the scrollback follows the
// numbering as the buffer scrolls. if the marker's gone (scrolled out of the
// scrollback between marks, or the scrollback cleared) or the lines are
// rewrapped (`forget()`, on a resize), the count starts again, in a new
// `epoch`: what a viewer has kept from the last one is no good
export function history(term) {
	let epoch = 0
	// {marker, number}: the marked line, and what it's numbered
	let mark = null

	function top() {
		if (!mark || mark.marker.isDisposed) return null
		return mark.number + (term.buffer.normal.baseY - mark.marker.line)
	}

	return {
		top,
		get epoch() {
			return epoch
		},
		/** how many lines there are above the screen */
		count() {
			return term.buffer.normal.baseY
		},
		/** moves the marker up to the top row: often enough that it isn't
		 * scrolled out of the scrollback before the next time */
		mark() {
			// a marker goes on the active buffer: the normal one's left alone
			// while a program has the alternate screen up
			if (term.buffer.active.type !== "normal") return
			const normal = term.buffer.normal
			let at = top()
			if (at == null) {
				epoch++
				at = normal.baseY
			}
			mark?.marker.dispose()
			// the line above the screen, if there is one: erasing the screen
			// (`clear`, ctrl-l) gets rid of markers on it, not on the scrollback
			const above = normal.baseY > 0 ? 1 : 0
			const marker = term.registerMarker(-normal.cursorY - above)
			mark = marker ? {marker, number: at - above} : null
		},
		forget() {
			mark?.marker.dispose()
			mark = null
		},
		/** lines start to end (numbered as above) that are still there, as
		 * [first, buffer lines]: first is null if there are none */
		lines(start, end, max = Infinity) {
			const at = top()
			if (at == null) return [null, []]
			const normal = term.buffer.normal
			const first = at - normal.baseY
			const begin = Math.max(start, first, end - max)
			const stop = Math.min(end, at)
			if (begin >= stop) return [null, []]
			const lines = []
			for (let n = begin; n < stop; n++) lines.push(normal.getLine(n - first))
			return [begin, lines]
		},
	}
}
