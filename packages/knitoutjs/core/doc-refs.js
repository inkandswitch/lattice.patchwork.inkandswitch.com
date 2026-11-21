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
export function docRefAt(code, pos) {
  for (const use of scan(code)) {
    if (use.url && pos >= use.string.from && pos <= use.string.to) return unpinned(use.url);
  }
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
