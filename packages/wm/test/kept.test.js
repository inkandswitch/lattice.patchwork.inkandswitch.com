import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOW_GRACE, keep, kept, keptFollow } from "../kept.js";
import { REJOIN_WITHIN, callToRejoin, forgetCall, keepCall, leavingCall } from "../call/rejoin.js";

function memory() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
}

test("kept: what's kept comes back, and nothing is the fallback", () => {
  const storage = memory();
  assert.equal(kept("k", "none", storage), "none");
  keep("k", { a: 1 }, storage);
  assert.deepEqual(kept("k", null, storage), { a: 1 });
  keep("k", null, storage);
  assert.equal(storage.items.has("k"), false);
});

test("kept: storage that throws, or isn't json, is the fallback", () => {
  const broken = {
    getItem() {
      throw new Error("no");
    },
    setItem() {
      throw new Error("no");
    },
  };
  assert.equal(kept("k", 7, broken), 7);
  keep("k", 1, broken);
  const storage = memory();
  storage.setItem("k", "{not json");
  assert.equal(kept("k", 7, storage), 7);
});

test("following: a follow kept from before is waited for, for a while", () => {
  const storage = memory();
  let now = 1000;
  keep("f", "peer-a", storage);
  const follow = keptFollow("f", { storage, now: () => now });
  assert.equal(follow.initial, "peer-a");
  assert.equal(follow.waiting("peer-a"), true);
  assert.equal(follow.waiting("peer-b"), false);
  now += FOLLOW_GRACE;
  assert.equal(follow.waiting("peer-a"), false);
});

test("following: heard, or changed, it's not waited for any more", () => {
  const storage = memory();
  keep("f", "peer-a", storage);
  const heard = keptFollow("f", { storage });
  heard.heard();
  assert.equal(heard.waiting("peer-a"), false);

  const changed = keptFollow("f", { storage });
  changed.set("peer-b");
  assert.equal(changed.waiting("peer-a"), false);
  assert.equal(kept("f", null, storage), "peer-b");
  changed.set(null);
  assert.equal(kept("f", "gone", storage), "gone");
});

test("following: nothing kept is nobody, never waited for", () => {
  const follow = keptFollow("f", { storage: memory() });
  assert.equal(follow.initial, null);
  assert.equal(follow.waiting(null), false);
});

test("rejoin: a call left by a reload is rejoined, as it was", () => {
  const storage = memory();
  keepCall({ room: "automerge:room", camera: true, mic: false }, { storage });
  // still in it: not one to rejoin
  assert.equal(callToRejoin("automerge:room", { now: 5000, storage }), null);
  leavingCall({ at: 5000, storage });
  assert.deepEqual(callToRejoin("automerge:room", { now: 6000, storage }), { camera: true, mic: false });
  assert.equal(callToRejoin("automerge:other", { now: 6000, storage }), null);
});

test("rejoin: not once it's too long ago, nor after hanging up", () => {
  const storage = memory();
  keepCall({ room: "automerge:room", camera: false, mic: true }, { storage });
  leavingCall({ at: 0, storage });
  assert.equal(callToRejoin("automerge:room", { now: REJOIN_WITHIN + 1, storage }), null);
  assert.ok(callToRejoin("automerge:room", { now: REJOIN_WITHIN, storage }));
  forgetCall({ storage });
  assert.equal(callToRejoin("automerge:room", { now: 1, storage }), null);
});

test("rejoin: leaving with no call kept keeps nothing", () => {
  const storage = memory();
  leavingCall({ at: 1, storage });
  assert.equal(storage.items.size, 0);
});
