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

test("each kind opens in its own editor", () => {
	assert.equal(toolsFor("machine")[0].id, "machine")
	assert.equal(toolsFor("yarn")[0].id, "yarn")
	assert.equal(toolsFor("swatch")[0].id, "swatch")
})
