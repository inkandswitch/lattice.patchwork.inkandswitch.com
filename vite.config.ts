import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {defineConfig} from "vite"
import {base, core, environment, patchwork} from "./vite/environment.ts"
import {frame} from "./vite/frame.ts"
import {pages} from "./vite/pages.ts"

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	// `pnpm dev` (unless --no-tunnel) reaches this server through a cloudflare quick
	// tunnel (or a named one, at LATTICE_TUNNEL_HOST), which vite's host check
	// would otherwise turn away. cloudflared dials localhost over ipv4, and
	// vite might otherwise listen on ::1 alone
	server:
		process.env.LATTICE_TUNNEL === "1"
			? {
					host: "127.0.0.1",
					allowedHosts: [
						".trycloudflare.com",
						...(process.env.LATTICE_TUNNEL_HOST
							? [process.env.LATTICE_TUNNEL_HOST]
							: []),
					],
				}
			: undefined,
	plugins: [
		environment(),
		frame(),
		pages(),
		patchwork({
			title: "Patchwork",
			description: "local-first collaborative malleable software environment",
			storagePrefix: "patchwork.inkandswitch.com",
			server: core ? {fs: {allow: [root, core]}} : undefined,
			keyhive:
				process.env.KEYHIVE === "true"
					? {
							syncServer:
								process.env.KEYHIVE_SYNC_SERVER === "true"
									? "keyhive"
									: "subduction",
							useIdFactory: false
						}
					: undefined,
			themeColor: {light: "#eaeaeb", dark: "#21252b"},
			html: {
				attributes: {
					"data-theme-light": "lattice-light",
					"data-theme-dark": "lattice-dark",
				},
			},
			icons: {
				source: process.env.PATCHWORK_FAVICON ?? "public/lattice.svg",
				maskIcon: "public/lattice-mask.svg",
			},
			static: [
				base
					? {from: join(base, "static-dist"), watch: ".watch-ready"}
					: "@inkandswitch/patchwork-pkg-base",
			],
			// vite's cors middleware adds `Vary: Origin`, which netlify doesn't
			// send; the service worker then caches the crossorigin wasm preloads
			// under that Vary and offline boot misses them. The patchwork plugin
			// already sends `Access-Control-Allow-Origin: *`.
			preview: {cors: false},
			buildInfo: {
				packageListURL: process.env.PATCHWORK_SYSTEM_PACKAGE_LIST_URL,
			},
		}),
	],
})
