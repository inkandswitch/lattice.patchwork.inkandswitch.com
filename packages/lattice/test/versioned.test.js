import { test } from "node:test";
import assert from "node:assert/strict";
import { unversioned, versioned } from "../versioned.js";

const at = { origin: "https://dev.example", version: 7, packages: ["lattice", "wm", "versions"] };

test("a versioned path is the same path without its version", () => {
  assert.equal(unversioned("/v7/packages/wm/call/call.js"), "/packages/wm/call/call.js");
  assert.equal(unversioned("/v123/packages/lattice/"), "/packages/lattice/");
});

test("anything else isn't versioned", () => {
  assert.equal(unversioned("/packages/wm/call.js"), null);
  assert.equal(unversioned("/v7/src/main.ts"), null);
  assert.equal(unversioned("/vx/packages/wm/a.js"), null);
});

test("a versioned path can't climb out of /packages/", () => {
  assert.equal(unversioned("/v7/../etc/passwd"), null);
  assert.equal(unversioned("/v7/packages/../../etc/passwd"), null);
  assert.equal(unversioned("/v7/packages/wm/.."), null);
});

test("one of ours, at a version", () => {
  assert.equal(
    versioned("https://dev.example/packages/lattice/index.js", at),
    "https://dev.example/v7/packages/lattice/index.js",
  );
  // from an earlier version
  assert.equal(
    versioned("https://dev.example/v3/packages/versions/", at),
    "https://dev.example/v7/packages/versions/",
  );
  assert.equal(
    versioned("https://dev.example/packages/wm/a.js?x=1", at),
    "https://dev.example/v7/packages/wm/a.js?x=1",
  );
});

test("not ours: another origin, another package, or not a url", () => {
  assert.equal(versioned("https://lattice.example/packages/lattice/index.js", at), null);
  assert.equal(versioned("https://dev.example/packages/providers/index.js", at), null);
  assert.equal(versioned("automerge:abc", at), null);
  assert.equal(versioned("system", at), null);
  assert.equal(versioned(undefined, at), null);
});
