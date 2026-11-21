// the files a pattern's editor gives the file tool's language server (its
// `detail.languageServer`, from pkg-base's file tool, when it has one), so it
// knows the docs the pattern uses: an imported .js as itself, where an editor
// would have it (/<id>/index.js), and any other doc as a .d.ts beside where
// that would be (/<id>/index.d.ts, see doc-types.js), kept up to date as each
// doc changes.
//
// every editor on the page shares the one server, so a doc's file is shared
// too: it's written by whichever editor wants it first, and removed once no
// editor wants it any more. the globals go in once, and stay
import { docDeclarations, GLOBALS } from "./doc-types.js";
import { docText, fileExtension } from "./files.js";
import { plainValue } from "./graph.js";
import { docIdOf, unpinned } from "./sources.js";

const GLOBALS_PATH = "/lattice/globals.d.ts";

// unpinned url → { users, server, handle?, onChange?, path?, text? }
const shared = new Map();
let globalsGiven = false;

function write(url, entry) {
  const doc = entry.handle.doc();
  if (!doc) return;
  const id = docIdOf(url);
  const js = fileExtension(doc) === "js";
  const path = js ? `/${id}/index.js` : `/${id}/index.d.ts`;
  const text = js ? docText(doc) : docDeclarations(url, plainValue(doc));
  // a change that leaves the types as they were needn't trouble the server
  if (path === entry.path && text === entry.text) return;
  if (entry.path && entry.path !== path) entry.server.removeFile(entry.path);
  entry.path = path;
  entry.text = text;
  entry.server.writeFile(path, text);
}

function take(url, server, repo) {
  let entry = shared.get(url);
  if (!entry) {
    entry = { users: 0, server };
    shared.set(url, entry);
    const mine = entry;
    Promise.resolve()
      .then(() => repo.find(url))
      .then((handle) => {
        // nobody may want it any more, by the time it's found
        if (shared.get(url) !== mine) return;
        mine.handle = handle;
        mine.onChange = () => write(url, mine);
        handle.on("change", mine.onChange);
        write(url, mine);
      }, (error) => console.warn(`knitoutjs: can't give the language server ${url}`, error));
  }
  entry.users++;
}

function drop(url) {
  const entry = shared.get(url);
  if (!entry || --entry.users > 0) return;
  shared.delete(url);
  if (entry.onChange) entry.handle.off("change", entry.onChange);
  if (entry.path) entry.server.removeFile(entry.path);
}

// one editor's say in it: `use(urls)` is every doc its pattern uses now (it
// can say so again on each change), `close()` when the editor goes. `self`,
// the pattern itself, is the editor's own file already
export function languageServerDocs(server, repo, { self }) {
  if (!globalsGiven) {
    globalsGiven = true;
    server.writeFile(GLOBALS_PATH, GLOBALS);
  }
  const using = new Set();
  const skip = unpinned(self);
  return {
    use(urls) {
      const want = new Set(urls.map(unpinned).filter((url) => url !== skip));
      for (const url of using) {
        if (want.has(url)) continue;
        using.delete(url);
        drop(url);
      }
      for (const url of want) {
        if (using.has(url)) continue;
        using.add(url);
        take(url, server, repo);
      }
    },
    close() {
      for (const url of using) drop(url);
      using.clear();
    },
  };
}
