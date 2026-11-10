import type {Plugin} from "vite"
import {parsePath} from "../packages/lattice/paths.js"

/**
 * The site's pages are all the one page: on netlify every path that isn't a
 * file is index.html (patchwork's _redirects). In dev, patchwork serves the
 * page only for exactly `/` or `/index.html`, so `/settings`,
 * `/projects/<name>-<short>` (packages/lattice/paths.js), and `/` with a
 * query (`?dev=…`) would 404. Asked for as a page, they're `/` here too.
 */
export function pages(): Plugin {
	return {
		name: "lattice-pages",
		// before patchwork's own page middleware, which is a "pre" plugin's
		// "pre" hook: so this is both, and listed ahead of patchwork
		enforce: "pre",
		configureServer: {
			order: "pre",
			handler(server) {
				server.middlewares.use((request, _response, next) => {
					if (request.method !== "GET" || !request.headers.accept?.includes("text/html")) {
						return next()
					}
					const {pathname} = new URL(request.url ?? "/", "http://localhost")
					if (pathname === "/" || parsePath(pathname)) request.url = "/"
					next()
				})
			},
		},
	}
}
