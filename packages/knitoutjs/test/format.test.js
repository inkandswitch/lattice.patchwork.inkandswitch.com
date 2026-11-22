import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChanges, changesBetween, format, styleOf } from "../core/format.js";
import DEFAULT_SOURCE from "../core/default-source.js";

test("changes turn the text into the other, touching only what differs", () => {
  const cases = [
    ["", "a"],
    ["a", ""],
    ["const a=1", "const a = 1;"],
    ["f( 1,2 )\nk.knit('+')", 'f(1, 2);\nk.knit("+");'],
    ["for(let x=0;x<3;x++){a()}", "for (let x = 0; x < 3; x++) {\n\ta();\n}\n"],
    ["same", "same"],
  ];
  for (const [before, after] of cases) {
    const changes = changesBetween(before, after);
    assert.equal(applyChanges(before, changes), after, JSON.stringify(before));
    for (let i = 1; i < changes.length; i++) assert.ok(changes[i].from >= changes[i - 1].to);
  }
  assert.deepEqual(changesBetween("k.knit('+')", 'k.knit("+")'), [
    { from: 7, to: 8, insert: '"' },
    { from: 9, to: 10, insert: '"' },
  ]);
  assert.deepEqual(changesBetween("const a=1", "const a = 1"), [
    { from: 7, to: 7, insert: " " },
    { from: 8, to: 8, insert: " " },
  ]);
});

test("a big change is one change, and still right", () => {
  const before = Array.from({ length: 4000 }, (_, i) => `a${i}`).join(" ");
  const after = Array.from({ length: 4000 }, (_, i) => `b${i}`).join("\n");
  assert.equal(applyChanges(before, changesBetween(before, after)), after);
});

test("the style it's tidied in is the one it's written in", () => {
  const lattice = "import x from \"y\"\n\nconst {a, b} = x\nfor (const c of a) {\n\tk.knit(c)\n}\nconst f = q => q\n";
  assert.deepEqual(
    (({ useTabs, semi, singleQuote, bracketSpacing, arrowParens }) => ({ useTabs, semi, singleQuote, bracketSpacing, arrowParens }))(styleOf(lattice)),
    { useTabs: true, semi: false, singleQuote: false, bracketSpacing: false, arrowParens: "avoid" },
  );
  const knitout = "import x from 'y';\n\nconst { a, b } = x;\nfor (const c of a) {\n  k.knit(c);\n}\nconst f = (q) => q;\n";
  const style = styleOf(knitout);
  assert.equal(style.useTabs, false);
  assert.equal(style.tabWidth, 2);
  assert.equal(style.semi, true);
  assert.equal(style.singleQuote, true);
  assert.equal(style.bracketSpacing, true);
  assert.equal(style.arrowParens, "always");
});

test("a pattern's tidied, top-level await and all, and an untidy one's tidied by a few changes", async () => {
  const code = 'import witch from "automerge:abc"\nconst a = await  doc("automerge:abc")\nfor(const c of witch.pixels){k.knit("+",`f${c}`,"3")}\n';
  const { text } = await format(code);
  assert.equal(text, 'import witch from "automerge:abc"\nconst a = await doc("automerge:abc")\nfor (const c of witch.pixels) {\n\tk.knit("+", `f${c}`, "3")\n}\n');
  const tidy = await format(DEFAULT_SOURCE);
  assert.ok(tidy.text);
  assert.equal((await format(tidy.text)).text, tidy.text);
  assert.ok(changesBetween(DEFAULT_SOURCE, tidy.text).length > 0);
});

test("code it can't read says where", async () => {
  const { error } = await format("const a = \n\nfor (");
  assert.equal(error.line, 3);
  assert.ok(error.message);
});
