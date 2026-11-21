import { evalJS } from "./vendor/evalJS.js";
import { linkGraph, runState } from "./modules.js";

// runs one knitout.js pattern off the page's thread, so a pattern that never
// ends can't freeze anything: the page just stops this worker.
//
// in:  {type: "run", code, sourceMap, base, loopBudget, timeBudget, automerge, graph}
//      (loops already counted; sourceMap leads back to the code as written;
//      automerge says where to load the Repo from, see compile in run.js;
//      graph is {pins, modules, snapshots}, every doc the pattern can read,
//      see graph.js)
// out: {type: "connect", port}   a port for the window's Repo to sync over
//      {type: "started"}         the Repo is up, the pattern is running
//      {type: "done", knitout, error: {message, line} | null}
//      {type: "done", notReady: url, kind, line}
//                                it asked for a doc it wasn't given: the page
//                                adds it and runs it again (buildRounds)

// a Repo of our own, with the window's Repo as its only peer: subduction over
// a MessageChannel. nothing stored here; everything comes from the window,
// which has the sync server. a worker has no import map, so the page says
// where the modules and wasm are
let started;
function startRepo({ modules, wasm, service }) {
  started ??= (async () => {
    const [{ initializeWasm }, subduction, { Repo }] = await Promise.all([
      import(modules.automerge),
      import(modules.subduction),
      import(modules.repo),
    ]);
    await Promise.all([
      initializeWasm(new Request(wasm.automerge)),
      subduction.default(new Request(wasm.subduction)),
    ]);
    return new Repo({
      subductionWebsocketEndpoints: [windowEndpoint(service, subduction.MessagePortTransport)],
    });
  })();
  return started;
}

// what the Repo's reconnect loop connects to: each time, a fresh channel, one
// end to the page (which accepts on it) and one end here
function windowEndpoint(service, MessagePortTransport) {
  return {
    // the reconnect loop takes this url's host as the service name
    url: `knitout://${service}`,
    async connect() {
      const { port1, port2 } = new MessageChannel();
      postMessage({ type: "connect", port: port2 }, [port2]);
      const transport = new MessagePortTransport(port1);
      let hungUp;
      const closed = new Promise((resolve) => (hungUp = resolve));
      let then = () => {};
      transport.onDisconnect(() => {
        hungUp();
        then();
      });
      return {
        sendBytes: (bytes) => transport.sendBytes(bytes),
        recvBytes: () => transport.recvBytes(),
        disconnect: () => transport.disconnect(),
        onDisconnect: (callback) => (then = callback),
        closed: () => closed,
      };
    },
  };
}

function loopCounter(loopBudget, timeBudget) {
  const start = performance.now();
  let turns = 0;
  return function __loop(line) {
    turns++;
    if (turns > loopBudget) {
      throw Object.assign(
        new Error(`stopped after ${loopBudget.toLocaleString()} loop turns, in the loop on line ${line}. is it infinite?`),
        { line },
      );
    }
    if ((turns & 0x3ff) === 0 && performance.now() - start > timeBudget) {
      throw Object.assign(
        new Error(`stopped after ${timeBudget / 1000}s in the loop on line ${line}. is it infinite?`),
        { line },
      );
    }
  };
}

onmessage = async ({ data }) => {
  if (data.type !== "run") return;
  let repo;
  try {
    repo = await startRepo(data.automerge);
  } catch (e) {
    postMessage({
      type: "done",
      knitout: "",
      error: { message: `the pattern's repo didn't start: ${e?.message ?? e}`, line: null },
    });
    return;
  }
  // on the worker's global too, for modules the pattern imports: they're
  // written for a page with a repo on it, and look for it there
  self.repo = repo;
  postMessage({ type: "started" });

  let error = null;
  let line = null;
  const __at = (at, value) => ((line = at), value);

  // the graph's docs and modules, each as a blob url, all let go of when the
  // run's done. a doc it hasn't got suspends the run (see runState)
  const state = runState();
  const blobs = [];
  const makeUrl = (text) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    blobs.push(url);
    return url;
  };
  let graph;
  try {
    graph = linkGraph(data.graph ?? {}, {
      makeUrl,
      suspend: (url, kind) => state.suspend(url, { kind, line }),
    });
  } catch (e) {
    for (const url of blobs) URL.revokeObjectURL(url);
    postMessage({ type: "done", knitout: "", error: { message: String(e?.message ?? e), line: null } });
    return;
  }
  // on the global, for the modules: they read docs the same way
  self.__docs = graph.docs;
  self.doc = graph.doc;

  // `import(x)` in the pattern: a doc from the graph, anything else found
  // from the page's address
  const __import = async (at, specifier) => {
    line = at;
    const blob = graph.module(specifier);
    if (blob) return import(blob);
    let url = specifier;
    try {
      url = new URL(specifier, data.base).href;
    } catch {}
    return import(url);
  };
  let knitout;
  try {
    knitout = await evalJS(data.code, {
      sourceMap: data.sourceMap,
      globals: { __loop: loopCounter(data.loopBudget, data.timeBudget), __at, __import, repo, doc: graph.doc },
      currentLine: () => line,
      onError: (e, at) =>
        (error = {
          message: String(e?.message ?? e),
          line: e?.line ?? at ?? null,
          syntax: e?.name === "SyntaxError",
        }),
    });
  } finally {
    for (const url of blobs) URL.revokeObjectURL(url);
  }
  // whatever it did after asking, it didn't have what it asked for
  const asked = state.suspension();
  if (asked) postMessage({ type: "done", notReady: asked.url, kind: asked.kind, line: asked.line });
  else postMessage({ type: "done", knitout, error });
};
