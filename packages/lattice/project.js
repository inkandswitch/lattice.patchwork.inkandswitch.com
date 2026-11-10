// lattice's project tool: wm's workspace on a project, with lattice's tools.
// the frame shows the same in its middle
import { createRoot } from "solid-js";
import { mountProject } from "../wm/project-view.js";
import { datatypeItem } from "../wm/patchwork/docs.js";
import { knitout } from "../knitoutjs/wm.js";
import { wearLook } from "../knitoutjs/look.js";
import { isOldKnitoutjs, updateKnitoutjs, OLD_KNITOUTJS_TYPES } from "../knitoutjs/app/migrate.js";
import { tools } from "./files.js";
import { newMachine, newSwatch, newYarn } from "./profile-docs.js";
import { useToolStorage } from "./storage.js";

// lattice's and knitoutjs's: the same shape, each with its own type
export const PROJECT_TYPES = ["lattice:project", "knitoutjs-project"];

// the tools that show a whole project: never offered in a pane of one
export const PROJECT_TOOLS = ["knitoutjs-project", "lattice:project", "lattice", ...OLD_KNITOUTJS_TYPES];

const PROFILES = [
  { icon: "build", label: "machine", detail: "a knitting machine: its gauge, beds and stitch table", make: newMachine },
  { icon: "link", label: "yarn", detail: "a yarn: what it is, its count, and its swatches", make: newYarn },
  { icon: "fit", label: "swatch", detail: "a swatch: how it was knit, and what it measures", make: newSwatch },
];

// what lattice adds to the + menu, after knitoutjs's: markdown, and while
// alt is held, a machine, a yarn, a swatch and a terminal. `baseRepo` is the
// repo under any draft overlay: latticex shares on the doc itself, never on
// a draft's copy of it
function lattice(baseRepo, hive) {
  return {
    name: "lattice",
    menu: () => [
      datatypeItem({ type: "markdown", icon: "text", label: "markdown" }, hive),
      ...PROFILES.map(({ icon, label, detail, make }) => ({
        icon,
        label,
        detail,
        alt: true,
        async create(api) {
          return (await api.repo.create2(make())).url;
        },
      })),
      {
        icon: "terminal",
        label: "terminal",
        detail: "shared from your computer with latticex",
        alt: true,
        async create() {
          const terminal = await baseRepo.create2({ "@patchwork": { type: "latticex" }, title: "terminal" });
          return terminal.url;
        },
      },
    ],
  };
}

// what lattice's workspace has: its tools, knitoutjs's extension and its
// own, and knitoutjs's projects from before, which it updates
export function latticeOptions(baseRepo, hive) {
  return {
    tools,
    extensions: [knitout, lattice(baseRepo, hive)],
    self: PROJECT_TOOLS,
    old: { is: isOldKnitoutjs, update: updateKnitoutjs, auto: true },
  };
}

export default function LatticeProjectTool(handle, element) {
  // knitout.js's look, which the frame wears too
  wearLook();
  const repo = element.repo;
  const baseRepo = repo.baseRepo ?? repo;
  return createRoot((dispose) => {
    // your pointer, an arrow or a mouse, as you chose it in lattice's settings
    const [mine] = useToolStorage(element, "lattice", { repo: baseRepo });
    const unmount = mountProject(element, {
      project: handle,
      repo,
      baseRepo,
      hive: element.hive,
      pointer: () => (mine()?.pointer === "mouse" ? "mouse" : "arrow"),
      ...latticeOptions(baseRepo, element.hive),
    });
    return () => {
      unmount();
      dispose();
    };
  });
}
