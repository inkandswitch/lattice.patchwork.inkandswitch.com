// updating lattice's projects from before: one way, and the type changes,
// so the old tools (which only open the old types) won't open them after.
// each is done on the doc itself, through the repo under any draft overlay,
// never on a draft's copy of it. and the drafts go: they're forks of the old
// shape, and merging one back would bring the old shape back with it.
// knitoutjs's are knitoutjs's (packages/knitoutjs/app/migrate.js)
import { isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { typeOf } from "../wm/doc/project.js";
import * as Layout from "../wm/doc/layout.js";
import { folderTitle } from "../wm/folder.js";
import { createDoc, findSoon } from "../wm/patchwork/docs.js";
import { seedActive } from "../wm/active.js";

const string = (value) => (value == null ? "" : String(value));
const isUrl = (value) => isValidAutomergeUrl(string(value));
const copy = (value) => (value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : null);

// a lattice project from before is a folder of its files, with its layout on
// a lattice:workspace doc it links as `workspace` (or, before workspaces, on
// the folder itself as `layout`)
export function isOldLatticeFolder(doc) {
  return (
    typeOf(doc) === "folder" &&
    (isUrl(doc.project) || isUrl(doc.workspace) || !!copy(doc.layout))
  );
}

// the project an old lattice folder became, if it's been updated: the folder
// links to it as `project` (or still as `workspace`, if the update was cut
// short before the folder changed)
export async function updatedTo(folder, repo) {
  if (isUrl(folder?.project)) return string(folder.project);
  if (!isUrl(folder?.workspace)) return null;
  const workspace = await findSoon(repo, string(folder.workspace));
  return typeOf(workspace) === "lattice:project" ? string(folder.workspace) : null;
}

// the folder's done being a project: it's the project's files now, and links
// back to it
function finish(folder, projectUrl) {
  folder.change((doc) => {
    if (string(doc.project) !== projectUrl) doc.project = projectUrl;
    if ("workspace" in doc) delete doc.workspace;
    if ("layout" in doc) delete doc.layout;
  });
}

/**
 * an old lattice project becomes a lattice:project. its workspace doc becomes
 * the project, in place, so its url and history stay with it (one from before
 * workspaces gets a new doc). the folder stays as its files. `folder` is the
 * folder's own handle, from `repo`. returns the project's url
 */
export async function updateLatticeFolder(folder, repo, { title, hive } = {}) {
  const already = await updatedTo(folder.doc(), repo);
  if (already) {
    finish(folder, already);
    return already;
  }
  const doc = folder.doc();
  title ??= folderTitle(doc);
  if (!isUrl(doc.workspace)) {
    const { nodes, active } = Layout.fromTree(copy(doc.layout));
    const project = await createDoc(
      repo,
      { "@patchwork": { type: "lattice:project" }, title, files: folder.url, nodes },
      hive,
    );
    seedActive(project.url, active);
    finish(folder, project.url);
    return project.url;
  }
  const project = await repo.find(string(doc.workspace));
  const { nodes, active } = Layout.fromTree(copy(project.doc()?.layout));
  let done = false;
  project.change((doc) => {
    if (typeOf(doc) !== "lattice:workspace") return;
    doc["@patchwork"].type = "lattice:project";
    delete doc["@patchwork"].mainDraftUrl;
    doc.title = title;
    doc.files = folder.url;
    delete doc.layout;
    doc.nodes = nodes;
    done = true;
  });
  if (typeOf(project.doc()) !== "lattice:project") {
    throw new Error(`its workspace is a ${typeOf(project.doc()) || "doc with no type"}`);
  }
  if (done) seedActive(project.url, active);
  finish(folder, project.url);
  return project.url;
}
