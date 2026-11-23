import { evalJS } from "./vendor/evalJS.js";
import { linkGraph, runState } from "./modules.js";
import { readLog, watched, withReadDocs } from "./reads.js";
import { preview } from "./probe.js";

// runs one knitout.js pattern off the page's thread, so a pattern that never
// ends can't freeze anything: the page just stops this worker.
//
// in:  {type: "run", code, sourceMap, base, loopBudget, timeBudget, automerge, graph, stopAt}
//      (loops already counted; sourceMap leads back to the code as written;
//      automerge says where to load the Repo from, see compile in run.js;
//      graph is {pins, modules, snapshots}, every doc the pattern can read,
//      see graph.js. with stopAt, an op's place among those written, the run
//      stops as that op's written, and says what the probed name was then:
//      see probe.js)
// out: {type: "connect", port}   a port for the window's Repo to sync over
//      {type: "started"}         the Repo is up, the pattern is running
//      {type: "done", knitout, error: {message, line} | null, probe?}
//                                probe: {reached: true, op, value} |
//                                {reached: true, op, unset: message} |
//                                {reached: true, op, unseen: true} |
//                                {reached: false, ops} (the run ended first)
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

// a loop's turn is counted, and the reads told (an op's reads are its turn's)
function turns(counter, reads) {
  return function __loop(line) {
    reads.turn();
    return counter(line);
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
  // what the pattern reads of its docs, for each op it writes (reads.js)
  const reads = readLog();
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
      watch: (pinned, value) => watched(value, (path, read) => reads.note(pinned, path, read)),
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
    // what a module reads as it's loaded (its exports) isn't any stitch's
    if (blob) return import(blob).finally(() => reads.forget());
    let url = specifier;
    try {
      url = new URL(specifier, data.base).href;
    } catch {}
    return import(url);
  };
  // what the probed name is as op `stopAt` is written: the latest way to
  // read it left by `__see` (probe.js), read then, and the run stopped
  let see = null;
  let written = 0;
  let probe = null;
  const STOP = new Error("stopped at the op asked about");
  const __see = (read) => void (see = read);
  const onOp = data.stopAt == null ? undefined : (op) => {
    if (probe) throw STOP;
    if (written++ < data.stopAt) return;
    probe = { reached: true, op };
    if (!see) probe.unseen = true;
    else {
      try {
        probe.value = preview(see());
      } catch (e) {
        probe.unset = String(e?.message ?? e);
      }
    }
    throw STOP;
  };
  let knitout;
  try {
    knitout = await evalJS(data.code, {
      sourceMap: data.sourceMap,
      globals: { __loop: turns(loopCounter(data.loopBudget, data.timeBudget), reads), __at, __import, __see, repo, doc: graph.doc },
      currentLine: () => line,
      currentReads: () => reads.take(),
      onOp,
      onError: (e, at) =>
        (error = e === STOP ? null : {
          message: String(e?.message ?? e),
          // (an engine's own `line` on a syntax error is safari's, counted
          // from the top of evalJS's wrapper: `at` is the pattern's)
          line: (e?.name === "SyntaxError" ? at : e?.line ?? at) ?? null,
          syntax: e?.name === "SyntaxError",
        }),
    });
  } finally {
    for (const url of blobs) URL.revokeObjectURL(url);
  }
  // whatever it did after asking, it didn't have what it asked for
  const asked = state.suspension();
  if (asked) postMessage({ type: "done", notReady: asked.url, kind: asked.kind, line: asked.line });
  else if (data.stopAt != null) postMessage({ type: "done", knitout: "", error, probe: probe ?? { reached: false, ops: written } });
  else postMessage({ type: "done", knitout: withReadDocs(knitout, reads.docs), error });
};
