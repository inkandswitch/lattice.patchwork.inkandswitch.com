// stage.mjs <knitoutjs|lattice> [dir] [--state <.pushwork dir>]: a patchwork
// package from this repo, in one folder pushwork can sync. knitoutjs's app
// imports knitoutjs's tools and wm, and lattice's frame (src/frame) imports
// both, from packages/; a relative import can't leave the folder that's
// pushed, so the folder has them all at the paths they have on the site:
// packages/knitoutjs, packages/wm (and packages/lattice, for lattice's
// frame), under a modules.json that points at the package.
//
// what's in `dir` (stage/<package>, if not given) is replaced, all but its
// .pushwork: the state that says which patchwork folder it is, and so which
// url people's module settings have. --state links one in, if `dir` hasn't
// one yet (~/soft/agnescameron/knitoutjs.pushwork is Knitout JS's, and
// src/frame/.pushwork lattice's).
//
// it only stages. syncing it (pushwork sync, in `dir`) is for whoever
// publishes
import {cp, mkdir, readdir, rm, stat, symlink, writeFile} from "node:fs/promises"
import {existsSync} from "node:fs"
import {dirname, extname, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const PACKAGES = {
	// the app, what it's called, and what it brings with it
	knitoutjs: {entry: "./packages/knitoutjs/app/index.js", name: "Knitout JS", with: ["knitoutjs", "wm"], meta: "packages/knitoutjs"},
	lattice: {entry: "./packages/lattice/index.js", name: "Lattice", with: ["knitoutjs", "wm"], frame: true, meta: "src/frame"},
}
const which = PACKAGES[args[0]]
if (!which) throw new Error(`stage what? ${Object.keys(PACKAGES).join(" or ")}`)
const name = args.shift()
const stateAt = args.indexOf("--state")
const state = stateAt >= 0 ? resolve(args.splice(stateAt, 2)[1]) : null
const dir = resolve(args[0] ?? join(root, "stage", name))

// what the module loader asks for (and the fonts lattice brings), and what
// the licences ask to go with it
const SERVED = new Set([".js", ".css", ".json", ".woff2"])
const KEPT = new Set(["LICENSE", "LICENSE.md", "README.md"])

function wanted(path, from) {
	const parts = relative(from, path).split(sep)
	if (parts.some(part => part.startsWith(".") || part === "node_modules" || part === "test")) return false
	return true
}

async function copyPackage(from, to) {
	await cp(from, join(dir, "packages", to), {
		recursive: true,
		filter: async path => {
			if (!wanted(path, from)) return false
			if ((await stat(path)).isDirectory()) return true
			const base = path.split(sep).at(-1)
			if (base === "package.json") return false
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
for (const each of which.with) await copyPackage(join(root, "packages", each), each)
if (which.frame) await copyPackage(join(root, "src", "frame"), "lattice")

await writeFile(
	join(dir, "modules.json"),
	JSON.stringify({"@patchwork": {type: "patchwork:module-settings"}, modules: [which.entry]}, null, "\t") + "\n",
)
// how pushwork keeps its files, and the headers a site serves them with
for (const file of ["_headers", ".pushworkattributes"]) {
	const from = join(root, which.meta, file)
	if (existsSync(from)) await cp(from, join(dir, file))
}
await writeFile(
	join(dir, "README.md"),
	`# ${which.name}\n\nfrom the lattice repo, staged by scripts/stage.mjs: ${which.entry.slice(2)} is\nwhere it starts, with what it needs beside it in packages/. each package's\nREADME says where it comes from, and its licence.\n`,
)

const count = async at => {
	let n = 0
	for (const entry of await readdir(at, {withFileTypes: true})) {
		if (entry.name === ".pushwork") continue
		n += entry.isDirectory() ? await count(join(at, entry.name)) : 1
	}
	return n
}
console.log(`staged ${which.name} in ${relative(process.cwd(), dir) || "."}: ${await count(dir)} files`)
console.log(existsSync(join(dir, ".pushwork")) ? "its .pushwork is there: pushwork sync in it publishes" : "no .pushwork in it yet (--state links one)")
