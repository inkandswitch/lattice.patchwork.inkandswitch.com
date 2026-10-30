// what we know about the files a knitout project shows
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { isKeyhiveDoc } from "@inkandswitch/patchwork-plugins";

export function docText(doc) {
  const content = doc?.content;
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  if (typeof content.val === "string") return content.val;
  return String(content);
}

// a short fingerprint of some text (fnv-1a): a .k keeps one of the code it
// was built from, so anyone can see when that code has changed since
export function textHash(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// download some text as a file
export function saveFile(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// a module worker, from a script that may be on another origin: a dev
// server's frame (?lattice-frame=). a worker can't be started from another
// origin's script, but a blob of this origin's can import it (with cors)
export function moduleWorker(url) {
  if (new URL(url).origin === location.origin) return new Worker(url, { type: "module" });
  const source = `import ${JSON.stringify(String(url))};`;
  const blob = new Blob([source], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob), { type: "module" });
}

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
  if (doc?.extension) return doc.extension.replace(/^\./, "").toLowerCase();
  const match = doc?.name?.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
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
    load: () => import("./visualizer.js"),
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
  editor: {
    id: "editor",
    name: "text",
    title: "see the file's text (and change it, if it isn't generated)",
    position: 1,
    extensions: ["js", "k"],
    load: () => import("./editor.js"),
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
    load: () => import("./patchwork-pane.js"),
  },
};

export function toolsFor(extension) {
  const tools = Object.values(TOOLS).filter((tool) =>
    tool.extensions.includes(extension),
  );
  return tools.length ? tools : [TOOLS.patchwork];
}

// each doc gets a colour of its own, so every pane showing it wears the same
// one. the colours are tokens in frame.css
export const DOC_COLOURS = [
  "cherry",
  "blue",
  "stem",
  "lilac",
  "peach",
  "butter",
];

export function docColour(url) {
  let hash = 0;
  for (const char of url ?? "") hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return DOC_COLOURS[Math.abs(hash) % DOC_COLOURS.length];
}

// automerge:4NMNnkMhL8jXrdJ9jamS58PAVdXu → 4NMNnk…
export function shortUrl(url) {
  return url ? url.replace(/^automerge:/, "").slice(0, 6) + "…" : "";
}

export function newFileDoc(name, content = "") {
  const extension = fileExtension({ name });
  return {
    "@patchwork": { type: "file" },
    name,
    extension,
    mimeType: extension === "js" ? "text/javascript" : "text/plain",
    content,
  };
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
