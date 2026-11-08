// lattice's project tool: latticework on a project, with lattice's tools. the
// frame shows the same in its middle
import { mountProject } from "./knitoutjs/core/project-view.js";
import { PROJECT_TOOLS } from "./knitoutjs/core/project.js";
import { TOOLS, toolsFor, fileExtension } from "./files.js";

// what lattice's latticework has, over knitoutjs's: its tools, and a terminal
// in the + menu while alt is held. `baseRepo` is the repo under any draft
// overlay: latticex shares on the doc itself, never on a draft's copy of it
export function latticeOptions(baseRepo) {
  return {
    tools: { TOOLS, toolsFor, fileExtension },
    self: PROJECT_TOOLS,
    menu: [
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
  return mountProject(element, {
    project: handle,
    repo,
    baseRepo,
    hive: element.hive,
    ...latticeOptions(baseRepo),
  });
}
