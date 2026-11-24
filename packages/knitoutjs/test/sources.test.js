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
  webSource,
  readWebSource,
  readWebSourcesLine,
  isSourcesLine,
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

test("what get() fetched is a web source: its url, and when", () => {
  const at = Date.UTC(2026, 10, 24, 21, 34, 5, 123);
  const source = webSource("https://x.test/p.png", at);
  assert.equal(source, "https://x.test/p.png@2026-11-24T21:34:05.123Z");
  assert.deepEqual(readWebSource(source), { url: "https://x.test/p.png", fetchedAt: at });
  // (an @ in the url is the url's: the time's after the last one)
  assert.deepEqual(readWebSource(webSource("https://me@x.test/a#b", at)), { url: "https://me@x.test/a#b", fetchedAt: at });
  assert.equal(readWebSource("https://x.test/a"), null);
});

test("web sources go on a line of their own after the sources, and only if there are some", () => {
  const web = [webSource("https://x.test/a;b c", 0), webSource("https://x.test/p", 1000)];
  assert.deepEqual(web, ["https://x.test/a%3Bb%20c@1970-01-01T00:00:00.000Z", "https://x.test/p@1970-01-01T00:00:01.000Z"]);
  const out = withSourcesLine(knitout, ["automerge:a#x"], web);
  assert.equal(
    out,
    `;!knitout-2\n;;Carriers: 1 2 3 4 5 6\nx-patchwork-sources automerge:a#x\nx-web-sources ${web.join(" ")}\nin 3\n`,
  );
  assert.deepEqual(readSourcesLine(out), ["automerge:a#x"]);
  assert.deepEqual(readWebSourcesLine(out), web);
  // built again with nothing fetched, the line goes
  const again = withSourcesLine(out, ["automerge:a#y"]);
  assert.equal(again, ";!knitout-2\n;;Carriers: 1 2 3 4 5 6\nx-patchwork-sources automerge:a#y\nin 3\n");
  assert.deepEqual(readWebSourcesLine(again), []);
  assert.ok(isSourcesLine("x-web-sources a@b") && isSourcesLine("x-patchwork-sources") && !isSourcesLine("in 3"));
});

test("a .kc's comment says what its .k fetched, on the next line", () => {
  const web = [webSource("https://x.test/p", 0)];
  const comment = kcodeSourcesComment("automerge:k#z", ["automerge:a#x"], web);
  assert.equal(comment, `// x-patchwork-sources automerge:k#z automerge:a#x\n// x-web-sources ${web[0]}`);
  assert.deepEqual(readWebSourcesLine(`${comment}\nexport default 1\n`), web);
  assert.equal(kcodeSourcesComment("automerge:k#z", []), "// x-patchwork-sources automerge:k#z");
});
