import {test} from "node:test"
import assert from "node:assert/strict"
import {createServer} from "node:http"
import {mkdtempSync, readFileSync, statSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createBridge, pageToken} from "../vite/page-bridge.js"

const TOKEN = "secret"

async function serve(options = {}) {
	const bridge = createBridge({token: TOKEN, hold: 200, ...options})
	const server = createServer((request, response) =>
		bridge(request, response, () => {
			response.statusCode = 418
			response.end("next")
		}),
	)
	await new Promise(done => server.listen(0, "127.0.0.1", done))
	const base = `http://127.0.0.1:${server.address().port}`
	const call = async (route, body, {token = TOKEN, method = body ? "POST" : "GET"} = {}) => {
		const response = await fetch(`${base}/__lattice-page/${route}`, {
			method,
			headers: {
				...(token ? {authorization: `Bearer ${token}`} : {}),
				...(body ? {"content-type": "application/json"} : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		})
		const text = await response.text()
		let json = null
		try {
			json = JSON.parse(text)
		} catch {}
		return {status: response.status, json, headers: response.headers}
	}
	return {
		base,
		call,
		close: () => {
			bridge.close()
			server.closeAllConnections()
			return new Promise(done => server.close(done))
		},
	}
}

// a tab that answers each command with what `answer` makes of it
function tab(call, id, {focused = false, answer = command => ({ok: true, value: command.code})} = {}) {
	let running = true
	const seen = []
	;(async () => {
		while (running) {
			const {json} = await call("next", {tab: id, url: `http://x/${id}`, title: id, focused})
			const command = json?.command
			if (!command || !running) continue
			seen.push(command)
			await call("result", {tab: id, id: command.id, ...answer(command)})
		}
	})().catch(() => {})
	return {seen, stop: () => (running = false)}
}

test("without the token, or with the wrong one, it isn't there", async () => {
	const {call, close} = await serve()
	try {
		assert.equal((await call("tabs", null, {token: null})).status, 404)
		assert.equal((await call("tabs", null, {token: "nope"})).status, 404)
		assert.equal((await call("next", {tab: "a"}, {token: "nope"})).status, 404)
		assert.equal((await call("tabs")).status, 200)
	} finally {
		await close()
	}
})

test("anything else goes on to the next middleware", async () => {
	const {base, close} = await serve()
	try {
		assert.equal((await fetch(`${base}/packages/lattice/frame.js`)).status, 418)
		assert.equal((await fetch(`${base}/__lattice-pages`)).status, 418)
	} finally {
		await close()
	}
})

test("a tab can say the token in what it sends, as text/plain, so there's no preflight", async () => {
	const {base, close} = await serve()
	try {
		const ask = token =>
			fetch(`${base}/__lattice-page/next`, {
				method: "POST",
				headers: {"content-type": "text/plain"},
				body: JSON.stringify({token, tab: "a", url: "u", title: "t", focused: true}),
			})
		assert.equal((await ask("nope")).status, 404)
		const right = await ask(TOKEN)
		assert.equal(right.status, 200)
		assert.equal(right.headers.get("access-control-allow-origin"), "*")
		assert.deepEqual(await right.json(), {command: null})
	} finally {
		await close()
	}
})

test("a tab asking with nothing to do is told so, once it's waited", async () => {
	const {call, close} = await serve()
	try {
		const started = Date.now()
		const {json} = await call("next", {tab: "a", url: "u", title: "t", focused: true})
		assert.deepEqual(json, {command: null})
		assert.ok(Date.now() - started >= 150)
	} finally {
		await close()
	}
})

test("a command goes to the tab, and its answer comes back", async () => {
	const {call, close} = await serve()
	const a = tab(call, "a", {focused: true})
	try {
		await new Promise(done => setTimeout(done, 20))
		const {status, json} = await call("run", {code: "1 + 1"})
		assert.equal(status, 200)
		assert.deepEqual(json, {ok: true, value: "1 + 1"})
	} finally {
		a.stop()
		await close()
	}
})

test("a command for one tab goes to that one only", async () => {
	const {call, close} = await serve()
	const a = tab(call, "a", {focused: true})
	const b = tab(call, "b")
	try {
		await new Promise(done => setTimeout(done, 20))
		await call("run", {tab: "b", code: "for b"})
		assert.deepEqual(b.seen.map(command => command.code), ["for b"])
		assert.deepEqual(a.seen, [])
	} finally {
		a.stop()
		b.stop()
		await close()
	}
})

test("with no tab said, the focused one", async () => {
	const {call, close} = await serve()
	const a = tab(call, "a")
	const b = tab(call, "b", {focused: true})
	const c = tab(call, "c")
	try {
		await new Promise(done => setTimeout(done, 20))
		await call("run", {code: "which"})
		assert.equal(b.seen.length, 1)
		assert.equal(a.seen.length + c.seen.length, 0)
	} finally {
		a.stop()
		b.stop()
		c.stop()
		await close()
	}
})

test("tabs lists who's asking", async () => {
	const {call, close} = await serve()
	const a = tab(call, "a", {focused: true})
	try {
		await new Promise(done => setTimeout(done, 20))
		const {json} = await call("tabs")
		assert.equal(json.tabs.length, 1)
		assert.equal(json.tabs[0].id, "a")
		assert.equal(json.tabs[0].url, "http://x/a")
		assert.equal(json.tabs[0].focused, true)
	} finally {
		a.stop()
		await close()
	}
})

test("no tab: it says so", async () => {
	const {call, close} = await serve()
	try {
		const {status, json} = await call("run", {code: "x"})
		assert.equal(status, 409)
		assert.equal(json.ok, false)
		assert.match(json.error, /no tab/)
	} finally {
		await close()
	}
})

test("a tab that doesn't answer: a timeout, not a hang", async () => {
	const {call, close} = await serve()
	// takes the command and never says
	call("next", {tab: "a", url: "u", title: "t", focused: true}).catch(() => {})
	try {
		await new Promise(done => setTimeout(done, 20))
		const {status, json} = await call("run", {code: "x", timeout: 100})
		assert.equal(status, 504)
		assert.equal(json.ok, false)
		assert.match(json.error, /didn't answer/)
	} finally {
		await close()
	}
})

test("a tab not asking about is given the command when it next asks", async () => {
	const {call, close} = await serve()
	try {
		// heard from once, then not waiting
		await call("next", {tab: "a", url: "u", title: "t", focused: true})
		const running = call("run", {code: "later"})
		await new Promise(done => setTimeout(done, 20))
		const {json} = await call("next", {tab: "a", url: "u", title: "t", focused: true})
		assert.equal(json.command.code, "later")
		await call("result", {tab: "a", id: json.command.id, ok: true, value: 3})
		assert.deepEqual((await running).json, {ok: true, value: 3})
	} finally {
		await close()
	}
})

test("the token's made once, kept to its owner, and the same after", () => {
	const directory = mkdtempSync(join(tmpdir(), "page-token-"))
	const file = join(directory, ".lattice-page.json")
	const {token} = pageToken(file)
	assert.match(token, /^[0-9a-f]{32,}$/)
	assert.equal(statSync(file).mode & 0o777, 0o600)
	assert.equal(pageToken(file).token, token)
	assert.equal(JSON.parse(readFileSync(file, "utf8")).token, token)
})
