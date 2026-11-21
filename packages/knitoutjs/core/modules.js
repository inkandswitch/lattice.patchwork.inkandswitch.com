// the parts of a build that both the page and the run worker need: finding
// and pinning the docs a module names, turning a plain doc into a module,
// and the signal a run throws when it asks for a doc it hasn't got. so it
// imports nothing a worker (or node) can't load
import { parser } from "./vendor/lezer-javascript.js";
import { isDocUrl } from "./instrument.js";
import { fileExtension } from "./files.js";

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
// here (with how it was asked, `kind`, and the pattern's `line` then), and
// once there is one the run's output doesn't count
export function runState() {
  let first = null;
  return {
    suspend(asked, details = {}) {
      first ??= { url: asked, ...details };
      return new NotReady(asked);
    },
    suspendedUrl: () => first?.url ?? null,
    suspension: () => first,
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
// stay where they were. `docs: false` leaves `doc("…")` strings be: they're
// urls to read, not modules to load
export function rewriteSpecifiers(code, map, { docs = true } = {}) {
  let out = "";
  let at = 0;
  for (const use of specifiers(code)) {
    if (!docs && use.kind === "doc") continue;
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

// names the module itself reads, so a field can't be exported as one
const OWN = new Set(["globalThis", "__docs"]);

// a doc that isn't code, as a module: the whole doc is its default, and each
// field that can be a name is a named export, so `import {width} from "…"`
// works. the value itself is put on globalThis.__docs by whoever runs it
export function snapshotModule(pinned, value) {
  const keys =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).filter((key) => /^[A-Za-z_$][\w$]*$/.test(key) && !RESERVED.has(key) && !OWN.has(key))
      : [];
  // the doc is held in `v`, unless it has a field called that
  let name = "v";
  while (keys.includes(name)) name += "_";
  let text = `const ${name} = globalThis.__docs[${JSON.stringify(pinned)}]; export default ${name};`;
  for (const key of keys) text += `\nexport const ${key} = ${name}[${JSON.stringify(key)}];`;
  return text;
}

// a doc's value, made read-only all the way down, so a sketch can't change
// what another part of it (or a module) reads. bytes can't be frozen, so
// they're left as they are
export function deepFreeze(value) {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value) || Object.isFrozen(value)) {
    return value;
  }
  for (const field of Object.values(value)) deepFreeze(field);
  return Object.freeze(value);
}

// the knitout library, for modules that `import … from "knitout"`. evalJS
// puts it on globalThis before the pattern runs
export const KNITOUT_SHIM = "export const Writer = globalThis.__knitout.Writer; export default globalThis.__knitout;";

// a graph made ready to run: every doc that isn't code and every module gets
// a url of its own (`makeUrl(text)`, a blob url in the worker), modules
// after what they import, with their specifiers swapped for those urls.
// `doc(url)` is a doc's (frozen) value and `module(url)` the url to load a
// module from, each found by the url as written or the pinned one it stands
// for. one the graph hasn't got throws `suspend(url, kind)`, kind being how
// it was asked ("doc" or "dynamic", as extendGraph takes it). `module` of
// something that isn't a doc url is null: the caller loads it as it is
export function linkGraph({ pins = {}, modules = [], snapshots = {} }, { makeUrl, suspend }) {
  const docs = {};
  for (const [pinned, value] of Object.entries(snapshots)) docs[pinned] = deepFreeze(value);
  const urls = {};
  const map = { knitout: makeUrl(KNITOUT_SHIM) };
  // a .js read with `doc()` is a value, not a module: importing it asks for it
  // again, as a module
  for (const [pinned, value] of Object.entries(docs)) {
    if (fileExtension(value) !== "js") urls[pinned] = map[pinned] = makeUrl(snapshotModule(pinned, value));
  }
  // a module wins over a doc at the same pin
  for (const { pinned, code } of modules) {
    urls[pinned] = map[pinned] = makeUrl(rewriteSpecifiers(code, map, { docs: false }));
  }
  const pinnedIn = (table, key) => (Object.hasOwn(table, key) ? key : pins[key]);

  return {
    docs,
    doc(asked) {
      const key = isDocUrl(asked);
      if (!key) throw new Error(`doc() takes an automerge url, not ${JSON.stringify(asked)}`);
      const pinned = pinnedIn(docs, key);
      if (pinned === undefined || !Object.hasOwn(docs, pinned)) throw suspend(key, "doc");
      return docs[pinned];
    },
    module(asked) {
      const key = isDocUrl(asked);
      if (!key) return null;
      const pinned = pinnedIn(urls, key);
      if (pinned === undefined || !Object.hasOwn(urls, pinned)) throw suspend(key, "dynamic");
      return urls[pinned];
    },
  };
}
