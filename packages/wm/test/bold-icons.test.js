import {test} from "node:test"
import assert from "node:assert/strict"
import {BOLD} from "../ui/bold-icons.js"
import {SPEED_ICONS} from "../ui/trays.js"

const NAMES = "pencil line rect fill eraser eyedropper hand undo redo gear check warning restart back play pause step flip strain bed fit snail turtle rabbit panicked".split(" ")

test("every icon the trays use is there, as svg that closes", () => {
	for (const name of NAMES) {
		const markup = BOLD[name]
		assert.ok(markup, name)
		assert.match(markup, /^<(path|g) /, name)
		const opened = (markup.match(/<(path|g|circle)\b/g) ?? []).length
		const closed = (markup.match(/\/>|<\/g>/g) ?? []).length
		assert.equal(opened, closed, name)
		assert.doesNotMatch(markup, /undefined|NaN/, name)
	}
})

test("the speeds go snail, turtle, rabbit, panicked", () => {
	assert.deepEqual(SPEED_ICONS, ["snail", "turtle", "rabbit", "panicked"])
})
