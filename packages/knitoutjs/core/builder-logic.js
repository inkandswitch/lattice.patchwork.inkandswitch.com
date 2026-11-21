// a builder: what builds one doc (its source) into another (its target),
// by hand or by itself, and says how it's going. there's a kind of builder
// for each sort of source: a .js writes a .k (./js-build.js), a .k a .kc
// (lattice's kcode.js), a patternstoat a .k (patternstoat's build-kind.js).
// what's the same for all of them is here. nothing here imports solid or
// automerge-repo, so it's tested in node: ./builder.js makes them with
// solid's signals (one for each source, for the whole page), and
// ./build-bar.js draws one
//
// a kind:
//   targetField        where the source keeps its target's url: "knitoutTarget"
//   targetExtension    what a target's called: "k"
//   targetName(doc)    a new target's name, from the source's doc: "pattern.k"
//   targetFields?(url) what else a new target starts with, from the source's url
//   autobuild          {key(url), default}: where this browser remembers
//                      whether a source builds by itself (localStorage), and
//                      whether it does before anyone's said
//   build(source, target, {signal, repo})
//                      → {error?: {message, line?}, message?}. the build,
//                      from one handle into the other. aborting signal
//                      stops it; a kind that can't stop leaves the target as
//                      it was once it's aborted. message is what to say once
//                      it's built ("built in 3ms · 20 lines": builtMessage)
//   watch?(builder)    what else makes it due a build, for as long as the
//                      builder's about: it calls builder.edited() (which
//                      does nothing with autobuild off). gives back how to
//                      stop: a function, or {stop, recheck}, and recheck is
//                      called as autobuild's turned on
//   openWith?          the tool a new target's shown with, once there's
//                      something in it
//   lines?             whether its errors say which line, to go to
//   titles?            what its bar's parts say when they're pointed at:
//                      {build, auto, target, open}
import { docText } from "./files.js";

// how long a pause in the edits autobuild waits for
export const BUILD_DELAY = 600;

// what's stored for autobuild when it isn't the default: a .js's (on to
// start with) as "off", a .k's (off) as "on". nothing's stored for the default
const stored = (autobuild) => (autobuild.default ? "off" : "on");

// every access in a try: storage can be missing, or full, or refuse
export function readAutobuild(autobuild, url, storage) {
  try {
    const value = (storage ?? globalThis.localStorage).getItem(autobuild.key(url));
    return value === stored(autobuild) ? !autobuild.default : autobuild.default;
  } catch {
    return autobuild.default;
  }
}

export function writeAutobuild(autobuild, url, on, storage) {
  try {
    const store = storage ?? globalThis.localStorage;
    if (on === autobuild.default) store.removeItem(autobuild.key(url));
    else store.setItem(autobuild.key(url), stored(autobuild));
  } catch {}
}

// a target with editable text in it (someone's copy, or one typed by hand)
// isn't written over without asking. a generated one is stored whole (an
// ImmutableString), and an empty one has nothing to lose
export function asksFirst(doc) {
  const content = doc?.content;
  return typeof content === "string" && !!content.trim();
}

// what a build says once it's done: how long, and how much came out
export function builtMessage(ms, text) {
  const lines = String(text ?? "").split("\n").length;
  return `built in ${Math.round(ms)}ms · ${lines.toLocaleString()} lines`;
}

// each kind, by the sort of doc it builds from (its extension, as wm says
// it: "js", "k", "patternstoat"), so whoever has only a source's url (a
// target's pane, rebuilding it while the source isn't shown) can build it
// with the right one. a kind says what it is as it's made: sourceKind
const kinds = new Map();

export function sourceKind(extension, kind) {
  kinds.set(extension, kind);
  return kind;
}

export const kindFor = (extension) => kinds.get(extension) ?? null;

// a signal with no solid in it, for node
export function plainSignal(value) {
  return [() => value, (next) => (value = next)];
}

const link = (value) => (typeof value === "string" && value ? value : null);

/**
 * a builder for the source at `url`, of `kind` (above).
 *
 *   source   its handle, or a promise of it
 *   env()    what it builds with now (whoever's holding it last's):
 *            {repo, createFile?(name, fields) → url, openIfClosed?(url, tool)}.
 *            without createFile, a target can only be picked
 *   signal   how to make a signal: solid's createSignal, or plainSignal
 *   storage  for autobuild, if not localStorage
 *   report   hears what it says, for the frame (builds.js's setBuild):
 *            {state?, line?, message?, auto?, builder?}
 *   timers   {setTimeout, clearTimeout}
 *
 * status is {state: "idle" | "running" | "ok" | "error" | "ask", message?,
 * line?, error?}: error is the kind's own, for a tool to show more of. due()
 * is whether autobuild's waiting out a pause to build (so it's about to)
 */
export function createBuilder(kind, url, { source, env, signal = plainSignal, storage, report = () => {}, timers = globalThis }) {
  const ext = kind.targetExtension;
  const [target, setTarget] = signal(null);
  const [auto, setAutoSignal] = signal(readAutobuild(kind.autobuild, url, storage));
  const [status, setStatusSignal] = signal({ state: "idle" });
  const [due, setDueSignal] = signal(false);
  const running = () => status().state === "running";
  const listeners = new Set();
  const lineJumps = [];
  let handle = null;
  let watching = null;
  let closed = false;
  let timer;
  // the build going now, and the newest build asked for (an older one that's
  // still finding its target gives way)
  let current = null;
  let latest = 0;
  // the target being made: a second ask while it is shares it
  let making = null;

  function setStatus(next) {
    if (closed) return;
    setStatusSignal(next);
    const { error, ...said } = next;
    report({ line: undefined, message: undefined, ...said });
    for (const listener of [...listeners]) listener(next);
  }

  const targetOf = (doc) => link(doc?.[kind.targetField]);

  function onChange() {
    setTarget(targetOf(handle.doc()));
    // an error is about the source as it was; once that changes, it's gone
    const was = status();
    if (was.state === "error" && was.line != null) setStatus({ state: "idle" });
  }

  function start(found) {
    if (closed) return found;
    handle = found;
    setTarget(targetOf(found.doc()));
    found.on("change", onChange);
    watching = kind.watch?.(builder) ?? null;
    return found;
  }

  // build it into its target. `create`: an explicit build (the button, ⌘↵,
  // wm's rebuild) makes a target if there's none yet; autobuild never does.
  // `overwrite`: yes, write over the editable text in it
  async function now({ overwrite = false, create = false } = {}) {
    const from = await ready.catch(() => null);
    if (!from || closed) return;
    let url = target();
    if (!url && create) {
      url = await newTarget();
      if (!url) return;
    }
    if (closed) return;
    if (!url) {
      setStatus({ state: "error", message: `pick a .${ext} file to write to` });
      return;
    }
    const ticket = ++latest;
    let into;
    try {
      into = await env().repo.find(url);
    } catch (error) {
      if (ticket === latest) setStatus({ state: "error", message: `couldn't find the .${ext}: ${error?.message ?? error}` });
      return;
    }
    if (closed || ticket !== latest) return;
    if (asksFirst(into.doc()) && !overwrite) {
      setStatus({ state: "ask", message: `${into.doc()?.name ?? `the .${ext}`} has editable text in it` });
      return;
    }
    // a target with nothing in it yet is new: once there's something in
    // it, it opens beside, if it isn't open already
    const fresh = !docText(into.doc()).trim();
    current?.abort();
    const run = (current = new AbortController());
    setStatus({ state: "running" });
    let result;
    try {
      result = (await kind.build(from, into, { signal: run.signal, repo: env().repo })) ?? {};
    } catch (error) {
      result = { error: { message: String(error?.message ?? error) } };
    }
    if (closed || current !== run) return;
    current = null;
    if (run.signal.aborted || result.error?.stopped) {
      setStatus({ state: "idle", message: "stopped" });
    } else if (result.error) {
      const error = result.error;
      const message = String(error.message ?? error);
      setStatus(error.line != null ? { state: "error", message, line: error.line, error } : { state: "error", message, error });
    } else {
      if (fresh) env().openIfClosed?.(url, kind.openWith);
      setStatus({ state: "ok", message: result.message ?? "built" });
    }
  }

  function pickTarget(url) {
    setTarget(url);
    const write = (found) =>
      found.change((doc) => {
        doc[kind.targetField] = url;
      });
    if (handle) write(handle);
    else ready.then(write, () => {});
  }

  // one target per ask: gives its url, or null if it couldn't be made (and
  // says why)
  function newTarget() {
    return (making ??= makeTarget()
      .catch((error) => {
        setStatus({ state: "error", message: String(error?.message ?? error) });
        return null;
      })
      .finally(() => (making = null)));
  }

  async function makeTarget() {
    const { createFile } = env();
    if (!createFile) throw new Error(`there's nowhere to make a .${ext} file here: pick one`);
    const from = await ready;
    const made = await createFile(kind.targetName(from.doc()), kind.targetFields?.(url));
    pickTarget(made);
    return made;
  }

  function setDue(on) {
    if (due() === on) return;
    setDueSignal(on);
    report({ due: on });
  }

  // after a pause in the edits, if autobuild's on
  function edited() {
    if (!auto() || closed) return;
    timers.clearTimeout(timer);
    setDue(true);
    timer = timers.setTimeout(() => {
      setDue(false);
      return now();
    }, BUILD_DELAY);
  }

  function setAuto(on) {
    setAutoSignal(on);
    report({ auto: on });
    writeAutobuild(kind.autobuild, url, on, storage);
    if (on) watching?.recheck?.();
  }

  const stop = () => current?.abort();
  const keep = () => setStatus({ state: "idle", message: "kept it as it is" });

  // a line of the source to go to (a .js's, in the code editor showing it):
  // whoever can registers how, and the last to is asked. says whether it could
  function lineJump(go) {
    lineJumps.push(go);
    return () => {
      const at = lineJumps.lastIndexOf(go);
      if (at >= 0) lineJumps.splice(at, 1);
    };
  }
  const goToLine = (line) => !!lineJumps.at(-1)?.(line);

  // hears every status, as it's said
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // `keep`: leave what it said last in the frame (a build done once, with
  // nobody holding it, that went wrong, say)
  function dispose({ keep: keeping = false } = {}) {
    if (closed) return;
    timers.clearTimeout(timer);
    setDue(false);
    current?.abort();
    handle?.off("change", onChange);
    (typeof watching === "function" ? watching : watching?.stop)?.();
    closed = true;
    listeners.clear();
    report(keeping ? { builder: undefined } : { state: "idle", line: undefined, message: undefined, builder: undefined, due: false });
  }

  const builder = {
    kind,
    url,
    target,
    auto,
    status,
    running,
    due,
    setAuto,
    now,
    edited,
    stop,
    keep,
    pickTarget,
    newTarget,
    goToLine,
    lineJump,
    subscribe,
    dispose,
    // the source's handle, once it's found, and what it's built with
    source: () => handle,
    env: () => env(),
    ready: null,
  };

  // what wm's rebuild and showError use (builds.js)
  report({ state: "idle", auto: auto(), builder: { now: () => now({ create: true }), goToLine } });

  const ready = source && typeof source.then !== "function" ? Promise.resolve(start(source)) : Promise.resolve(source).then(start);
  ready.catch((error) => setStatus({ state: "error", message: `couldn't find this: ${error?.message ?? error}` }));
  builder.ready = ready;
  return builder;
}
