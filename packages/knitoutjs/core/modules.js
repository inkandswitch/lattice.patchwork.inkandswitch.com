// the parts of a build that both the page and the run worker need: finding
// and pinning the docs a module names, turning a plain doc into a module,
// and the signal a run throws when it asks for a doc it hasn't got. so it
// imports nothing a worker (or node) can't load
import { parser } from "./vendor/lezer-javascript.js";
import { isDocUrl } from "./instrument.js";

// thrown by `doc(x)` or `import(x)` when x is a doc the run wasn't given. the
// page pins it, adds it, and runs the pattern again
export class NotReady extends Error {
  constructor(url) {
    super(`not ready: ${url}`);
    this.name = "NotReady";
    this.url = url;
  }
}

// one run's suspension. a sketch can catch what `doc()` throws, so the throw
// alone can't be trusted to reach the end: the first url asked for is kept
// here, and once there is one the run's output doesn't count
export function runState() {
  let url = null;
  return {
    suspend(asked) {
      url ??= asked;
      return new NotReady(asked);
    },
    suspendedUrl: () => url,
  };
}

// what a String node says, when it's plain (no escapes to untangle)
function stringValue(code, node) {
  const text = code.slice(node.from, node.to);
  if (!/^(["']).*\1$/s.test(text) || text.includes("\\")) return null;
  return text.slice(1, -1);
}

// `doc("x")`'s string, if that's all the call has
function docString(code, call) {
  const callee = call.firstChild;
  if (callee?.name !== "VariableName" || code.slice(callee.from, callee.to) !== "doc") return null;
  const args = callee.nextSibling;
  if (args?.name !== "ArgList") return null;
  const string = args.firstChild?.nextSibling;
  if (string?.name !== "String" || string.nextSibling?.name !== ")") return null;
  return string;
}

// every literal specifier in a module: `import … from "x"`, `import "x"`,
// `export … from "x"`, `import("x")`, `doc("x")`. unlike a pattern, a module
// stays a module, so its exports can name docs too
function specifiers(code) {
  const lineAt = (pos) => code.slice(0, pos).split("\n").length;
  const found = [];
  parser.parse(code).iterate({
    enter(node) {
      let string;
      let kind;
      if (node.name === "ImportDeclaration") {
        string = node.node.getChild("String");
        kind = "import";
      } else if (node.name === "ExportDeclaration") {
        // only `export … from "x"`: `export default "x"` is just a string
        string = node.node.getChild("String");
        if (string?.prevSibling?.name !== "from") string = null;
        kind = "export";
      } else if (node.name === "DynamicImport") {
        string = node.node.getChild("String");
        kind = "dynamic";
      } else if (node.name === "CallExpression") {
        string = docString(code, node.node);
        kind = "doc";
      }
      if (!string || string.type.isError) return;
      const text = stringValue(code, string);
      if (text === null) return;
      found.push({ text, url: isDocUrl(text), kind, line: lineAt(node.from), from: string.from, to: string.to });
    },
  });
  return found;
}

// the docs a module uses, in order, as `collectSources` gives a pattern's
export function moduleSources(code) {
  return specifiers(code)
    .filter((use) => use.url)
    .map(({ url, line, kind }) => ({ url, line, kind }));
}

// a module's specifiers swapped for what `map` says (a pinned url, a blob
// url, the knitout shim). keyed by the normalised url, or the text as written
// for anything that isn't a doc (`"knitout"`). nothing else changes, so lines
// stay where they were
export function rewriteSpecifiers(code, map) {
  let out = "";
  let at = 0;
  for (const use of specifiers(code)) {
    const key = use.url ?? use.text;
    if (!Object.hasOwn(map, key)) continue;
    out += code.slice(at, use.from) + JSON.stringify(map[key]);
    at = use.to;
  }
  return out + code.slice(at);
}

const RESERVED = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends " +
    "false finally for function if import in instanceof new null return super switch this throw " +
    "true try typeof var void while with yield let static implements interface package private " +
    "protected public await arguments eval"
  ).split(" "),
);

// a doc that isn't code, as a module: the whole doc is its default, and each
// field that can be a name is a named export, so `import {width} from "…"`
// works. the value itself is put on globalThis.__docs by whoever runs it
export function snapshotModule(pinned, value) {
  const keys =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).filter((key) => /^[A-Za-z_$][\w$]*$/.test(key) && !RESERVED.has(key))
      : [];
  // the doc is held in `v`, unless it has a field called that
  let name = "v";
  while (keys.includes(name)) name += "_";
  let text = `const ${name} = globalThis.__docs[${JSON.stringify(pinned)}]; export default ${name};`;
  for (const key of keys) text += `\nexport const ${key} = ${name}[${JSON.stringify(key)}];`;
  return text;
}
