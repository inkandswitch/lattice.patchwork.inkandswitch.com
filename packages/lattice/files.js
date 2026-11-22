// the files lattice shows, and which tools open them. what we know about
// the files themselves is in knitoutjs's core (shared with it)
import { fileExtension as fileExtensionOf } from "../knitoutjs/core/files.js";
import { profileKind } from "./profile-docs.js";

// all of core's, but fileExtension: lattice's own (below) is the one
export * from "../knitoutjs/core/files.js";

// a link to a project's files (its folder or directory) on this site, and
// the name it's going by: whoever opens it gets a project of their own on
// them, called that (frame.js's openShared)
export function shareUrl(filesUrl, name) {
  name = String(name ?? "").trim();
  return `${location.origin}/#folder=${filesUrl}${name ? `&name=${encodeURIComponent(name)}` : ""}`;
}

// "js", "k", or whatever else the file says it is. a latticex terminal isn't
// a file, nor is a machine, a yarn or a swatch (profile-docs.js), but each
// opens in a tool of ours as if it were. any other doc that isn't a file
// (markdown, say) goes by its datatype: notes.markdown
export function fileExtension(doc) {
  const type = doc?.["@patchwork"]?.type;
  if (type === "latticex") return "latticex";
  if (type === "lattice:patternstoat") return "patternstoat";
  if (type === "lattice:charm") return "charm";
  const kind = profileKind(doc);
  if (kind) return kind;
  const own = fileExtensionOf(doc);
  if (own || !type || type === "file") return own;
  return String(type).toLowerCase();
}

// the first tool that fits a file is the one it opens in
export const TOOLS = {
  visualizer: {
    id: "visualizer",
    name: "visualiser",
    title: "draw the stitches this .k makes",
    // where it sits in a tab's tool menu
    position: 2,
    extensions: ["k"],
    load: () => import("../knitoutjs/core/visualizer.js"),
  },
  kniterate: {
    id: "kniterate",
    name: "kniterate",
    title: "the .k as a Kniterate editor draws it, a row a pass: and, if it isn't generated, edit it there",
    position: 3,
    extensions: ["k"],
    // only offered while alt is held (and to a pane that shows it already)
    offered: "alt",
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
  yarnpath: {
    id: "yarnpath",
    name: "yarn path",
    title: "the yarn itself, a path through where it touches other yarn, relaxed and drawn with its fibres: Hannah Twigg-Smith's knitscape",
    position: 6,
    extensions: ["k"],
    offered: "alt",
    load: () => import("./yarnpath.js"),
  },
  provenance: {
    id: "provenance",
    name: "provenance",
    title: "every stitch, and where it came from: its line of the .k, the line of the .js that wrote it, and what that read of the docs it was made from (a patternwitch's pixel, say). click one to keep it open, and go to any of them",
    position: 7,
    extensions: ["k"],
    load: () => import("./provenance.js"),
  },
  editor: {
    id: "editor",
    name: "text",
    title: "see the file's text (and change it, if it isn't generated)",
    position: 1,
    extensions: ["js", "k", "kc"],
    load: () => import("../knitoutjs/core/editor.js"),
  },
  terminal: {
    id: "terminal",
    name: "terminal",
    title: "a program on someone's computer, shared with latticex",
    position: 1,
    extensions: ["latticex"],
    patchworkId: "latticex",
    // latticex shares on the doc itself, never on a draft's copy of it
    drafts: false,
    load: () => import("./terminal.js"),
  },
  machine: {
    id: "machine",
    name: "machine",
    title: "a knitting machine: its gauge, beds, carriers and stitch table",
    position: 1,
    extensions: ["machine"],
    patchworkId: "lattice:machine",
    load: () => import("./machine.js"),
  },
  yarn: {
    id: "yarn",
    name: "yarn",
    title: "a yarn: what it is, its count, and the swatches knitted from it",
    position: 1,
    extensions: ["yarn"],
    patchworkId: "lattice:yarn",
    load: () => import("./yarn.js"),
  },
  patternstoat: {
    id: "patternstoat",
    name: "patternstoat",
    title: "a design in colours that stand for stitches, with stitches painted on top, built into a .k with a charm",
    position: 1,
    extensions: ["patternstoat"],
    patchworkId: "lattice:patternstoat",
    load: () => import("../patternstoat/stoat-tool.js"),
  },
  arrangement: {
    id: "arrangement",
    name: "arrangement",
    title: "a charm: what each colour of a patternstoat does, a pass a row, as the kniterate editor paints them",
    position: 1,
    extensions: ["charm"],
    patchworkId: "lattice:charm",
    load: () => import("../patternstoat/arrangement-tool.js"),
  },
  "charm-text": {
    id: "charm-text",
    name: "text",
    title: "the charm as text: a rule a colour",
    position: 2,
    extensions: ["charm"],
    load: () => import("../patternstoat/text-tool.js"),
  },
  swatch: {
    id: "swatch",
    name: "swatch",
    title: "a swatch: how it was knit, and what it measures",
    position: 1,
    extensions: ["swatch"],
    patchworkId: "lattice:swatch",
    load: () => import("./swatch.js"),
  },
};

// (those offered: a tool with offered false is only there for the panes
// that show it already, and one with offered "alt" is offered while alt is
// held, in altToolsFor)
export function toolsFor(extension) {
  return Object.values(TOOLS).filter(
    (tool) => tool.offered !== false && tool.offered !== "alt" && tool.extensions.includes(extension),
  );
}
export function altToolsFor(extension) {
  return Object.values(TOOLS).filter((tool) => tool.offered === "alt" && tool.extensions.includes(extension));
}

// for wm: a doc's tools are its kind's. one none of them fits shows with
// patchwork's own tool for it (wm's)
export const tools = {
  list: Object.values(TOOLS),
  for: (doc) => toolsFor(fileExtension(doc)),
  alt: (doc) => altToolsFor(fileExtension(doc)),
  extension: fileExtension,
};
