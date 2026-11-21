import { createStore, unwrap } from "solid-js/store";

// how each source's builds are going (a .js's, a .k's into its .kc, a
// patternstoat's), for the whole frame: its builder (builder.js) builds it
// (by hand, or by itself with autobuild on) and says so here, so the panes
// showing what it writes can say so too. keyed by the source's url:
// { state: "idle" | "running" | "ok" | "error" | "ask", line?, message?, at,
//   auto, due, failed, builder?: { now(), goToLine(line) → whether it could } }
// there's only a builder while the source is shown somewhere (or edited).
// due is whether its autobuild's waiting out a pause, about to build.
// failed is how its last build that finished went, kept while it's edited
// and built again. at is when its state was last said
const [builds, setBuilds] = createStore({});

export { builds };

export function setBuild(url, build) {
  if (build.state) build = { ...build, at: Date.now() };
  if (build.state === "error") build = { ...build, failed: true };
  if (build.state === "ok") build = { ...build, failed: false };
  setBuilds(url, build);
}

// the builder itself, not the store's stand-in for it, to tell whose it is
export function builderOf(url) {
  return unwrap(builds)[url]?.builder;
}
