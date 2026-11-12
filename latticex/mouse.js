// a viewer's mouse, as the bytes the program asked for. a program turns on
// mouse reporting (tmux, claude, vim's mouse=a) with an escape the
// terminal's own xterm reads, and xterm's mouse code knows what each kind
// reports (x10 presses, vt200 releases too, drag and any movement as well)
// and how each encoding says it. it says it as data, as if to send it:
// caught here instead.
//
// an event is {action, button, x, y, ctrl, alt, shift}: action is down, up,
// move, wheelup or wheeldown; button 0 left, 1 middle, 2 right (none, for a
// move with nothing held); x and y the cell, from 0
const BUTTON = {0: 0, 1: 1, 2: 2}
const NONE = 3
const WHEEL = 4
const ACTION = {up: 0, down: 1, move: 32}

export function mouse(term) {
	let caught = null
	term.onData(data => caught?.push(Buffer.from(data, "utf8")))
	// the oldest encoding is bytes, not text: past column 95 they're past 127
	term.onBinary(data => caught?.push(Buffer.from(data, "latin1")))

	/** the bytes for event, or an empty buffer if the program doesn't want it */
	return function encode(event) {
		// not in the public api
		const service = term._core?.coreMouseService
		if (!service || term.modes.mouseTrackingMode === "none") return Buffer.alloc(0)
		const {action, x, y} = event ?? {}
		if (!Number.isInteger(x) || !Number.isInteger(y)) return Buffer.alloc(0)
		let button
		let code
		if (action === "wheelup" || action === "wheeldown") {
			button = WHEEL
			code = action === "wheelup" ? ACTION.up : ACTION.down
		} else if (action in ACTION) {
			button = BUTTON[event.button] ?? NONE
			code = ACTION[action]
		} else {
			return Buffer.alloc(0)
		}
		caught = []
		try {
			service.triggerMouseEvent({
				col: x,
				row: y,
				x,
				y,
				button,
				action: code,
				ctrl: Boolean(event.ctrl),
				alt: Boolean(event.alt),
				shift: Boolean(event.shift),
			})
			return Buffer.concat(caught)
		} finally {
			caught = null
		}
	}
}
