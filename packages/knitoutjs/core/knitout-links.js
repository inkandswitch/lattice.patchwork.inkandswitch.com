// the logic behind a knitout project's links and a .k's build state, apart
// from the wiring in ../wm.js: nothing here imports automerge-repo or solid,
// so it can be tested in node. what it needs of the page comes in as
// arguments: `api` (see packages/wm/workspace.js), `builds` (how each .js's
// builds are going) and `headsNow(unpinnedUrl)` (a doc's heads now, as
// core/sources.js's headsOf gives them for a pin, or undefined if not known yet)
import { docText, fileExtension, knitoutOf } from "./files.js";
import { collectSources } from "./instrument.js";
import { exceptPinned, headsOf, recordedSources, staleSources, unpinned } from "./sources.js";

// every doc a .js names; nothing for any other file
const usesOf = (doc) => (fileExtension(doc) === "js" ? collectSources(docText(doc)) : []);

// what a .js imports or reads with doc(), unpinned, each once, in order
export function importsOf(doc) {
  return [...new Set(usesOf(doc).map((use) => unpinned(use.url)))];
}

// the docs a .js names at fixed heads (`automerge:<id>#<heads>`), as written,
// each once: it's read at those heads however the doc moves on
export function pinsOf(doc) {
  return [...new Set(usesOf(doc).map((use) => use.url).filter(headsOf))];
}

// every doc whose moving makes the .k a .js writes stale, unpinned, each once:
// the .js's literal imports, then the .k's sources after the first (which
// include docs only reached at runtime). never the .js (`self`) or the .k
// (`target`): a build writes the .k, so watching it would rebuild forever.
// nor one only read at heads the code pins (`pinned`: the .js's own, and
// any the modules it uses pin), which can't move
export function watchedSources(jsDoc, kDoc, { self, target, pinned = pinsOf(jsDoc) }) {
  const imports = usesOf(jsDoc).filter((use) => !headsOf(use.url)).map((use) => unpinned(use.url));
  const known = exceptPinned((kDoc?.knitoutSources ?? []).slice(1).map(String), pinned).map(unpinned);
  const skip = new Set([self && unpinned(self), target && unpinned(target)]);
  return [...new Set([...imports, ...known])].filter((url) => !skip.has(url));
}

// whether a doc the .k was built from has moved on since (the .js itself
// aside, one whose heads aren't known yet, and one the code pins), so it's
// due a build
export function sourcesMoved(kDoc, headsNow, { pinned = [] } = {}) {
  return staleSources(knitoutOf(kDoc).sources, headsNow, { pinned }).length > 0;
}

// which docs to go and find: each once, but one whose find failed is let
// through again on an ask once `retryAfter` ms have passed (a find can fail
// for a moment, offline, say), so it isn't left unwatched all session
export function findOnce({ retryAfter = 30_000, now = Date.now } = {}) {
  const failedAt = new Map(); // url → when its find failed, or null if found or finding
  return {
    ask(url) {
      if (failedAt.has(url) && (failedAt.get(url) === null || now() - failedAt.get(url) < retryAfter)) return false;
      failedAt.set(url, null);
      return true;
    },
    failed(url) {
      failedAt.set(url, now());
    },
  };
}

// what wm keeps of a doc for us: its knitout links, and a .js's code now,
// to tell when the .k it writes is out of date
export const linksOf = (url, api) => api.docInfo(url).ext?.knitout ?? {};

// how a .js's build is going: yours, or someone else's in the room if
// theirs is newer. what's only yours (its builder, autobuild, whether it
// failed last) stays yours
export function buildOf(jsUrl, api, builds) {
  const mine = builds[jsUrl] ?? {};
  let latest = mine.state ? mine : null;
  for (const person of api.people()) {
    const build = person.ext?.knitout?.builds?.[jsUrl];
    if (build && !(latest?.at >= build.at)) latest = build;
  }
  if (!latest || latest === mine) return mine;
  return { ...mine, state: latest.state, line: latest.line, message: latest.message };
}

// how a generated .k is doing: built, building, out of date, or its .js
// failed. null once its .js writes somewhere else. it's out of date when its
// .js's code has changed, or when a doc it was built from has moved on
export function buildState(kUrl, api, { builds, headsNow }) {
  const k = linksOf(kUrl, api);
  const js = k.source ? linksOf(k.source, api) : null;
  if (js?.target !== kUrl) return null;
  const build = buildOf(k.source, api, builds);
  if (build.state === "running") return "running";
  if (build.state === "error") return "error";
  const edited = !!k.sourceHash && !!js.textHash && k.sourceHash !== js.textHash;
  // (a .k built before builds left out the .k itself, and the .js again,
  // can still list them: they'd be stale by its own write)
  const sources = recordedSources(k.sources ?? [], { self: k.source, target: kUrl });
  // what the .js pins can't move, nor what a module it uses pins (as that
  // module is now: if it's moved, that's stale of itself)
  const pinned = [js, ...sources.slice(1).map((url) => linksOf(unpinned(url), api))].flatMap((doc) => doc.pins ?? []);
  const moved = sources.length > 1 && staleSources(sources, headsNow, { pinned }).length > 0;
  // with autobuild on, it's about to build anyway
  if (edited || moved) return build.auto && build.builder ? "running" : "stale";
  return "built";
}

// a doc's links: where a .js writes, what it imports (and who imports it),
// and what a .k was built from. a doc outside the project is as good as one
// in it: wm shows what it knows of it
export function links(url, api) {
  const doc = linksOf(url, api);
  const found = [];
  if (doc.target) found.push({ url: doc.target, live: true });
  if (doc.copyOf) {
    found.push({ url: doc.copyOf, label: "copy of", title: "open the .k this is a copy of", live: true });
  }
  // a .k also remembers which .js wrote it last, but once that writes
  // somewhere else it's history: a chip, but no light
  if (doc.source) {
    const live = linksOf(doc.source, api).target === url;
    found.push({
      url: doc.source,
      label: live ? "written by" : "last written by",
      title: "open the .js that wrote this",
      live,
    });
  }
  for (const imported of doc.imports ?? []) {
    found.push({ url: imported, label: "imports", title: "open what this imports", live: true });
  }
  for (const file of api.files()) {
    if (file.url !== url && linksOf(file.url, api).imports?.includes(url)) {
      found.push({ url: file.url, label: "used by", title: "open a .js that imports this", live: true });
    }
  }
  // the first source is the .js itself, which "written by" has. a chip opens
  // the doc as it is now (the pinned version would be a read-only view, and
  // a pane of its own): the version it was built from is in its title
  for (const source of (doc.sources ?? []).slice(1)) {
    found.push({
      url: unpinned(source),
      label: "built from",
      title: `open a doc this was built from (it was built from ${source})`,
      live: false,
    });
  }
  return found;
}
