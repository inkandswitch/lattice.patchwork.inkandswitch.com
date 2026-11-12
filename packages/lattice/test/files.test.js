import {test} from "node:test"
import assert from "node:assert/strict"
import {fileExtension, toolsFor} from "../files.js"
import {newMachine, newSwatch, newYarn} from "../profile-docs.js"

test("a profile's extension is its kind", () => {
	assert.equal(fileExtension(newMachine()), "machine")
	assert.equal(fileExtension(newYarn()), "yarn")
	assert.equal(fileExtension(newSwatch()), "swatch")
	assert.equal(fileExtension({name: "pattern.k"}), "k")
})

test("a doc that isn't a file goes by its datatype", () => {
	assert.equal(fileExtension({"@patchwork": {type: "markdown"}, content: "# hi"}), "markdown")
	assert.equal(fileExtension({"@patchwork": {type: "tldraw"}}), "tldraw")
	// a file's is its own, and one with none has none
	assert.equal(fileExtension({"@patchwork": {type: "file"}, name: "notes.md"}), "md")
	assert.equal(fileExtension({"@patchwork": {type: "file"}, name: "README"}), "")
	// one that says what it is, says
	assert.equal(fileExtension({"@patchwork": {type: "markdown"}, extension: "md"}), "md")
	assert.equal(fileExtension({}), "")
})

test("each kind opens in its own editor", () => {
	assert.equal(toolsFor("machine")[0].id, "machine")
	assert.equal(toolsFor("yarn")[0].id, "yarn")
	assert.equal(toolsFor("swatch")[0].id, "swatch")
})
