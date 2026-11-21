import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteSpecifiers, snapshotModule, moduleSources, runState, NotReady } from "../core/modules.js";

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
  const code = 'const m = await import("automerge:a")\nconst d = doc(\'automerge:a\').width\nimport "automerge:b"';
  assert.equal(
    rewriteSpecifiers(code, map),
    'const m = await import("automerge:a#h1|h2")\nconst d = doc("automerge:a#h1|h2").width\nimport "automerge:b"',
  );
});

test("moduleSources lists every literal doc url a module uses, exports too", () => {
  const code = 'import x from "automerge:a"\nexport {y} from "automerge:b"\ndoc("automerge:c")\nimport("knitout")';
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
