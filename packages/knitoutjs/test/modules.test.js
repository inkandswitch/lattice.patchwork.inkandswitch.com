import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteSpecifiers, snapshotModule, moduleSources, runState, NotReady, deepFreeze, linkGraph } from "../core/modules.js";
import { Picture } from "../core/get.js";

const map = { "automerge:a": "automerge:a#h1|h2", knitout: "blob:knitout" };

test("rewriteSpecifiers pins imports and exports, and leaves plain strings alone", () => {
  const code = [
    'import x from "automerge:a"',
    'export {y} from "/automerge:a"',
    'export * from "knitout"',
    'const s = "automerge:a"',
    'export const t = "automerge:a"',
  ].join("\n");
  assert.equal(
    rewriteSpecifiers(code, map),
    [
      'import x from "automerge:a#h1|h2"',
      'export {y} from "automerge:a#h1|h2"',
      'export * from "blob:knitout"',
      'const s = "automerge:a"',
      'export const t = "automerge:a"',
    ].join("\n"),
  );
});

test("rewriteSpecifiers pins dynamic imports and doc() strings", () => {
  const code = 'import {doc} from "lattice"; const m = await import("automerge:a")\nconst d = doc(\'automerge:a\').width\nimport "automerge:b"';
  assert.equal(
    rewriteSpecifiers(code, map),
    'import {doc} from "lattice"; const m = await import("automerge:a#h1|h2")\nconst d = doc("automerge:a#h1|h2").width\nimport "automerge:b"',
  );
});

test("moduleSources lists every literal doc url a module uses, exports too", () => {
  const code = 'import {doc} from "lattice"; import x from "automerge:a"\nexport {y} from "automerge:b"\ndoc("automerge:c")\nimport("knitout")';
  assert.deepEqual(moduleSources(code), [
    { url: "automerge:a", line: 1, kind: "import" },
    { url: "automerge:b", line: 2, kind: "export" },
    { url: "automerge:c", line: 3, kind: "doc" },
  ]);
});

test("snapshotModule gives the doc as its default and its fields by name", async () => {
  const pinned = "automerge:b#h";
  const value = { width: 20, "not a name": 1, class: 2, rows: [1, 2] };
  globalThis.__docs = { [pinned]: value };
  const text = snapshotModule(pinned, value);
  assert.match(text, /^const v = globalThis\.__docs\["automerge:b#h"\]; export default v;/);
  const module = await import(`data:text/javascript,${encodeURIComponent(text)}`);
  assert.equal(module.default, value);
  assert.equal(module.width, 20);
  assert.deepEqual(module.rows, [1, 2]);
  assert.equal("class" in module, false);
  delete globalThis.__docs;
});

test("snapshotModule doesn't trip over a field called v", async () => {
  const pinned = "automerge:c#h";
  const value = { v: 3, w: 4 };
  globalThis.__docs = { [pinned]: value };
  const module = await import(`data:text/javascript,${encodeURIComponent(snapshotModule(pinned, value))}`);
  assert.equal(module.default, value);
  assert.equal(module.v, 3);
  assert.equal(module.w, 4);
  delete globalThis.__docs;
});

test("snapshotModule of a value that isn't a map has only a default", async () => {
  globalThis.__docs = { "automerge:d#h": "hi" };
  const module = await import(`data:text/javascript,${encodeURIComponent(snapshotModule("automerge:d#h", "hi"))}`);
  assert.deepEqual(Object.keys(module), ["default"]);
  assert.equal(module.default, "hi");
  delete globalThis.__docs;
});

test("a caught NotReady still suspends", () => {
  const state = runState();
  assert.equal(state.suspendedUrl(), null);
  try {
    throw state.suspend("automerge:d");
  } catch (error) {
    // the sketch swallowed it
    assert.ok(error instanceof NotReady);
    assert.equal(error.url, "automerge:d");
  }
  state.suspend("automerge:e");
  assert.equal(state.suspendedUrl(), "automerge:d");
});

test("snapshotModule doesn't export globalThis or __docs", async () => {
  const pinned = "automerge:g#h";
  const value = { globalThis: 1, __docs: 2, width: 3 };
  globalThis.__docs = { [pinned]: value };
  const module = await import(`data:text/javascript,${encodeURIComponent(snapshotModule(pinned, value))}`);
  assert.deepEqual(Object.keys(module).sort(), ["default", "width"]);
  assert.equal(module.default.globalThis, 1);
  delete globalThis.__docs;
});

test("rewriteSpecifiers can leave doc() strings alone", () => {
  const code = 'import {doc} from "lattice"; import a from "automerge:a"\nconst b = doc("automerge:a")';
  assert.equal(
    rewriteSpecifiers(code, { "automerge:a": "blob:a" }, { docs: false }),
    'import {doc} from "lattice"; import a from "blob:a"\nconst b = doc("automerge:a")',
  );
});

test("a suspension keeps how and where the first ask was made", () => {
  const state = runState();
  assert.equal(state.suspension(), null);
  state.suspend("automerge:d", { kind: "doc", line: 3 });
  state.suspend("automerge:e", { kind: "dynamic", line: 9 });
  assert.deepEqual(state.suspension(), { url: "automerge:d", kind: "doc", line: 3 });
  assert.equal(state.suspendedUrl(), "automerge:d");
});

test("deepFreeze freezes a doc's maps and lists, and leaves bytes be", () => {
  const value = deepFreeze({ a: { b: [1, { c: 2 }] }, bytes: new Uint8Array([1]) });
  assert.ok(Object.isFrozen(value.a.b[1]));
  assert.throws(() => value.a.b.push(3));
  value.bytes[0] = 2;
  assert.equal(value.bytes[0], 2);
});

// node can import data: urls from data: urls, so the graph can be linked and
// run here the way the worker does with blob urls
const dataUrl = (text) => `data:text/javascript,${encodeURIComponent(text)}`;

test("linkGraph makes each module and doc importable, children first", async () => {
  const graph = {
    pins: { "automerge:a": "automerge:a#h", "automerge:b": "automerge:b#h", "automerge:w": "automerge:w#h" },
    modules: [
      { pinned: "automerge:b#h", code: 'import {Writer} from "knitout"\nexport default Writer' },
      {
        pinned: "automerge:a#h",
        code: 'import {doc} from "lattice"; import W from "automerge:b#h"\nimport {width} from "automerge:w#h"\nexport default [W, width, doc("automerge:w#h").width]',
      },
    ],
    snapshots: { "automerge:w#h": { width: 20 }, "automerge:j#h": { extension: "js", content: "x" } },
  };
  const asked = [];
  const run = linkGraph(graph, {
    makeUrl: dataUrl,
    suspend: (url, kind) => (asked.push([url, kind]), new NotReady(url)),
  });
  class Writer {}
  globalThis.__knitout = { Writer };
  globalThis.__docs = run.docs;
  globalThis.__lattice = run.lattice;
  try {
    const a = await import(run.module("/automerge:a"));
    assert.deepEqual(a.default, [Writer, 20, 20]);
    assert.equal(run.doc("automerge:w").width, 20);
    assert.equal(run.doc("automerge:w#h").width, 20);
    assert.ok(Object.isFrozen(run.doc("automerge:w")));
    // a .js read as a doc isn't a module yet
    assert.throws(() => run.module("automerge:j#h"), NotReady);
    assert.throws(() => run.doc("automerge:zz"), NotReady);
    assert.deepEqual(asked, [
      ["automerge:j#h", "dynamic"],
      ["automerge:zz", "doc"],
    ]);
    assert.throws(() => run.doc("not a url"), /doc\(\) takes an automerge url/);
    assert.equal(run.module("./thing.js"), null);
  } finally {
    delete globalThis.__knitout;
    delete globalThis.__docs;
    delete globalThis.__lattice;
  }
});

test("linkGraph's get() is what the graph got, made a Picture if it's pixels, and suspends for what it hasn't", () => {
  const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) };
  const graph = {
    gets: {
      "clever https://x.test/p.png": { value: pixels },
      "json https://x.test/a": { value: { n: 1 } },
      "text https://x.test/gone": { error: 'get("https://x.test/gone", "text"): 404' },
    },
  };
  const asked = [];
  const run = linkGraph(graph, {
    makeUrl: dataUrl,
    suspend: (url, kind, details) => (asked.push([url, kind, details]), new NotReady(url)),
  });
  const picture = run.get("https://x.test/p.png");
  assert.ok(picture instanceof Picture);
  assert.equal(picture.light(0, 0), 1);
  assert.equal(run.get("https://x.test/p.png"), picture);
  assert.deepEqual(run.lattice.get("https://x.test/a", "json"), { n: 1 });
  assert.ok(Object.isFrozen(run.get("https://x.test/a", "json")));
  assert.throws(() => run.get("https://x.test/gone", "text"), /404/);
  assert.throws(() => run.get("https://x.test/a"), NotReady);
  assert.deepEqual(asked, [["https://x.test/a", "get", { as: "clever" }]]);
  assert.throws(() => run.get("https://x.test/a", "wat"), TypeError);
  assert.throws(() => run.get(3), TypeError);
});

test("a module's import of lattice is its doc() and get()", async () => {
  const graph = {
    pins: { "automerge:a": "automerge:a#h" },
    modules: [
      {
        pinned: "automerge:a#h",
        code: 'import {doc, get} from "lattice"\nimport * as l from "lattice"\nimport L from "lattice"\nexport default [doc, get, l.doc, L.get]',
      },
    ],
  };
  // (a url of its own: node keeps what it's imported by url, and the test
  // before had the same shim. the worker's blob urls are new each run)
  const makeUrl = (text) => dataUrl(`${text}\n// a module's import of lattice`);
  const run = linkGraph(graph, { makeUrl, suspend: (url) => new NotReady(url) });
  globalThis.__lattice = run.lattice;
  try {
    const a = await import(run.module("automerge:a"));
    assert.deepEqual(a.default, [run.doc, run.get, run.doc, run.get]);
  } finally {
    delete globalThis.__lattice;
  }
});
