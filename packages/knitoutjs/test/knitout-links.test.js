import test from "node:test";
import assert from "node:assert/strict";
import { buildState, findOnce, importsOf, links, pinsOf, sourcesMoved, watchedSources } from "../core/knitout-links.js";

const JS = "automerge:jsAAA";
const K = "automerge:kAAA";
const LIB = "automerge:lib";
const OUT = "automerge:elsewhere";

// a fake api over a table of knitout facts, by url
function fake(facts) {
  return {
    docInfo: (url) => ({ ext: { knitout: facts[url] ?? {} } }),
    files: () => Object.keys(facts).map((url) => ({ url })),
    people: () => [],
  };
}

test("a .js links to what it imports, and they link back", () => {
  const api = fake({ [JS]: { imports: [LIB, OUT] }, [LIB]: {}, [K]: {} });
  assert.deepEqual(
    links(JS, api).map((l) => [l.url, l.label, l.live]),
    [[LIB, "imports", true], [OUT, "imports", true]],
  );
  assert.deepEqual(
    links(LIB, api).map((l) => [l.url, l.label, l.live]),
    [[JS, "used by", true]],
  );
});

test("a .k links to what it was built from, unpinned, not live, past the .js itself", () => {
  const api = fake({ [K]: { source: JS, sources: [`${JS}#a`, `${LIB}#b`] }, [JS]: { target: K } });
  assert.deepEqual(
    links(K, api).map((l) => [l.url, l.label, l.live]),
    [[JS, "written by", true], [LIB, "built from", false]],
  );
  // the version it was built from is in the chip's title
  assert.match(links(K, api)[1].title, new RegExp(`${LIB}#b`));
});

test("a source with new heads makes the .k stale", () => {
  const api = fake({
    [K]: { source: JS, sourceHash: "h", sources: [`${JS}#a`, `${LIB}#b`] },
    [JS]: { target: K, textHash: "h" },
  });
  let lib = "b";
  const deps = { builds: {}, headsNow: (url) => (url === LIB ? lib : undefined) };
  assert.equal(buildState(K, api, deps), "built");
  lib = "c";
  assert.equal(buildState(K, api, deps), "stale");
  // the .js's own heads are never looked at
  assert.equal(buildState(K, api, { builds: {}, headsNow: () => "zzz" }), "stale");
  // not found yet isn't stale
  assert.equal(buildState(K, api, { builds: {}, headsNow: () => undefined }), "built");
});

test("a stale .k with autobuild on and a builder is building", () => {
  const api = fake({
    [K]: { source: JS, sources: [`${JS}#a`, `${LIB}#b`] },
    [JS]: { target: K },
  });
  const builds = { [JS]: { auto: true, builder: {} } };
  assert.equal(buildState(K, api, { builds, headsNow: () => "c" }), "running");
});

test("a .k with no sources behaves as before", () => {
  const api = fake({
    [K]: { source: JS, sourceHash: "h" },
    [JS]: { target: K, textHash: "h" },
  });
  const deps = { builds: {}, headsNow: () => "anything" };
  assert.equal(buildState(K, api, deps), "built");
  api.docInfo(JS).ext.knitout.textHash = "other";
  assert.equal(buildState(K, api, deps), "stale");
  assert.equal(buildState(K, api, { builds: { [JS]: { state: "error" } }, headsNow: () => "x" }), "error");
  assert.equal(buildState(K, fake({ [K]: { source: JS }, [JS]: { target: "automerge:z" } }), deps), null);
});

test("a .js imports each url once, in order, unpinned", () => {
  const doc = {
    name: "p.knitout.js",
    content: `import a from "automerge:aaa#x|y"\nimport b from "/automerge:aaa"\nconst d = doc("automerge:bbb")\n`,
  };
  assert.deepEqual(importsOf(doc), ["automerge:aaa", "automerge:bbb"]);
});

test("a .k imports nothing", () => {
  assert.deepEqual(importsOf({ name: "p.k", content: `import a from "automerge:aaa"` }), []);
});

const IMP = "automerge:impAAA";
const DYN = "automerge:dynBBB";

test("watchedSources: imports, then the .k's other sources, each once, unpinned", () => {
  const js = { name: "a.js", content: `import "/${IMP}"\nconst d = await doc("${DYN}#abc")` };
  const k = { knitoutSources: [`${JS}#h1`, `${DYN}#h2`, `automerge:Mre#h3`] };
  assert.deepEqual(watchedSources(js, k, { self: JS, target: K }), [IMP, DYN, "automerge:Mre"]);
});

test("watchedSources: never the .js or its target, even if listed", () => {
  const js = { name: "a.js", content: `import "${K}"\nimport "${JS}"\nimport "${IMP}"` };
  const k = { knitoutSources: [`${JS}#h1`, `${K}#h2`, `${JS}#h3`, `${IMP}#h4`] };
  assert.deepEqual(watchedSources(js, k, { self: JS, target: K }), [IMP]);
});

test("watchedSources: no .k, imports only", () => {
  const js = { name: "a.js", content: `import "${IMP}"` };
  assert.deepEqual(watchedSources(js, undefined, { self: JS, target: undefined }), [IMP]);
});

test("sourcesMoved: a .k whose sources have moved since it was built", () => {
  const k = { knitoutSources: [`${JS}#a`, `${LIB}#b`] };
  assert.equal(sourcesMoved(k, (url) => (url === LIB ? "b" : undefined)), false);
  assert.equal(sourcesMoved(k, (url) => (url === LIB ? "c" : undefined)), true);
  // the .js itself isn't looked at, and one not found yet hasn't moved
  assert.equal(sourcesMoved(k, (url) => (url === JS ? "z" : undefined)), false);
  assert.equal(sourcesMoved(undefined, () => "c"), false);
  assert.equal(sourcesMoved({}, () => "c"), false);
});

test("findOnce: each url once, and one that failed again after a while", () => {
  let time = 0;
  const finds = findOnce({ retryAfter: 30_000, now: () => time });
  assert.equal(finds.ask(LIB), true);
  assert.equal(finds.ask(LIB), false);
  finds.failed(LIB);
  time = 29_999;
  assert.equal(finds.ask(LIB), false);
  time = 30_000;
  assert.equal(finds.ask(LIB), true);
  // and only the one ask that's let through, while that find goes
  assert.equal(finds.ask(LIB), false);
  // a found one is never found again
  time = 1_000_000;
  assert.equal(finds.ask(LIB), false);
  assert.equal(finds.ask(OUT), true);
});

test("a .k that lists itself or its .js again among its sources isn't stale by its own write", () => {
  const api = fake({
    [K]: { source: JS, sources: [`${JS}#a`, `${K}#old`, `${JS}#old`, `${LIB}#b`] },
    [JS]: { target: K },
  });
  const headsNow = (url) => ({ [K]: "new", [JS]: "new", [LIB]: "b" })[url];
  assert.equal(buildState(K, api, { builds: {}, headsNow }), "built");
});

const PIN = "automerge:pinAAA";

test("a .js pins the docs it names with #heads, as written", () => {
  const doc = {
    name: "p.knitout.js",
    content: `import a from "/${PIN}#x|y"\nconst b = doc("${PIN}#x|y")\nconst c = doc("${LIB}")\nimport("${DYN}#z")\n`,
  };
  assert.deepEqual(pinsOf(doc), [`${PIN}#x|y`, `${DYN}#z`]);
  assert.deepEqual(pinsOf({ name: "p.k", content: `import a from "${PIN}#x"` }), []);
});

test("a .k whose only moved source is one its .js pins itself isn't stale", () => {
  const api = fake({
    [K]: { source: JS, sourceHash: "h", sources: [`${JS}#a`, `${PIN}#old`, `${LIB}#b`] },
    [JS]: { target: K, textHash: "h", pins: [`${PIN}#old`] },
  });
  let lib = "b";
  const headsNow = (url) => ({ [PIN]: "new", [LIB]: lib })[url];
  assert.equal(buildState(K, api, { builds: {}, headsNow }), "built");
  // nor building forever, with autobuild on
  assert.equal(buildState(K, api, { builds: { [JS]: { auto: true, builder: {} } }, headsNow }), "built");
  // but one it reads as it is now that's moved still is
  lib = "c";
  assert.equal(buildState(K, api, { builds: {}, headsNow }), "stale");
});

test("a doc pinned by a .js the pattern imports isn't stale either", () => {
  const api = fake({
    [K]: { source: JS, sources: [`${JS}#a`, `${LIB}#b`, `${PIN}#old`] },
    [JS]: { target: K, imports: [LIB] },
    [LIB]: { pins: [`${PIN}#old`] },
  });
  const headsNow = (url) => ({ [PIN]: "new", [LIB]: "b" })[url];
  assert.equal(buildState(K, api, { builds: {}, headsNow }), "built");
});

test("sourcesMoved: a source the code pins never has", () => {
  const k = { knitoutSources: [`${JS}#a`, `${PIN}#old`, `${LIB}#b`] };
  const headsNow = (url) => ({ [PIN]: "new", [LIB]: "b" })[url];
  assert.equal(sourcesMoved(k, headsNow, { pinned: [`${PIN}#old`] }), false);
  assert.equal(sourcesMoved(k, headsNow), true);
  assert.equal(sourcesMoved(k, (url) => ({ [PIN]: "new", [LIB]: "c" })[url], { pinned: [`${PIN}#old`] }), true);
});

test("watchedSources: a doc only ever read at the heads the code pins isn't watched", () => {
  const js = { name: "a.js", content: `import a from "${PIN}#old"\nimport "${IMP}"` };
  const k = { knitoutSources: [`${JS}#h1`, `${PIN}#old`, `${IMP}#h2`, `${DYN}#h3`] };
  assert.deepEqual(watchedSources(js, k, { self: JS, target: K }), [IMP, DYN]);
  // one also read as it is now is
  const both = { name: "a.js", content: `import a from "${PIN}#old"\nconst b = doc("${PIN}")` };
  const built = { knitoutSources: [`${JS}#h1`, `${PIN}#old`, `${PIN}#h4`] };
  assert.deepEqual(watchedSources(both, built, { self: JS, target: K }), [PIN]);
  // and so is one a module the pattern imports pins, unless it's said
  const lib = { knitoutSources: [`${JS}#h1`, `${LIB}#h5`, `${PIN}#old`] };
  const usesLib = { name: "a.js", content: `import "${LIB}"` };
  assert.deepEqual(watchedSources(usesLib, lib, { self: JS, target: K }), [LIB, PIN]);
  assert.deepEqual(watchedSources(usesLib, lib, { self: JS, target: K, pinned: [`${PIN}#old`] }), [LIB]);
});
