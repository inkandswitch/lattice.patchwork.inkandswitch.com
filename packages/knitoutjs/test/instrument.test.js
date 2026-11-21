import { test } from "node:test";
import assert from "node:assert/strict";
import { collectSources, instrument, isDocUrl } from "../core/instrument.js";

const pins = { "automerge:abc": "automerge:abc#h1" };

test("knitout imports become require", () => {
  assert.ok(instrument('import k from "knitout"\nk').code.startsWith('const k = require("knitout");'));
  assert.ok(instrument('import * as k from "knitout"').code.startsWith('const k = require("knitout");'));
  assert.ok(
    instrument('import {Writer as W, X} from "knitout"').code.startsWith(
      'const {Writer: W, X} = require("knitout");',
    ),
  );
});

test("doc imports become pinned __import", () => {
  const code = (src) => instrument(src, { pins }).code;
  assert.ok(code('\n\nimport r from "/automerge:abc"').includes('const r = (await __import(3, "automerge:abc#h1")).default;'));
  assert.ok(code('import * as r from "automerge:abc"').includes('const r = await __import(1, "automerge:abc#h1");'));
  assert.ok(code('import {a as b} from "automerge:abc"').includes('const {a: b} = await __import(1, "automerge:abc#h1");'));
  assert.ok(code('import "automerge:abc"').includes('await __import(1, "automerge:abc#h1");'));
  assert.ok(code('import r from "automerge:abc"').includes('__import(1, "automerge:abc#h1")'));
});

test("an unpinned import keeps its url", () => {
  assert.ok(instrument('import r from "automerge:abc"').code.includes('__import(1, "automerge:abc")'));
});

test("doc() and import() strings are pinned", () => {
  assert.ok(instrument('doc("automerge:abc").width', { pins }).code.includes('"automerge:abc#h1"'));
  assert.ok(instrument('import("automerge:abc")', { pins }).code.includes('__import(1, "automerge:abc#h1")'));
});

test("lines stay put", () => {
  const code = 'import {\n a,\n b\n} from "knitout"\nfoo()';
  const out = instrument(code).code;
  assert.equal(out.split("\n").length, code.split("\n").length);
  assert.ok(out.split("\n")[4].includes("foo"));
});

test("urls that aren't imports or doc() aren't sources", () => {
  const code = '// automerge:abc\nconst u = "automerge:abc"\nfoo("automerge:abc")';
  assert.deepEqual(collectSources(code), []);
  assert.ok(instrument(code, { pins }).code.includes('"automerge:abc"'));
  assert.ok(!instrument(code, { pins }).code.includes("#h1"));
});

test("collectSources finds each use", () => {
  const code = 'import a from "/automerge:abc"\nimport("automerge:abc#h2")\ndoc("automerge:abc")';
  assert.deepEqual(collectSources(code), [
    { url: "automerge:abc", line: 1, kind: "import" },
    { url: "automerge:abc#h2", line: 2, kind: "dynamic" },
    { url: "automerge:abc", line: 3, kind: "doc" },
  ]);
});

test("a url carrying heads is used at those heads", () => {
  assert.ok(instrument('doc("automerge:abc#h2")', { pins }).code.includes('"automerge:abc#h2"'));
});

test("isDocUrl", () => {
  assert.equal(isDocUrl("/automerge:abc"), "automerge:abc");
  assert.equal(isDocUrl("automerge:abc#h1,h2"), "automerge:abc#h1,h2");
  assert.equal(isDocUrl("knitout"), null);
  assert.equal(isDocUrl("automerge:a0l"), null);
});

test("loops still count", () => {
  assert.ok(instrument("for(;;){}").code.includes("{__loop(1);"));
});

test("calls note their line", () => {
  assert.ok(instrument("\nk.knit()").code.includes("__at(2, k).knit()"));
});
