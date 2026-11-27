// before a pattern runs, every doc it names is found and pinned at its heads
// now: a .js as a module (with what it names pinned in turn), anything else
// as a plain value. the run only ever sees these, so a build is made from one
// version of everything, and says which (`sources`)
//
// a graph is {pins, modules, snapshots, gets, sources}:
// - pins: each url as written (normalised) → the pinned url it's read at
// - modules: the .js docs, children first, each with its own specifiers pinned
// - snapshots: pinned url → plain value, for the docs that aren't code (or are
//   read with `doc()`)
// - gets: what's at each url `get()` asked for, by get.js's getKey: {value,
//   url, fetchedAt} or {error}. it isn't a doc, so it has no version to pin,
//   and isn't one of the sources: webSources says what was fetched when
// - sources: the pattern, then every doc depth-first as first reached, once
import { isImmutableString, isCounter } from "@automerge/automerge";
import { collectGets, collectSources, isDocUrl } from "./instrument.js";
import { fetchGet, getKey } from "./get.js";
import { unpinned, headsOf, webSource } from "./sources.js";
import { fileExtension, docText } from "./files.js";
import { NotReady, moduleSources, rewriteSpecifiers } from "./modules.js";

export { NotReady };

// a doc's value with automerge's own types made plain, so it can be posted
// to a worker and read like any object
export function plainValue(value) {
  if (isImmutableString(value)) return value.toString();
  if (isCounter(value)) return value.value;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(plainValue);
  const out = {};
  for (const [key, field] of Object.entries(value)) out[key] = plainValue(field);
  return out;
}

const buildError = (message, line) => Object.assign(new Error(message), { line });

// a doc at the heads written in its url, or at its heads now. a find that
// doesn't settle in `timeout` counts as not found
async function read(repo, url, timeout) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), timeout);
  });
  try {
    const handle = await Promise.race([repo.find(unpinned(url)), late]);
    const heads = headsOf(url);
    const view = handle.view(heads ? heads.split("|") : handle.heads());
    const value = view.doc();
    if (value === undefined) throw new Error("no doc");
    return { pinned: view.url, value: plainValue(value) };
  } finally {
    clearTimeout(timer);
  }
}

// adds to a copy of `graph`, leaving the one given as it was. `self` is the
// pattern's own url, which can't be imported (that would be a cycle)
function walker(graph, repo, { timeout, self, selfValue }) {
  const pins = { ...graph.pins };
  const snapshots = { ...graph.snapshots };
  const modules = [...graph.modules];
  const gets = { ...graph.gets };
  const sources = [...graph.sources];
  const done = new Set(modules.map((m) => m.pinned));
  // values read this time round, by url as written
  const values = selfValue === undefined ? {} : { [self]: selfValue };
  // the modules being visited, outermost first
  const path = self ? [self] : [];

  // what a url's doc says, from what's been read already where possible.
  // a pinned one is read again at its pin, so its heads aren't asked twice
  async function valueOf(url, where) {
    if (url in values) return values[url];
    const known = snapshots[pins[url]];
    if (known !== undefined) return known;
    try {
      const got = await read(repo, pins[url] ?? url, timeout);
      if (!(url in pins)) {
        pins[url] = got.pinned;
        sources.push(got.pinned);
      }
      values[url] = got.value;
      return got.value;
    } catch {
      throw buildError(`couldn't find ${url}${where.at}`, where.top);
    }
  }

  async function nameOf(url) {
    try {
      const name = (await valueOf(url, { at: "", top: null }))?.name;
      return typeof name === "string" && name ? name : url;
    } catch {
      return url;
    }
  }

  // kind is how it was used: "doc" for `doc()`, "import" / "export" /
  // "dynamic" for a module, "any" (both) when the run didn't say
  async function visit(url, kind, where) {
    // a run asking for a module it's inside of can only have meant its value
    if (kind === "any" && path.includes(url)) kind = "doc";
    if (kind !== "doc" && path.includes(url)) {
      const loop = [...path.slice(path.indexOf(url)), url];
      const names = await Promise.all(loop.map(nameOf));
      throw buildError(`import cycle: ${names.join(" → ")}`, where.top);
    }
    if (url in pins && done.has(pins[url]) && kind !== "doc" && kind !== "any") return;
    const value = await valueOf(url, where);
    const pinned = pins[url];
    const js = fileExtension(value) === "js";
    if (!js || kind === "doc" || kind === "any") snapshots[pinned] ??= value;
    if (!js || kind === "doc" || done.has(pinned)) return;
    // a module: what it uses goes first, so their pins are known here
    const code = docText(value);
    const name = await nameOf(url);
    const pinsOf = {};
    path.push(url);
    for (const use of moduleSources(code)) {
      await visit(use.url, use.kind, { at: ` (line ${use.line} of ${name})`, top: where.top });
      pinsOf[use.url] = pins[use.url];
    }
    path.pop();
    modules.push({ pinned, code: rewriteSpecifiers(code, pinsOf) });
    done.add(pinned);
  }

  return {
    visit,
    graph: () => ({ pins, modules, snapshots, gets, sources }),
  };
}

// the graph a pattern (`code`, the text of `self`, a .js handle, at `heads`)
// runs against. rejects with {message, line} when a doc can't be found or
// the imports go round in a circle; line is the pattern's, where it leads
// there. pass the heads `code` was read at, so the pin says the same version.
// `pinned` (pinned urls, a build's sources) are read at their pins, not as
// they are now, so it's the same docs a build was made from. what it `get()`s
// of a url written out is fetched (`fetch(url, as)`, get.js's fetchGet) while
// the docs are found
export async function buildGraph(
  code,
  repo,
  { self, heads = self.heads(), timeout = 10_000, pinned: given = [], fetch = fetchGet },
) {
  const view = self.view(heads);
  const url = isDocUrl(self.url) ?? self.url;
  const pinned = view.url;
  const pins = {};
  for (const each of given) if (headsOf(each)) pins[unpinned(each)] = each;
  pins[url] = pinned;
  const fetching = collectGets(code).map(async ({ url, as }) => [getKey(url, as), await fetch(url, as)]);
  const walk = walker({ pins, modules: [], snapshots: {}, gets: {}, sources: [pinned] }, repo, {
    timeout,
    self: url,
    selfValue: plainValue(view.doc()),
  });
  for (const use of collectSources(code)) {
    await walk.visit(use.url, use.kind, { at: ` (line ${use.line})`, top: use.line });
  }
  const graph = walk.graph();
  return { ...graph, gets: { ...graph.gets, ...Object.fromEntries(await Promise.all(fetching)) } };
}

// what a graph's gets fetched, as web sources (sources.js's webSource), each
// url once, in the order they were got. one that failed wasn't read; a data:
// url is in the code it's written in, which is a source already
export function webSources(graph) {
  const found = new Map();
  for (const got of Object.values(graph.gets ?? {})) {
    if (!("value" in got) || typeof got.url !== "string" || got.url.startsWith("data:")) continue;
    if (!found.has(got.url)) found.set(got.url, webSource(got.url, got.fetchedAt ?? Date.now()));
  }
  return [...found.values()];
}

// a new graph with what's at `url` (as get.js's `as`) fetched and added
export async function extendGets(graph, url, as, { fetch = fetchGet } = {}) {
  return { ...graph, gets: { ...graph.gets, [getKey(url, as)]: await fetch(url, as) } };
}

// a new graph with `url` (and, for a .js, what it uses) pinned and added
// after what's there. what's there is kept as it was, pins and all. `line`
// is the pattern's line it was asked for on, if known, for the errors
export async function extendGraph(graph, url, repo, { timeout = 10_000, kind = "any", line = null } = {}) {
  const at = line == null ? "" : ` (line ${line})`;
  const key = isDocUrl(url);
  if (!key) throw buildError(`couldn't find ${url}${at}`, line);
  const self = Object.keys(graph.pins).find((u) => graph.pins[u] === graph.sources[0]);
  const walk = walker(graph, repo, { timeout, self });
  await walk.visit(key, kind, { at, top: line });
  return walk.graph();
}

// how much a graph holds, to tell whether extending it added anything
const sizeOf = (graph) =>
  [graph.sources, graph.modules, Object.keys(graph.snapshots), Object.keys(graph.pins), Object.keys(graph.gets ?? {})]
    .map((list) => list.length)
    .join(" ");

// runs a pattern until it stops asking for docs it wasn't given: each time it
// answers {notReady: url, kind, line}, that doc is added (or, kind "get",
// what's at the url is fetched, as `as`) and it runs again from the start.
// asking for one it already has would only ask again, so that fails at once
export async function buildRounds(run, graph, repo, { maxRuns = 20, timeout, fetch = fetchGet } = {}) {
  for (let runs = 1; ; runs++) {
    const result = await run(graph);
    if (!result?.notReady) return { result, graph };
    const line = result.line ?? null;
    if (runs >= maxRuns) {
      throw buildError(`still asking for new docs after ${runs} runs: ${result.notReady}`, line);
    }
    const next =
      result.kind === "get"
        ? await extendGets(graph, result.notReady, result.as, { fetch })
        : await extendGraph(graph, result.notReady, repo, { timeout, kind: result.kind, line });
    if (sizeOf(next) === sizeOf(graph)) {
      throw buildError(`asked for ${result.notReady} again, but the build already has it`, line);
    }
    graph = next;
  }
}
