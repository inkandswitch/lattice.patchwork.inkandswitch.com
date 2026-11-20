import {test} from "node:test"
import assert from "node:assert/strict"
import {ADJECTIVES, ANIMALS, christen, isNewcomer, randomColour, randomName} from "../newcomer.js"
import {COLOURS} from "../pointer.js"

test("a random name is an adjective and an animal", () => {
	assert.equal(randomName(() => 0), `${ADJECTIVES[0]} ${ANIMALS[0]}`)
	assert.equal(randomName(() => 0.999999), `${ADJECTIVES.at(-1)} ${ANIMALS.at(-1)}`)
	const [adjective, animal] = randomName().split(" ")
	assert.ok(ADJECTIVES.includes(adjective) && ANIMALS.includes(animal))
})

test("a random colour is one of the palette's", () => {
	const palette = COLOURS.map(([, colour]) => colour)
	for (let i = 0; i < 20; i++) assert.ok(palette.includes(randomColour()))
})

test("patchwork's new contact gets a name and a colour, and is someone", () => {
	const doc = {"@patchwork": {type: "contact"}, type: "anonymous"}
	assert.ok(isNewcomer(doc))
	assert.equal(christen(doc, () => 0), true)
	assert.equal(doc.name, `${ADJECTIVES[0]} ${ANIMALS[0]}`)
	assert.equal(doc.color, COLOURS[0][1])
	assert.equal(doc.type, "registered")
	assert.ok(!isNewcomer(doc))
})

test("anyone who's already someone is left alone", () => {
	for (const doc of [
		{type: "anonymous", name: "chee"},
		{type: "anonymous", color: "hsl(10, 75%, 58%)"},
		{type: "anonymous", avatarUrl: "automerge:abc"},
		{type: "registered"},
	]) {
		const before = structuredClone(doc)
		assert.equal(christen(doc), false)
		assert.deepEqual(doc, before)
	}
	assert.ok(!isNewcomer(undefined))
})
