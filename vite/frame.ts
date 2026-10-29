import type {Plugin} from "vite"
import {cp, readFile, stat} from "node:fs/promises"
import {extname, join, relative, resolve, sep} from "node:path"

const CONTENT_TYPES: Record<string, string> = {
	".css": "text/css",
	".js": "text/javascript",
	".json": "application/json",
}

/**
 * Mounts the lattice frame checkout in `from` at `to`: served in dev, copied
 * into the site at build. Only what the module loader asks for goes out — the
 * checkout's own .git, .pushwork store and node_modules stay behind — and an
 * edit to the frame reloads the dev page.
 */
export function frame({from, to}: {from: string; to: string}): Plugin {
	let directory: string
	let outDir: string
	let serve = false

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
				if (included(path, true)) server.ws.send({type: "full-reload"})
			})
			server.middlewares.use(to, async (request, response, next) => {
				const pathname = decodeURIComponent(
					new URL(request.url ?? "/", "http://localhost").pathname
				)
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
