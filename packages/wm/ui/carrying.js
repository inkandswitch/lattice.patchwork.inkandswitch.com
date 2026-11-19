// a file being dragged out of a project's files: which, and how to take it
// out of the project it's from. somewhere else on the page that takes files
// (lattice's projects, down the side) can then have it moved there, not
// only linked. a drag's data can't be read till it's dropped, and this is
// only ever ours, so it's kept here rather than in the drag. one at a time,
// as drags are

let carried = null;

/** `file`: {url, name, remove()}. it's carried till `putDown(file)` */
export function carry(file) {
  carried = file;
}

/** what's being carried, or null */
export function carrying() {
  return carried;
}

export function putDown(file) {
  if (carried === file) carried = null;
}
