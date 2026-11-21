import test from "node:test";
import assert from "node:assert/strict";
import { ImmutableString } from "@automerge/automerge";
import { asksFirst, createBuilder, readAutobuild, writeAutobuild } from "../core/builder-logic.js";
import { jsBuild } from "../core/js-build.js";
import { kcodeBuild } from "../../lattice/kcode.js";
import { stoatBuild } from "../../patternstoat/build-kind.js";

const JS = "automerge:js";
const K = "automerge:k";

// a handle that's only a doc, changed in place, telling whoever listens
function fakeHandle(url, doc) {
  const listeners = new Set();
  return {
    url,
    doc: () => doc,
    on: (event, fn) => listeners.add(fn),
    off: (event, fn) => listeners.delete(fn),
    change(fn) {
      fn(doc);
      for (const listener of [...listeners]) listener();
    },
  };
}

// localStorage, as far as autobuild uses it
function fakeStorage(values = {}) {
  return {
    values,
    getItem: (key) => (key in values ? values[key] : null),
    setItem: (key, value) => (values[key] = String(value)),
    removeItem: (key) => delete values[key],
  };
}

// a promise to settle by hand
function later() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// a kind whose builds are what the test says, and which counts them
function testKind(builds = []) {
  const runs = [];
  return {
    runs,
    targetField: "knitoutTarget",
    targetExtension: "k",
    targetName: (doc) => `${doc?.name ?? "pattern"}.k`,
    autobuild: { key: (url) => `test:${url}`, default: true },
    build(source, target, options) {
      const run = { source, target, options };
      runs.push(run);
      return builds.shift() ?? { message: "built" };
    },
  };
}

// a builder over a few fake docs: the source, and whatever's made
function setUp({ kind = testKind(), source = {}, docs = {}, storage = fakeStorage(), timers } = {}) {
  const handles = { [JS]: fakeHandle(JS, { name: "pattern", ...source }) };
  for (const [url, doc] of Object.entries(docs)) handles[url] = fakeHandle(url, doc);
  const made = [];
  const reported = [];
  const env = {
    repo: { find: async (url) => handles[url] },
    async createFile(name, fields) {
      const url = `automerge:new${made.length}`;
      made.push(name);
      handles[url] = fakeHandle(url, { name, content: "", ...fields });
      return url;
    },
    openIfClosed: () => {},
  };
  const builder = createBuilder(kind, JS, {
    source: handles[JS],
    env: () => env,
    storage,
    report: (said) => reported.push(said),
    timers,
  });
  return { builder, handles, made, reported, kind, storage };
}

test("each kind says where its autobuild is remembered, and whether it's on to start with", () => {
  assert.equal(jsBuild.autobuild.key(JS), `knitoutjs:autorun:${JS}`);
  assert.equal(jsBuild.autobuild.default, true);
  assert.equal(kcodeBuild.autobuild.key(K), `lattice:kcode-autobuild:${K}`);
  assert.equal(kcodeBuild.autobuild.default, false);
  assert.equal(stoatBuild.autobuild.default, true);
  assert.equal([jsBuild, kcodeBuild, stoatBuild].map((kind) => kind.targetExtension).join(" "), "k kc k");
  assert.equal([jsBuild, kcodeBuild, stoatBuild].map((kind) => kind.targetField).join(" "), "knitoutTarget kcodeTarget knitoutTarget");
});

test("autobuild is stored only when it isn't the default: a .js's as off, a .k's as on", () => {
  const storage = fakeStorage();
  assert.equal(readAutobuild(jsBuild.autobuild, JS, storage), true);
  writeAutobuild(jsBuild.autobuild, JS, false, storage);
  assert.deepEqual(storage.values, { [`knitoutjs:autorun:${JS}`]: "off" });
  assert.equal(readAutobuild(jsBuild.autobuild, JS, storage), false);
  writeAutobuild(jsBuild.autobuild, JS, true, storage);
  assert.deepEqual(storage.values, {});

  assert.equal(readAutobuild(kcodeBuild.autobuild, K, storage), false);
  writeAutobuild(kcodeBuild.autobuild, K, true, storage);
  assert.deepEqual(storage.values, { [`lattice:kcode-autobuild:${K}`]: "on" });
  assert.equal(readAutobuild(kcodeBuild.autobuild, K, storage), true);
  writeAutobuild(kcodeBuild.autobuild, K, false, storage);
  assert.deepEqual(storage.values, {});
});

test("storage that throws is the default, and writing to it doesn't throw", () => {
  const broken = {
    getItem() {
      throw new Error("no");
    },
    setItem() {
      throw new Error("no");
    },
    removeItem() {
      throw new Error("no");
    },
  };
  assert.equal(readAutobuild(jsBuild.autobuild, JS, broken), true);
  assert.equal(readAutobuild(kcodeBuild.autobuild, K, broken), false);
  writeAutobuild(jsBuild.autobuild, JS, false, broken);
});

test("a builder starts with its autobuild as stored, and says so", () => {
  const { builder, reported } = setUp({ storage: fakeStorage({ [`test:${JS}`]: "off" }) });
  assert.equal(builder.auto(), false);
  assert.equal(reported[0].auto, false);
  builder.setAuto(true);
  assert.equal(builder.auto(), true);
  assert.equal(reported.at(-1).auto, true);
});

test("its target is the one the source's doc says, as it changes", () => {
  const { builder, handles } = setUp({ source: { knitoutTarget: K }, docs: { [K]: {} } });
  assert.equal(builder.target(), K);
  builder.pickTarget("automerge:other");
  assert.equal(handles[JS].doc().knitoutTarget, "automerge:other");
  assert.equal(builder.target(), "automerge:other");
});

test("with no target and nothing to make one, it asks for one", async () => {
  const { builder, kind, made } = setUp();
  await builder.now();
  assert.deepEqual(builder.status(), { state: "error", message: "pick a .k file to write to" });
  assert.equal(kind.runs.length, 0);
  assert.equal(made.length, 0);
});

test("an explicit build makes a target, once, however many ask at once", async () => {
  const { builder, kind, made, handles } = setUp();
  await Promise.all([builder.now({ create: true }), builder.now({ create: true }), builder.newTarget()]);
  assert.deepEqual(made, ["pattern.k"]);
  assert.equal(handles[JS].doc().knitoutTarget, "automerge:new0");
  // the build asked second took over from the first, so it's built once
  assert.equal(kind.runs.length, 1);
  assert.equal(kind.runs[0].target.url, "automerge:new0");
  assert.equal(builder.status().state, "ok");
});

test("a target with editable text in it is asked about first", async () => {
  const { builder, kind } = setUp({ source: { knitoutTarget: K }, docs: { [K]: { name: "mine.k", content: "in 3\n" } } });
  await builder.now();
  assert.equal(builder.status().state, "ask");
  assert.match(builder.status().message, /mine\.k has editable text in it/);
  assert.equal(kind.runs.length, 0);
  builder.keep();
  assert.deepEqual(builder.status(), { state: "idle", message: "kept it as it is" });
  await builder.now({ overwrite: true });
  assert.equal(kind.runs.length, 1);
  assert.equal(builder.status().state, "ok");
});

test("a generated target, or an empty one, is just built", async () => {
  assert.equal(asksFirst({ content: "in 3" }), true);
  assert.equal(asksFirst({ content: new ImmutableString("in 3") }), false);
  assert.equal(asksFirst({ content: "" }), false);
  assert.equal(asksFirst({ content: "  \n" }), false);
  assert.equal(asksFirst(undefined), false);
  const { builder, kind } = setUp({ source: { knitoutTarget: K }, docs: { [K]: { content: new ImmutableString("in 3") } } });
  await builder.now();
  assert.equal(kind.runs.length, 1);
});

test("a newer build stops the one before, and the status follows the newest", async () => {
  const first = later();
  const second = later();
  const kind = testKind([first.promise, second.promise]);
  const { builder } = setUp({ kind, source: { knitoutTarget: K }, docs: { [K]: {} } });
  const one = builder.now();
  await settle();
  assert.equal(builder.status().state, "running");
  const two = builder.now();
  await settle();
  assert.equal(kind.runs.length, 2);
  assert.equal(kind.runs[0].options.signal.aborted, true);
  assert.equal(kind.runs[1].options.signal.aborted, false);
  first.resolve({ message: "the old one" });
  await one;
  assert.equal(builder.status().state, "running");
  second.resolve({ message: "the new one" });
  await two;
  assert.deepEqual(builder.status(), { state: "ok", message: "the new one" });
});

test("a build stopped by hand says so, whatever its kind gave back", async () => {
  const run = later();
  const kind = testKind([run.promise]);
  const { builder } = setUp({ kind, source: { knitoutTarget: K }, docs: { [K]: {} } });
  const going = builder.now();
  await settle();
  assert.equal(builder.running(), true);
  builder.stop();
  run.resolve({ message: "built anyway" });
  await going;
  assert.deepEqual(builder.status(), { state: "idle", message: "stopped" });
});

test("a failed build says why and where; changing the source clears one with a line", async () => {
  const kind = testKind([{ error: { message: "nope", line: 3 } }, { error: { message: "no charm" } }]);
  const { builder, handles } = setUp({ kind, source: { knitoutTarget: K }, docs: { [K]: {} } });
  await builder.now();
  assert.deepEqual(builder.status(), { state: "error", message: "nope", line: 3, error: { message: "nope", line: 3 } });
  handles[JS].change((doc) => (doc.content = "something else"));
  assert.equal(builder.status().state, "idle");
  await builder.now();
  handles[JS].change((doc) => (doc.content = "again"));
  assert.equal(builder.status().state, "error");
});

test("an edit builds after a pause, only with autobuild on, and never makes a target", async () => {
  const timers = [];
  const fakeTimers = {
    setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1,
    clearTimeout: (id) => id != null && timers[id] && (timers[id].fn = null),
  };
  const { builder, kind, made } = setUp({ timers: fakeTimers, source: { knitoutTarget: K }, docs: { [K]: {} } });
  builder.edited();
  builder.edited();
  assert.equal(timers.length, 2);
  assert.equal(timers[0].fn, null);
  assert.equal(timers[1].ms, 600);
  await timers[1].fn();
  assert.equal(kind.runs.length, 1);
  builder.setAuto(false);
  builder.edited();
  assert.equal(timers.length, 2);

  const empty = setUp({ timers: fakeTimers });
  empty.builder.edited();
  await timers.at(-1).fn();
  assert.equal(empty.builder.status().message, "pick a .k file to write to");
  assert.equal(empty.made.length, 0);
});

test("a target that's new opens once it's built into", async () => {
  const { builder, handles } = setUp({ source: { knitoutTarget: K }, docs: { [K]: { content: "" } } });
  const opened = [];
  const kind = builder.kind;
  kind.openWith = "visualizer";
  const env = { repo: { find: async (url) => handles[url] }, openIfClosed: (url, tool) => opened.push([url, tool]) };
  const other = createBuilder(kind, JS, { source: handles[JS], env: () => env, storage: fakeStorage() });
  await other.now();
  assert.deepEqual(opened, [[K, "visualizer"]]);
});

test("whoever listens hears the status change, till they stop", async () => {
  const { builder } = setUp({ source: { knitoutTarget: K }, docs: { [K]: {} } });
  const heard = [];
  const stop = builder.subscribe((status) => heard.push(status.state));
  await builder.now();
  stop();
  builder.keep();
  assert.deepEqual(heard, ["running", "ok"]);
});

test("a line is gone to by whoever registered last, and not once they've gone", () => {
  const { builder } = setUp();
  assert.equal(builder.goToLine(3), false);
  const went = [];
  const unregister = builder.lineJump((line) => (went.push(line), true));
  assert.equal(builder.goToLine(3), true);
  unregister();
  assert.equal(builder.goToLine(4), false);
  assert.deepEqual(went, [3]);
});

test("disposed, it stops listening and says it's idle, or keeps what it said", async () => {
  const kind = testKind([{ error: { message: "nope" } }]);
  const { builder, handles, reported } = setUp({ kind, source: { knitoutTarget: K }, docs: { [K]: {} } });
  await builder.now();
  builder.dispose({ keep: true });
  assert.deepEqual(reported.at(-1), { builder: undefined });
  handles[JS].change((doc) => (doc.knitoutTarget = "automerge:x"));
  assert.equal(builder.target(), K);

  const other = setUp({ source: { knitoutTarget: K }, docs: { [K]: {} } });
  other.builder.dispose();
  assert.deepEqual(other.reported.at(-1), { state: "idle", line: undefined, message: undefined, builder: undefined });
});
