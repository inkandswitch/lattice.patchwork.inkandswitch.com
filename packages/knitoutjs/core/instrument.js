import { parser } from "./vendor/lezer-javascript.js";

// a doc's url as the graph knows it: `/automerge:…` is the same doc as
// `automerge:…`, and `#heads` (if written) say which version. anything else
// isn't a doc (null)
const DOC_URL = /^\/?(automerge:[1-9A-HJ-NP-Za-km-z]+(?:#.*)?)$/;
export function isDocUrl(text) {
  return DOC_URL.exec(text)?.[1] ?? null;
}

// what a String node says, when it's plain (no escapes to untangle)
function stringValue(code, node) {
  const text = code.slice(node.from, node.to);
  if (!/^(["']).*\1$/s.test(text) || text.includes("\\")) return null;
  return text.slice(1, -1);
}

// `import … from "x"`: what it binds (`def` the default, `ns` the whole
// module, `group` the `{a, b: c}`), and where its string is
function importParts(code, decl) {
  const text = (n) => code.slice(n.from, n.to);
  const parts = { def: null, ns: null, group: null, string: null };
  // the parser doesn't make sense of `x, * as y` (it calls `as` the name), so
  // that one is read from the text
  const both = /^import\s+([\w$]+)\s*,\s*\*\s*as\s+([\w$]+)\s+from\b/.exec(text(decl));
  if (both) [, parts.def, parts.ns] = both;
  for (let child = decl.firstChild; child && !both; child = child.nextSibling) {
    if (child.name === "VariableDefinition") parts.def = text(child);
    else if (child.name === "Star") {
      parts.ns = text(child.nextSibling.nextSibling);
      child = child.nextSibling.nextSibling;
    } else if (child.name === "ImportGroup") {
      const names = [];
      for (let n = child.firstChild; n; n = n.nextSibling) {
        if (n.name === "VariableName" && n.nextSibling?.name === "as") {
          names.push(`${text(n)}: ${text(n.nextSibling.nextSibling)}`);
          n = n.nextSibling.nextSibling;
        } else if (n.name === "VariableDefinition") names.push(text(n));
      }
      parts.group = `{${names.join(", ")}}`;
    } else if (child.name === "String") parts.string = child;
  }
  if (both) parts.string = decl.getChild("String");
  return parts.string && parts;
}

// `doc("x")`'s string, if that's all the call has
function docString(code, call) {
  const callee = call.firstChild;
  if (callee?.name !== "VariableName" || code.slice(callee.from, callee.to) !== "doc") return null;
  const args = callee.nextSibling;
  if (args?.name !== "ArgList") return null;
  const open = args.firstChild;
  const string = open?.nextSibling;
  if (string?.name !== "String" || string.nextSibling?.name !== ")") return null;
  return string;
}

// every place a pattern names a doc: `import … from "x"`, `import "x"`,
// `import("x")`, `doc("x")`. only a literal url counts, since that's all
// that can be known before the pattern runs
export function scan(code) {
  const lineAt = (pos) => code.slice(0, pos).split("\n").length;
  const found = [];
  parser.parse(code).iterate({
    enter(node) {
      let string;
      let kind;
      let decl;
      if (node.name === "ImportDeclaration") {
        decl = importParts(code, node.node);
        string = decl?.string;
        kind = "import";
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
      const url = isDocUrl(text);
      found.push({
        kind,
        text,
        url,
        line: lineAt(node.from),
        from: node.from,
        to: node.to,
        string: { from: string.from, to: string.to },
        decl,
      });
    },
  });
  return found;
}

export function collectSources(code) {
  return scan(code)
    .filter((use) => use.url)
    .map(({ url, line, kind }) => ({ url, line, kind }));
}

function loopBody(node) {
  // do Statement while (...)
  if (node.name === "DoStatement") return node.firstChild?.nextSibling;
  // for (...) Statement, while (...) Statement
  return node.lastChild;
}

// what a call is called on: `k` in `k.knit()`, `foo` in `foo()`
function callTarget(call) {
  const callee = call.firstChild;
  if (!callee) return null;
  if (callee.name === "MemberExpression") return callee.firstChild;
  return callee;
}

// two things are added to a pattern before it runs, all on the lines they
// belong to, so line numbers (and the ;!source: lines) still match the editor:
// - every loop body becomes `{__loop(line); body}`, to count its turns
// - every call notes its line, `k.knit(…)` → `__at(line, k).knit(…)`, so a
//   stitch knows where it came from even where stack traces don't say
//   (safari). `__at` hands back what it's given, so `this` is unchanged
// - every `import(x)` becomes `__import(line, x)`. left alone, `/automerge:…`
//   would be found next to evalJS.js (wherever these panes are hosted), not
//   on the page's own site, where the service worker hands out docs
// - `import x from "…"` can't be in a function body, so a declaration is
//   swapped for the line it means: `require("knitout")` for the knitout
//   library, `await __import(line, "…")` for a doc. `pins` says which
//   version of each doc to load (a url's `#heads`, or none: whatever's
//   current). a declaration keeps its line count, so nothing below it moves
export function instrument(code, { pins = {} } = {}) {
  const tree = parser.parse(code);
  const lineAt = (pos) => code.slice(0, pos).split("\n").length;
  const inserts = [];
  let temps = 0;
  const pinned = (url) => JSON.stringify(pins[url] ?? url);
  for (const use of scan(code)) {
    if (use.kind === "import") {
      const { def, ns, group } = use.decl;
      const source =
        use.text === "knitout"
          ? 'require("knitout")'
          : use.url && `await __import(${use.line}, ${pinned(use.url)})`;
      if (!source) continue;
      // knitout's default is the library itself; a doc's is its `default`
      const dflt = use.text === "knitout" ? "" : ".default";
      const names = [def, ns, group].filter(Boolean).length;
      let text;
      if (names === 0) text = `${source};`;
      else if (names === 1) {
        text = `const ${def ?? ns ?? group} = ${def ? (dflt ? `(${source})${dflt}` : source) : source};`;
      } else {
        // several names, one module: load it once
        const temp = `__m${++temps}`;
        const binds = [`${temp} = ${source}`];
        if (def) binds.push(`${def} = ${temp}${dflt}`);
        if (ns) binds.push(`${ns} = ${temp}`);
        if (group) binds.push(`${group} = ${temp}`);
        text = `const ${binds.join(", ")};`;
      }
      inserts.push({ at: use.from, to: use.to, text, depth: Infinity, open: true });
    } else if (use.url) {
      inserts.push({ at: use.string.from, to: use.string.to, text: pinned(use.url), depth: Infinity, open: true });
    }
  }
  let depth = 0;
  tree.iterate({
    enter(node) {
      depth++;
      if (
        node.name === "ForStatement" ||
        node.name === "WhileStatement" ||
        node.name === "DoStatement"
      ) {
        const body = loopBody(node.node);
        if (!body || body.type.isError) return;
        const line = lineAt(node.from);
        inserts.push({ at: body.from, text: `{__loop(${line});`, depth, open: true });
        inserts.push({ at: body.to, text: "}", depth, open: false });
      } else if (node.name === "DynamicImport") {
        const keyword = node.node.firstChild;
        const paren = keyword?.nextSibling;
        if (keyword?.name !== "import" || paren?.name !== "(") return;
        const line = lineAt(node.from);
        inserts.push({ at: keyword.from, text: "__", depth, open: true });
        inserts.push({ at: paren.to, text: `${line}, `, depth, open: true });
      } else if (node.name === "CallExpression") {
        const target = callTarget(node.node);
        const text = target && code.slice(target.from, target.to);
        if (!target || target.type.isError || text === "super" || text === "import") return;
        inserts.push({ at: target.from, text: `__at(${lineAt(node.from)}, `, depth, open: true });
        inserts.push({ at: target.to, text: ")", depth, open: false });
      }
    },
    leave() {
      depth--;
    },
  });
  // where several land on one spot, the outer one goes in front when opening
  // and behind when closing
  inserts.sort(
    (a, b) =>
      a.at - b.at ||
      (a.open === b.open ? (a.open ? a.depth - b.depth : b.depth - a.depth) : a.open ? 1 : -1),
  );

  // put together front to back, keeping a source map as we go: nothing
  // added has a newline, so each line maps to the same line, and only the
  // columns move. the code's own text gets a mapping at every token (a
  // mapping covers everything up to the next one, so fewer would land a
  // breakpoint at the wrong spot); added text maps to where it was added
  const lines = [[]];
  let out = "";
  let line = 0;
  let lineStart = 0;
  let generated = 0;
  const map = (from) => lines[line].push([generated, line, from - lineStart]);
  function original(from, to) {
    for (const piece of code.slice(from, to).split(/(\n)/)) {
      if (piece === "\n") {
        out += "\n";
        lines.push([]);
        line++;
        lineStart = from + 1;
        generated = 0;
        from++;
        continue;
      }
      for (const token of piece.matchAll(/[\w$]+|\S/g)) {
        lines[line].push([generated + token.index, line, from + token.index - lineStart]);
      }
      out += piece;
      generated += piece.length;
      from += piece.length;
    }
  }
  let at = 0;
  for (const insert of inserts) {
    original(at, insert.at);
    at = insert.at;
    map(at);
    out += insert.text;
    generated += insert.text.length;
    if (insert.to === undefined) continue;
    // a replacement keeps the newlines it covered, so lines stay put
    const covered = code.slice(at, insert.to).split("\n");
    at = insert.to;
    for (let i = 1; i < covered.length; i++) {
      out += "\n";
      lines.push([]);
      line++;
      generated = 0;
    }
    if (covered.length > 1) lineStart = at - covered[covered.length - 1].length;
  }
  original(at, code.length);

  return { code: out, mappings: encodeMappings(lines) };
}

// a source map's mappings, from [generated column, original line, original
// column] per line. each number is relative to the one before it, in base64
// vlq
function encodeMappings(lines) {
  const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function vlq(n) {
    let value = n < 0 ? (-n << 1) | 1 : n << 1;
    let text = "";
    do {
      let digit = value & 31;
      value >>>= 5;
      if (value) digit |= 32;
      text += BASE64[digit];
    } while (value);
    return text;
  }
  let lastLine = 0;
  let lastColumn = 0;
  return lines
    .map((segments) => {
      let lastGenerated = 0;
      return segments
        .map(([generated, line, column]) => {
          const text =
            vlq(generated - lastGenerated) + "A" + vlq(line - lastLine) + vlq(column - lastColumn);
          lastGenerated = generated;
          lastLine = line;
          lastColumn = column;
          return text;
        })
        .join(",");
    })
    .join(";");
}

// what lezer's grammar reads as typescript, which a pattern can't be: the
// engine stops there, so it's where the code stops making sense too
const TYPESCRIPT = new Set([
  "TypeAnnotation",
  "TypeParamList",
  "TypeArgList",
  "TypePredicate",
  "TypeAliasDeclaration",
  "InterfaceDeclaration",
  "EnumDeclaration",
  "NamespaceDeclaration",
  "AmbientDeclaration",
  "AmbientFunctionDeclaration",
]);

// where the code first stops making sense, for syntax errors (chrome and
// firefox don't say which line)
export function firstBrokenLine(code) {
  let at = null;
  parser.parse(code).iterate({
    enter(node) {
      if (at !== null) return false;
      if (node.type.isError || TYPESCRIPT.has(node.name)) at = node.from;
    },
  });
  return at === null ? null : code.slice(0, at).split("\n").length;
}
