#!/usr/bin/env node
// latticex: one program on a pty here, shared over an automerge doc's
// ephemeral channel. the doc itself is never written to: the screen goes out
// as messages, seen live and stored nowhere, and keys come back the same way.
// anyone with the doc's url can see the program and type into it.
//
//   latticex [--readonly] [--size COLSxROWS] [-q] <url> [cmd args...]
//   latticex look <url>
//   latticex type [--look] <url> <text...>
//
// see README.md
import {Repo, initSubduction, isValidAutomergeUrl} from "@automerge/automerge-repo"
import xterm from "@xterm/headless"
import pty from "node-pty"
import {parseArgs} from "node:util"
import {randomUUID} from "node:crypto"
import {accessSync, chmodSync, constants, existsSync} from "node:fs"
import {createRequire} from "node:module"
import {dirname, join} from "node:path"
import {encodeInput, parseTyped} from "./keys.js"
import {rowRuns, screenText} from "./screen.js"

const SERVER = "wss://subduction.sync.inkandswitch.com"
// how long after the screen changes it's sent: a burst of output is one frame
const FRAME_DELAY = 30
// how often a host says it's still there, with the seq it's up to
const ALIVE_EVERY = 2000

const USAGE = `latticex: share a program on a pty over an automerge doc

  latticex [options] <url> [cmd args...]   share cmd (default: $SHELL)
      --readonly          viewers see it, only this terminal types into it
      --size COLSxROWS    the size when there's no terminal here (100x30)
      --server URL        the subduction server (${SERVER})
      -q, --quiet         say nothing before the program starts

  latticex look <url>                      print the screen as text
  latticex type [--look] <url> <text...>   type into it
      text is typed as it is; <enter> <tab> <esc> <backspace> <up> <down>
      <left> <right> <home> <end> <pageup> <pagedown> <f1>…<f12> and
      <C-c> <M-b> <S-tab> (ctrl, alt, shift) are keys
      --look              print the screen after (--wait ms later, 400)

anyone with the url can see the program and type into it`

function fail(message) {
	console.error(`latticex: ${message}`)
	process.exit(1)
}

async function open(url, server, role) {
	if (!isValidAutomergeUrl(url)) fail(`${url} isn't an automerge url`)
	await initSubduction()
	const repo = new Repo({
		subductionWebsocketEndpoints: [server],
		peerId: `latticex-${role}-${randomUUID().slice(0, 8)}`,
	})
	const timeout = setTimeout(() => fail(`couldn't find ${url} on ${server}`), 20000)
	const handle = await repo.find(url).catch(error => fail(`couldn't find ${url}: ${error.message}`))
	clearTimeout(timeout)
	return handle
}

function messages(handle, on) {
	handle.on("ephemeral-message", ({message}) => {
		if (message && typeof message === "object" && typeof message.latticex === "string") on(message)
	})
}

// ── sharing ──────────────────────────────────────────────────────────────

// node-pty's prebuilt spawn-helper is packed without its executable bit, and
// nothing in its install sets it, so spawning fails with "posix_spawnp failed"
function makeSpawnHelperExecutable() {
	const nodePty = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"))
	const helper = join(nodePty, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper")
	if (!existsSync(helper)) return
	try {
		accessSync(helper, constants.X_OK)
	} catch {
		chmodSync(helper, 0o755)
	}
}

async function share(url, command, {server, readonly, size, quiet}) {
	const handle = await open(url, server, "host")
	const local = Boolean(process.stdin.isTTY && process.stdout.isTTY)
	let [cols, rows] = local ? [process.stdout.columns, process.stdout.rows] : size
	const term = new xterm.Terminal({cols, rows, scrollback: 0, allowProposedApi: true})
	let program
	try {
		makeSpawnHelperExecutable()
		program = pty.spawn(command[0], command.slice(1), {
			name: "xterm-256color",
			cols,
			rows,
			cwd: process.cwd(),
			env: {...process.env, TERM: "xterm-256color", LATTICEX_URL: url},
		})
	} catch (error) {
		fail(`couldn't start ${command.join(" ")}: ${error.message}`)
	}

	if (!quiet) {
		console.error(`latticex: sharing ${command.join(" ")} on ${url}`)
		console.error(
			readonly
				? "latticex: anyone with the url can see it (--readonly: only you type)"
				: "latticex: anyone with the url can see it and type into it",
		)
	}

	const host = randomUUID().slice(0, 8)
	const cell = term.buffer.active.getNullCell()
	let seq = 0
	let sent = []
	let sentRest = ""
	let title = ""
	let timer = null
	let full = true

	function frame() {
		timer = null
		const buffer = term.buffer.active
		const lines = {}
		let changed = false
		for (let y = 0; y < rows; y++) {
			const runs = rowRuns(buffer.getLine(buffer.viewportY + y), cols, cell)
			const key = JSON.stringify(runs)
			if (full || sent[y] !== key) {
				lines[y] = runs
				sent[y] = key
				changed = true
			}
		}
		const cursor = {
			x: buffer.cursorX,
			y: buffer.baseY + buffer.cursorY - buffer.viewportY,
			// not in the public api; shown unless it says otherwise
			visible: !term._core?.coreService?.isCursorHidden,
		}
		const modes = {
			applicationCursorKeysMode: term.modes.applicationCursorKeysMode,
			bracketedPasteMode: term.modes.bracketedPasteMode,
		}
		const rest = JSON.stringify([cursor, title, modes])
		if (!full && !changed && rest === sentRest) return
		sentRest = rest
		handle.broadcast({
			latticex: "screen",
			host,
			seq: ++seq,
			full,
			cols,
			rows,
			lines,
			cursor,
			title,
			readonly,
			modes,
		})
		full = false
	}

	function schedule(wantFull = false) {
		if (wantFull) full = true
		timer ??= setTimeout(frame, FRAME_DELAY)
	}

	term.onTitleChange(next => {
		title = next
		schedule()
	})

	program.onData(data => {
		if (local) process.stdout.write(data)
		term.write(data, () => schedule())
	})

	function typeInput(input) {
		const bytes = encodeInput(input, term.modes)
		if (bytes) program.write(bytes)
	}

	// ephemeral messages can arrive out of order, so each viewer numbers what
	// it types (from 1, for each host it sees) and it's typed in that order.
	// one that never comes isn't waited for long
	const viewers = new Map()
	function typed({from, n, input}) {
		if (typeof from !== "string" || !Number.isInteger(n)) return typeInput(input)
		let viewer = viewers.get(from)
		if (!viewer) viewers.set(from, (viewer = {next: 1, waiting: new Map(), timer: null}))
		if (n < viewer.next) return
		viewer.waiting.set(n, input)
		flushTyped(viewer)
	}
	function flushTyped(viewer) {
		clearTimeout(viewer.timer)
		viewer.timer = null
		while (viewer.waiting.has(viewer.next)) {
			typeInput(viewer.waiting.get(viewer.next))
			viewer.waiting.delete(viewer.next++)
		}
		if (!viewer.waiting.size) return
		viewer.timer = setTimeout(() => {
			viewer.next = Math.min(...viewer.waiting.keys())
			flushTyped(viewer)
		}, 500)
	}

	messages(handle, message => {
		if (message.latticex === "hello") schedule(true)
		if (message.latticex === "keys" && !readonly) typed(message)
	})

	const alive = setInterval(() => handle.broadcast({latticex: "alive", host, seq}), ALIVE_EVERY)

	function resize(nextCols, nextRows) {
		cols = nextCols
		rows = nextRows
		program.resize(cols, rows)
		term.resize(cols, rows)
		sent = []
		schedule(true)
	}

	if (local) {
		process.stdin.setRawMode(true)
		process.stdin.on("data", data => program.write(data.toString()))
		process.stdout.on("resize", () => resize(process.stdout.columns, process.stdout.rows))
	}
	// with no terminal here a signal is for the program; in raw mode ctrl-c
	// is typed into it instead, and a hangup means this terminal went away
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.on(signal, () => program.kill(signal))
	}

	program.onExit(({exitCode, signal}) => {
		clearInterval(alive)
		clearTimeout(timer)
		frame()
		const status = signal ? 128 + signal : exitCode
		handle.broadcast({latticex: "exit", host, status})
		if (local) process.stdin.setRawMode(false)
		// time for the last messages to reach the server
		setTimeout(() => process.exit(status), 500)
	})
}

// ── looking and typing ───────────────────────────────────────────────────

// the next whole screen whoever's sharing on handle sends
function fullScreen(handle, timeout) {
	return new Promise(resolve => {
		const hello = () => handle.broadcast({latticex: "hello"})
		const again = setInterval(hello, 1000)
		const giveUp = setTimeout(() => fail("nobody is sharing on this doc (is latticex running?)"), timeout)
		messages(handle, message => {
			if (message.latticex !== "screen" || !message.full) return
			clearInterval(again)
			clearTimeout(giveUp)
			resolve(message)
		})
		hello()
	})
}

function print(screen) {
	const lines = Array.from({length: screen.rows}, (_, y) => screen.lines[y] ?? [])
	const text = screenText(lines, screen.cols)
	while (text.length && !text[text.length - 1]) text.pop()
	console.log(text.join("\n"))
	const {x, y, visible} = screen.cursor
	const where = visible ? `cursor at row ${y + 1}, column ${x + 1}` : "cursor hidden"
	console.error(
		`latticex: ${screen.cols}×${screen.rows}, ${where}${screen.title ? `, ${screen.title}` : ""}${screen.readonly ? ", read only" : ""}`,
	)
}

async function look(url, {server, timeout}) {
	const handle = await open(url, server, "look")
	print(await fullScreen(handle, timeout))
	process.exit(0)
}

async function type(url, text, {server, timeout, look, wait}) {
	const handle = await open(url, server, "type")
	// wait until someone's there to type into
	const screen = await fullScreen(handle, timeout)
	if (screen.readonly) fail("it's shared --readonly: only its own terminal types into it")
	handle.broadcast({latticex: "keys", from: randomUUID(), n: 1, input: parseTyped(text)})
	await new Promise(resolve => setTimeout(resolve, look ? wait : 300))
	if (look) print(await fullScreen(handle, timeout))
	process.exit(0)
}

// ── arguments ────────────────────────────────────────────────────────────

const OPTIONS = {
	readonly: {type: "boolean"},
	size: {type: "string"},
	server: {type: "string"},
	quiet: {type: "boolean", short: "q"},
	look: {type: "boolean"},
	wait: {type: "string"},
	timeout: {type: "string"},
	help: {type: "boolean", short: "h"},
}

const argv = process.argv.slice(2)
const [mode] = argv
if (mode === "look" || mode === "type") {
	const {values, positionals} = parseArgs({args: argv.slice(1), options: OPTIONS, allowPositionals: true})
	const [url, ...text] = positionals
	if (!url) fail(`${mode} needs a url\n\n${USAGE}`)
	const options = {
		server: values.server ?? SERVER,
		timeout: Number(values.timeout ?? 10000),
		look: values.look,
		wait: Number(values.wait ?? 400),
	}
	if (mode === "look") await look(url, options)
	else await type(url, text.join(" "), options)
} else {
	// options, then the url; everything after the url is the program
	const at = argv.findIndex(arg => arg.startsWith("automerge:"))
	const {values, positionals} = parseArgs({
		args: at === -1 ? argv : argv.slice(0, at),
		options: OPTIONS,
		allowPositionals: true,
	})
	if (values.help || at === -1) {
		console.error(USAGE)
		process.exit(values.help ? 0 : 1)
	}
	if (positionals.length) fail(`what's ${positionals.join(" ")}? options go before the url\n\n${USAGE}`)
	let command = argv.slice(at + 1)
	if (command[0] === "--") command = command.slice(1)
	if (!command.length) command = [process.env.SHELL || "/bin/sh"]
	const size = (values.size ?? "100x30").match(/^(\d+)x(\d+)$/)
	if (!size) fail(`--size is COLSxROWS, like 100x30`)
	await share(argv[at], command, {
		server: values.server ?? SERVER,
		readonly: values.readonly,
		size: [Number(size[1]), Number(size[2])],
		quiet: values.quiet,
	})
}
