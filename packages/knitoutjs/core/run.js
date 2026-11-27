import { ImmutableString } from "@automerge/automerge";
import { MessagePortTransport } from "@automerge/automerge-subduction/slim";
import { docText, knitoutOf, moduleWorker, textHash } from "./files.js";
import { firstBrokenLine, instrument } from "./instrument.js";
import { buildGraph, buildRounds, webSources } from "./graph.js";
import { recordedSources, withSourcesLine } from "./sources.js";

export { instrument };

// patterns run in a worker (run-worker.js), so the page never waits on them.
// every loop gets a turn counter, so a loop that never ends stops with the
// line it's on; past the time budget, the worker is stopped regardless
export const LOOP_BUDGET = 10_000_000;
export const TIME_BUDGET = 5_000;
const HARD_STOP = TIME_BUDGET + 1_500;
// how long the worker gets to load automerge and start its Repo, before the
// pattern's own time starts
const SETUP_BUDGET = 10_000;

const WORKER_URL = new URL("./run-worker.js", import.meta.url);


// what the worker and the window call the subduction link between them
const SERVICE = "knitout-run";

// the wasm this page already loaded (its name is hashed in a build), or the
// path that redirects to the current one
function wasmUrl(name) {
  const file = new RegExp(`/${name}(-[\\w-]+)?\\.wasm$`);
  const loaded = performance
    .getEntriesByType("resource")
    .find((entry) => file.test(new URL(entry.name).pathname));
  return loaded?.name ?? new URL(`/${name}.wasm`, location.href).href;
}

// where the worker loads automerge from: the same files as the page, found
// through the page's import map (a worker doesn't have one)
function automergeForWorker() {
  return {
    service: SERVICE,
    modules: {
      automerge: import.meta.resolve("@automerge/automerge/slim"),
      subduction: import.meta.resolve("@automerge/automerge-subduction/slim"),
      repo: import.meta.resolve("@automerge/automerge-repo/slim"),
    },
    wasm: { automerge: wasmUrl("automerge"), subduction: wasmUrl("subduction") },
  };
}

// run a knitout.js pattern: {knitout, error, ms}. the pattern has a Repo of
// its own, synced with `repo` over subduction, so `repo.find(url)` there finds
// what this window has. aborting `signal` stops it. `graph` (graph.js) is the
// docs it can `import` and `doc()`, pinned, and what it `get()`s; one it asks
// for that isn't there stops the run, and it answers {notReady: url, kind,
// line, as, ms} instead.
// with `probe` ({at, op}: a place in the code, and an op's place among those
// written), the name at `at` is watched and the run stops as op `op` is
// written, answering {probe, error, ms} (see run-worker.js) with no knitout
export function compile(code, { repo, signal, name, graph, probe = null } = {}) {
  const start = performance.now();
  let budgeted;
  let sourceMap = null;
  try {
    const instrumented = instrument(code, { pins: graph?.pins ?? {}, probe: probe?.at ?? null });
    if (probe && !instrumented.probed) return Promise.resolve({ probe: { nothing: true }, error: null, ms: 0 });
    budgeted = instrumented.code;
    // so devtools shows (and steps through) the pattern as it was written
    sourceMap = {
      version: 3,
      sources: [name || "pattern.knitout.js"],
      sourcesContent: [code],
      names: [],
      mappings: instrumented.mappings,
    };
  } catch {
    budgeted = code;
  }

  return new Promise((resolve) => {
    const worker = moduleWorker(WORKER_URL);
    let timer;
    // the worker's Repo, connected to this window's: hung up when it's done
    const links = [];

    function finish(result) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      for (const hangUp of links) hangUp();
      resolve({ ...result, ms: performance.now() - start });
    }

    function hardStop() {
      finish({ knitout: "", error: { message: `stopped after ${HARD_STOP / 1000}s. is something looping forever?` } });
    }

    // the worker's Repo asking to connect: this window's Repo is its peer
    // until the run's over
    async function accept(port) {
      const transport = new MessagePortTransport(port);
      const linked = (async () => {
        const subduction = await repo.subduction;
        const peer = await subduction.acceptTransport(transport, SERVICE);
        return () => subduction.disconnectFromPeer(peer);
      })();
      links.push(() => {
        transport.disconnect().catch(() => {});
        // the handshake may finish after the run has
        linked.then((hangUp) => hangUp()).catch(() => {});
      });
      linked.catch((error) => console.warn("couldn't connect the pattern's repo to this window's", error));
    }

    function onAbort() {
      finish({ knitout: "", error: { message: "stopped", stopped: true } });
    }

    worker.onmessage = ({ data }) => {
      if (data.type === "done" && data.notReady) {
        finish({ notReady: data.notReady, kind: data.kind, line: data.line ?? null, as: data.as });
      } else if (data.type === "done") {
        const error = data.error;
        if (error?.syntax && error.line == null) error.line = firstBrokenLine(code);
        finish({ knitout: data.knitout, error, ...(data.probe && { probe: data.probe }) });
      } else if (data.type === "connect") {
        accept(data.port);
      } else if (data.type === "started") {
        clearTimeout(timer);
        timer = setTimeout(hardStop, HARD_STOP);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish({ knitout: "", error: { message: event.message || "the pattern's worker didn't start" } });
    };

    timer = setTimeout(hardStop, SETUP_BUDGET + HARD_STOP);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort);

    worker.postMessage({
      type: "run",
      code: budgeted,
      sourceMap,
      // where the pattern's imports are found from: the page, not this file
      base: location.href,
      loopBudget: LOOP_BUDGET,
      timeBudget: TIME_BUDGET,
      automerge: automergeForWorker(),
      graph: graph && { pins: graph.pins, modules: graph.modules, snapshots: graph.snapshots, gets: graph.gets },
      stopAt: probe?.op ?? null,
    });
  });
}

// run the .js handle's code and write the knitout into the .k handle,
// remembering on each side who it's linked to, and on the .k when it was
// built and from what code (so it can tell when it's out of date) and every
// doc it read, pinned (knitoutSources, and a line in the knitout), and every
// url it fetched and when (knitoutWebSources, and a line after that). the
// knitout goes in as an ImmutableString: writing a big one as editable text
// is slow, and a generated .k isn't for typing into (make an editable copy
// for that). {knitout, error, ms, sources, webSources}
export async function runInto(jsHandle, kHandle, repo, { signal } = {}) {
  const start = performance.now();
  // the code and its pin, both from one version of the .js
  const heads = jsHandle.heads();
  const js = jsHandle.view(heads).doc();
  const code = docText(js);
  const name = js?.name;
  const done = (result) => ({ ...result, ms: performance.now() - start });
  let built;
  try {
    const graph = await buildGraph(code, repo, { self: jsHandle, heads });
    built = await buildRounds((graph) => compile(code, { repo, signal, name, graph }), graph, repo);
  } catch (error) {
    if (signal?.aborted) return done({ knitout: "", error: { message: "stopped", stopped: true }, sources: [] });
    return done({ knitout: "", error: { message: String(error?.message ?? error), line: error?.line ?? null }, sources: [] });
  }
  const { result, graph } = built;
  const sources = recordedSources(graph.sources, { self: jsHandle.url, target: kHandle.url });
  const web = webSources(graph);
  // a build that failed leaves the .k as it was
  if (result.error) return done({ knitout: result.knitout, error: result.error, sources, webSources: web });
  const knitout = withSourcesLine(result.knitout, sources, web);
  kHandle.change((doc) => {
    doc.content = new ImmutableString(knitout);
    doc.knitoutSource = jsHandle.url;
    doc.knitoutSourceHash = textHash(code);
    doc.knitoutBuiltAt = Date.now();
    doc.knitoutSources = sources;
    doc.knitoutWebSources = web;
  });
  if (knitoutOf(jsHandle.doc()).target !== kHandle.url) {
    jsHandle.change((doc) => {
      doc.knitoutTarget = kHandle.url;
    });
  }
  return done({ knitout, error: null, sources, webSources: web });
}
