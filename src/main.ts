import setup, {
	hideLoadingAnimation,
	showErrorScreen,
	showLoadingAnimation,
} from "@inkandswitch/patchwork"

const DEFAULT_PACKAGE_LIST = "/modules.json"

// lattice's frame is a package list of its own, beside the site's
const OWN_FRAME = "/packages/lattice/"

// a dev server can stand in for the site's packages, every one of them and
// the frame: ?dev=https://some-tunnel.example. only while it's in the url,
// and the site's own are used whenever it doesn't answer
async function devPackages(): Promise<string[] | null> {
	const wanted = new URLSearchParams(location.search).get("dev")
	if (!wanted) return null
	const base = new URL(wanted, location.href)
	if (!base.pathname.endsWith("/")) base.pathname += "/"
	const lists = [
		new URL("modules.json", base).href,
		new URL(`.${OWN_FRAME}modules.json`, base).href,
	]
	try {
		const answers = await Promise.all(
			lists.map(list => fetch(list, {cache: "no-store", signal: AbortSignal.timeout(4000)})),
		)
		if (answers.every(answer => answer.ok)) return lists
	} catch {}
	console.warn(`lattice: the dev server at ${base} didn't answer, so these are the site's own packages`)
	return null
}

// what used to say which frame: forget it
localStorage.removeItem("latticeFrameURL")

showLoadingAnimation()

const packageListURL = (await devPackages()) ?? [
	...(
		new URLSearchParams(location.search).get("system-package-list") ||
		localStorage.getItem("systemPackageListURL") ||
		import.meta.env.PATCHWORK_SYSTEM_PACKAGE_LIST_URL ||
		import.meta.env.VITE_DEFAULT_MODULES ||
		DEFAULT_PACKAGE_LIST
	)
		.split(",")
		.map((source: string) => source.trim())
		.filter(Boolean),
	new URL("modules.json", new URL(OWN_FRAME, location.href)).href,
]

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
