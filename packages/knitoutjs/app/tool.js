// knitoutjs's project tool: wm's workspace on a project, its files down the
// side
import { mountProject } from "../../wm/project-view.js";
import { datatypeItem } from "../../wm/patchwork/docs.js";
import { knitout } from "../wm.js";
import { isOldKnitoutjs, updateKnitoutjs, OLD_KNITOUTJS_TYPES } from "./migrate.js";
import { tools } from "./files.js";
import { wearLook } from "../look.js";

// the tools that show a whole project: never offered in a pane of one
export const PROJECT_TOOLS = ["knitoutjs-project", "lattice:project", "lattice", ...OLD_KNITOUTJS_TYPES];

export default function KnitoutProjectTool(handle, element) {
  wearLook();
  // the repo patchwork gives a tool resolves through any draft overlay above
  // it; updating a project from before is done under it, on the doc itself
  const repo = element.repo;
  const hive = element.hive;
  return mountProject(element, {
    project: handle,
    repo,
    baseRepo: repo.baseRepo ?? repo,
    hive,
    tools,
    extensions: [knitout, { name: "knitoutjs", menu: () => [datatypeItem({ type: "markdown", icon: "text", label: "markdown" }, hive)] }],
    old: { is: isOldKnitoutjs, update: updateKnitoutjs, auto: true },
    self: PROJECT_TOOLS,
  });
}
