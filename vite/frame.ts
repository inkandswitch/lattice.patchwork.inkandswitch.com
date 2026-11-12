import type {Plugin} from "vite"
import {existsSync, readdirSync, statSync} from "node:fs"
import {cp, readFile, stat} from "node:fs/promises"
import {extname, join, relative, resolve, sep} from "node:path"
// plain js, shared with the frame (dev-swap.js), and its tests
import {unversioned} from "../packages/lattice/versioned.js"

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css",
	".js": "text/javascript",
	".json": "application/json",
	// the fonts lattice's frame brings (packages/lattice/fonts)
	".woff2": "font/woff2",
}

// how long a request for the frame's changes is held when nothing changes:
// under the 100s a cloudflare tunnel waits for an answer
const CHANGES_WAIT = 25_000

/**
 * Mounts each of `packages` (the repo's packages/*: lattice's frame, and what
 * it imports) at its own `/packages/<name>`: served in dev, copied into the
 * site at build. So `../<name>/…` from one package is the same file on disk
 * and on the site. Only what the module loader asks for goes out — a
 * package's own .pushwork store, node_modules and tests stay behind.
 *
 * Another site can use this dev server's packages, all of them (?dev=, see
 * src/main.ts), so everything it serves says any origin may have it. An edit
 * to any of them is swapped in where everyone using them is, without a
 * reload (packages/lattice/dev-swap.js), this server's own page included,
 * which a meta tag says is a dev server's. The frame asks for changes:
 * `/packages/<frame>/__changes?since=<version>` answers with the packages'
 * version, and their names, as soon as that's not `since` (a long poll,
 * which tunnels pass, where they don't always pass a stream). Every package
 * is at `/v<version>/packages/<name>/` too, the same files under a new url,
 * so a module imported from there is a new one.
 */
export function frame({
	frame = "lattice",
	packages = "packages",
}: {
	frame?: string
	packages?: string
} = {}): Plugin {
	const to = `/packages/${frame}`
	// [url, directory]
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
			mounts = []
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
			// a package at a version is the package (see packages/lattice/versioned.js)
			server.middlewares.use((request, response, next) => {
				response.setHeader("Access-Control-Allow-Origin", "*")
				const url = request.url ?? "/"
				const query = url.indexOf("?")
				const plain = unversioned(query < 0 ? url : url.slice(0, query))
				if (plain && mounts.some(([at]) => plain.startsWith(`${at}/`))) {
					request.url = plain + (query < 0 ? "" : url.slice(query))
				}
				next()
			})
			// swapped in where it's used, not reloaded (dev-swap.js)
			server.watcher.on("change", path => {
				if (!mounts.some(([, directory]) => included(directory, path, true))) return
				version++
				for (const wake of waiting) wake()
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
							if (response.writableEnded) return
							const packages = mounts.map(([at]) => at.slice("/packages/".length))
							response.end(JSON.stringify({version, packages}))
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
		// this server's own page: its frame's from a dev server too
		transformIndexHtml() {
			if (!serve) return
			return [{tag: "meta", attrs: {name: "lattice-dev-server", content: ""}, injectTo: "head"}]
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
