import { test } from "node:test";
import assert from "node:assert/strict";
import { completionAt, definitionDoc, docRefAt, dropImport, findWithin, importLineAt, keysOf, toolFor } from "../core/doc-refs.js";

const A = "automerge:2Qf9bTzK3xJvPq7YwHnE5RcLmA8d";
const never = () => false;

test("a doc ref is the url in an import's string", () => {
  const code = `import r from "${A}"\nr`;
  assert.equal(docRefAt(code, code.indexOf("automerge") + 3), A);
});

test("a doc ref is the url in doc()'s string, unpinned", () => {
  const code = `const d = doc("/${A}#abc|def")`;
  assert.equal(docRefAt(code, code.indexOf("automerge") + 3), A);
});

test("a doc ref is an identifier bound by an import of a doc", () => {
  const code = `import r from "${A}"\nimport {x, y as z} from "${A}"\nimport * as ns from "${A}"\nr; x; z; ns`;
  for (const name of ["r;", "x;", "z;", "ns"]) {
    assert.equal(docRefAt(code, code.lastIndexOf(name) + 1), A, name);
  }
});

test("a doc ref is null in a comment and on an unrelated identifier", () => {
  const code = `// "${A}"\nimport r from "${A}"\nother; // r`;
  assert.equal(docRefAt(code, code.indexOf("automerge") + 3), null);
  assert.equal(docRefAt(code, code.indexOf("other") + 1), null);
  assert.equal(docRefAt(code, code.lastIndexOf("r")), null);
});

test("a string that isn't a doc url is not a doc ref", () => {
  const code = `import r from "./r.js"`;
  assert.equal(docRefAt(code, code.indexOf("r.js") + 1), null);
});

test("completion after doc(url). is the doc's top level", () => {
  const code = `const d = doc("${A}").`;
  assert.deepEqual(completionAt(code, code.length, { isJs: never }), { url: A, path: [], from: code.length });
});

test("completion after doc(url).a.b. is that path, and from is where the typed member starts", () => {
  const code = `doc("${A}").size.wi`;
  assert.deepEqual(completionAt(code, code.length, { isJs: never }), {
    url: A,
    path: ["size"],
    from: code.length - 2,
  });
});

test("completion after a binding of a doc is its top level", () => {
  const code = `import r from "${A}"\nr.`;
  assert.deepEqual(completionAt(code, code.length, { isJs: never }), { url: A, path: [], from: code.length });
});

test("completion after a binding's member is the path", () => {
  const code = `import * as r from "${A}"\nr.a.b.`;
  assert.deepEqual(completionAt(code, code.length, { isJs: never })?.path, ["a", "b"]);
});

test("completion after a named import starts at that key", () => {
  const code = `import {size as s} from "${A}"\ns.`;
  assert.deepEqual(completionAt(code, code.length, { isJs: never })?.path, ["size"]);
});

test("completion is null for a binding of a .js (a module, not a doc value)", () => {
  const code = `import r from "${A}"\nr.`;
  assert.equal(completionAt(code, code.length, { isJs: (url) => url === A }), null);
});

test("completion after doc(url). ignores isJs", () => {
  const code = `doc("${A}").`;
  assert.deepEqual(completionAt(code, code.length, { isJs: () => true })?.path, []);
});

test("completion is null in a comment, a string, and after an unbound name", () => {
  for (const code of [`// doc("${A}").`, `"doc('${A}').`, `import r from "${A}"\nq.`, `import r from "${A}"\nx.r.`]) {
    assert.equal(completionAt(code, code.length, { isJs: never }), null, code);
  }
});

test("keys of a doc's top level, with what each holds", () => {
  const value = { width: 1, name: "x", rows: [], on: true, at: new Date(0), bits: new Uint8Array(1), gone: null, deep: { a: 1 } };
  assert.deepEqual(keysOf(value, []), [
    { label: "width", detail: "number" },
    { label: "name", detail: "string" },
    { label: "rows", detail: "list" },
    { label: "on", detail: "boolean" },
    { label: "at", detail: "date" },
    { label: "bits", detail: "bytes" },
    { label: "gone", detail: "null" },
    { label: "deep", detail: "map" },
  ]);
});

test("keys at a path, and none where there's nothing to complete", () => {
  const value = { size: { w: 1 }, list: [1], n: 3 };
  assert.deepEqual(keysOf(value, ["size"]), [{ label: "w", detail: "number" }]);
  assert.deepEqual(keysOf(value, ["list"]), []);
  assert.deepEqual(keysOf(value, ["n"]), []);
  assert.deepEqual(keysOf(value, ["missing", "x"]), []);
});

test("a .js opens in the code editor, anything else in its own tool", () => {
  assert.equal(toolFor({ name: "a.knitout.js" }), "editor");
  assert.equal(toolFor({ name: "a.k" }), undefined);
  assert.equal(toolFor({ name: "x", extension: "js" }), "editor");
  assert.equal(toolFor({ width: 1 }), undefined);
  assert.equal(toolFor(undefined), undefined);
});

test("a definition in a doc's file is that doc", () => {
  const id = A.slice("automerge:".length);
  assert.equal(definitionDoc(`file:///${id}/index.js`), A);
  assert.equal(definitionDoc(`file:///${id}/index.d.ts`), A);
});

test("a definition anywhere else isn't a doc", () => {
  for (const uri of [
    "file:///lattice/globals.d.ts",
    "file:///lib.dom.d.ts",
    "file:///node_modules/typescript/lib/lib.es5.d.ts",
    "file:///0OIl/index.js",
    "file:///2Qf9/other.js",
    "https://example.com/x/index.js",
    undefined,
  ]) {
    assert.equal(definitionDoc(uri), null, String(uri));
  }
});

test("with names left to a language server, a doc ref is only a url's string", () => {
  const code = `import r from "${A}"\nr`;
  assert.equal(docRefAt(code, code.indexOf("automerge") + 3, { names: false }), A);
  assert.equal(docRefAt(code, code.length, { names: false }), null);
  assert.equal(docRefAt(code, code.length), A);
});

test("a doc dropped onto a pattern is an import of it, named after it", () => {
  assert.equal(dropImport("2x2 rib.knitout.js", A), `import _2x2Rib from "${A}"\n`);
  assert.equal(dropImport("Swatch Sizes", A), `import swatchSizes from "${A}"\n`);
  assert.equal(dropImport("...", A), `import doc from "${A}"\n`);
  // what it writes is a source like any other import
  const code = dropImport("lib.js", A);
  assert.equal(docRefAt(code, code.indexOf("automerge") + 3), A);
});

test("a find that takes too long is given up on, and tried again next time", async () => {
  let calls = 0;
  let answer = () => new Promise(() => {});
  const find = findWithin(() => (calls++, answer()), 20);
  await assert.rejects(find(A), /took too long/);
  answer = () => Promise.resolve("handle");
  assert.equal(await find(A), "handle");
  assert.equal(await find(A), "handle");
  assert.equal(calls, 2);
});

test("a find that fails is tried again next time", async () => {
  let calls = 0;
  const find = findWithin(() => (++calls === 1 ? Promise.reject(new Error("no")) : Promise.resolve("handle")), 1000);
  await assert.rejects(find(A), /no/);
  assert.equal(await find(A), "handle");
  assert.equal(calls, 2);
});

test("a find that throws straight away is a rejection, not a throw", async () => {
  const find = findWithin(() => {
    throw new Error("thrown");
  }, 1000);
  await assert.rejects(find(A), /thrown/);
});

test("a dropped import goes on the line it's dropped on, at the top level", () => {
  const code = `import knitout from "knitout"\n\nconst k = new knitout.Writer({ carriers: ["1"] })\nk.in("1")\n`;
  for (const line of [1, 2, 3, 4, 5]) assert.equal(importLineAt(code, line), line);
});

test("a dropped import goes above the statement it's dropped inside", () => {
  const code = [
    `const k = 1`, // 1
    `function rib(n) {`, // 2
    `  for (let i = 0; i < n; i++) {`, // 3
    `    k.knit("+", "f" + i, "1")`, // 4
    `  }`, // 5
    `}`, // 6
    `for (let i = 0; i < 3; i++)`, // 7
    `  rib(i)`, // 8
    `const sizes = {`, // 9
    `  small: 10,`, // 10
    `  large: 20,`, // 11
    `}`, // 12
    `k.write("out.k")`, // 13
  ].join("\n");
  assert.equal(importLineAt(code, 2), 2);
  for (const line of [3, 4, 5, 6]) assert.equal(importLineAt(code, line), 2);
  assert.equal(importLineAt(code, 8), 7);
  for (const line of [10, 11, 12]) assert.equal(importLineAt(code, line), 9);
  assert.equal(importLineAt(code, 13), 13);
  // past the end, the last line
  assert.equal(importLineAt(code, 40), 13);
  // a statement that starts partway along a line: the line it starts on
  assert.equal(importLineAt(`a(); function f() {\n  b()\n}\n`, 2), 1);
});
