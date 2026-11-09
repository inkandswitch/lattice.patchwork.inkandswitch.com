import {test} from "node:test"
import assert from "node:assert/strict"
import {checkKnitout} from "../knitcheck.js"
import {textHash} from "../files.js"
import {knitFromCheck} from "../swatch-fill.js"

// a 48 needle 2×2 rib, 100 rows, on carrier 3 at stitch 7, roller 80
function rib() {
	const lines = [";!knitout-2", ";;Carriers: 1 2 3 4 5 6", "in 3", "x-stitch-number 7", "x-roller-advance 80", "rack 0.5"]
	for (let r = 0; r < 100; r++) {
		const dir = r % 2 ? "-" : "+"
		let needles = [...Array(48).keys()].map(i => `${"FFBB"[i % 4] === "F" ? "f" : "b"}${i + 1}`)
		if (dir === "-") needles = needles.reverse()
		for (const needle of needles) lines.push(`knit ${dir} ${needle} 3`)
	}
	lines.push("out 3")
	return lines.join("\n")
}

test("how a swatch was knit, from the .k that knit it", () => {
	const text = rib()
	const result = checkKnitout(text, null, {gauge: 7})
	const knit = knitFromCheck(result, {yarns: []}, "automerge:k", text)
	assert.equal(knit.needles, 48)
	assert.equal(knit.rows, 100)
	assert.equal(knit.stitch, "7")
	assert.equal(knit.structure, "rib-2x2")
	assert.equal(knit.roller, 80)
	assert.equal(knit.speed, 100)
	assert.deepEqual(knit.feeds, [{carrier: "3", yarns: [], plated: false}])
	assert.equal(knit.k, "automerge:k")
	assert.equal(knit.kHash, textHash(text))
})

test("the feeds take the .k's yarns, and how they're plated", () => {
	const text = rib()
	const result = checkKnitout(text, null, {gauge: 7})
	const k = {profiles: {machine: null, carriers: {"3": ["a", "b"]}}, yarns: [null, null, {colours: ["#fff", "#000"], plated: true}]}
	assert.deepEqual(knitFromCheck(result, k, "automerge:k", text).feeds[0], {carrier: "3", yarns: ["a", "b"], plated: true})
})
