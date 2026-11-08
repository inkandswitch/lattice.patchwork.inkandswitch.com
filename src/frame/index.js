// nothing imported up here: patchwork may read this list in a worker, which
// has no import map, so a bare import anywhere below this file stops the
// whole package registering. what each plugin needs, its load() imports
export const plugins = [
  {
    type: "patchwork:tool",
    id: "lattice",
    name: "Lattice Frame",
    icon: "Shirt",
    supportedDatatypes: ["folder", "account"],
    // offered as a frame wherever it's installed
    tags: ["frame-tool"],
    async load() {
      const { default: KnitoutFrameTool } = await import("./frame.js");
      return KnitoutFrameTool;
    },
  },
  // a project: {title, layout, files}, a layout doc and a folder (or a
  // pushwork directory) of its files. knitoutjs's knitoutjs-project is the
  // same shape, so each tool opens both
  {
    type: "patchwork:datatype",
    id: "lattice:project",
    name: "Lattice Project",
    icon: "Shirt",
    async load() {
      const { projectDatatype } = await import("./knitoutjs/core/project.js");
      return projectDatatype();
    },
  },
  {
    type: "patchwork:tool",
    id: "lattice:project",
    name: "Lattice Project",
    icon: "Shirt",
    supportedDatatypes: [
      "lattice:project",
      "knitoutjs-project",
      // knitoutjs's from before: it shows only a button to update them
      "prototype-knitoutjs-panes",
      "knitoutjs-panes",
    ],
    async load() {
      const { default: LatticeProjectTool } = await import("./project.js");
      return LatticeProjectTool;
    },
  },
  // a project's layout: its panes, and what's in them. it lives behind a
  // project (as `layout`), never on its own
  {
    type: "patchwork:datatype",
    id: "latticework:layout",
    name: "Layout",
    icon: "LayoutGrid",
    unlisted: true,
    async load() {
      const { layoutDatatype } = await import("./knitoutjs/core/project.js");
      return layoutDatatype;
    },
  },
  // a project's layout from before, behind its folder (as `workspace`).
  // updating the project makes it the project itself
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
