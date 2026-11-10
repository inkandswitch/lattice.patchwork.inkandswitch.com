// the files this app shows, and which tools open them. what we know about
// the files themselves is in core (shared with lattice)
import { fileExtension } from "../core/files.js";

export * from "../core/files.js";

// the first tool that fits a file is the one it opens in. anything that
// isn't a .js or .k shows with patchwork's own tool for it (wm's)
export const TOOLS = {
  visualizer: {
    id: "visualizer",
    name: "visualiser",
    title: "draw the stitches this .k makes",
    // where it sits in a tab's tool menu
    position: 2,
    extensions: ["k"],
    patchworkId: "lattice:knitoutjs-visualizer",
    load: () => import("../core/visualizer.js"),
  },
  editor: {
    id: "editor",
    name: "text",
    title: "see the file's text (and change it, if it isn't generated)",
    position: 1,
    extensions: ["js", "k"],
    load: () => import("../core/editor.js"),
  },
};

export function toolsFor(extension) {
  return Object.values(TOOLS).filter((tool) => tool.extensions.includes(extension));
}

// for wm
export const tools = {
  list: Object.values(TOOLS),
  for: (doc) => toolsFor(fileExtension(doc)),
};
