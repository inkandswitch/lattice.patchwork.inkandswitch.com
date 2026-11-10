import {test} from "node:test"
import assert from "node:assert/strict"
import {editBetween, moved} from "../edits.js"

const apply = (text, {at, remove, insert}) => text.slice(0, at) + insert + text.slice(at + remove)

test("typing is a splice where it's typed", () => {
	assert.deepEqual(editBetween("scarf", "scarfs", 6), {at: 5, remove: 0, insert: "s"})
	assert.deepEqual(editBetween("sarf", "scarf", 2), {at: 1, remove: 0, insert: "c"})
})

test("a letter beside the same letter goes where the caret is", () => {
	assert.deepEqual(editBetween("aa", "aaa", 1), {at: 0, remove: 0, insert: "a"})
	assert.deepEqual(editBetween("aa", "aaa", 2), {at: 1, remove: 0, insert: "a"})
	assert.deepEqual(editBetween("aa", "aaa", 3), {at: 2, remove: 0, insert: "a"})
})

test("deleting, either way, takes out the right one", () => {
	// backspace after the first a of "aaa"
	assert.deepEqual(editBetween("aaa", "aa", 0), {at: 0, remove: 1, insert: ""})
	// delete forward from after the first a
	assert.deepEqual(editBetween("aaa", "aa", 1), {at: 1, remove: 1, insert: ""})
	assert.deepEqual(editBetween("lambswool", "lambsool", 5), {at: 5, remove: 1, insert: ""})
})

test("pasting over a selection replaces just it", () => {
	const edit = editBetween("merino wool", "merino silk", 11)
	assert.deepEqual(edit, {at: 7, remove: 4, insert: "silk"})
	assert.equal(apply("merino wool", edit), "merino silk")
})

test("any edit, applied, gives what's after", () => {
	const cases = [["", "x", 1], ["abc", "", 0], ["abcabc", "abXcabc", 3], ["mississippi", "missippi", 4], ["2/30", "2/28", 4]]
	for (const [before, after, caret] of cases) assert.equal(apply(before, editBetween(before, after, caret)), after)
})

test("a caret moves with someone else's edit", () => {
	const edit = {at: 2, remove: 0, insert: "xyz"}
	assert.equal(moved(1, edit), 1)
	assert.equal(moved(2, edit), 2)
	assert.equal(moved(4, edit), 7)
	assert.equal(moved(5, {at: 2, remove: 4, insert: ""}), 2)
})
