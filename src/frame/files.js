// the files lattice shows, and which tools open them. what we know about
// the files themselves is in knitoutjs's core (shared with it)
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { isKeyhiveDoc } from "@inkandswitch/patchwork-plugins";
import { fileExtension as fileExtensionOf, shortUrl } from "./knitoutjs/core/files.js";

// all of core's, but fileExtension: lattice's own (below) is the one
export * from "./knitoutjs/core/files.js";

// an automerge url in some text: the url itself, or a patchwork link's
// #doc=automerge:<id> (or the older #doc=<id>)
export function urlFromText(text) {
  const trimmed = text.trim();
  if (isValidAutomergeUrl(trimmed)) return trimmed;
  const doc = trimmed.match(/#(?:.*&)?doc=([^&\s]+)/)?.[1];
  if (!doc) return null;
  const url = doc.startsWith("automerge:") ? doc : `automerge:${doc}`;
  return isValidAutomergeUrl(url) ? url : null;
}

// a link to a doc on this site, as patchwork's router reads them
export function shareUrl(url) {
  return `${location.origin}/#doc=${url}`;
}

// a string in a doc can be a plain string or an ImmutableString (pushwork
// writes links that way); read them the same
function asString(value) {
  return value == null ? undefined : String(value);
}

// the urls a folder doc links to, in order
export function folderUrls(doc) {
  return (Array.isArray(doc?.docs) ? doc.docs : [])
    .map((link) => asString(link?.url))
    .filter((url) => url && isValidAutomergeUrl(url));
}

export function folderTitle(doc) {
  return asString(doc?.title) || "untitled";
}

// the entry a folder keeps for a doc: what patchwork's folder tool writes
export function folderLink(url, doc, title) {
  return {
    name: asString(doc?.name ?? doc?.title ?? title) || shortUrl(url),
    type: asString(doc?.["@patchwork"]?.type) || "file",
    url,
  };
}

// "js", "k", or whatever else the file says it is. a latticex terminal isn't
// a file, but it opens in a tool of ours as if it were
export function fileExtension(doc) {
  if (doc?.["@patchwork"]?.type === "latticex") return "latticex";
  return fileExtensionOf(doc);
}

// the first tool that fits a file is the one it opens in. anything that
// isn't a .js or .k shows in a patchwork view
export const TOOLS = {
  visualizer: {
    id: "visualizer",
    name: "visualiser",
    title: "draw the stitches this .k makes",
    // where it sits in a tab's tool menu
    position: 2,
    extensions: ["k"],
    load: () => import("./knitoutjs/core/visualizer.js"),
  },
  kniterate: {
    id: "kniterate",
    name: "kniterate",
    title: "the passes this .k makes on a Kniterate, drawn the way its editor draws them",
    position: 3,
    extensions: ["k"],
    load: () => import("./kniterate.js"),
  },
  animation: {
    id: "animation",
    name: "animation",
    title: "watch this .k being knitted, a stitch at a time, by a little latch needle",
    position: 4,
    extensions: ["k"],
    load: () => import("./animation.js"),
  },
  knit3d: {
    id: "knit3d",
    name: "3d",
    title: "the fabric this .k makes, in 3d, hanging from the needle bed: a tube opens out round",
    position: 5,
    extensions: ["k"],
    load: () => import("./knit3d.js"),
  },
  editor: {
    id: "editor",
    name: "text",
    title: "see the file's text (and change it, if it isn't generated)",
    position: 1,
    extensions: ["js", "k"],
    load: () => import("./knitoutjs/core/editor.js"),
  },
  terminal: {
    id: "terminal",
    name: "terminal",
    title: "a program on someone's computer, shared with latticex",
    position: 1,
    extensions: ["latticex"],
    // latticex shares on the doc itself, never on a draft's copy of it
    drafts: false,
    load: () => import("./terminal.js"),
  },
  patchwork: {
    id: "patchwork",
    name: "patchwork",
    title: "show this doc with patchwork's own tool for it",
    extensions: ["*"],
    load: () => import("./knitoutjs/core/patchwork-pane.js"),
  },
};

export function toolsFor(extension) {
  const tools = Object.values(TOOLS).filter((tool) =>
    tool.extensions.includes(extension),
  );
  return tools.length ? tools : [TOOLS.patchwork];
}

// a new doc of one of patchwork's datatypes, like patchwork-plugins'
// createDocOfDatatype2 but recording only its type: no suggestedImportUrl
// (or frozenImportUrl) saying where the datatype was loaded from
export async function createDocOfDatatype(datatype, repo, change, hive) {
  const handle = await repo.create2();
  // a keyhive doc gets the sync server's relay, as createDocOfDatatype2 does
  if (hive && isKeyhiveDoc(handle.url)) await hive.addSyncServerRelayToDoc(handle.url);
  handle.change((doc) => {
    datatype.module.init(doc, repo);
    doc["@patchwork"] = { type: datatype.id };
    change?.(doc);
  });
  return handle;
}
