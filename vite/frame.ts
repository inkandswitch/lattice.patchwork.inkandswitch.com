import type {Plugin} from "vite"
import {cp, readFile, stat} from "node:fs/promises"
import {extname, join, relative, resolve, sep} from "node:path"

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css",
	".js": "text/javascript",
	".json": "application/json",
}

// how long a request for the frame's changes is held when nothing changes:
// under the 100s a cloudflare tunnel waits for an answer
const CHANGES_WAIT = 25_000

/**
 * Mounts the lattice frame checkout in `from` at `to`: served in dev, copied
 * into the site at build. Only what the module loader asks for goes out — the
 * checkout's own .git, .pushwork store and node_modules stay behind — and an
 * edit to the frame reloads the dev page.
 *
 * Another site using this frame (?lattice-frame=) has no vite client to be
 * told to reload, so it asks: `<to>/__changes?since=<version>` answers with
 * the frame's version as soon as that's not `since` (a long poll, which
 * tunnels pass, where they don't always pass a stream).
 */
export function frame({from, to}: {from: string; to: string}): Plugin {
	let directory: string
	let outDir: string
	let serve = false
	// a fresh server is a new version too: what it serves may have changed
	let version = Date.now()
	const waiting = new Set<() => void>()

	function included(path: string, file: boolean) {
		const within = relative(directory, path)
		if (within.startsWith("..")) return false
		const parts = within.split(sep).filter(Boolean)
		if (parts.some(part => part.startsWith(".") || part === "node_modules")) {
			return false
		}
		return !file || extname(path) in CONTENT_TYPES
	}

	return {
		name: "lattice-frame",
		configResolved(config) {
			directory = resolve(config.root, from)
			outDir = resolve(config.root, config.build.outDir)
			serve = config.command === "serve"
		},
		configureServer(server) {
			server.watcher.on("change", path => {
				if (!included(path, true)) return
				version++
				for (const wake of waiting) wake()
				server.ws.send({type: "full-reload"})
			})
			server.middlewares.use(to, async (request, response, next) => {
				const url = new URL(request.url ?? "/", "http://localhost")
				const pathname = decodeURIComponent(url.pathname)
				if (pathname === "/__changes") {
					response.setHeader("Cache-Control", "no-store")
					response.setHeader("Access-Control-Allow-Origin", "*")
					response.setHeader("Content-Type", "application/json")
					const answer = () => {
						waiting.delete(answer)
						clearTimeout(timer)
						if (!response.writableEnded) response.end(JSON.stringify({version}))
					}
					const timer = setTimeout(answer, CHANGES_WAIT)
					if (url.searchParams.get("since") !== String(version)) return answer()
					waiting.add(answer)
					// the asker gave up (or the page went away)
					response.on("close", () => {
						waiting.delete(answer)
						clearTimeout(timer)
					})
					return
				}
				const path = join(directory, pathname)
				if (!included(path, true)) return next()
				try {
					const body = await readFile(path)
					response.setHeader("Cache-Control", "no-cache")
					// so another site can use this frame (?lattice-frame=)
					response.setHeader("Access-Control-Allow-Origin", "*")
					response.setHeader("Content-Type", CONTENT_TYPES[extname(path)])
					response.end(body)
				} catch {
					next()
				}
			})
		},
		async closeBundle() {
			// also called when a dev server shuts down, which has nothing to copy
			if (serve) return
			await cp(directory, join(outDir, to), {
				recursive: true,
				filter: async path => included(path, (await stat(path)).isFile()),
			})
		},
	}
}
