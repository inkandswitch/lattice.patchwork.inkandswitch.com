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

const none = {
  target: null,
  source: null,
  sourceHash: null,
  copyOf: null,
  builtAt: null,
  sources: [],
  webSources: [],
  kcodeTarget: null,
  kcodeSource: null,
  kcodeSourceHash: null,
  kcodeBuiltAt: null,
  kcodeSources: [],
  kcodeWebSources: [],
};

test("a doc without them has none", () => {
  assert.deepEqual(knitoutOf({}), none);
  assert.deepEqual(knitoutOf(undefined), none);
  assert.deepEqual(knitoutOf({ knitoutSources: "nope", kcodeSources: {} }), none);
});

test("the sources and kcode fields come out as plain strings, however they're kept", () => {
  const a = "automerge:a#1";
  for (const kept of [(s) => s, (s) => new ImmutableString(s)]) {
    const out = knitoutOf({
      knitoutSources: [kept(a)],
      kcodeTarget: kept("automerge:t"),
      kcodeSource: kept("automerge:k"),
      kcodeSourceHash: kept("abc"),
      kcodeBuiltAt: 5,
      kcodeSources: [kept(a), kept("automerge:b#2")],
    });
    assert.deepEqual(out.sources, [a]);
    assert.equal(out.kcodeTarget, "automerge:t");
    assert.equal(out.kcodeSource, "automerge:k");
    assert.equal(out.kcodeSourceHash, "abc");
    assert.equal(out.kcodeBuiltAt, 5);
    assert.deepEqual(out.kcodeSources, [a, "automerge:b#2"]);
  }
});
