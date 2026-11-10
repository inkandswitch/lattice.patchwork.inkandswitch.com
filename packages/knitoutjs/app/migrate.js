// updating knitoutjs's projects from before: one way, and the type changes,
// so the old tools (which only open the old types) won't open them after.
// it's done on the doc itself, through the repo under any draft overlay,
// never on a draft's copy of it. and the drafts go: they're forks of the old
// shape, and merging one back would bring the old shape back with it
import { projectTitle, typeOf } from "../../wm/doc/project.js";
import { partsFrom } from "../../wm/project-view.js";
import { seedActive } from "../../wm/active.js";

// knitoutjs's projects from before: {title, files: [urls], layout: tree}
export const OLD_KNITOUTJS_TYPES = ["prototype-knitoutjs-panes", "knitoutjs-panes"];

export const isOldKnitoutjs = (doc) => OLD_KNITOUTJS_TYPES.includes(typeOf(doc));

/**
 * a knitoutjs project from before becomes a knitoutjs-project, in place: its
 * files go in a new folder, its tree becomes its nodes. `handle` is the doc's
 * own, from `repo`. says whether it was this that did it (someone else may
 * have, meanwhile)
 */
export async function updateKnitoutjs(handle, repo, hive) {
  const doc = handle.doc();
  const from = typeOf(doc);
  if (!OLD_KNITOUTJS_TYPES.includes(from)) return false;
  const title = projectTitle(doc);
  const { files, nodes, active } = await partsFrom(
    { title, urls: Array.isArray(doc.files) ? doc.files : [], tree: doc.layout },
    repo,
    hive,
  );
  let done = false;
  handle.change((doc) => {
    if (typeOf(doc) !== from) return;
    doc["@patchwork"].type = "knitoutjs-project";
    delete doc["@patchwork"].mainDraftUrl;
    doc.title = title;
    doc.files = files;
    delete doc.layout;
    doc.nodes = nodes;
    done = true;
  });
  if (done) seedActive(handle.url, active);
  return done;
}

