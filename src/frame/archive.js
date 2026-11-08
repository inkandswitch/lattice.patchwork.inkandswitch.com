// a project as a .patchworkfolder, and one back: a zip of .amtext files, the
// project and every doc it reaches (its files, the docs in its panes), as
// patchwork's sideboard downloads and takes them. amtext's own code, in
// vendor/amtext: knit.patchwork.inkandswitch.com's packages/amtext at
// 49dd849, copied, so the frame has it wherever it's installed
import * as Automerge from "@automerge/automerge";
import { getRegistry, isKeyhiveDoc } from "@inkandswitch/patchwork-plugins";
import { patchworkFolder } from "./vendor/amtext/patchworkfolder.js";

// a doc of a datatype for something unpacked: its type and nothing else. not
// the datatype's init, which would make what a new one starts with (a
// knitoutjs project's pattern, its folder) only to have it all replaced
async function typedDoc(datatype, repo, _change, hive) {
  const handle = await repo.create2();
  if (hive && isKeyhiveDoc(handle.url)) await hive.addSyncServerRelayToDoc(handle.url);
  handle.change((doc) => {
    doc["@patchwork"] = { type: datatype.id };
  });
  return handle;
}

const folder = (repo, hive) =>
  patchworkFolder({
    repo,
    hive,
    Automerge,
    plugins: { getRegistry, isKeyhiveDoc, createDocOfDatatype2: typedDoc },
  });

export const isArchive = (file) => /\.(patchworkfolder|zip)$/i.test(String(file?.name ?? ""));

// downloads `url`, and all it reaches, as a .patchworkfolder named after it
export function downloadArchive(repo, url, hive) {
  return folder(repo, hive).downloadFolder(url);
}

// unpacks a .patchworkfolder into new docs. resolves with its root's url
export async function unpackArchive(repo, file, hive) {
  return (await folder(repo, hive).importFolder(file)).root;
}
