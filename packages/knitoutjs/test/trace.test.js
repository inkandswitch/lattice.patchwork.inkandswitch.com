import { test } from "node:test";
import assert from "node:assert/strict";
import { tracer } from "../core/trace.js";

const W = "automerge:2Wwitch";
const V = "automerge:3Vother";
const urls = (found) => found.map((each) => each.url);

test("a line that reads an imported doc itself", () => {
  const code = `import k from "knitout"\nimport witch from "${W}"\nconst w = new k.Writer({carriers: ["3"]})\nif (witch.pixels[0][0]) w.knit("+", "f1", "3")`;
  const found = tracer(code)(4);
  assert.deepEqual(found, [{ url: W, name: "witch", line: 2, via: [] }]);
});

test("through a copy into a local array, and the loops round the line", () => {
  const code = [
    `import witch from "${W}"`,
    `import {cols} from "${V}"`,
    "const grid = []",
    "for (const row of witch.pixels) grid.push(row.map(c => c > 0))",
    "for (let x = 0; x < cols; x++) {",
    "  const on = grid[0][x]",
    "  if (on)",
    "    k.knit('+', `f${x}`, '3')",
    "}",
  ].join("\n");
  const found = tracer(code)(8);
  assert.deepEqual(urls(found).sort(), [W, V].sort());
  const witch = found.find((each) => each.url === W);
  assert.deepEqual(witch.via.map((step) => step.name ?? step.kind), ["if", "on", "grid", "row"]);
  const cols = found.find((each) => each.url === V);
  assert.equal(cols.name, "cols");
  assert.deepEqual(cols.via, [{ kind: "loop", line: 5 }]);
});

test("through a function, and its parameters' arguments", () => {
  const code = [
    `import witch from "${W}"; import {doc} from "lattice"`,
    "function colour(x, y) { return witch.pixels[y][x] }",
    "const stitch = (c) => c ? 'f' : 'b'",
    `const other = doc("${V}")`,
    "function row(r) { for (let x = 0; x < 2; x++) k.knit('+', stitch(colour(x, r)) + x, '3') }",
    "row(other.start)",
  ].join("\n");
  const found = tracer(code)(5);
  assert.deepEqual(urls(found).sort(), [W, V].sort());
  assert.deepEqual(found.find((each) => each.url === V).via.map((step) => step.name), ["r", "other"]);
});

test("a name of the same name somewhere else isn't this one", () => {
  const code = [
    `import witch from "${W}"`,
    "function f() { const witch = 1; return witch }",
    "k.knit('+', 'f' + f(), '3')",
  ].join("\n");
  assert.deepEqual(tracer(code)(3), []);
});

test("assignments, and nothing from a doc", () => {
  const code = [`import witch from "${W}"`, "let a = 0", "a = witch.width", "k.knit('+', 'f' + a, '3')", "k.knit('+', 'f1', '3')"].join(
    "\n",
  );
  const trace = tracer(code);
  assert.deepEqual(urls(trace(4)), [W]);
  assert.deepEqual(trace(5), []);
  assert.deepEqual(trace(99), []);
});

test("lattice's doc(), whatever it's imported as, and not a doc() of no import", () => {
  const code = [
    'import * as lattice from "lattice"',
    `const a = lattice.doc("${W}")`,
    `const b = doc("${V}")`,
    "k.knit('+', 'f' + a.x + b.y, '3')",
  ].join("\n");
  assert.deepEqual(urls(tracer(code)(4)), [W]);
});
