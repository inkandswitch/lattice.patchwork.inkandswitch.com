// the logic behind a knitout project's links and a .k's build state, apart
// from the wiring in ../wm.js: nothing here imports automerge-repo or solid,
// so it can be tested in node. what it needs of the page comes in as
// arguments: `api` (see packages/wm/workspace.js), `builds` (how each .js's
// builds are going) and `headsNow(unpinnedUrl)` (a doc's heads now, as
// core/sources.js's headsOf gives them for a pin, or undefined if not known yet)
import { staleSources } from "./sources.js";

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
  const moved = (k.sources ?? []).length > 1 && staleSources(k.sources, headsNow).length > 0;
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
  // the first source is the .js itself, which "written by" has
  for (const source of (doc.sources ?? []).slice(1)) {
    found.push({ url: source, label: "built from", title: "open a doc this was built from", live: false });
  }
  return found;
}
