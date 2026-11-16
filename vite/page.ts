import type {Plugin} from "vite"
import {readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"
// plain js, so its tests run without vite
import {createBridge, pageToken} from "./page-bridge.js"

/**
 * A way into the tab that's using this dev server, its own page or the site's
 * with ?dev=, for `pnpm page` (scripts/page.mjs): what to run goes to the tab
 * (packages/lattice/page.js), and what came of it comes back. Only for
 * whoever has the token in node_modules/.lattice-page.json: the command line
 * here, and a tab given it by `pnpm page link`. In dev only; nothing of it is
 * in the build.
 */
export function page(): Plugin {
	return {
		name: "lattice-page",
		apply: "serve",
		configureServer(server) {
			const file = join(server.config.root, "node_modules", ".lattice-page.json")
			const {token} = pageToken(file)
			const bridge = createBridge({token})
			server.middlewares.use(bridge)
			// where the command line finds this server
			server.httpServer?.once("listening", () => {
				const address = server.httpServer?.address()
				if (!address || typeof address === "string") return
				const host = server.config.server.host
				const shown = typeof host === "string" && host !== "0.0.0.0" ? host : "localhost"
				let kept: Record<string, unknown> = {}
				try {
					kept = JSON.parse(readFileSync(file, "utf8"))
				} catch {}
				writeFileSync(
					file,
					JSON.stringify({...kept, token, url: `http://${shown}:${address.port}/`}, null, "\t"),
					{mode: 0o600},
				)
			})
			server.httpServer?.once("close", () => bridge.close())
		},
	}
}
