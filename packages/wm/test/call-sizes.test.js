import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEAKING_AFTER, QUIET_AFTER, levelOf, speakingStep, tilesFor, videoFor, shownInBar } from "../call/sizes.js";

test("the sidebar's tiles: big while there are few, chips when there are many", () => {
  assert.equal(tilesFor(1), "tiles");
  assert.equal(tilesFor(4), "tiles");
  assert.equal(tilesFor(5), "grid");
  assert.equal(tilesFor(9), "grid");
  assert.equal(tilesFor(10), "chips");
  assert.equal(tilesFor(20), "chips");
});

test("the call bar: up to six faces, and how many more", () => {
  assert.deepEqual(shownInBar(["a", "b"]), { shown: ["a", "b"], more: 0 });
  const twenty = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(shownInBar(twenty), { shown: [0, 1, 2, 3, 4, 5], more: 14 });
});

test("video sent: less of it, the more people there are to send it to", () => {
  assert.equal(videoFor(1), null);
  assert.equal(videoFor(5), null);
  const six = videoFor(6);
  const ten = videoFor(10);
  assert.ok(six.maxBitrate > ten.maxBitrate);
  assert.ok(six.scaleResolutionDownBy < ten.scaleResolutionDownBy);
  assert.ok(ten.maxFramerate <= six.maxFramerate);
});

test("a level: silence is nothing, a full swing is loud", () => {
  assert.equal(levelOf(new Uint8Array(64).fill(128)), 0);
  const swing = Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0));
  assert.ok(levelOf(swing) > 0.9);
});

test("speaking: a moment's sound isn't, and a pause doesn't stop it", () => {
  let state = { speaking: false, loudSince: null, quietSince: null };
  // a click
  state = speakingStep(state, 0.3, 0);
  state = speakingStep(state, 0.0, 50);
  assert.equal(state.speaking, false);
  // talking
  state = speakingStep(state, 0.3, 1000);
  state = speakingStep(state, 0.3, 1000 + SPEAKING_AFTER);
  assert.equal(state.speaking, true);
  // a breath
  state = speakingStep(state, 0.0, 2000);
  state = speakingStep(state, 0.0, 2000 + QUIET_AFTER - 1);
  assert.equal(state.speaking, true);
  // stopped
  state = speakingStep(state, 0.0, 2000 + QUIET_AFTER);
  assert.equal(state.speaking, false);
});
