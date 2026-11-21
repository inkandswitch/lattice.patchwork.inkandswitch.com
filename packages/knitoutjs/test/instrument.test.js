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

// original [line, column] of each generated segment start, per generated line
function decode(mappings) {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let line = 0;
  let column = 0;
  return mappings.split(";").map((segments) => {
    let generated = 0;
    return segments === ""
      ? []
      : segments.split(",").map((segment) => {
          const numbers = [];
          let value = 0;
          let shift = 0;
          for (const char of segment) {
            const digit = B64.indexOf(char);
            value |= (digit & 31) << shift;
            if (digit & 32) shift += 5;
            else {
              numbers.push(value & 1 ? -(value >> 1) : value >> 1);
              value = shift = 0;
            }
          }
          generated += numbers[0];
          line += numbers[2];
          column += numbers[3];
          return { generated, line, column };
        });
  });
}

// where `token` landed in the output, and the original column it maps to
function originalColumn(result, token) {
  const rows = result.code.split("\n");
  const row = rows.findIndex((text) => text.includes(token));
  const generated = rows[row].lastIndexOf(token);
  const segment = decode(result.mappings)[row].find((s) => s.generated === generated);
  return segment && { line: segment.line, column: segment.column };
}

test("tokens after a replaced string keep their columns", () => {
  const code = 'const w = doc("automerge:abc").width + 1';
  const result = instrument(code, { pins });
  assert.deepEqual(originalColumn(result, "width"), { line: 0, column: code.indexOf("width") });
});

test("tokens after a replaced import keep their columns", () => {
  const code = 'x; import a from "knitout"; y(1)';
  const result = instrument(code);
  assert.deepEqual(originalColumn(result, "y"), { line: 0, column: code.indexOf("y(") });
});

test("tokens after a multi-line import keep their columns", () => {
  const code = 'import {\n a,\n b\n} from "knitout"; foo(1)';
  const result = instrument(code);
  assert.deepEqual(originalColumn(result, "foo"), { line: 3, column: code.split("\n")[3].indexOf("foo") });
});

test("a default and a group are both bound", () => {
  const doc = instrument('import x, {a, b as c} from "automerge:abc"', { pins }).code;
  assert.ok(doc.includes('__m1 = await __import(1, "automerge:abc#h1")'));
  assert.ok(doc.includes("x = __m1.default"));
  assert.ok(doc.includes("{a, b: c} = __m1"));
  const k = instrument('import x, {a} from "knitout"').code;
  assert.ok(k.includes('__m1 = require("knitout")') && k.includes("x = __m1") && k.includes("{a} = __m1"));
});

test("a default and a namespace are both bound", () => {
  const doc = instrument('import x, * as y from "automerge:abc"', { pins }).code;
  assert.ok(doc.includes("x = __m1.default") && doc.includes("y = __m1"));
  const k = instrument('import x, * as y from "knitout"').code;
  assert.ok(k.includes('__m1 = require("knitout")') && k.includes("x = __m1") && k.includes("y = __m1"));
});

test("two combined imports get their own temporaries", () => {
  const code = instrument('import x, {a} from "knitout"; import y, {b} from "knitout"').code;
  assert.ok(code.includes("__m1") && code.includes("__m2"));
});
