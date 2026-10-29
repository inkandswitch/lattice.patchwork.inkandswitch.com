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
  }
];
