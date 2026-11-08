// the files lattice shows, and which tools open them. what we know about
// the files themselves is in knitoutjs's core (shared with it)
import { fileExtension as fileExtensionOf } from "./knitoutjs/core/files.js";

// all of core's, but fileExtension: lattice's own (below) is the one
export * from "./knitoutjs/core/files.js";

// a link to a project's files (its folder or directory) on this site: whoever
// opens it gets a project of their own on them (frame.js's openShared)
export function shareUrl(filesUrl) {
  return `${location.origin}/#folder=${filesUrl}`;
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
