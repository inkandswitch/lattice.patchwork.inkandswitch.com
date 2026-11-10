// stage-knitoutjs.mjs [dir] [--state <.pushwork dir>]: the Knitout JS
// patchwork package, in one folder pushwork can sync. its app imports
// knitoutjs's tools and wm, which live beside it in packages/, and a relative
// import can't leave the folder that's pushed; so the folder has them at the
// same paths: packages/knitoutjs and packages/wm, under a modules.json that
// points at the app.
//
// what's in `dir` (stage/knitoutjs, if not given) is replaced, all but its
// .pushwork: the state that says which patchwork folder it is, and so which
// url people's module settings have. --state links one in, if `dir` hasn't
// one yet (~/soft/agnescameron/knitoutjs.pushwork is Knitout JS's).
//
// it only stages. syncing it (pushwork sync, in `dir`) is for whoever
// publishes Knitout JS
import {cp, mkdir, readdir, rm, stat, symlink, writeFile} from "node:fs/promises"
import {existsSync} from "node:fs"
import {dirname, extname, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const stateAt = args.indexOf("--state")
const state = stateAt >= 0 ? resolve(args.splice(stateAt, 2)[1]) : null
const dir = resolve(args[0] ?? join(root, "stage", "knitoutjs"))

// what the module loader asks for, and what the licences ask to go with it
const SERVED = new Set([".js", ".css", ".json"])
const KEPT = new Set(["LICENSE", "LICENSE.md", "README.md"])
const PACKAGES = ["knitoutjs", "wm"]

function wanted(path, from) {
	const parts = relative(from, path).split(sep)
	if (parts.some(part => part.startsWith(".") || part === "node_modules" || part === "test")) return false
	return true
}

async function copyPackage(name) {
	const from = join(root, "packages", name)
	await cp(from, join(dir, "packages", name), {
		recursive: true,
		filter: async path => {
			if (!wanted(path, from)) return false
			if ((await stat(path)).isDirectory()) return true
			const base = path.split(sep).at(-1)
			// the package's own modules.json says where it was: this folder has its own
			if (base === "modules.json" || base === "package.json") return false
			return SERVED.has(extname(path)) || KEPT.has(base)
		},
	})
}

await mkdir(dir, {recursive: true})
for (const entry of await readdir(dir)) {
	if (entry === ".pushwork") continue
	await rm(join(dir, entry), {recursive: true, force: true})
}
if (state && !existsSync(join(dir, ".pushwork"))) {
	if (!existsSync(join(state, "config.json"))) throw new Error(`${state} isn't a .pushwork folder: it has no config.json`)
	await symlink(state, join(dir, ".pushwork"), "dir")
}
for (const name of PACKAGES) await copyPackage(name)

const knitoutjs = join(root, "packages", "knitoutjs")
await writeFile(
	join(dir, "modules.json"),
	JSON.stringify({"@patchwork": {type: "patchwork:module-settings"}, modules: ["./packages/knitoutjs/app/index.js"]}, null, "\t") + "\n",
)
for (const file of ["_headers", ".pushworkattributes", "LICENSE"]) {
	await cp(join(knitoutjs, file), join(dir, file))
}
await writeFile(
	join(dir, "README.md"),
	`# Knitout JS\n\nknitout in patchwork, from the lattice repo: its app is packages/knitoutjs/app,\nwith knitoutjs's tools and wm beside it. see packages/knitoutjs/README.md for\nwhere it all comes from, and its licences.\n`,
)

const count = async at => {
	let n = 0
	for (const entry of await readdir(at, {withFileTypes: true})) {
		if (entry.name === ".pushwork") continue
		n += entry.isDirectory() ? await count(join(at, entry.name)) : 1
	}
	return n
}
console.log(`staged Knitout JS in ${relative(process.cwd(), dir) || "."}: ${await count(dir)} files`)
console.log(existsSync(join(dir, ".pushwork")) ? "its .pushwork is there: pushwork sync in it publishes" : "no .pushwork in it yet (--state links one)")
