// a folder dropped in from the computer that's a .patchworkfolder unzipped:
// .amtext files, with a root.amtext (or only the one .amtext), at its top or
// all in one folder inside it. it's taken as the .patchworkfolder would be

// past this many things in it, it's not one: a .patchworkfolder is its docs
// and nothing else, and a folder of a whole disk shouldn't be read through
const MOST = 5000;

// what's dropped: its files, and its folders (as FileSystemEntries). has to
// be asked in the drop itself, as what's dropped is gone once it's over
export function dropped(dataTransfer) {
  const items = [...(dataTransfer?.items ?? [])].filter((item) => item.kind === "file");
  if (!items.length || !items[0].webkitGetAsEntry) return { files: [...(dataTransfer?.files ?? [])], folders: [] };
  const files = [];
  const folders = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry();
    if (entry?.isDirectory) folders.push(entry);
    else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return { files, folders };
}

// the paths in it that a .patchworkfolder's import reads: not mac's ._ files
// or __MACOSX
const isAmtext = (path) => {
  const base = path.split("/").pop();
  return base.endsWith(".amtext") && !base.startsWith("._") && !path.startsWith("__MACOSX/");
};

// whether `paths` (all that's in a folder, by where they are in it) is a
// .patchworkfolder's
export function isPatchworkFolder(paths) {
  const amtext = paths.filter(isAmtext);
  if (!amtext.length) return false;
  const tops = new Set(amtext.map((p) => (p.includes("/") ? p.split("/")[0] : "")));
  const prefix = tops.size === 1 && !tops.has("") ? `${[...tops][0]}/` : "";
  return amtext.length === 1 || amtext.includes(`${prefix}root.amtext`);
}

const entriesOf = (dir) =>
  new Promise((resolve, reject) => {
    const reader = dir.createReader();
    const all = [];
    // it gives them a hundred or so at a time, then nothing when it's done
    const more = () =>
      reader.readEntries((some) => {
        if (!some.length) return resolve(all);
        all.push(...some);
        more();
      }, reject);
    more();
  });

const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

// the .amtext files in `dir`, as a .patchworkfolder's ({ name: its path in
// it, data }), or null if it's not the shape of one
export async function patchworkFolderFiles(dir) {
  const found = [];
  const walk = async (entry, path) => {
    for (const child of await entriesOf(entry)) {
      if (found.length > MOST) return;
      const at = path + child.name;
      if (child.isDirectory) await walk(child, `${at}/`);
      else found.push({ path: at, entry: child });
    }
  };
  await walk(dir, "");
  if (found.length > MOST || !isPatchworkFolder(found.map((f) => f.path))) return null;
  return Promise.all(
    found
      .filter((f) => isAmtext(f.path))
      .map(async (f) => ({ name: f.path, data: new Uint8Array(await (await fileOf(f.entry)).arrayBuffer()) })),
  );
}
