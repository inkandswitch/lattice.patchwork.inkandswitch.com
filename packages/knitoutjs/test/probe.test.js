import { test } from "node:test";
import assert from "node:assert/strict";
import { instrument } from "../core/instrument.js";
import { opPlace, preview, probeTarget } from "../core/probe.js";

const PATTERN = `const crab = {height: 7}
for (let r = 0; r < 3; ++r) {
  if (r%2 == 0) {
    for (let n = 5; n >= 4; --n) k.knit("+", "f" + n)
  } else [1, 2].forEach(x => k.knit("-", "b" + x))
}
crab.height
function f(a) { k.knit(a) }
f("z")
switch (crab.height) { case 7: let s = "seven"; k.knit(s) }
try { throw 1 } catch (e) { k.knit(e) }`;

// what `find` (at `offset` into it) was at each op, as the run would say
function seen(find, offset = 0, code = PATTERN) {
  const at = code.indexOf(find) + offset;
  const { code: run, probed } = instrument(code, { probe: at });
  if (!probed) return null;
  let see = null;
  const ops = [];
  const k = {
    knit: (...args) => {
      let value;
      try {
        value = see ? preview(see()) : "-";
      } catch (e) {
        value = `! ${e.message}`;
      }
      ops.push(`${args.join(" ")}=${value}`);
    },
  };
  new Function("k", "__see", "__loop", "__at", run)(k, (read) => (see = read), () => {}, (_, v) => v);
  return { text: probed.text, ops };
}

test("a loop's variable, from its header, its body, or a condition", () => {
  const expect = ["+ f5=0", "+ f4=0", "- b1=1", "- b2=1", "+ f5=2", "+ f4=2"];
  for (const [find, offset] of [["r = 0", 0], ["r%2", 0], ["++r", 2]]) {
    const { text, ops } = seen(find, offset);
    assert.equal(text, "r");
    assert.deepEqual(ops.slice(0, 6), expect);
  }
});

test("an inner loop's, and an arrow's parameter, are the last they were when out of them", () => {
  assert.deepEqual(seen('"f" + n', 6).ops.slice(0, 6), ["+ f5=5", "+ f4=4", "- b1=4", "- b2=4", "+ f5=5", "+ f4=4"]);
  assert.deepEqual(seen('"b" + x', 6).ops.slice(0, 6), ["+ f5=-", "+ f4=-", "- b1=1", "- b2=2", "+ f5=2", "+ f4=2"]);
});

test("a chain off a name is seen from where the name's declared, not only once its line runs", () => {
  const { text, ops } = seen("crab.height", 6);
  assert.equal(text, "crab.height");
  assert.ok(ops.every((op) => op.endsWith("=7")), ops.join(" "));
  assert.equal(seen("crab", 0).ops[0], "+ f5={height: 7}");
});

test("a parameter, a switch's let, a catch's error", () => {
  assert.equal(seen("f(a", 2).ops.at(-3), "z=\"z\"");
  assert.equal(seen("k.knit(s", 7).ops.at(-2), "seven=\"seven\"");
  assert.equal(seen("catch (e", 7).ops.at(-1), "1=1");
});

test("not a method being called, nor a chain that does something, nor a keyword", () => {
  assert.equal(probeTarget(PATTERN, PATTERN.indexOf("knit")), null);
  assert.equal(probeTarget("a().b", 4), null);
  assert.equal(probeTarget("for (;;) {}", 1), null);
  assert.equal(probeTarget("a.b.c", 2).text, "a.b");
});

test("a name the pattern doesn't declare is seen from its line", () => {
  const code = "k.knit(1)\nk.knit(Math.PI > 3)";
  const { ops } = seen("Math.PI", 6, code);
  assert.deepEqual(ops, ["1=-", "true=3.141592653589793"]);
});

test("an op's place: after the header and the sources line", () => {
  const k = ";!knitout-2\n;;Carriers: 1 2\nx-patchwork-sources automerge:a\nin 1 ;!source:3\nknit + f1 1 ;!source:4";
  assert.equal(opPlace(k, 4), 0);
  assert.equal(opPlace(k, 5), 1);
});

test("values said short", () => {
  assert.equal(preview("f12"), '"f12"');
  assert.equal(preview([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "[1, 2, 3, 4, 5, 6, 7, 8, … 2 more]");
  assert.equal(preview({ a: { b: { c: 1 } } }), "{a: {b: {…}}}");
  class Writer {
    constructor() {
      this.carriers = {};
    }
  }
  assert.equal(preview(new Writer()), "Writer {carriers: {}}");
  assert.equal(preview(function knit() {}), "ƒ knit()");
  assert.ok(preview("x".repeat(1000)).length <= 240);
});
