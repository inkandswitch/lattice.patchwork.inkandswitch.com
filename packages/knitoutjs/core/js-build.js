// a knitout.js pattern (a .js) built into a .k: the builder's kind for it
// (see ./builder-logic.js). autobuild is on to start with, and turning it
// off is remembered in this browser, for each .js. it builds after your own
// edits in the code editor (which says so: ./editor.js), and whenever a doc
// that can make the .k stale moves, while the .js is shown anywhere. the
// build itself is ./run.js's runInto, loaded when it's first wanted: nothing
// up here needs automerge-repo, so this is tested in node
import { builtMessage, sourceKind } from "./builder-logic.js";
import { knitoutOf } from "./files.js";
import { pinsOf, sourcesMoved, watchedSources } from "./knitout-links.js";
import { headsOf } from "./sources.js";

// every doc that can make the target .k stale (the .js's imports, and what
// the .k was last built from) is watched, so a change to one rebuilds, if
// autobuild is on. never the .js or the .k themselves: a build writes the
// .k. and a doc the .k was built from may have moved before this was about
// (or while it was being found), with no change to come to say so: if one
// has, that's an edit too (so with autobuild off, still nothing)
function watchSources(builder) {
  const handle = builder.source();
  const repo = () => builder.env().repo;
  const edited = () => builder.edited();
  const watching = new Map(); // unpinned url → { handle? }
  const warned = new Set();
  let kWatch = null; // { url, handle? }: the target .k, for its sources
  let closed = false;

  function warnOnce(url, error) {
    if (warned.has(url)) return;
    warned.add(url);
    console.warn(`knitoutjs: can't watch ${url}`, error);
  }

  // the heads a watched doc has now, as a pin says them, once it's found
  function headsNow(url) {
    const found = watching.get(url)?.handle;
    return found ? headsOf(found.view(found.heads()).url) : undefined;
  }

  // the docs the code reads at fixed heads (`#heads` written in it), which
  // never move: the .js's own, and those of the modules it uses, as found
  function pinnedNow() {
    return [handle.doc(), ...[...watching.values()].map((entry) => entry.handle?.doc())].flatMap(pinsOf);
  }

  // only once for each set of sources the .k has: a build that comes out
  // the same (or fails) isn't tried again and again
  let builtFor = null;
  function buildIfMoved() {
    const kDoc = kWatch?.handle?.doc();
    if (!kDoc || !builder.auto() || !sourcesMoved(kDoc, headsNow, { pinned: pinnedNow() })) return;
    const sources = knitoutOf(kDoc).sources.join(" ");
    if (sources === builtFor) return;
    builtFor = sources;
    edited();
  }

  function recompute() {
    if (closed) return;
    const want = watchedSources(handle.doc(), kWatch?.handle?.doc(), {
      self: handle.url,
      target: builder.target(),
      pinned: pinnedNow(),
    });
    for (const [url, entry] of watching) {
      if (want.includes(url)) continue;
      entry.handle?.off("change", edited);
      watching.delete(url);
    }
    for (const url of want) {
      if (watching.has(url)) continue;
      const entry = {};
      watching.set(url, entry);
      repo().find(url).then((found) => {
        // it may have left the set (or this closed) while it was found
        if (closed || watching.get(url) !== entry) return;
        entry.handle = found;
        found.on("change", edited);
        // a module found says what it pins, which may need no watching
        recompute();
      }, (error) => warnOnce(url, error));
    }
    buildIfMoved();
  }

  // the target .k's own doc says what it was built from; a build writes it
  function watchTarget() {
    const url = knitoutOf(handle.doc()).target;
    if (kWatch?.url === url) return recompute();
    kWatch?.handle?.off("change", recompute);
    const entry = (kWatch = url ? { url } : null);
    recompute();
    if (!entry) return;
    repo().find(url).then((found) => {
      if (closed || kWatch !== entry) return;
      entry.handle = found;
      found.on("change", recompute);
      recompute();
    }, (error) => warnOnce(url, error));
  }

  handle.on("change", watchTarget);
  watchTarget();
  return () => {
    closed = true;
    handle.off("change", watchTarget);
    kWatch?.handle?.off("change", recompute);
    for (const entry of watching.values()) entry.handle?.off("change", edited);
    watching.clear();
  };
}

export const jsBuild = sourceKind("js", {
  name: "knitout.js",
  targetField: "knitoutTarget",
  targetExtension: "k",
  targetName: (doc) => (doc?.name ?? "pattern").replace(/\.knitout\.js$|\.js$/, "") + ".k",
  autobuild: { key: (url) => `knitoutjs:autorun:${url}`, default: true },
  lines: true,
  titles: {
    build: "build the pattern: it writes its knitout into the .k file chosen on the right (⌘↵)",
    auto: "build again by itself whenever you stop typing for a moment. this browser remembers it for this file",
    target: "the .k file this pattern writes its knitout (the machine's instructions) into",
    open: "show that .k file's text beside this one",
  },
  async build(jsHandle, kHandle, { signal, repo }) {
    const { runInto } = await import("./run.js");
    const result = await runInto(jsHandle, kHandle, repo, { signal });
    if (result.error) return { error: result.error };
    return { message: builtMessage(result.ms, result.knitout) };
  },
  watch: watchSources,
});
