import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanNode, flat, triples, SkitchDatatype, regionOf, maskOf, isLayer, atOf } from "../marks.js";

test("points go flat, to a tenth, and come back as triples", () => {
  const points = flat([
    [1.234, 5.678, 0.333],
    [2, 3],
  ]);
  assert.deepEqual(points, [1.2, 5.7, 0.33, 2, 3, 0.5]);
  assert.deepEqual(triples(points), [
    [1.2, 5.7, 0.33],
    [2, 3, 0.5],
  ]);
  assert.deepEqual(triples([1, 2]), []);
});

test("a drauu arrow keeps its shape and its arrowhead", () => {
  const arrow = {
    t: "g",
    a: {},
    c: [
      { t: "defs", a: {}, c: [{ t: "marker", a: { id: "a-1", orient: "auto" }, c: [{ t: "path", a: { d: "M0,-5L10,0L0,5", fill: "red" } }] }] },
      { t: "line", a: { x1: "0", y1: "0", x2: "9", y2: "9", stroke: "red", "marker-end": "url(#a-1)", "data-drauu_index": "0" } },
    ],
  };
  const clean = cleanNode(arrow);
  assert.equal(clean.c[1].a["marker-end"], "url(#a-1)");
  assert.equal(clean.c[1].a["data-drauu_index"], undefined);
  assert.equal(clean.c[0].c[0].c[0].a.d, "M0,-5L10,0L0,5");
});

test("nothing that runs, links or loads gets through", () => {
  assert.equal(cleanNode({ t: "script", a: {}, c: [] }), null);
  assert.equal(cleanNode({ t: "foreignObject", a: {}, c: [] }), null);
  const path = cleanNode({
    t: "path",
    a: { d: "M0 0", onclick: "alert(1)", href: "javascript:alert(1)", style: "fill:url(https://x)", fill: "url(https://x)" },
    c: [{ t: "image", a: { href: "x" } }, { t: "a", a: {} }],
  });
  assert.deepEqual(path, { t: "path", a: { d: "M0 0" }, c: [] });
});

test("a new skitch is an empty page", () => {
  const doc = {};
  SkitchDatatype.init(doc);
  assert.deepEqual(doc.marks, []);
  assert.equal(SkitchDatatype.getTitle(doc), "skitch");
});

// a width by height rgba image, with the pixels at these [x, y] set
const image = (width, height, set = []) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of set) data.set([255, 0, 0, 255], (y * width + x) * 4);
  return data;
};

test("a fill's region is what it changed, in runs, and back again", () => {
  const before = image(6, 4);
  const after = image(6, 4, [[1, 1], [2, 1], [4, 1], [2, 2]]);
  const region = regionOf(before, after, 6, 4, 0);
  assert.deepEqual([region.x, region.y, region.w, region.h], [1, 1, 4, 2]);
  assert.ok(region.runs instanceof Uint8Array);
  assert.deepEqual([...maskOf(region)], [1, 1, 0, 1, 0, 1, 0, 0]);
});

test("a fill grows a pixel to tuck under its lines, and nothing changed is no fill", () => {
  const region = regionOf(image(5, 5), image(5, 5, [[2, 2]]), 5, 5, 1);
  assert.deepEqual([region.x, region.y, region.w, region.h], [1, 1, 3, 3]);
  assert.deepEqual([...maskOf(region)], [0, 1, 0, 1, 1, 1, 0, 1, 0]);
  assert.equal(regionOf(image(3, 3), image(3, 3), 3, 3), null);
  assert.deepEqual([...maskOf({ w: 2, h: 1, runs: "nonsense" })], [0, 0]);
});

test("layers, and where they've been moved to", () => {
  assert.ok(isLayer({ id: "a", kind: "ink" }));
  assert.ok(isLayer({ id: "a", kind: "paint" }));
  assert.ok(isLayer({ id: "a", kind: "paint", mode: "draw" }));
  assert.ok(!isLayer({ id: "a", kind: "paint", mode: "erase" }));
  assert.ok(!isLayer({ id: "a", kind: "erase" }));
  assert.ok(!isLayer({ kind: "ink" }));
  assert.deepEqual(atOf({ at: [3, -4] }), [3, -4]);
  assert.deepEqual(atOf({}), [0, 0]);
  assert.deepEqual(atOf({ at: ["x", 2] }), [0, 2]);
});
