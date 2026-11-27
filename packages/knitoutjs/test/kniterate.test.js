import { test } from "node:test";
import assert from "node:assert/strict";
import { evalJS } from "../core/vendor/evalJS.js";
import { instrument } from "../core/instrument.js";
import { linkGraph, NotReady } from "../core/modules.js";
import { addWasteSection, bindoff } from "../core/kniterate.js";

// a pattern, instrumented and run as the worker runs it, with what it's
// handed for "lattice"
async function run(code) {
  const lattice = linkGraph({}, { makeUrl: (text) => text, suspend: (url) => new NotReady(url) }).lattice;
  let error = null;
  const knitout = await evalJS(instrument(code).code, {
    globals: { __loop() {}, __at: (_, x) => x, __import() {}, __see() {}, repo: null, __lattice: lattice },
    onError: (e) => (error = e),
  });
  if (error) throw error;
  return knitout.split("\n").map((line) => line.replace(/\s*;!source:.*$/, ""));
}

const writer = 'import knitout from "knitout"\nconst k = new knitout.Writer({ carriers: ["1", "2", "3", "4", "5", "6"] })\n';

for (const name of ["lattice", "knitout-utilities/kniterate", "kniterate-utilities"]) {
  test(`bindoff and addWasteSection come from "${name}"`, async () => {
    const ops = await run(
      `import {bindoff, addWasteSection} from "${name}"\n` +
        writer +
        'addWasteSection(k, ["2"], "2", 0, 9)\nbindoff(k, "+", 0, 9, "2")\nk.write("x.k")',
    );
    assert.ok(ops.includes("in 6"));
    assert.ok(ops.includes("out 1"));
    assert.ok(ops.includes("knit + f9 2"));
  });
}

test("the default import and a namespace have them too", async () => {
  for (const imported of ['import utils from "kniterate-utilities"', 'import * as utils from "knitout-utilities/kniterate"']) {
    const ops = await run(`${imported}\n${writer}k.in("2")\nutils.bindoff(k, "-", 0, 3, "2")\nk.write("x.k")`);
    assert.ok(ops.includes("knit - f0 2"));
  }
});

// what's called on k, in order
function recorder() {
  const ops = [];
  const k = new Proxy({}, { get: (_, name) => (...args) => ops.push([name, ...args].join(" ")) });
  return { k, ops };
}

test("bindoff moves each loop onto the next, either way", () => {
  const right = recorder();
  bindoff(right.k, "+", 0, 2, "3");
  assert.deepEqual(right.ops.filter((op) => /^(xfer|knit|rack)/.test(op)), [
    "xfer f0 b0", "rack 1", "xfer b0 f1", "rack 0", "knit + f1 3",
    "xfer f1 b1", "rack 1", "xfer b1 f2", "rack 0", "knit + f2 3",
  ]);
  const left = recorder();
  bindoff(left.k, "-", 0, 2, "3");
  assert.deepEqual(left.ops.filter((op) => op.startsWith("knit")), ["knit - f1 3", "knit - f0 3"]);
  // the roller eases off as it goes, to 150
  assert.deepEqual(right.ops.filter((op) => op.startsWith("rollerAdvance") && op !== "rollerAdvance 0"), [
    "rollerAdvance 250", "rollerAdvance 200",
  ]);
});

test("addWasteSection brings in the main yarns, then waste and draw thread, and takes those out", () => {
  const { k, ops } = recorder();
  addWasteSection(k, ["3", "2"], "2", 0, 5);
  assert.deepEqual(ops.filter((op) => /^(in|out) /.test(op)), ["in 3", "in 2", "in 6", "in 1", "out 1", "out 6"]);
  // 71 passes of waste interlock and 3 of tube
  assert.equal(ops.filter((op) => op === "knit + f0 6").length, 36 + 2);
  // the cast on's half racked, and right to left
  const rack = ops.indexOf("rack -0.5");
  assert.deepEqual(ops.slice(rack + 1, rack + 3), ["knit - f5 2", "knit - b5 2"]);
});

test("addWasteSection takes other waste and draw carriers, and wants the cast on carrier among its own", () => {
  const { k, ops } = recorder();
  addWasteSection(k, ["2"], "2", 0, 3, { wasteCarrier: "5", drawCarrier: "4", stitchNumber: 6 });
  assert.deepEqual(ops.filter((op) => /^(in|out) /.test(op)), ["in 2", "in 5", "in 4", "out 4", "out 5"]);
  assert.ok(ops.includes("stitchNumber 6"));
  assert.throws(() => addWasteSection(recorder().k, ["2"], "3", 0, 3), /cast on carrier \(3\)/);
});

test("a module the pattern imports has them by any of lattice's names", async () => {
  const code = [
    'import {bindoff as a} from "lattice"',
    'import {bindoff as b} from "knitout-utilities/kniterate"',
    'import u, {addWasteSection as w} from "kniterate-utilities"',
    "export default [a, b, u.bindoff, w]",
  ].join("\n");
  const graph = linkGraph(
    { pins: { "automerge:m": "automerge:m#h" }, modules: [{ pinned: "automerge:m#h", code }] },
    { makeUrl: (text) => `data:text/javascript,${encodeURIComponent(text)}`, suspend: (url) => new NotReady(url) },
  );
  globalThis.__lattice = graph.lattice;
  try {
    const { default: got } = await import(graph.module("automerge:m"));
    assert.deepEqual(got, [bindoff, bindoff, bindoff, addWasteSection]);
  } finally {
    delete globalThis.__lattice;
  }
});
