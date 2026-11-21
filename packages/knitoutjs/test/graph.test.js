import { test } from "node:test";
import assert from "node:assert/strict";
import { ImmutableString, Counter } from "@automerge/automerge";
import { buildGraph, extendGraph, buildRounds, plainValue, NotReady } from "../core/graph.js";
import { NotReady as WorkerNotReady } from "../core/modules.js";

const js = (name, content) => ({ name, extension: "js", content });

// a repo of plain values, every doc at heads ["h"], counting what's asked of it
function fakeRepo(docs, { reject = [], hang = [] } = {}) {
  const calls = { find: [], heads: [], view: [] };
  const handle = (url) => ({
    url,
    heads: () => {
      calls.heads.push(url);
      return ["h"];
    },
    view: (heads) => {
      calls.view.push([url, heads]);
      return { url: url + "#" + heads.join("|"), doc: () => docs[url] };
    },
  });
  return {
    calls,
    find(url) {
      calls.find.push(url);
      if (reject.includes(url)) return Promise.reject(new Error(`no ${url}`));
      if (hang.includes(url)) return new Promise(() => {});
      if (!(url in docs)) return Promise.reject(new Error(`no ${url}`));
      return Promise.resolve(handle(url));
    },
    handle,
  };
}

const SELF = "automerge:pat";

function setup(code, docs, options) {
  const all = { [SELF]: js("pattern.js", code), ...docs };
  const repo = fakeRepo(all, options);
  return { repo, self: repo.handle(SELF), code };
}

test("the .js comes first, then what it uses", async () => {
  const code = 'import a from "automerge:a"\nconst c = doc("automerge:c")';
  const { repo, self } = setup(code, {
    "automerge:a": js("a.js", 'export default doc("/automerge:b").width'),
    "automerge:b": { width: 20 },
    "automerge:c": { rows: 6 },
  });
  const graph = await buildGraph(code, repo, { self });
  assert.deepEqual(graph.sources, [
    "automerge:pat#h",
    "automerge:a#h",
    "automerge:b#h",
    "automerge:c#h",
  ]);
  assert.deepEqual(graph.modules, [
    { pinned: "automerge:a#h", code: 'export default doc("automerge:b#h").width' },
  ]);
  assert.deepEqual(Object.keys(graph.snapshots).sort(), ["automerge:b#h", "automerge:c#h"]);
  assert.deepEqual(graph.snapshots["automerge:b#h"], { width: 20 });
  assert.equal(graph.pins["automerge:a"], "automerge:a#h");
  assert.equal(graph.pins["automerge:c"], "automerge:c#h");
});

test("modules come children first", async () => {
  const code = 'import a from "automerge:a"';
  const { repo, self } = setup(code, {
    "automerge:a": js("a.js", 'import b from "automerge:b"\nexport default b'),
    "automerge:b": js("b.js", "export default 1"),
  });
  const graph = await buildGraph(code, repo, { self });
  assert.deepEqual(
    graph.modules.map((m) => m.pinned),
    ["automerge:b#h", "automerge:a#h"],
  );
  assert.equal(graph.modules[1].code, 'import b from "automerge:b#h"\nexport default b');
});

test("each doc once", async () => {
  const code = 'import a from "automerge:a"\nimport {x} from "/automerge:a"';
  const { repo, self } = setup(code, { "automerge:a": js("a.js", "export const x = 1") });
  const graph = await buildGraph(code, repo, { self });
  assert.equal(graph.modules.length, 1);
  assert.deepEqual(graph.sources, ["automerge:pat#h", "automerge:a#h"]);
  assert.equal(repo.calls.find.filter((u) => u === "automerge:a").length, 1);
});

test("a diamond isn't a cycle", async () => {
  const code = 'import a from "automerge:a"\nimport b from "automerge:b"';
  const { repo, self } = setup(code, {
    "automerge:a": js("a.js", 'import c from "automerge:c"'),
    "automerge:b": js("b.js", 'import c from "automerge:c"'),
    "automerge:c": js("c.js", "export default 1"),
  });
  const graph = await buildGraph(code, repo, { self });
  assert.deepEqual(
    graph.modules.map((m) => m.pinned),
    ["automerge:c#h", "automerge:a#h", "automerge:b#h"],
  );
});

test("a cycle fails naming the docs in it", async () => {
  const code = 'import a from "automerge:a"';
  const { repo, self } = setup(code, {
    "automerge:a": js("a.js", 'import b from "automerge:b"'),
    "automerge:b": js("b.js", 'import a from "automerge:a"'),
  });
  await assert.rejects(buildGraph(code, repo, { self }), {
    message: "import cycle: a.js → b.js → a.js",
    line: 1,
  });
});

test("a module importing the pattern is a cycle", async () => {
  const code = '\nimport a from "automerge:a"';
  const { repo, self } = setup(code, { "automerge:a": js(undefined, `import p from "${SELF}"`) });
  await assert.rejects(buildGraph(code, repo, { self }), {
    message: "import cycle: pattern.js → automerge:a → pattern.js",
    line: 2,
  });
});

test("an unfindable doc fails the build with its url and line", async () => {
  const code = '// one\n// two\n// three\nconst z = doc("automerge:zzz")';
  const { repo, self } = setup(code, {}, { reject: ["automerge:zzz"] });
  await assert.rejects(buildGraph(code, repo, { self }), {
    message: "couldn't find automerge:zzz (line 4)",
    line: 4,
  });
});

test("a doc that never comes fails after the timeout", async () => {
  const code = '\nimport q from "automerge:qqq"';
  const { repo, self } = setup(code, {}, { hang: ["automerge:qqq"] });
  const started = Date.now();
  await assert.rejects(buildGraph(code, repo, { self, timeout: 20 }), {
    message: "couldn't find automerge:qqq (line 2)",
    line: 2,
  });
  assert.ok(Date.now() - started < 1000);
});

test("an unfindable doc inside a module points at the pattern's import", async () => {
  const code = '\n\nimport a from "automerge:a"';
  const { repo, self } = setup(code, { "automerge:a": js("a.js", '\ndoc("automerge:zzz")') });
  await assert.rejects(buildGraph(code, repo, { self }), {
    message: "couldn't find automerge:zzz (line 2 of a.js)",
    line: 3,
  });
});

test("a url written with heads is used at those heads", async () => {
  const code = 'const b = doc("automerge:b#x|y")';
  const { repo, self } = setup(code, { "automerge:b": { width: 3 } });
  const graph = await buildGraph(code, repo, { self });
  assert.deepEqual(repo.calls.find, ["automerge:b"]);
  assert.equal(repo.calls.heads.includes("automerge:b"), false);
  assert.deepEqual(repo.calls.view.at(-1), ["automerge:b", ["x", "y"]]);
  assert.equal(graph.pins["automerge:b#x|y"], "automerge:b#x|y");
  assert.deepEqual(graph.sources, ["automerge:pat#h", "automerge:b#x|y"]);
});

test("plainValue turns automerge's own types into plain ones", () => {
  const bytes = new Uint8Array([1, 2]);
  const date = new Date(0);
  const value = plainValue({
    name: new ImmutableString("x"),
    count: new Counter(3),
    list: [new ImmutableString("y"), { deep: new Counter(1) }],
    bytes,
    date,
  });
  assert.deepEqual(value, { name: "x", count: 3, list: ["y", { deep: 1 }], bytes, date });
  assert.equal(value.bytes, bytes);
  assert.equal(value.date, date);
});

test("graph.js hands on the worker's NotReady", () => {
  assert.equal(NotReady, WorkerNotReady);
});

test("extendGraph adds a doc and keeps what's there", async () => {
  const code = 'const c = doc("automerge:c")';
  const { repo, self } = setup(code, {
    "automerge:c": { rows: 6 },
    "automerge:d": js("d.js", 'export default doc("automerge:e")'),
    "automerge:e": { width: 1 },
  });
  const graph = await buildGraph(code, repo, { self });
  const before = structuredClone(graph);
  const next = await extendGraph(graph, "automerge:d", repo, {});
  assert.deepEqual(graph, before);
  assert.deepEqual(next.sources, ["automerge:pat#h", "automerge:c#h", "automerge:d#h", "automerge:e#h"]);
  assert.equal(next.snapshots["automerge:c#h"], graph.snapshots["automerge:c#h"]);
  assert.deepEqual(next.modules, [{ pinned: "automerge:d#h", code: 'export default doc("automerge:e#h")' }]);
});

test("a run asking for its own pattern gets its value, not a cycle", async () => {
  const { repo, self } = setup("", {});
  const graph = await buildGraph("", repo, { self });
  const next = await extendGraph(graph, SELF, repo, {});
  assert.deepEqual(next.sources, ["automerge:pat#h"]);
  assert.equal(next.snapshots["automerge:pat#h"].name, "pattern.js");
  assert.deepEqual(next.modules, []);
});

test("a computed url suspends and runs again", async () => {
  const code = 'const c = doc("automerge:c")';
  const { repo, self } = setup(code, { "automerge:c": { rows: 6 }, "automerge:d": { width: 2 } });
  const graph = await buildGraph(code, repo, { self });
  const seen = [];
  const run = async (g) => {
    seen.push(g);
    return g.pins["automerge:d"] ? { knitout: "ok" } : { notReady: "automerge:d" };
  };
  const headsBefore = repo.calls.heads.length;
  const out = await buildRounds(run, graph, repo, {});
  assert.equal(seen.length, 2);
  assert.deepEqual(out.result, { knitout: "ok" });
  assert.equal(out.graph.sources.at(-1), "automerge:d#h");
  assert.equal(out.graph.pins["automerge:c"], seen[0].pins["automerge:c"]);
  assert.equal(seen[1].snapshots["automerge:c#h"], seen[0].snapshots["automerge:c#h"]);
  // only d was asked for its heads
  assert.deepEqual(repo.calls.heads.slice(headsBefore), ["automerge:d"]);
});

test("the run cap names the url", async () => {
  // ids are base58, so no 0s: n, na, naa, …
  const id = (i) => "n" + "a".repeat(i - 1);
  const docs = {};
  for (let i = 1; i <= 30; i++) docs[`automerge:${id(i)}`] = { i };
  const { repo, self } = setup("", docs);
  const graph = await buildGraph("", repo, { self });
  let runs = 0;
  const run = async () => ({ notReady: `automerge:${id(++runs)}` });
  await assert.rejects(buildRounds(run, graph, repo, {}), {
    message: `still asking for new docs after 20 runs: automerge:${id(20)}`,
    line: null,
  });
  assert.equal(runs, 20);
});

test("a doc a later run asks for that can't be found points at the run's line", async () => {
  const { repo, self } = setup("", {});
  const graph = await buildGraph("", repo, { self });
  await assert.rejects(extendGraph(graph, "automerge:gone", repo, { line: 4 }), {
    message: "couldn't find automerge:gone (line 4)",
    line: 4,
  });
  const run = async () => ({ notReady: "automerge:gone", kind: "doc", line: 7 });
  await assert.rejects(buildRounds(run, graph, repo, {}), {
    message: "couldn't find automerge:gone (line 7)",
    line: 7,
  });
});

test("a run asking again for a doc it was given fails at once", async () => {
  const code = 'const c = doc("automerge:c")';
  const { repo, self } = setup(code, { "automerge:c": { rows: 6 } });
  const graph = await buildGraph(code, repo, { self });
  let runs = 0;
  const run = async () => (runs++, { notReady: "automerge:c", kind: "doc", line: 1 });
  await assert.rejects(buildRounds(run, graph, repo, {}), {
    message: "asked for automerge:c again, but the build already has it",
    line: 1,
  });
  assert.equal(runs, 1);
});

test("a .js read with doc() and then imported is added as a module", async () => {
  const code = 'const d = doc("automerge:d")';
  const { repo, self } = setup(code, { "automerge:d": js("d.js", "export default 1") });
  const graph = await buildGraph(code, repo, { self });
  assert.deepEqual(graph.modules, []);
  const run = async (g) => (g.modules.length ? { knitout: "ok" } : { notReady: "automerge:d", kind: "dynamic" });
  const out = await buildRounds(run, graph, repo, {});
  assert.deepEqual(out.graph.modules, [{ pinned: "automerge:d#h", code: "export default 1" }]);
  assert.deepEqual(out.graph.sources, ["automerge:pat#h", "automerge:d#h"]);
});

test("buildGraph reads the pattern at the heads it's given", async () => {
  const { repo, self } = setup("", {});
  const graph = await buildGraph("", repo, { self, heads: ["old"] });
  assert.deepEqual(graph.sources, ["automerge:pat#old"]);
  assert.equal(repo.calls.heads.includes(SELF), false);
});
