// a project: {title, files, nodes}. `files` links a folder or a pushwork
// directory of its files, `nodes` is its layout (the flat nodes in
// layout.js). the project doc is the arrangement, and it's what drafts are
// of. one folder can have any number of projects, each with its own title
//
// nothing imported here imports a package, so a datatype can use it wherever
// patchwork loads one
// each app has its own type for one (knitoutjs-project, lattice:project),
// and each opens the others'
import * as Layout from "./layout.js";

const string = (value) => (value == null ? "" : String(value));

export const typeOf = (doc) => string(doc?.["@patchwork"]?.type);

export function projectTitle(doc) {
  return string(doc?.title) || "untitled";
}

// what a new project has besides its title: a folder of some docs ([{name,
// type, url}], as a folder keeps them), and nodes from a tree made with
// layout.js's newSplit, newGroup and newPanel (or none). the folder's made
// in the same task, so a datatype's init can write its url before it awaits
// anything
export function newProjectParts(repo, { title = "untitled", links = [], tree = null } = {}) {
  const folder = repo.create({ "@patchwork": { type: "folder" }, title, docs: links });
  return { files: folder.url, nodes: Layout.fromTree(tree).nodes };
}

// a project datatype for patchwork: a new one has an empty folder and layout
export function projectDatatype({ title = "untitled" } = {}) {
  return {
    init(doc, repo) {
      doc.title = title;
      Object.assign(doc, newProjectParts(repo, { title }));
    },
    getTitle: projectTitle,
    setTitle(doc, title) {
      doc.title = title;
    },
  };
}
