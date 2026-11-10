// knitoutjs in a wm workspace: a .js and the .k it writes, linked; how its
// builds are going, on the .k's pane and the .js's; and new patterns. it's
// handed to wm by whoever mounts one (lattice, or the Knitout JS app), and
// imports nothing of wm's: what it needs of the workspace is `api` (see
// packages/wm/workspace.js)
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { builds, setBuild } from "./core/builds.js";
import { docText, fileExtension, knitoutOf, textHash } from "./core/files.js";
import defaultSource from "./core/default-source.js";

const string = (value) => (value == null ? "" : String(value));
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

// what wm keeps of a doc for us: its knitout links, and a .js's code now,
// to tell when the .k it writes is out of date
const linksOf = (url, api) => api.docInfo(url).ext?.knitout ?? {};

// how a .js's build is going: yours, or someone else's in the room if
// theirs is newer. what's only yours (its builder, autobuild, whether it
// failed last) stays yours
function buildOf(jsUrl, api) {
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
// failed. null once its .js writes somewhere else
function buildState(kUrl, api) {
  const k = linksOf(kUrl, api);
  const js = k.source ? linksOf(k.source, api) : null;
  if (js?.target !== kUrl) return null;
  const build = buildOf(k.source, api);
  if (build.state === "running") return "running";
  if (build.state === "error") return "error";
  const outOfDate = !!k.sourceHash && !!js.textHash && k.sourceHash !== js.textHash;
  // with autobuild on, it's about to build anyway
  if (outOfDate) return build.auto && build.builder ? "running" : "stale";
  return "built";
}

// build a .js into its .k again: by its editor, if it's open in one, so its
// build bar shows it too
async function rebuild(jsUrl, kUrl, api) {
  const builder = builds[jsUrl]?.builder;
  if (builder) return builder.now();
  const [{ runInto }, jsHandle, kHandle] = await Promise.all([
    import("./core/run.js"),
    api.repo.find(jsUrl),
    api.repo.find(kUrl),
  ]);
  setBuild(jsUrl, { state: "running", line: undefined, message: undefined });
  const { error } = await runInto(jsHandle, kHandle, api.repo);
  setBuild(
    jsUrl,
    error
      ? { state: "error", line: error.line ?? undefined, message: String(error.message ?? error) }
      : { state: "ok" },
  );
}

// a build that failed: show the .js, at the line it failed on
async function showError(jsUrl, from, api) {
  await api.reveal(jsUrl, from, "left", "editor");
  const line = buildOf(jsUrl, api).line;
  if (line != null) builds[jsUrl]?.builder?.goToLine(line);
}

// a .js and the .k it writes, side by side on a row of their own, and the
// .k built once, so there's something to see
async function newPattern(api) {
  const k = await api.createFile("pattern.k");
  const js = await api.createFile("pattern.knitout.js", { content: defaultSource, knitoutTarget: k });
  api.openRow([[{ url: js, tool: "editor" }], [{ url: k, tool: "visualizer" }]]);
  const [{ runInto }, jsHandle, kHandle] = await Promise.all([
    import("./core/run.js"),
    api.repo.find(js),
    api.repo.find(k),
  ]);
  runInto(jsHandle, kHandle, api.repo);
}

// a new file opens as text, ready to write in (a .k too, which would
// otherwise open in whatever draws it)
const newFile = (name) => async (api) => ({ url: await api.createFile(name), tool: "editor" });

const STATES = new Set(["running", "ok", "error"]);
// someone's builds, checked: by the .js's url, {state, line, message, at}
function buildsFrom(value) {
  if (!isObject(value)) return {};
  const read = {};
  for (const [url, build] of Object.entries(value)) {
    if (!isValidAutomergeUrl(url) || !isObject(build) || !STATES.has(build.state)) continue;
    if (typeof build.at !== "number") continue;
    read[url] = {
      state: build.state,
      line: Number.isInteger(build.line) ? build.line : undefined,
      message: build.message == null ? undefined : string(build.message),
      at: build.at,
    };
  }
  return read;
}

export const knitout = {
  name: "knitout",

  watch(doc) {
    return {
      ...knitoutOf(doc),
      textHash: fileExtension(doc) === "js" ? textHash(docText(doc)) : null,
    };
  },

  // a .js lights up with the .k it writes into now, and a .k with its
  // editable copy. a .k also remembers which .js wrote it last, but once
  // that writes somewhere else it's history: a chip, but no light
  links(url, api) {
    const doc = linksOf(url, api);
    const links = [];
    if (doc.target) links.push({ url: doc.target, live: true });
    if (doc.copyOf) {
      links.push({ url: doc.copyOf, label: "copy of", title: "open the .k this is a copy of", live: true });
    }
    if (doc.source) {
      const live = linksOf(doc.source, api).target === url;
      links.push({
        url: doc.source,
        label: live ? "written by" : "last written by",
        title: "open the .js that wrote this",
        live,
      });
    }
    return links;
  },

  // a generated .k's line: built just now, out of date, or its .js failed,
  // only while its .js still writes into it. a .js's says when it failed
  status(url, api) {
    const doc = linksOf(url, api);
    const jsUrl = doc.source ?? url;
    const build = buildOf(jsUrl, api);
    const state = doc.source ? buildState(url, api) : build.state === "error" ? "error" : null;
    if (!state) return null;
    // a .k that isn't keeping up with its .js: it failed, or it's out of
    // date, or it's building again after failing
    const stuck =
      !!doc.source &&
      (state === "error" || state === "stale" || (state === "running" && !!builds[doc.source]?.failed));
    switch (state) {
      case "running":
        return { state, stuck, text: "building…" };
      case "error":
        return {
          state,
          stuck,
          action: {
            icon: "warning",
            label: build.line != null ? `error on line ${build.line}` : "error",
            title: `${build.message ?? ""}\n${doc.source ? "show the .js, at that line" : "go to that line"}`,
            run: (from) => showError(jsUrl, from, api),
          },
        };
      case "stale":
        return {
          state,
          stuck,
          text: "out of date —",
          action: {
            icon: "rebuild",
            label: "rebuild",
            title: "build it again from its .js",
            run: () => rebuild(doc.source, url, api),
          },
        };
      default:
        return { state, stuck, text: doc.builtAt ? `generated ${api.ago(doc.builtAt)}` : "generated" };
    }
  },

  // a .k is built, not edited: its newest change is its whole knitout. a new
  // build, from here or anyone else, tints its panes
  touched(url, api) {
    const { builtAt } = linksOf(url, api);
    return builtAt ? { verb: "built", at: builtAt, flash: true } : null;
  },

  menu() {
    return [
      {
        icon: "plus",
        label: "pattern",
        detail: "a .js and the .k it writes",
        primary: "new pattern",
        create: newPattern,
      },
      { icon: "file", label: ".js file", create: newFile("untitled.knitout.js") },
      { icon: "file", label: ".k file", create: newFile("untitled.k") },
    ];
  },

  presence: {
    // how your builds of this project's .js are going, for everyone else
    builds: {
      mine(api) {
        const mine = {};
        for (const { url } of api.files()) {
          const { state, line, message, at } = builds[url] ?? {};
          if (STATES.has(state)) mine[url] = { state, line, message, at };
        }
        return mine;
      },
      read: buildsFrom,
    },
  },
};
