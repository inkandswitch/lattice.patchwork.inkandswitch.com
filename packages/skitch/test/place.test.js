import { test } from "node:test";
import assert from "node:assert/strict";
import { IDENTITY, placeOf, matrixOf, invert, multiply, transform, resized, turned, matrixFrom, sizeOf } from "../place.js";

const near = (a, b, label) => a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < 1e-6, `${label}: ${a} vs ${b}`));

test("a place is every field, checked", () => {
  assert.deepEqual(placeOf({}), { at: [0, 0], turn: 0, scale: [1, 1], pivot: null });
  assert.deepEqual(placeOf({ at: [1, "x"], turn: "nope", scale: [0, -0.001], pivot: [5, 6] }), { at: [1, 0], turn: 0, scale: [0.02, -0.02], pivot: [5, 6] });
});

test("only moved is only a translation, whatever the pivot", () => {
  near(matrixOf(placeOf({ at: [3, 4] }), [100, 100]), [1, 0, 0, 1, 3, 4], "moved");
  near(matrixOf(placeOf({})), IDENTITY, "nothing");
});

test("turned about its pivot, the pivot stays put", () => {
  const place = placeOf({ at: [10, 0], turn: 90, pivot: [50, 50] });
  const m = matrixOf(place);
  near(transform(m, [50, 50]), [60, 50], "pivot");
  near(transform(m, [60, 50]), [60, 60], "a point to its right goes below");
  near(transform(multiply(invert(m), m), [7, 9]), [7, 9], "and back");
  assert.ok(Math.abs(sizeOf(m) - 1) < 1e-9);
});

test("sized from a corner, the opposite corner stays where it was", () => {
  const box = { corner: [100, 100], opposite: [0, 0] };
  for (const start of [placeOf({}), placeOf({ at: [20, -5], turn: 30, scale: [1.5, 0.5], pivot: [50, 50] })]) {
    const before = transform(matrixOf(start, [50, 50]), box.opposite);
    const after = resized(start, [50, 50], box.corner, box.opposite, [300, 260]);
    near(transform(matrixOf(after), box.opposite), before, "opposite corner");
    // unturned, the corner goes to the pointer
    if (!start.turn) near(transform(matrixOf(after), box.corner), [300, 260], "corner");
  }
});

test("sized keeping its shape, both ways by as much", () => {
  const after = resized(placeOf({}), [50, 50], [100, 100], [0, 0], [200, 180], true);
  assert.ok(Math.abs(after.scale[0] - after.scale[1]) < 1e-9);
  assert.ok(after.scale[0] > 1.8 && after.scale[0] < 2);
});

test("a flat line keeps its height when it's sized", () => {
  const after = resized(placeOf({}), [50, 0], [100, 0], [0, 0], [200, 40]);
  assert.deepEqual(after.scale, [2, 1]);
});

test("turning: by the angle the pointer went round, and to 15° with shift", () => {
  const start = placeOf({ at: [0, 0] });
  const quarter = turned(start, [0, 0], [10, 0], [0, 10]);
  assert.ok(Math.abs(quarter.turn - 90) < 1e-9);
  assert.deepEqual(quarter.pivot, [0, 0]);
  assert.equal(turned(start, [0, 0], [10, 0], [10, 2], true).turn, 15);
  assert.ok(Math.abs(turned(placeOf({ turn: 170 }), [0, 0], [10, 0], [0, 10]).turn - -100) < 1e-9);
});

test("an erase's `on`: an old offset, or a matrix", () => {
  assert.deepEqual(matrixFrom([3, 4]), [1, 0, 0, 1, 3, 4]);
  assert.deepEqual(matrixFrom([1, 0, 0, 1, 5, 6]), [1, 0, 0, 1, 5, 6]);
  assert.deepEqual(matrixFrom("x"), [1, 0, 0, 1, 0, 0]);
});

test("sized past the opposite corner, it grows that way, never turned inside out", () => {
  const start = placeOf({});
  // the bottom right corner, dragged up and left past the top left one
  const past = resized(start, [50, 50], [100, 100], [0, 0], [-80, -60]);
  near(past.scale, [0.8, 0.6], "scale");
  near(transform(matrixOf(past), [100, 100]), [0, 0], "the corner's where the opposite one was");
  near(transform(matrixOf(past), [0, 0]), [-80, -60], "and the opposite one's at the pointer");
  // only one way past: that way flips round, the other as dragged
  const sideways = resized(start, [50, 50], [100, 100], [0, 0], [-30, 150]);
  near(sideways.scale, [0.3, 1.5], "sideways scale");
  near(transform(matrixOf(sideways), [100, 0]), [0, 0], "what stays");
  near(transform(matrixOf(sideways), [0, 100]), [-30, 150], "the pointer's corner");
  // keeping its shape, too
  const shaped = resized(start, [50, 50], [100, 100], [0, 0], [-80, -60], true);
  assert.ok(shaped.scale[0] > 0 && Math.abs(shaped.scale[0] - shaped.scale[1]) < 1e-9);
  near(transform(matrixOf(shaped), [100, 100]), [0, 0], "shaped: what stays");
  // turned, past it: the same, in its turned frame
  const turnedStart = placeOf({ turn: 40, pivot: [50, 50] });
  const fixed = transform(matrixOf(turnedStart), [0, 0]);
  const turnedPast = resized(turnedStart, [50, 50], [100, 100], [0, 0], [fixed[0] - 40, fixed[1] - 70]);
  assert.ok(turnedPast.scale[0] > 0 && turnedPast.scale[1] > 0);
  near(transform(matrixOf(turnedPast), [100, 100]), fixed, "turned: what stays");
  // dragged right onto the opposite corner: as small as it goes, not nothing
  assert.ok(resized(start, [50, 50], [100, 100], [0, 0], [0, 0]).scale.every((n) => n > 0));
  // and something already flipped stays the way it is
  const flipped = resized(placeOf({ scale: [-1, 1] }), [50, 50], [100, 100], [0, 0], [300, 300]);
  assert.ok(flipped.scale[0] < 0);
});

test("several turned together go round their middle, and turn as they go", async () => {
  const { turnedAbout, sizedAbout, angleAbout, factorAbout } = await import("../place.js");
  const one = placeOf({ at: [100, 0] });
  const half = turnedAbout(one, [0, 0], [0, 0], 180);
  near(half.at, [-100, 0], "round");
  assert.equal(Math.abs(half.turn), 180);
  // where its own point is, it agrees with its matrix
  near(transform(matrixOf(half), [0, 0]), [-100, 0], "matrix");
  const sized = sizedAbout(placeOf({ at: [10, 10] }), [0, 0], [0, 0], 2);
  near(sized.at, [20, 20], "away from the fixed point");
  near(sized.scale, [2, 2], "and bigger");
  assert.equal(Math.round(angleAbout([0, 0], [10, 0], [0, 10])), 90);
  assert.equal(angleAbout([0, 0], [10, 0], [10, 2], true), 15);
  assert.equal(factorAbout([0, 0], [10, 10], [20, 20]), 2);
  assert.equal(factorAbout([0, 0], [10, 10], [-20, -20]), 0.05);
});
