import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withSourcesLine,
  readSourcesLine,
  kcodeSourcesComment,
  docIdOf,
  unpinned,
  headsOf,
  staleSources,
} from "../core/sources.js";

const knitout = ";!knitout-2\n;;Carriers: 1 2 3 4 5 6\nin 3\n";

test("the line goes after the headers", () => {
  const out = withSourcesLine(knitout, ["automerge:a#x", "automerge:b#y"]);
  assert.equal(
    out,
    ";!knitout-2\n;;Carriers: 1 2 3 4 5 6\nx-patchwork-sources automerge:a#x automerge:b#y\nin 3\n",
  );
});

test("applying it twice leaves one line", () => {
  const once = withSourcesLine(knitout, ["automerge:a#x"]);
  const twice = withSourcesLine(once, ["automerge:b#y"]);
  assert.equal(twice.match(/x-patchwork-sources/g).length, 1);
  assert.deepEqual(readSourcesLine(twice), ["automerge:b#y"]);
});

test("with no header the line goes first", () => {
  assert.equal(withSourcesLine("in 3\n", ["automerge:a#x"]), "x-patchwork-sources automerge:a#x\nin 3\n");
});

test("reads back what it wrote", () => {
  const sources = ["automerge:a#x", "automerge:b#y"];
  assert.deepEqual(readSourcesLine(withSourcesLine(knitout, sources)), sources);
  assert.deepEqual(
    readSourcesLine(kcodeSourcesComment("automerge:k#z", ["automerge:a#x"]) + "\nexport default 1\n"),
    ["automerge:k#z", "automerge:a#x"],
  );
  assert.deepEqual(readSourcesLine(knitout), []);
});

test("urls come apart", () => {
  assert.equal(docIdOf("automerge:abc#1|2"), "abc");
  assert.equal(docIdOf("/automerge:abc"), "abc");
  assert.equal(unpinned("automerge:abc#1|2"), "automerge:abc");
  assert.equal(unpinned("/automerge:abc"), "automerge:abc");
  assert.equal(headsOf("automerge:abc#1|2"), "1|2");
  assert.equal(headsOf("automerge:abc"), "");
});

test("a source is stale when its heads have moved", () => {
  const sources = ["automerge:js#1", "automerge:a#2", "automerge:b#3"];
  const now = { "automerge:a": "2", "automerge:b": "9", "automerge:js": "7" };
  assert.deepEqual(staleSources(sources, (url) => now[url]), ["automerge:b#3"]);
  assert.deepEqual(staleSources(sources, (url) => ({ "automerge:a": "2" })[url]), []);
});
