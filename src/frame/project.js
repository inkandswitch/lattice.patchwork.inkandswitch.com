// lattice's project tool: latticework on a project, with lattice's tools. the
// frame shows the same in its middle
import { createRoot } from "solid-js";
import { mountProject } from "../../packages/wm/project-view.js";
import { PROJECT_TOOLS } from "../../packages/wm/doc/project.js";
import { TOOLS, toolsFor, fileExtension } from "./files.js";
import { newMachine, newSwatch, newYarn } from "./profile-docs.js";
import { useToolStorage } from "./storage.js";

// what lattice's latticework has, over knitoutjs's: its tools; a machine, a
// yarn and a swatch in the + menu; and a terminal there while alt is held.
// `repo` is the project's (a draft's, in a draft), and `baseRepo` the repo
// under any draft overlay: latticex shares on the doc itself, never on a
// draft's copy of it
const PROFILES = [
  { icon: "build", label: "machine", detail: "a knitting machine: its gauge, beds and stitch table", make: newMachine },
  { icon: "link", label: "yarn", detail: "a yarn: what it is, its count, and its swatches", make: newYarn },
  { icon: "fit", label: "swatch", detail: "a swatch: how it was knit, and what it measures", make: newSwatch },
];

export function latticeOptions(baseRepo, repo = baseRepo) {
  return {
    tools: { TOOLS, toolsFor, fileExtension },
    self: PROJECT_TOOLS,
    menu: [
      ...PROFILES.map(({ icon, label, detail, make }) => ({
        icon,
        label,
        detail,
        async create() {
          return (await repo.create2(make())).url;
        },
      })),
      {
        icon: "terminal",
        label: "terminal",
        detail: "shared from your computer with latticex",
        alt: true,
        async create() {
          const terminal = await baseRepo.create2({
            "@patchwork": { type: "latticex" },
            title: "terminal",
          });
          return terminal.url;
        },
      },
    ],
  };
}

export default function LatticeProjectTool(handle, element) {
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
      ...latticeOptions(baseRepo, repo),
    });
    return () => {
      unmount();
      dispose();
    };
  });
}
