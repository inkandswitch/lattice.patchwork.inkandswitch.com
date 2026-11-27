import {test} from "node:test"
import assert from "node:assert/strict"
import {dropped, isPatchworkFolder, patchworkFolderFiles} from "../dropped-folder.js"

// a FileSystemDirectoryEntry of `tree` ({name: text, or a tree for a folder}),
// read as the browser reads one: a few at a time
function folder(name, tree) {
	return {
		name,
		isDirectory: true,
		isFile: false,
		createReader() {
			const left = Object.entries(tree).map(([n, v]) => (typeof v === "string" ? file(n, v) : folder(n, v)))
			return {readEntries: (ok) => setTimeout(() => ok(left.splice(0, 2)))}
		},
	}
}

function file(name, text) {
	return {name, isDirectory: false, isFile: true, file: (ok) => ok(new File([text], name))}
}

const named = async (dir) => {
	const files = await patchworkFolderFiles(dir)
	return files && Object.fromEntries(files.map((f) => [f.name, new TextDecoder().decode(f.data)]))
}

test("a folder of a root.amtext and the docs it reaches is a .patchworkfolder", async () => {
	const dir = folder("scarf.patchworkfolder", {
		"root.amtext": "{title: 'scarf'}",
		"a.amtext": "{}",
		"b.amtext": "{}",
		"notes.txt": "not a doc",
		"._root.amtext": "mac's",
	})
	assert.deepEqual(await named(dir), {"root.amtext": "{title: 'scarf'}", "a.amtext": "{}", "b.amtext": "{}"})
})

test("so is one with all that in a folder of its own, or with just the one doc", async () => {
	assert.deepEqual(Object.keys(await named(folder("x", {scarf: {"root.amtext": "{}", "a.amtext": "{}"}}))).sort(), [
		"scarf/a.amtext",
		"scarf/root.amtext",
	])
	assert.deepEqual(await named(folder("x", {"mittens.amtext": "{}"})), {"mittens.amtext": "{}"})
})

test("a folder of anything else isn't", async () => {
	assert.equal(await named(folder("photos", {"cat.jpg": "meow"})), null)
	assert.equal(await named(folder("x", {"a.amtext": "{}", "b.amtext": "{}"})), null)
	assert.equal(isPatchworkFolder(["one/root.amtext", "two/a.amtext"]), false)
	assert.equal(isPatchworkFolder(["__MACOSX/root.amtext", "a.amtext", "b.amtext"]), false)
})

test("what's dropped is split into files and folders", () => {
	const scarf = new File(["zip"], "scarf.latticeproject")
	const dir = folder("scarf.latticeproject", {})
	const item = (entry, got) => ({kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => got})
	const {files, folders} = dropped({
		items: [item(file("scarf.latticeproject", ""), scarf), item(dir, new File([], "scarf.latticeproject")), {kind: "string"}],
	})
	assert.deepEqual(files, [scarf])
	assert.deepEqual(folders, [dir])
	// without entries, it's only what's in .files
	assert.deepEqual(dropped({items: [{kind: "file", getAsFile: () => scarf}], files: [scarf]}), {files: [scarf], folders: []})
})
