// the dev server's way into a tab: a command line here (scripts/page.mjs)
// says what to run, a tab (packages/lattice/page.js) asks for what to run and
// says what came of it. both have the one token, which this checks on every
// request: through `pnpm dev`'s tunnel everything's from 127.0.0.1, so where
// a request's from says nothing. the tab asks by long poll, as the frame asks
// for its changes (vite/frame.ts), since tunnels pass that. the tab's
// requests are "simple" ones, text/plain with the token in the body: a
// preflight from another origin (the site's, with ?dev=) is answered by
// vite's own cors before any plugin's middleware, and turned away
//
//   POST /__lattice-page/run     {tab?, code, timeout?}  → {ok, value | error}
//   GET  /__lattice-page/tabs                            → {tabs}
//   POST /__lattice-page/next    {tab, url, title, focused} → {command} (held)
//   POST /__lattice-page/result  {tab, id, ok, value | error}
import {randomBytes, randomUUID, timingSafeEqual} from "node:crypto"
import {chmodSync, existsSync, readFileSync, writeFileSync} from "node:fs"

const PREFIX = "/__lattice-page/"
// the most a request's body can be: a file's content, going in or out
const MAX_BODY = 32 * 1024 * 1024
// a tab not heard from in this long is gone (one asks again within `hold`)
const GONE_AFTER = 60_000

/**
 * the token in `file`, made (and kept to its owner) the first time. kept
 * after: a tab given it once goes on working when the server starts again.
 * a new one is the file deleted
 */
export function pageToken(file) {
	if (existsSync(file)) {
		try {
			const kept = JSON.parse(readFileSync(file, "utf8"))
			if (typeof kept?.token === "string" && kept.token.length >= 32) return kept
		} catch {}
	}
	const kept = {token: randomBytes(24).toString("hex")}
	writeFileSync(file, JSON.stringify(kept, null, "\t"), {mode: 0o600})
	chmodSync(file, 0o600)
	return kept
}

function send(response, status, value) {
	if (response.writableEnded) return
	response.statusCode = status
	response.setHeader("Cache-Control", "no-store")
	response.setHeader("Content-Type", "application/json")
	response.end(JSON.stringify(value))
}

function body(request) {
	return new Promise((resolve, reject) => {
		const chunks = []
		let size = 0
		request.on("data", chunk => {
			size += chunk.length
			if (size > MAX_BODY) {
				reject(new Error("too big"))
				request.destroy()
			} else chunks.push(chunk)
		})
		request.on("end", () => {
			try {
				resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {})
			} catch (error) {
				reject(error)
			}
		})
		request.on("error", reject)
	})
}

/**
 * connect middleware for /__lattice-page/*, which is a 404 to anyone without
 * `token`. `hold`: how long a tab's asking is held with nothing to give it,
 * under the 100s a cloudflare tunnel waits. `.close()` lets them all go
 */
export function createBridge({token, hold = 25_000}) {
	const expected = Buffer.from(`Bearer ${token}`)
	// id → {id, url, title, focused, seen, waiting: answer | null, queue}
	const tabs = new Map()
	// a command's id → its run's answer
	const pending = new Map()

	// the command line says it in a header, the tab in what it sends
	const allowed = (request, sent) => {
		const said = request.headers.authorization ?? (typeof sent?.token === "string" ? `Bearer ${sent.token}` : "")
		const given = Buffer.from(String(said))
		return given.length === expected.length && timingSafeEqual(given, expected)
	}

	const alive = () => {
		const now = Date.now()
		for (const [id, tab] of tabs) if (!tab.waiting && now - tab.seen > GONE_AFTER) tabs.delete(id)
		return [...tabs.values()]
	}

	// the tab asked for: or the focused one, or the last heard from
	function pick(id) {
		const all = alive()
		if (id) return tabs.get(id) ?? null
		return (
			all.filter(tab => tab.focused).sort((a, b) => b.seen - a.seen)[0] ??
			all.sort((a, b) => b.seen - a.seen)[0] ??
			null
		)
	}

	function give(tab) {
		if (!tab.waiting || !tab.queue.length) return
		const answer = tab.waiting
		tab.waiting = null
		answer(tab.queue.shift())
	}

	async function run(sent, response) {
		const {tab: wanted, code, timeout = 10_000} = sent
		if (typeof code !== "string") return send(response, 400, {ok: false, error: "no code"})
		const tab = pick(wanted)
		if (!tab) {
			return send(response, 409, {
				ok: false,
				error: wanted
					? `no tab ${wanted} (pnpm page tabs says which there are)`
					: "no tab's asking: open the one from `pnpm page link`",
			})
		}
		const command = {id: randomUUID(), code}
		const ms = Math.max(100, Math.min(Number(timeout) || 10_000, 10 * 60_000))
		const answered = new Promise(resolve => {
			const timer = setTimeout(() => {
				pending.delete(command.id)
				const at = tab.queue.indexOf(command)
				if (at >= 0) tab.queue.splice(at, 1)
				resolve({status: 504, value: {ok: false, error: `tab ${tab.id} didn't answer in ${ms}ms`}})
			}, ms)
			pending.set(command.id, value => {
				clearTimeout(timer)
				pending.delete(command.id)
				resolve({status: 200, value})
			})
		})
		// the asker gave up: so does this
		response.on("close", () => pending.get(command.id) && pending.delete(command.id))
		tab.queue.push(command)
		give(tab)
		const {status, value} = await answered
		send(response, status, value)
	}

	async function next(sent, response) {
		const {tab: id, url, title, focused} = sent
		if (typeof id !== "string" || !id) return send(response, 400, {error: "no tab"})
		const tab = tabs.get(id) ?? {id, queue: [], waiting: null}
		tabs.set(id, Object.assign(tab, {url, title, focused: !!focused, seen: Date.now()}))
		// it's asking again, so whatever asked before has gone
		tab.waiting?.(null)
		let timer
		const answer = command => {
			clearTimeout(timer)
			if (tab.waiting === answer) tab.waiting = null
			tab.seen = Date.now()
			if (response.writableEnded || response.destroyed) {
				// it went before it could be given this: the next one is
				if (command) tab.queue.unshift(command)
				return
			}
			send(response, 200, {command})
		}
		tab.waiting = answer
		timer = setTimeout(() => answer(null), hold)
		response.on("close", () => {
			clearTimeout(timer)
			if (tab.waiting === answer) tab.waiting = null
		})
		give(tab)
	}

	function result(sent, response) {
		const {id, ok, value, error, stack} = sent
		pending.get(id)?.(ok ? {ok: true, value} : {ok: false, error, ...(stack ? {stack} : {})})
		send(response, 200, {})
	}

	function tabsList(response) {
		const now = Date.now()
		send(response, 200, {
			tabs: alive().map(({id, url, title, focused, seen}) => ({id, url, title, focused, ago: now - seen})),
		})
	}

	const routes = {
		"POST run": run,
		"GET tabs": (_, response) => tabsList(response),
		"POST next": next,
		"POST result": result,
	}

	function bridge(request, response, next) {
		const path = (request.url ?? "/").split("?")[0]
		if (!path.startsWith(PREFIX)) return next()
		response.setHeader("Access-Control-Allow-Origin", "*")
		const route = routes[`${request.method} ${path.slice(PREFIX.length)}`]
		const missing = () => {
			response.statusCode = 404
			response.end()
		}
		if (!route) return missing()
		;(async () => {
			const sent = request.method === "POST" ? await body(request) : {}
			if (!allowed(request, sent)) return missing()
			await route(sent, response)
		})().catch(error => send(response, 400, {ok: false, error: String(error?.message ?? error)}))
	}

	bridge.close = () => {
		for (const tab of tabs.values()) tab.waiting?.(null)
	}
	return bridge
}
