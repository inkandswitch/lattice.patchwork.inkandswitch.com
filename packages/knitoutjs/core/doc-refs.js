import { parser } from "./vendor/lezer-javascript.js";
import { scan } from "./instrument.js";
import { fileExtension } from "./files.js";
import { unpinned } from "./sources.js";

// what each import of a doc binds: name → {url, path}. a default or `* as`
// is the doc itself; `{a, b: c}` binds the doc's `a` and `b` fields
function bindingsOf(code) {
  const bound = new Map();
  for (const use of scan(code)) {
    if (use.kind !== "import" || !use.url || !use.decl) continue;
    const url = unpinned(use.url);
    const { def, ns, group } = use.decl;
    if (def) bound.set(def, { url, path: [] });
    if (ns) bound.set(ns, { url, path: [] });
    if (group) {
      for (const name of group.slice(1, -1).split(",")) {
        const [field, local = field] = name.split(":").map((part) => part.trim());
        if (field) bound.set(local, { url, path: [field] });
      }
    }
  }
  return bound;
}

// the url a doc ref at `pos` points to: inside the string of an `import`,
// `import()` or `doc()` of a doc, or on a name an import of a doc bound
// (unless `names` is off: a language server goes to where a name's defined)
export function docRefAt(code, pos, { names = true } = {}) {
  for (const use of scan(code)) {
    if (use.url && pos >= use.string.from && pos <= use.string.to) return unpinned(use.url);
  }
  if (!names) return null;
  // a click at the end of a name still counts as on it
  const tree = parser.parse(code);
  for (const side of [1, -1]) {
    const node = tree.resolveInner(pos, side);
    if (node.name === "VariableName" || node.name === "VariableDefinition") {
      return bindingsOf(code).get(code.slice(node.from, node.to))?.url ?? null;
    }
  }
  return null;
}

// `doc("x")` or a name, then `.a.b`, then `.` and what's typed of the next
const CHAIN =
  /(?<![\w$.])(?:doc\(\s*(["'])([^"'\\]*)\1\s*\)|([A-Za-z_$][\w$]*))((?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)?$/;

// what's being completed at `pos`: the doc, the path to the value being
// completed in it, and where the typed member starts. `isJs(url)` says a
// binding is a module, which has no fields to complete (`doc("x").` never is)
export function completionAt(code, pos, { isJs }) {
  const before = code.slice(0, pos);
  const match = CHAIN.exec(before);
  if (!match) return null;
  const [, , literal, name, members, typed = ""] = match;
  const inside = parser.parse(before).resolveInner(pos, -1).name;
  if (/Comment|String/.test(inside)) return null;
  const path = members ? members.slice(1).split(".") : [];
  const from = pos - typed.length;
  if (name) {
    const bound = bindingsOf(code).get(name);
    if (!bound || isJs(bound.url)) return null;
    return { url: bound.url, path: [...bound.path, ...path], from };
  }
  const url = /^\/?(automerge:[1-9A-HJ-NP-Za-km-z]+)/.exec(literal)?.[1];
  return url ? { url, path, from } : null;
}

const kindOf = (value) =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "list"
      : value instanceof Uint8Array
        ? "bytes"
        : value instanceof Date
          ? "date"
          : typeof value === "object"
            ? "map"
            : typeof value;

// the fields of the map at `path` in a doc's value, and what each holds
export function keysOf(value, path) {
  let here = value;
  for (const key of path) here = here != null && typeof here === "object" ? here[key] : undefined;
  if (kindOf(here) !== "map") return [];
  return Object.entries(here)
    .filter(([, field]) => field !== undefined)
    .map(([label, field]) => ({ label, detail: kindOf(field) }));
}

// the tool to open a doc with: a .js in the code editor, else its own
export const toolFor = (doc) => (fileExtension(doc) === "js" ? "editor" : undefined);

// the doc a language server's definition is in, when it's in one: an editor's
// file, or one we gave the server (a .js's text, or the .d.ts of a doc's
// types), is /<documentId>/index.<ext>. anything else (typescript's own lib
// files, our globals under /lattice/) is null
export function definitionDoc(uri) {
  const id = /^file:\/\/\/([1-9A-HJ-NP-Za-km-z]+)\/index\.[\w.]+$/.exec(uri ?? "")?.[1];
  return id ? `automerge:${id}` : null;
}

// "2x2 rib.knitout.js" → _2x2Rib
export function identifierFor(name) {
  const words = String(name)
    .replace(/\..*$/, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const id = words
    .map((word, index) => (index ? word[0].toUpperCase() + word.slice(1) : word[0].toLowerCase() + word.slice(1)))
    .join("") || "doc";
  return /^[0-9]/.test(id) ? "_" + id : id;
}

// the line a doc dropped onto a pattern writes: an import, a .js or any
// other doc alike, so it's a source of the build, a link, and typed
export const dropImport = (name, url) => `import ${identifierFor(name)} from "${url}"\n`;

// the last code parsed, as a drag asks again and again while it moves
let parsed = { code: null, tree: null };

// the line (from 1) a doc dropped onto `line` of a pattern has its import
// written above: that line, at the top level, but an import can't go in a
// function or a block (or the middle of an object), so inside a statement
// it's the line that statement starts on. past the end, the last line
export function importLineAt(code, line) {
  const lines = code.split("\n");
  const at = Math.min(Math.max(line, 1), lines.length);
  let pos = 0;
  for (let i = 0; i < at - 1; i++) pos += lines[i].length + 1;
  if (parsed.code !== code) parsed = { code, tree: parser.parse(code) };
  for (let node = parsed.tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.from <= pos && pos < node.to) return code.slice(0, node.from).split("\n").length;
  }
  return at;
}

// `find(url)`, each url's answer kept, but one that's taken longer than `ms`
// or failed isn't: it's tried again on the next ask. a find that never comes
// back would otherwise hold back every completion after it
export function findWithin(find, ms) {
  const found = new Map();
  return (url) => {
    if (found.has(url)) return found.get(url);
    let timer;
    const answer = Promise.race([
      Promise.resolve().then(() => find(url)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`finding ${url} took too long`)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
    found.set(url, answer);
    answer.catch(() => {
      if (found.get(url) === answer) found.delete(url);
    });
    return answer;
  };
}
