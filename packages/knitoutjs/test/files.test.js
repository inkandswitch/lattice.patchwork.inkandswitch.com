import { test } from "node:test";
import assert from "node:assert/strict";
import { ImmutableString } from "@automerge/automerge";
import { knitoutOf } from "../core/files.js";

test("a doc's knitout links come out as plain strings, however they're kept", () => {
  const url = "automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu";
  for (const kept of [url, new ImmutableString(url)]) {
    const links = knitoutOf({ knitoutTarget: kept, knitoutSource: kept, knitoutCopyOf: kept });
    assert.equal(links.target, url);
    assert.equal(links.source, url);
    assert.equal(links.copyOf, url);
  }
});

test("a doc without them has none", () => {
  assert.deepEqual(knitoutOf({}), { target: null, source: null, sourceHash: null, copyOf: null, builtAt: null });
  assert.deepEqual(knitoutOf(undefined), { target: null, source: null, sourceHash: null, copyOf: null, builtAt: null });
});
