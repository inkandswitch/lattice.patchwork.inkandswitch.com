import { ImmutableString } from "@automerge/automerge";
import { MessagePortTransport } from "@automerge/automerge-subduction/slim";
import { parser } from "./vendor/lezer-javascript.js";
import { docText, knitoutOf, moduleWorker, textHash } from "./files.js";
import { instrument } from "./instrument.js";

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

// where the code first stops making sense, for syntax errors (the engine
// doesn't say which line)
function firstBrokenLine(code) {
  let at = null;
  parser.parse(code).iterate({
    enter(node) {
      if (at !== null) return false;
      if (node.type.isError) at = node.from;
    },
  });
  return at === null ? null : code.slice(0, at).split("\n").length;
}

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
// what this window has. aborting `signal` stops it
export function compile(code, { repo, signal, name } = {}) {
  const start = performance.now();
  let budgeted;
  let sourceMap = null;
  try {
    const instrumented = instrument(code);
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

    function finish(knitout, error) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      for (const hangUp of links) hangUp();
      resolve({ knitout, error, ms: performance.now() - start });
    }

    function hardStop() {
      finish("", { message: `stopped after ${HARD_STOP / 1000}s. is something looping forever?` });
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
      finish("", { message: "stopped", stopped: true });
    }

    worker.onmessage = ({ data }) => {
      if (data.type === "done") {
        const error = data.error;
        if (error?.syntax && error.line == null) error.line = firstBrokenLine(code);
        finish(data.knitout, error);
      } else if (data.type === "connect") {
        accept(data.port);
      } else if (data.type === "started") {
        clearTimeout(timer);
        timer = setTimeout(hardStop, HARD_STOP);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish("", { message: event.message || "the pattern's worker didn't start" });
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
    });
  });
}

// run the .js handle's code and write the knitout into the .k handle,
// remembering on each side who it's linked to, and on the .k when it was
// built and from what code (so it can tell when it's out of date). the
// knitout goes in as an ImmutableString: writing a big one as editable text
// is slow, and a generated .k isn't for typing into (make an editable copy
// for that)
export async function runInto(jsHandle, kHandle, repo, { signal } = {}) {
  const code = docText(jsHandle.doc());
  const result = await compile(code, { repo, signal, name: jsHandle.doc()?.name });
  // a build that failed leaves the .k as it was
  if (result.error) return result;
  kHandle.change((doc) => {
    doc.content = new ImmutableString(result.knitout);
    doc.knitoutSource = jsHandle.url;
    doc.knitoutSourceHash = textHash(code);
    doc.knitoutBuiltAt = Date.now();
  });
  if (knitoutOf(jsHandle.doc()).target !== kHandle.url) {
    jsHandle.change((doc) => {
      doc.knitoutTarget = kHandle.url;
    });
  }
  return result;
}
