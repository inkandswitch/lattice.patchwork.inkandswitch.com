// a terminal on a canvas: whatever `latticex <this doc's url>` is sharing
// from someone's computer. nothing is stored in the doc. latticex sends the
// screen as ephemeral messages on it, and keys typed here go back the same
// way (see latticex/README.md for what the messages are)

import {stylesheet} from "../wm/ui/stylesheet.js"

const STYLESHEET = new URL("./terminal.css", import.meta.url).href
// ask again this often while there's no screen, or it's gone quiet
const HELLO_EVERY = 2000
// latticex says it's there every 2s: three missed and it's gone
const LOST_AFTER = 7000
const LINE_HEIGHT = 1.25
const MAX_FONT_SIZE = 14
const PAD = 8
// history is asked for this many lines at a time
const HISTORY_CHUNK = 200

// how a run looks (latticex/screen.js)
const BOLD = 1
const ITALIC = 2
const UNDERLINE = 4
const INVERSE = 8
const DIM = 16
const STRIKE = 32
const INVISIBLE = 64
const WIDE = 128
const RGB = 0x1000000

// one dark / one light, for when the theme doesn't say
const FALLBACK = {
	dark: ["#3f4451", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf"],
	light: ["#383a42", "#e45649", "#50a14f", "#c18401", "#4078f2", "#a626a4", "#0184bc", "#a0a1a7"],
}
// the six colours a lattice theme names, in ansi order
const NAMED = ["red", "green", "yellow", "blue", "purple", "cyan"]

function hex(rgb) {
	return `#${rgb.toString(16).padStart(6, "0")}`
}

// the xterm 256: 16 from the theme, a 6×6×6 cube, then 24 greys
function palette(element) {
	const style = getComputedStyle(element)
	const read = name => style.getPropertyValue(name).trim()
	const dark = style.colorScheme.includes("dark")
	const base = [...FALLBACK[dark ? "dark" : "light"]]
	NAMED.forEach((name, i) => (base[i + 1] = read(`--lattice-${name}`) || base[i + 1]))
	const ink = read("--lattice-ink")
	const faint = read("--lattice-ink-faint")
	if (ink && faint) {
		if (dark) base[7] = ink
		else base[0] = ink
	}
	const bright = base.map((colour, i) =>
		i === 0 ? faint || colour : i === 7 ? read("--studio-line") || colour : colour,
	)
	const colours = [...base, ...bright]
	const steps = [0, 95, 135, 175, 215, 255]
	for (let i = 0; i < 216; i++) {
		const r = steps[Math.floor(i / 36)]
		const g = steps[Math.floor(i / 6) % 6]
		const b = steps[i % 6]
		colours.push(hex((r << 16) | (g << 8) | b))
	}
	for (let i = 0; i < 24; i++) {
		const v = 8 + i * 10
		colours.push(hex((v << 16) | (v << 8) | v))
	}
	return {
		colours,
		fg: read("--text-editor-line") || read("--studio-line") || (dark ? "#abb2bf" : "#383a42"),
		bg: read("--text-editor-fill") || read("--studio-fill") || (dark ? "#282c34" : "#fafafa"),
		cursor:
			read("--text-editor-cursor-fill") || read("--studio-primary") || (dark ? "#528bff" : "#526fff"),
		family: read("--studio-family-code") || "ui-monospace, Menlo, monospace",
	}
}

function colourOf(colour, colours, fallback) {
	if (colour < 0) return fallback
	if (colour >= RGB) return hex(colour & 0xffffff)
	return colours[colour] ?? fallback
}

// a key pressed here, as latticex input (latticex/keys.js): text, or a key
const NAMED_KEYS = {
	Enter: "enter",
	Tab: "tab",
	Escape: "esc",
	Backspace: "backspace",
	Delete: "delete",
	Insert: "insert",
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
	Home: "home",
	End: "end",
	PageUp: "pageup",
	PageDown: "pagedown",
}
function inputFor(event) {
	const mods = (event.ctrlKey ? "C-" : "") + (event.altKey ? "M-" : "")
	const named = NAMED_KEYS[event.key] ?? (/^F([1-9]|1[0-2])$/.test(event.key) && event.key.toLowerCase())
	if (named) return {key: mods + (event.shiftKey ? "S-" : "") + named}
	if (event.key.length !== 1 && !/^Key[A-Z]$/.test(event.code)) return null
	// alt on a mac types å for a: send the a
	if (event.altKey && /^Key[A-Z]$/.test(event.code)) {
		const letter = event.code.slice(3)
		return {key: mods + (event.shiftKey ? letter : letter.toLowerCase())}
	}
	if (event.ctrlKey) return {key: mods + event.key}
	return event.key
}

export default function LatticexTerminalTool(handle, element) {
	const root = document.createElement("div")
	root.className = "latticex-terminal"
	const link = stylesheet(STYLESHEET, root)
	element.appendChild(link)
	root.innerHTML = `
		<div class="latticex-status">
			<span class="latticex-dot"></span>
			<span class="latticex-state"></span>
		</div>
		<div class="latticex-screen">
			<canvas tabindex="0"></canvas>
			<div class="latticex-waiting">
				<p class="latticex-waiting-what"></p>
				<button class="latticex-command" title="click to copy"></button>
				<p class="latticex-waiting-note">
					run it in a terminal to share that terminal here. anyone with
					this doc's url can see it and type into it.
				</p>
			</div>
		</div>`
	element.appendChild(root)

	const state = root.querySelector(".latticex-state")
	const screenBox = root.querySelector(".latticex-screen")
	const canvas = root.querySelector("canvas")
	const waiting = root.querySelector(".latticex-waiting")
	const waitingWhat = root.querySelector(".latticex-waiting-what")
	const commandButton = root.querySelector(".latticex-command")
	const context = canvas.getContext("2d")

	const command = `latticex ${handle.url} zsh`
	commandButton.textContent = command
	commandButton.addEventListener("click", () => {
		navigator.clipboard?.writeText(command)
		commandButton.dataset.copied = ""
		setTimeout(() => delete commandButton.dataset.copied, 1200)
	})

	// what latticex last sent, kept whole
	let screen = null
	// waiting | live | lost | ended
	let status = "waiting"
	let exitStatus = null
	let lastHeard = 0
	let lastHello = 0

	// scrolled back: the line at the top of the view, as latticex numbers
	// them (the screen's top row is screen.top), or null to follow the screen.
	// each viewer scrolls on its own
	let viewTop = null
	// history lines latticex has sent, for this host and epoch
	const history = new Map()
	let historyOf = ""
	// chunk start → when it was asked for
	const asked = new Map()
	let wanting = false

	const scrollable = () =>
		Boolean(screen && Number.isInteger(screen.top) && screen.history > 0 && !screen.alternate)
	const firstLine = () => screen.top - screen.history

	function scrollTo(line) {
		viewTop = !scrollable() || line >= screen.top ? null : Math.max(firstLine(), line)
		setStatus(status)
		draw()
	}
	const scrollBy = lines => scrollTo((viewTop ?? screen.top) + lines)

	// a new latticex, or one that's started counting again, has other lines
	function keepHistory() {
		const of = `${screen.host} ${screen.epoch}`
		if (of !== historyOf) {
			historyOf = of
			history.clear()
			asked.clear()
			viewTop = null
			return
		}
		if (!scrollable()) viewTop = null
		else if (viewTop != null) viewTop = Math.max(firstLine(), viewTop)
		for (const line of history.keys()) if (line < firstLine()) history.delete(line)
	}

	function askHistory(start, end) {
		const now = Date.now()
		// and a chunk above, ready for scrolling further
		for (let chunk = Math.floor(start / HISTORY_CHUNK - 1) * HISTORY_CHUNK; chunk < end; chunk += HISTORY_CHUNK) {
			const from = Math.max(chunk, firstLine())
			const to = Math.min(chunk + HISTORY_CHUNK, screen.top)
			if (from >= to || now - (asked.get(chunk) ?? 0) < 1000) continue
			asked.set(chunk, now)
			handle.broadcast({latticex: "need-history", from: viewer, epoch: screen.epoch, start: from, end: to})
		}
	}

	function onHistory(message) {
		if (message.to !== viewer || message.host !== screen?.host || message.epoch !== screen.epoch) return
		if (!Array.isArray(message.lines) || !Number.isInteger(message.start)) return
		message.lines.forEach((runs, i) => history.set(message.start + i, runs))
		if (viewTop != null) draw()
	}

	function hello() {
		lastHello = Date.now()
		handle.broadcast({latticex: "hello"})
	}

	function setStatus(next) {
		status = next
		root.dataset.status = status
		const size = screen ? `${screen.cols}×${screen.rows}` : ""
		const title = screen?.title || "terminal"
		const back = viewTop == null ? "" : ` · ${screen.top - viewTop} lines back`
		state.textContent = {
			waiting: "waiting for latticex",
			live: `${title} · ${size}${screen?.readonly ? " · read only" : ""}${back}`,
			lost: `${title} · latticex went quiet${back}`,
			ended: `${title} · ended${exitStatus == null ? "" : ` (status ${exitStatus})`}${back}`,
		}[status]
		waiting.hidden = status === "live" || status === "lost"
		waitingWhat.textContent =
			status === "ended" ? "that program ended. to share another:" : "nothing's shared here yet. run:"
	}

	// ephemeral messages can arrive out of order: a change that comes early
	// waits here for the ones before it, and only a gap that stays a gap asks
	// for the whole screen again
	const early = new Map()
	let gapTimer = null

	function apply(message) {
		for (const [y, runs] of Object.entries(message.lines)) screen.lines[y] = runs
		Object.assign(screen, {
			seq: message.seq,
			cursor: message.cursor,
			title: message.title,
			modes: message.modes,
			readonly: message.readonly,
			top: message.top,
			history: message.history,
			epoch: message.epoch,
			alternate: message.alternate,
		})
	}

	function catchUp(behind) {
		while (early.has(screen.seq + 1)) {
			apply(early.get(screen.seq + 1))
			early.delete(screen.seq)
		}
		for (const seq of early.keys()) if (seq <= screen.seq) early.delete(seq)
		clearTimeout(gapTimer)
		gapTimer = null
		if (early.size || behind > screen.seq) {
			gapTimer = setTimeout(() => {
				gapTimer = null
				hello()
			}, 400)
		}
	}

	function onScreen(message) {
		if (message.host !== screen?.host) {
			if (!message.full) return hello()
			// a new latticex: it counts what's typed from 1 again
			typedCount = 0
			early.clear()
		} else if (message.seq <= screen.seq) {
			return
		}
		if (message.full) {
			screen = {...message, lines: Array.from({length: message.rows}, (_, y) => message.lines[y] ?? [])}
		} else if (message.seq === screen.seq + 1) {
			apply(message)
		} else {
			early.set(message.seq, message)
		}
		catchUp()
		keepHistory()
		lastHeard = Date.now()
		setStatus("live")
		draw()
	}

	function onMessage({message}) {
		if (!message || typeof message !== "object") return
		if (message.latticex === "screen") {
			onScreen(message)
		} else if (message.latticex === "history") {
			onHistory(message)
		} else if (message.latticex === "alive") {
			if (message.host !== screen?.host) return hello()
			lastHeard = Date.now()
			if (status !== "live") setStatus("live")
			if (message.seq > screen.seq && !gapTimer) catchUp(message.seq)
		} else if (message.latticex === "exit" && message.host === screen?.host) {
			exitStatus = message.status
			setStatus("ended")
			draw()
		}
	}

	// ── drawing ──────────────────────────────────────────────────────────

	let frameRequest = null
	// a row's height as last drawn, for turning a wheel's pixels into rows
	let rowHeight = 16
	function draw() {
		frameRequest ??= requestAnimationFrame(paint)
	}

	function paint() {
		frameRequest = null
		const theme = palette(root)
		const ratio = devicePixelRatio || 1
		if (!screen) {
			canvas.width = canvas.height = 0
			return
		}
		const {cols, rows} = screen
		// as big as fits, up to MAX_FONT_SIZE
		context.font = `100px ${theme.family}`
		const advance = context.measureText("M").width / 100
		const room = {
			width: screenBox.clientWidth - PAD * 2,
			height: screenBox.clientHeight - PAD * 2,
		}
		const size = Math.max(
			4,
			Math.min(MAX_FONT_SIZE, room.width / (cols * advance), room.height / (rows * LINE_HEIGHT)),
		)
		const cellWidth = size * advance
		const cellHeight = Math.ceil(size * LINE_HEIGHT)
		rowHeight = cellHeight
		const width = Math.ceil(cols * cellWidth)
		const height = rows * cellHeight
		canvas.style.width = `${width}px`
		canvas.style.height = `${height}px`
		canvas.width = Math.round(width * ratio)
		canvas.height = Math.round(height * ratio)
		context.setTransform(ratio, 0, 0, ratio, 0, 0)
		context.fillStyle = theme.bg
		context.fillRect(0, 0, width, height)
		context.textBaseline = "middle"

		const cursor = screen.cursor
		const focused = document.activeElement === canvas
		// scrolled back, the screen's rows are further down the view
		const down = viewTop == null ? 0 : screen.top - viewTop
		const cursorRow = cursor ? cursor.y + down : -1
		const showCursor = cursor?.visible && status === "live" && cursorRow >= 0 && cursorRow < rows
		let missing = null
		for (let y = 0; y < rows; y++) {
			let runs
			if (y >= down) {
				runs = screen.lines[y - down] ?? []
			} else {
				const line = viewTop + y
				runs = history.get(line)
				if (!runs) {
					missing ??= [line, line + 1]
					missing[1] = line + 1
					runs = []
				}
			}
			const top = y * cellHeight
			for (const [x, text, fgColour, bgColour, look] of runs) {
				let fg = colourOf(fgColour, theme.colours, theme.fg)
				let bg = colourOf(bgColour, theme.colours, null)
				if (look & INVERSE) [fg, bg] = [bg ?? theme.bg, fg]
				const chars = look & WIDE ? [text] : Array.from(text)
				const span = look & WIDE ? 2 : chars.length
				if (bg) {
					context.fillStyle = bg
					context.fillRect(x * cellWidth, top, span * cellWidth + 0.5, cellHeight)
				}
				if (look & INVISIBLE) continue
				context.font = `${look & ITALIC ? "italic " : ""}${look & BOLD ? "bold " : ""}${size}px ${theme.family}`
				context.fillStyle = fg
				context.globalAlpha = look & DIM ? 0.6 : 1
				chars.forEach((char, i) => {
					if (char !== " ") context.fillText(char, (x + i) * cellWidth, top + cellHeight / 2)
				})
				if (look & UNDERLINE) context.fillRect(x * cellWidth, top + cellHeight - 2, span * cellWidth, 1)
				if (look & STRIKE) context.fillRect(x * cellWidth, top + cellHeight / 2, span * cellWidth, 1)
				context.globalAlpha = 1
			}
		}
		wanting = Boolean(missing)
		if (missing) askHistory(...missing)
		if (showCursor) {
			const left = cursor.x * cellWidth
			const top = cursorRow * cellHeight
			context.fillStyle = context.strokeStyle = theme.cursor
			if (focused) {
				context.globalAlpha = 0.5
				context.fillRect(left, top, cellWidth, cellHeight)
				context.globalAlpha = 1
			} else {
				context.lineWidth = 1
				context.strokeRect(left + 0.5, top + 0.5, cellWidth - 1, cellHeight - 1)
			}
		}
	}

	// ── typing ───────────────────────────────────────────────────────────

	// numbered, so latticex can type them in order however they arrive. keys
	// pressed close together go as one message
	const viewer = crypto.randomUUID()
	let typedCount = 0
	let typing = []
	let typingTimer = null
	function send(input) {
		if (status !== "live" || screen?.readonly) return
		// typing goes back to the screen, as a terminal does
		if (viewTop != null) scrollTo(screen.top)
		typing.push(input)
		typingTimer ??= setTimeout(() => {
			typingTimer = null
			handle.broadcast({latticex: "keys", from: viewer, n: ++typedCount, input: typing})
			typing = []
		}, 8)
	}

	function onKeyDown(event) {
		// ⌘ is the browser's (⌘v pastes, below)
		if (event.metaKey || event.isComposing) return
		// shift-page up and down scroll back here, as a terminal's do
		if (event.shiftKey && (event.key === "PageUp" || event.key === "PageDown") && scrollable()) {
			event.preventDefault()
			const page = Math.max(1, screen.rows - 1)
			scrollBy(event.key === "PageUp" ? -page : page)
			return
		}
		const input = inputFor(event)
		if (input == null) return
		event.preventDefault()
		send(input)
	}

	function onPaste(event) {
		const text = event.clipboardData?.getData("text/plain")
		if (!text) return
		event.preventDefault()
		send({paste: text})
	}

	// the wheel scrolls back through history. a program with the whole screen
	// (vim, less) has none, so there it's the arrow keys, as most terminals do
	let wheelRows = 0
	function onWheel(event) {
		if (!screen || status === "waiting") return
		const alternate = screen.alternate && status === "live" && !screen.readonly
		if (!alternate && !scrollable()) return
		event.preventDefault()
		wheelRows +=
			event.deltaMode === 1
				? event.deltaY
				: event.deltaMode === 2
					? event.deltaY * screen.rows
					: event.deltaY / rowHeight
		const rows = Math.trunc(wheelRows)
		if (!rows) return
		wheelRows -= rows
		if (!alternate) return scrollBy(rows)
		const key = {key: rows < 0 ? "up" : "down"}
		for (let i = 0; i < Math.min(Math.abs(rows), screen.rows); i++) send(key)
	}

	canvas.addEventListener("keydown", onKeyDown)
	screenBox.addEventListener("wheel", onWheel, {passive: false})
	canvas.addEventListener("paste", onPaste)
	canvas.addEventListener("focus", draw)
	canvas.addEventListener("blur", draw)
	screenBox.addEventListener("pointerdown", () => canvas.focus())

	// ── keeping up ───────────────────────────────────────────────────────

	handle.on("ephemeral-message", onMessage)
	const ticker = setInterval(() => {
		const quiet = Date.now() - lastHeard
		if (status === "live" && quiet > LOST_AFTER) setStatus("lost")
		if ((status === "waiting" || status === "lost") && Date.now() - lastHello >= HELLO_EVERY) hello()
		// history that was asked for and hasn't come is asked for again
		if (wanting && viewTop != null) draw()
	}, 500)
	const resizeObserver = new ResizeObserver(draw)
	resizeObserver.observe(screenBox)
	// the theme can change under us
	const schemeQuery = matchMedia("(prefers-color-scheme: dark)")
	schemeQuery.addEventListener("change", draw)

	setStatus("waiting")
	hello()

	return () => {
		handle.off("ephemeral-message", onMessage)
		clearInterval(ticker)
		clearTimeout(gapTimer)
		clearTimeout(typingTimer)
		if (frameRequest) cancelAnimationFrame(frameRequest)
		resizeObserver.disconnect()
		schemeQuery.removeEventListener("change", draw)
		root.remove()
		link.remove()
	}
}
