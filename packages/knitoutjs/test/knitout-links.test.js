import test from "node:test";
import assert from "node:assert/strict";
import { buildState, importsOf, links, watchedSources } from "../core/knitout-links.js";

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

test("a .k links to what it was built from, not live, past the .js itself", () => {
  const api = fake({ [K]: { source: JS, sources: [`${JS}#a`, `${LIB}#b`] }, [JS]: { target: K } });
  assert.deepEqual(
    links(K, api).map((l) => [l.url, l.label, l.live]),
    [[JS, "written by", true], [`${LIB}#b`, "built from", false]],
  );
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
