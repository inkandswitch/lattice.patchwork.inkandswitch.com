// what the language server is told about the docs a pattern uses, so hovering
// `doc("automerge:…").width` says `number`, and an import of a doc completes
// its fields. each doc that isn't code gets a .d.ts of its own, beside where
// its code would be (written by ./language-server.js); a .js doc is given to
// the server as itself. nothing
// here touches a handle, so it can be tested in node
import { docIdOf } from "./sources.js";

// a doc's value (made plain, as graph.js's plainValue does) as a typescript
// type. a list is the type of its first element; a map's keys are always
// quoted, so any key is fine. past `depth` it's just unknown
export function typeOf(value, depth = 4) {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Uint8Array) return "Uint8Array";
  if (value instanceof Date) return "Date";
  if (Array.isArray(value)) {
    if (depth <= 0) return "unknown";
    if (!value.length) return "unknown[]";
    return `${typeOf(value[0], depth - 1)}[]`;
  }
  if (typeof value === "object") {
    if (depth <= 0) return "unknown";
    const fields = Object.entries(value).filter(([, field]) => field !== undefined);
    if (!fields.length) return "{}";
    return `{ ${fields.map(([key, field]) => `${JSON.stringify(key)}: ${typeOf(field, depth - 1)}; `).join("")}}`;
  }
  return "unknown";
}

// words that can't be a `const`'s name in a module
const RESERVED = new Set(
  ("break case catch class const continue debugger default delete do else enum export extends false finally for " +
    "function if import in instanceof new null return super switch this throw true try typeof var void while with " +
    "yield let static implements interface package private protected public await arguments eval").split(" "),
);
const isName = (key) => /^[A-Za-z_$][\w$]*$/.test(key) && !RESERVED.has(key);

// a doc's own .d.ts, for /<id>/index.d.ts: it's the module an import of the
// doc finds (the language server's paths send `automerge:<id>` and
// `/automerge:<id>` both to /<id>/index.js, which is this when there's no .js
// there), its value the default and its fields that can be names named too.
// and `doc("automerge:<id>")`, with or without the `/`, is its value
// (a `declare module "/automerge:…"` would never be found: a name starting
// with / is a path to typescript, not a module's name)
export function docDeclarations(url, value) {
  const id = docIdOf(url);
  const type = typeOf(value);
  const isMap = value && typeof value === "object" && !Array.isArray(value) &&
    !(value instanceof Uint8Array) && !(value instanceof Date);
  const fields = isMap ? Object.entries(value).filter(([key, field]) => field !== undefined && isName(key)) : [];
  // the default needs a name of its own, which no field has
  let name = "_default";
  while (fields.some(([key]) => key === name)) name = "_" + name;
  return [
    `declare const ${name}: ${type};`,
    `export default ${name};`,
    ...fields.map(([key, field]) => `export declare const ${key}: ${typeOf(field, 3)};`),
    "declare global {",
    ...["", "/"].map((slash) => `  function doc(url: ${JSON.stringify(`${slash}automerge:${id}`)}): ${type};`),
    "}",
    "",
  ].join("\n");
}

// what every pattern can use without importing it: `doc()` of a url no .d.ts
// knows of yet, `repo`, and the knitout library (by import or require)
export const GLOBALS = `declare function doc(url: string): any;
declare const repo: any;
declare function require(name: "knitout"): any;
declare module "knitout" {
  const knitout: any;
  export default knitout;
  export const Writer: any;
}
`;
