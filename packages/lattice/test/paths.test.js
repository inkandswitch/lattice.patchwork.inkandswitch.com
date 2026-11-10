import {test} from "node:test"
import assert from "node:assert/strict"
import {parsePath, projectByShort, projectPath, shortIdOf, slugOf} from "../paths.js"

const scarf = {url: "automerge:3ahtXk9QmPzR2vYc8LwN4bJdEfGh", name: "Scarf, for Mimi!"}
const mittens = {url: "automerge:7Kp2sWqZ1xYvU9tRbN3mLcEaDfGh", name: "mittens"}

test("a project's path is its name and the start of its id", () => {
	assert.equal(projectPath(scarf), "/projects/scarf-for-mimi-3ahtXk")
	assert.equal(shortIdOf("automerge:3ahtXk9QmPzR2vYc8LwN4bJdEfGh#heads"), "3ahtXk")
})

test("names become slugs, and a name with nothing in it is still a path", () => {
	assert.equal(slugOf("Café  Cables"), "cafe-cables")
	assert.equal(slugOf("   "), "project")
	assert.equal(slugOf("編み物"), "編み物")
	assert.equal(slugOf("x".repeat(60)).length, 40)
})

test("paths say what they ask for", () => {
	assert.deepEqual(parsePath("/settings"), {page: "settings"})
	assert.deepEqual(parsePath("/settings/"), {page: "settings"})
	assert.deepEqual(parsePath("/projects/scarf-for-mimi-3ahtXk"), {short: "3ahtXk"})
	// the name's only for reading: a stale one still finds it
	assert.deepEqual(parsePath("/projects/old-name-3ahtXk"), {short: "3ahtXk"})
	assert.deepEqual(parsePath("/projects/3ahtXk"), {short: "3ahtXk"})
	assert.equal(parsePath("/"), null)
	assert.equal(parsePath("/projects/scarf-3a"), null)
	assert.equal(parsePath("/packages/lattice/index.js"), null)
})

test("a short id finds the project among yours", () => {
	assert.equal(projectByShort([scarf, mittens], "7Kp2sW"), mittens)
	assert.equal(projectByShort([scarf, mittens], "zzzzzz"), null)
})
