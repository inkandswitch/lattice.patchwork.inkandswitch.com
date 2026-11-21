import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "automerge:2Qf9bTzK3xJvPq7YwHnE5RcLmA8d";
const DATA = "automerge:3RgAcUaL4yKwQr8ZxJoF6SdMnB9e";
const SELF = "automerge:4ShBdVbM5zLxRs9AyKpG7TeNoC1f";
const idOf = (url) => url.slice("automerge:".length);

// the module keeps what's shared in itself, so each test has its own copy
let copies = 0;
const fresh = () => import(`../core/language-server.js?${copies++}`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeHandle(value) {
  const listeners = new Set();
  return {
    value,
    doc: () => value,
    on: (_, fn) => listeners.add(fn),
    off: (_, fn) => listeners.delete(fn),
    listeners,
    change(next) {
      value = next;
      for (const fn of listeners) fn();
    },
  };
}

function setup() {
  const handles = {
    [LIB]: fakeHandle({ name: "lib.knitout.js", content: "export const x = 1\n" }),
    [DATA]: fakeHandle({ name: "sizes.json", width: 20 }),
  };
  const finds = [];
  const repo = { find: async (url) => (finds.push(url), handles[url]) };
  const calls = [];
  const server = {
    writeFile: (path, text) => calls.push(["write", path, text]),
    removeFile: (path) => calls.push(["remove", path]),
  };
  return { handles, finds, repo, calls, server };
}

test("a .js is given as its text, anything else as its types, and the globals once", async () => {
  const { languageServerDocs } = await fresh();
  const { repo, calls, server } = setup();
  languageServerDocs(server, repo, { self: SELF }).use([LIB, "/" + DATA + "#abc"]);
  languageServerDocs(server, repo, { self: SELF });
  await settle();
  const writes = calls.filter(([kind]) => kind === "write").map(([, path]) => path);
  assert.deepEqual(writes.sort(), [`/${idOf(DATA)}/index.d.ts`, `/${idOf(LIB)}/index.js`, "/lattice/globals.d.ts"].sort());
  assert.equal(calls.find(([, path]) => path.endsWith("index.js"))[2], "export const x = 1\n");
  assert.match(calls.find(([, path]) => path.endsWith("index.d.ts"))[2], /"width": number;/);
});

test("the pattern itself isn't given", async () => {
  const { languageServerDocs } = await fresh();
  const { repo, finds, server } = setup();
  languageServerDocs(server, repo, { self: SELF }).use([SELF, LIB]);
  await settle();
  assert.deepEqual(finds, [LIB]);
});

test("a doc two editors use is written once, and removed when neither does", async () => {
  const { languageServerDocs } = await fresh();
  const { repo, finds, calls, server } = setup();
  const one = languageServerDocs(server, repo, { self: SELF });
  const two = languageServerDocs(server, repo, { self: SELF });
  one.use([DATA]);
  two.use([DATA]);
  await settle();
  assert.deepEqual(finds, [DATA]);
  one.close();
  assert.equal(calls.filter(([kind]) => kind === "remove").length, 0);
  two.use([]);
  assert.deepEqual(calls.at(-1), ["remove", `/${idOf(DATA)}/index.d.ts`]);
});

test("a doc's change rewrites its file, unless its types are the same", async () => {
  const { languageServerDocs } = await fresh();
  const { handles, repo, calls, server } = setup();
  languageServerDocs(server, repo, { self: SELF }).use([DATA, LIB]);
  await settle();
  const before = calls.length;
  handles[DATA].change({ name: "sizes.json", width: 30 });
  assert.equal(calls.length, before);
  handles[DATA].change({ name: "sizes.json", width: 30, height: 4 });
  assert.match(calls.at(-1)[2], /"height": number;/);
  handles[LIB].change({ name: "lib.knitout.js", content: "export const y = 2\n" });
  assert.deepEqual(calls.at(-1), ["write", `/${idOf(LIB)}/index.js`, "export const y = 2\n"]);
});

test("a doc no longer used stops being watched", async () => {
  const { languageServerDocs } = await fresh();
  const { handles, repo, server } = setup();
  const docs = languageServerDocs(server, repo, { self: SELF });
  docs.use([DATA]);
  await settle();
  assert.equal(handles[DATA].listeners.size, 1);
  docs.use([]);
  assert.equal(handles[DATA].listeners.size, 0);
});

test("a doc dropped before it's found is never written", async () => {
  const { languageServerDocs } = await fresh();
  const { handles, repo, calls, server } = setup();
  const docs = languageServerDocs(server, repo, { self: SELF });
  docs.use([DATA]);
  docs.close();
  await settle();
  assert.equal(calls.filter(([, path]) => path.includes(idOf(DATA))).length, 0);
  assert.equal(handles[DATA].listeners.size, 0);
});
