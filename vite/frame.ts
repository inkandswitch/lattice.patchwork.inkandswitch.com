import type {Plugin} from "vite"
import {existsSync, readdirSync, statSync} from "node:fs"
import {cp, readFile, stat} from "node:fs/promises"
import {extname, join, relative, resolve, sep} from "node:path"

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css",
	".js": "text/javascript",
	".json": "application/json",
	// the fonts it brings (src/frame/fonts)
	".woff2": "font/woff2",
}

// how long a request for the frame's changes is held when nothing changes:
// under the 100s a cloudflare tunnel waits for an answer
const CHANGES_WAIT = 25_000

/**
 * Mounts the lattice frame checkout in `from` at `to`, and each of `packages`
 * (the repo's packages/*, which it imports) at its own `/packages/<name>`:
 * served in dev, copied into the site at build. The frame is at
 * /packages/lattice, so `../../packages/<name>/…` from src/frame is the same
 * file on disk and on the site. Only what the module loader asks for goes
 * out — a checkout's own .git, .pushwork store, node_modules and tests stay
 * behind — and an edit to any of them reloads the dev page.
 *
 * Another site can use this dev server's packages, all of them (?dev=, see
 * src/main.ts), so everything it serves says any origin may have it. That
 * site has no vite client to be told to reload, so it asks: `<to>/__changes?since=<version>` answers with
 * the frame's version as soon as that's not `since` (a long poll, which
 * tunnels pass, where they don't always pass a stream).
 */
export function frame({
	from,
	to,
	packages = "packages",
}: {
	from: string
	to: string
	packages?: string
}): Plugin {
	// [url, directory], the frame's first
	let mounts: [string, string][] = []
	let outDir: string
	let serve = false
	// a fresh server is a new version too: what it serves may have changed
	let version = Date.now()
	const waiting = new Set<() => void>()

	function included(directory: string, path: string, file: boolean) {
		const within = relative(directory, path)
		if (within.startsWith("..")) return false
		const parts = within.split(sep).filter(Boolean)
		if (
			parts.some(
				part => part.startsWith(".") || part === "node_modules" || part === "test",
			)
		) {
			return false
		}
		return !file || extname(path) in CONTENT_TYPES
	}

	return {
		name: "lattice-frame",
		configResolved(config) {
			const directory = resolve(config.root, packages)
			mounts = [[to, resolve(config.root, from)]]
			for (const name of existsSync(directory) ? readdirSync(directory) : []) {
				if (name.startsWith(".")) continue
				if (!statSync(join(directory, name)).isDirectory()) continue
				mounts.push([`/packages/${name}`, join(directory, name)])
			}
			outDir = resolve(config.root, config.build.outDir)
			serve = config.command === "serve"
		},
		configureServer(server) {
			// before vite's own and the other plugins', so it's on every answer:
			// patchwork's static packages included
			server.middlewares.use((_request, response, next) => {
				response.setHeader("Access-Control-Allow-Origin", "*")
				next()
			})
			server.watcher.on("change", path => {
				if (!mounts.some(([, directory]) => included(directory, path, true))) return
				version++
				for (const wake of waiting) wake()
				server.ws.send({type: "full-reload"})
			})
			for (const [at, directory] of mounts) {
				server.middlewares.use(at, async (request, response, next) => {
					const url = new URL(request.url ?? "/", "http://localhost")
					const pathname = decodeURIComponent(url.pathname)
					if (at === to && pathname === "/__changes") {
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
					if (!included(directory, path, true)) return next()
					try {
						const body = await readFile(path)
						response.setHeader("Cache-Control", "no-cache")
						response.setHeader("Content-Type", CONTENT_TYPES[extname(path)])
						response.end(body)
					} catch {
						next()
					}
				})
			}
		},
		async closeBundle() {
			// also called when a dev server shuts down, which has nothing to copy
			if (serve) return
			for (const [at, directory] of mounts) {
				await cp(directory, join(outDir, at), {
					recursive: true,
					filter: async path => included(directory, path, (await stat(path)).isFile()),
				})
			}
		},
	}
}
