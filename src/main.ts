import setup, {
	hideLoadingAnimation,
	showErrorScreen,
	showLoadingAnimation,
} from "@inkandswitch/patchwork"

const DEFAULT_PACKAGE_LIST = "/modules.json"

const packageListURL = (
	new URLSearchParams(location.search).get("system-package-list") ||
	localStorage.getItem("systemPackageListURL") ||
	import.meta.env.PATCHWORK_SYSTEM_PACKAGE_LIST_URL ||
	import.meta.env.VITE_DEFAULT_MODULES ||
	DEFAULT_PACKAGE_LIST
)
	.split(",")
	.map(source => source.trim())
	.filter(Boolean)

// lattice's frame is a package list of its own, so a dev server's can stand
// in for the site's: ?lattice-frame=https://some-tunnel.example (or a path to
// its /packages/lattice/). it's remembered here until ?lattice-frame= with
// nothing, and the site's own is used whenever the given one doesn't answer
const OWN_FRAME = "/packages/lattice/"
const FRAME_KEY = "latticeFrameURL"

async function latticeFrame() {
	const given = new URLSearchParams(location.search).get("lattice-frame")
	if (given != null) {
		if (given) localStorage.setItem(FRAME_KEY, given)
		else localStorage.removeItem(FRAME_KEY)
	}
	const wanted = localStorage.getItem(FRAME_KEY)
	const own = new URL("modules.json", new URL(OWN_FRAME, location.href)).href
	if (!wanted) return own
	const base = new URL(wanted, location.href)
	if (base.pathname === "/") base.pathname = OWN_FRAME
	if (!base.pathname.endsWith("/")) base.pathname += "/"
	const manifest = new URL("modules.json", base).href
	try {
		const response = await fetch(manifest, {
			cache: "no-store",
			signal: AbortSignal.timeout(4000),
		})
		if (response.ok) return manifest
	} catch {}
	console.warn(`lattice: the frame at ${base} didn't answer, so this is the site's own`)
	return own
}

showLoadingAnimation()

packageListURL.push(await latticeFrame())

window.patchwork = await setup({
	packageListURL,
	accountKey: "tinyPatchworkAccountUrl",
	frameToolId: "lattice",
}).catch(error => {
	showErrorScreen(error, {contact: "chee@inkandswitch.com"})
	throw error
})

declare global {
  interface Window {
	 accountDocHandle: typeof window.patchwork.account
  }
}

window.accountDocHandle = window.patchwork.account
hideLoadingAnimation()
