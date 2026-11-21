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
  recordedSources,
  exceptPinned,
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

test("a build never records the .k it writes, or the .js again after the first", () => {
  const sources = ["automerge:js#1", "automerge:lib#2", "automerge:k#3", "/automerge:js#4", "automerge:other#5"];
  assert.deepEqual(recordedSources(sources, { self: "automerge:js", target: "automerge:k" }), [
    "automerge:js#1",
    "automerge:lib#2",
    "automerge:other#5",
  ]);
  assert.deepEqual(recordedSources(["automerge:js#1", "automerge:k#3"], { self: "automerge:js", target: null }), [
    "automerge:js#1",
    "automerge:k#3",
  ]);
});

test("a source the code pins itself is never stale, however its doc moves", () => {
  const sources = ["automerge:js#1", "automerge:x#h", "automerge:y#2"];
  const now = { "automerge:x": "moved", "automerge:y": "9" };
  assert.deepEqual(staleSources(sources, (url) => now[url], { pinned: ["automerge:x#h"] }), ["automerge:y#2"]);
  // one pinned at other heads than the code says is a source like any other
  assert.deepEqual(staleSources(sources, (url) => now[url], { pinned: ["automerge:x#g"] }), [
    "automerge:x#h",
    "automerge:y#2",
  ]);
  // the heads can be written in any order
  assert.deepEqual(staleSources(["automerge:js#1", "automerge:x#a|b"], () => "c", { pinned: ["automerge:x#b|a"] }), []);
});

test("a doc read both pinned and as it is now is listed twice, and only the pinned one is let off", () => {
  // `doc("automerge:x#h")` and `doc("automerge:x")`, built while x was at h
  const sources = ["automerge:js#1", "automerge:x#h", "automerge:x#h"];
  assert.deepEqual(staleSources(sources, () => "moved", { pinned: ["automerge:x#h"] }), ["automerge:x#h"]);
  assert.deepEqual(exceptPinned(sources.slice(1), ["automerge:x#h", "automerge:x#h"]), ["automerge:x#h"]);
});
