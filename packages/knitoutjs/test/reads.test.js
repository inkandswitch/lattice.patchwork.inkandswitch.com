import { test } from "node:test";
import assert from "node:assert/strict";
import { deepFreeze } from "../core/modules.js";
import { FEW, pathText, readDocsOf, readLog, readsOf, readTag, watched, withReadDocs } from "../core/reads.js";

const witch = () => deepFreeze({ width: 2, pixels: [[0, 1], [2, 3]], palette: ["#fff", "#000"], title: "a, b=c" });

test("a watched doc reads as the doc does, and says each plain value read", () => {
  const seen = [];
  const doc = watched(witch(), (path, value) => seen.push([path.join("/"), value]));
  assert.equal(doc.pixels[1][0], 2);
  assert.equal(doc.pixels.length, 2);
  assert.ok(Array.isArray(doc.pixels));
  assert.deepEqual(seen, [["pixels/1/0", 2]]);
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), witch());
  assert.deepEqual(Object.keys(doc), ["width", "pixels", "palette", "title"]);
  assert.deepEqual(doc.pixels.map((row) => row[1]), [1, 3]);
  assert.equal(doc.pixels, doc.pixels);
});

test("a watched doc is read-only", () => {
  const doc = watched(witch(), () => {});
  assert.throws(() => {
    "use strict";
    doc.width = 3;
  });
  assert.equal(doc.width, 2);
  assert.throws(() => doc.pixels.push(4));
});

test("an op takes the few reads since the one before", () => {
  const log = readLog();
  log.note("automerge:w#h", ["pixels", "0", "1"], 1);
  assert.equal(log.take(), " ;!read:0:pixels/0/1=1");
  // the same turn, nothing new: the same
  assert.equal(log.take(), " ;!read:0:pixels/0/1=1");
  log.turn();
  assert.equal(log.take(), "");
  for (let i = 0; i <= FEW; i++) log.note("automerge:w#h", ["pixels", "0", String(i)], i);
  assert.equal(log.take(), "");
  log.note("automerge:v#h", ["a"], "x");
  log.forget();
  assert.equal(log.take(), "");
  assert.deepEqual(log.docs, ["automerge:w#h", "automerge:v#h"]);
});

test("a read tag says each read, escaped, and reads back", () => {
  const reads = [
    { doc: 0, path: ["pixels", "12", "4"], value: 2 },
    { doc: 1, path: ["a b", "c,d"], value: "x, y=z" },
  ];
  const tag = readTag(reads);
  assert.ok(!/[\s,]/.test(tag.trim().replace(/,(?=\d+:)/g, "")), tag);
  assert.deepEqual(readsOf(`knit + f1 3 ;!source:24${tag}`), reads);
  assert.deepEqual(readsOf("knit + f1 3 ;!source:24"), []);
  assert.equal(readTag([]), "");
});

test("the docs read are listed last, and read back", () => {
  const text = withReadDocs(";!knitout-2\nknit + f1 3", ["automerge:a#h", "automerge:b#i"]);
  assert.equal(text, ";!knitout-2\nknit + f1 3\n;!read-docs: automerge:a#h automerge:b#i\n");
  assert.deepEqual(readDocsOf(text), ["automerge:a#h", "automerge:b#i"]);
  assert.deepEqual(readDocsOf("knit + f1 3"), []);
  assert.equal(withReadDocs("knit", []), "knit");
});

test("a path reads as javascript", () => {
  assert.equal(pathText(["pixels", "12", "4"]), "pixels[12][4]");
  assert.equal(pathText(["a", "b c", "d"]), 'a["b c"].d');
});

test("a loop's turn before last is as far back as an op's reads go", () => {
  const log = readLog();
  const W = "automerge:w#h";
  // a grid copied first, then a loop over the doc's rows
  for (let i = 0; i < 4; i++) log.note(W, ["pixels", "0", String(i)], i);
  log.note(W, ["height"], 2);
  log.turn();
  log.note(W, ["width"], 2);
  log.turn();
  log.note(W, ["pixels", "0", "0"], 7);
  log.note(W, ["pixels", "0", "0"], 7);
  assert.equal(log.take(), " ;!read:0:width=2,0:pixels/0/0=7");
  // for (const c of row): c's read before its turn
  log.note(W, ["pixels", "0", "1"], 8);
  log.turn();
  assert.equal(log.take(), " ;!read:0:pixels/0/1=8");
});
