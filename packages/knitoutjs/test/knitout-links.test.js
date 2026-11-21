import test from "node:test";
import assert from "node:assert/strict";
import { buildState, links } from "../core/knitout-links.js";

const JS = "automerge:js";
const K = "automerge:k";
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
