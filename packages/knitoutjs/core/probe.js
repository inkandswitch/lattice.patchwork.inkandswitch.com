import { parser } from "./vendor/lezer-javascript.js";
import { isSourcesLine } from "./sources.js";

// what a name in a pattern was at a moment of its run: the name (or a
// `crab.height`, a chain of fields off one) is looked at from a place it's
// in scope, `__see(() => (name))`: where the name's declared (just before its
// declaration, or at the start of the loop or function body that declares
// it, for a loop's `let r` or a function's parameter), or, for a name the
// pattern doesn't declare (or a chain that uses more than one), just before
// the statement it's in. each time that runs, it leaves a way to read the
// name as it is then and after: the run is stopped as the op asked about is
// written (run-worker.js), and the latest one left says what the name is at
// that moment
//
// probeTarget(code, pos) → {from, to, text, insert: [...]} | null, the inserts
// as instrument.js takes them. null where there's nothing to see (a keyword,
// a method being called, a chain with a call in it, which can't be read again
// without doing it again)

// a node's depth as instrument.js counts it (the Script is 1)
function depthOf(node) {
  let depth = 0;
  for (let at = node; at; at = at.parent) depth++;
  return depth;
}

const LOOPS = new Set(["ForStatement", "WhileStatement", "DoStatement"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration"]);
// where a statement can have another put in front of it
const LISTS = new Set(["Script", "Block", "SwitchBody"]);
// a chain that does something when it's read
const DOES = new Set([
  "CallExpression",
  "NewExpression",
  "AssignmentExpression",
  "UpdateExpression",
  "AwaitExpression",
  "YieldExpression",
  "TaggedTemplateExpression",
]);

// the expression under `pos`: a name, or a chain of fields ending in the one
// pointed at (`crab.height`, not `crab.height.toFixed` if it's `height`)
function expressionAt(tree, pos) {
  for (const side of [1, -1]) {
    const node = tree.resolveInner(pos, side);
    // (a method's object is fine, `k` in `k.knit()`: it's the call that isn't)
    if (node.name === "VariableName" || node.name === "VariableDefinition") return node;
    if (node.name === "PropertyName" && node.parent?.name === "MemberExpression") {
      const chain = node.parent;
      // a method, as it's called: its value's only a function
      if (chain.parent?.name === "CallExpression" && chain.parent.firstChild?.from === chain.from &&
        chain.parent.firstChild?.to === chain.to) return null;
      // (anything in it that does something: read it again and it does it again)
      return doesSomething(chain) ? null : chain;
    }
  }
  return null;
}

function doesSomething(node) {
  if (DOES.has(node.name)) return true;
  for (let child = node.firstChild; child; child = child.nextSibling) if (doesSomething(child)) return true;
  return false;
}

// a loop's or function's body: its last child (a catch's too)
const bodyOf = (node) => (node.name === "DoStatement" ? node.firstChild?.nextSibling : node.lastChild);

// `text` put at the start of a body: inside a block's brace, or, for a body
// that's one statement (which instrument.js braces) or an arrow's expression,
// in front of it
function atStartOf(body, owner, text) {
  if (!body || body.type.isError) return null;
  if (body.name === "Block") return [{ at: body.from + 1, text: `;${text};`, depth: depthOf(body) + 0.5, open: true }];
  if (owner.name === "ArrowFunction") {
    const depth = depthOf(body) - 0.5;
    return [
      { at: body.from, text: `(${text}, `, depth, open: true },
      { at: body.to, text: ")", depth, open: false },
    ];
  }
  if (LOOPS.has(owner.name)) return [{ at: body.from, text: `;${text};`, depth: depthOf(owner) + 0.5, open: true }];
  return null;
}

// the names a pattern of definitions binds (`{a, b: [c]}`), and a
// declaration's, not looking inside what they're set to
const NOT_INTO = new Set([...FUNCTIONS, "ClassBody", "Block", "CallExpression", "NewExpression"]);
function definitions(node, out = []) {
  if (node.name === "VariableDefinition") out.push(node);
  else if (!NOT_INTO.has(node.name)) {
    for (let child = node.firstChild; child; child = child.nextSibling) definitions(child, out);
  }
  return out;
}

// where `name` is declared in `scope` itself (not in a scope inside it), or
// null
function declaredIn(scope, name, code) {
  const named = (defs) => defs.find((def) => code.slice(def.from, def.to) === name) ?? null;
  const own = [];
  if (LISTS.has(scope.name)) {
    for (let each = scope.firstChild; each; each = each.nextSibling) {
      if (each.name === "VariableDeclaration" || each.name === "ImportDeclaration") definitions(each, own);
      else if (each.name === "FunctionDeclaration" || each.name === "ClassDeclaration") {
        const def = each.getChild("VariableDefinition");
        if (def) own.push(def);
      }
    }
  } else if (scope.name === "ForStatement") {
    const spec = scope.getChild("ForSpec") ?? scope.getChild("ForInSpec") ?? scope.getChild("ForOfSpec");
    if (spec) definitions(spec, own);
  } else if (FUNCTIONS.has(scope.name)) {
    const params = scope.getChild("ParamList");
    if (params) definitions(params, own);
  } else if (scope.name === "CatchClause") {
    const def = scope.getChild("VariableDefinition");
    if (def) own.push(def);
  }
  return named(own);
}

// the definition a name (a VariableName) means, or null for one the pattern
// doesn't declare
function definitionOf(use, code) {
  const name = code.slice(use.from, use.to);
  for (let scope = use.parent; scope; scope = scope.parent) {
    const def = declaredIn(scope, name, code);
    if (def) return def;
  }
  return null;
}

// a chain's names: `crab` in `crab.height`, `grid` and `y` in `grid[y]`
function namesIn(node, out = []) {
  if (node.name === "VariableName") out.push(node);
  for (let child = node.firstChild; child; child = child.nextSibling) namesIn(child, out);
  return out;
}

// where `see` can go, from `from` up: the nearest place in front of a
// statement or at the start of a body where what `from` names means what it
// does there
function placeFrom(from, see) {
  for (let child = from, node = from.parent; node; child = node, node = node.parent) {
    // (a function declaration's own name is the declaration's, not its body's)
    if (FUNCTIONS.has(node.name) && child.name === "VariableDefinition") continue;
    if (LOOPS.has(node.name) || FUNCTIONS.has(node.name) || node.name === "CatchClause") {
      const body = bodyOf(node);
      // in a block body, there's a statement nearer (handled on the way up)
      if (body?.name === "Block" && child.from >= body.from && child.to <= body.to) continue;
      return atStartOf(body, node, see);
    }
    if (LISTS.has(node.name)) return [{ at: child.from, text: `;${see};`, depth: depthOf(child) - 0.5, open: true }];
  }
  return null;
}

export function probeTarget(code, pos, tree = parser.parse(code)) {
  const target = expressionAt(tree, pos);
  if (!target) return null;
  const text = code.slice(target.from, target.to);
  // from its declaration, if it's one name (a chain's names could each be
  // declared somewhere different): then it's seen from the start, not only
  // once the line it's on has run
  let from = target;
  if (target.name !== "VariableDefinition") {
    const names = namesIn(target);
    if (names.length === 1) from = definitionOf(names[0], code) ?? target;
  }
  const insert = placeFrom(from, `__see(() => (${text}))`);
  return insert && { from: target.from, to: target.to, text, insert };
}

// an op's place among those the pattern wrote, from its line in the .k: the
// lines before it, less the ones that aren't ops (the header, and the
// sources lines just after it)
export function opPlace(kText, kLine) {
  const lines = kText.split("\n");
  let top = 0;
  while (top < lines.length && (lines[top].startsWith(";;") || (top === 0 && lines[top].startsWith(";!")) ||
    isSourcesLine(lines[top]))) top++;
  return kLine - 1 - top;
}

// a value, said short, as a console would: `1`, `"f73"`, `[1, 2, … 38 more]`,
// `Writer {carriers: {…}, …}`. never more than about LONGEST long
const LONGEST = 240;
export function preview(value, depth = 0) {
  try {
    return clip(say(value, depth));
  } catch (error) {
    return `(can't say: ${error?.message ?? error})`;
  }
}

const clip = (text) => (text.length > LONGEST ? `${text.slice(0, LONGEST - 1)}…` : text);

function say(value, depth) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}…` : value);
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "bigint":
      return `${value}n`;
    case "boolean":
      return String(value);
    case "symbol":
      return value.toString();
    case "function":
      return `ƒ ${value.name || "(anonymous)"}()`;
  }
  if (value instanceof Date) return Number.isNaN(+value) ? "Invalid Date" : value.toISOString();
  if (ArrayBuffer.isView(value)) return `${value.constructor?.name ?? "bytes"}(${value.length ?? value.byteLength})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  const deep = depth >= 2;
  if (Array.isArray(value)) {
    if (deep) return `[…${value.length}]`;
    const shown = value.slice(0, 8).map((each) => say(each, depth + 1));
    const more = value.length - shown.length;
    return `[${shown.join(", ")}${more > 0 ? `, … ${more} more` : ""}]`;
  }
  const kind = Object.getPrototypeOf(value)?.constructor?.name;
  const prefix = kind && kind !== "Object" ? `${kind} ` : "";
  if (deep) return `${prefix}{…}`;
  const keys = Object.keys(value);
  const shown = keys.slice(0, 6).map((key) => {
    const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    return `${name}: ${say(value[key], depth + 1)}`;
  });
  return `${prefix}{${shown.join(", ")}${keys.length > shown.length ? ", …" : ""}}`;
}
