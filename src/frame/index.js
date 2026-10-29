import defaultJavaScriptContent from "./default-source.js";
import { newFileDoc } from "./files.js";
import { newPanel, newGroup, newSplit } from "./layout.js";

export const plugins = [
  {
    type: "patchwork:tool",
    id: "lattice",
    name: "Lattice Frame",
    icon: "Shirt",
    supportedDatatypes: ["folder", "account"],
    async load() {
      const { default: KnitoutFrameTool } = await import("./frame.js");
      return KnitoutFrameTool;
    },
  },
  // a lattice project's layout: what its drafts are of. it lives behind
  // the project's folder (as `workspace`), never on its own
  {
    type: "patchwork:datatype",
    id: "lattice:workspace",
    name: "Lattice Workspace",
    icon: "LayoutGrid",
    unlisted: true,
    async load() {
      return {
        init(doc) {
          doc.layout = null;
        },
        getTitle() {
          return "workspace";
        },
        setTitle() {},
      };
    },
  },
  // a terminal latticex shares from someone's computer. unlisted: you make
  // one from a frame's + menu, holding alt
  {
    type: "patchwork:datatype",
    id: "latticex",
    name: "Terminal",
    icon: "SquareTerminal",
    unlisted: true,
    async load() {
      return {
        init(doc) {
          doc.title = "terminal";
        },
        getTitle(doc) {
          return doc.title || "terminal";
        },
        setTitle(doc, title) {
          doc.title = title;
        },
      };
    },
  },
  {
    type: "patchwork:tool",
    id: "latticex",
    name: "Terminal",
    icon: "SquareTerminal",
    supportedDatatypes: ["latticex"],
    async load() {
      const { default: LatticexTerminalTool } = await import("./terminal.js");
      return LatticexTerminalTool;
    },
  },
];
