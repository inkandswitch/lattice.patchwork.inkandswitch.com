import { parser } from "./vendor/lezer-javascript.js";
import { scan } from "./instrument.js";

// which docs a line of a pattern is made from, read from its code, as far as
// that can be known without running it: the names the line uses (and the
// conditions of the ifs and loops it's in), back through where each was
// made (`const grid = …`, `grid = …`, `grid[y] = …`, `grid.push(…)`, a
// function's body, its parameters' arguments where it's called) to an
// `import … from "automerge:…"` or a `doc("automerge:…")`. what it reads at
// runtime is reads.js's; this is what the code says, so it finds a doc even
// once its values are copied somewhere else first (or, as it can't tell
// which way an `if` goes, one the line might not have used this time)
//
// tracer(code)(line) → [{url, name, line, via: [{name, line}]}], each doc
// once, by the shortest way to it. `name` is what it's bound to in the code,
// `line` where it's imported, and `via` the names in between, from the line
// back to the doc. one the line's reached through an if or a loop round it
// starts with {name: "if" | "loop", line}

const SCOPES = new Set([
  "Script",
  "Block",
  "ForStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunction",
  "MethodDeclaration",
  "ClassBody",
  "CatchClause",
]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration"]);
const LOOPS = new Set(["ForStatement", "WhileStatement", "DoStatement"]);
// a call to one of these changes what it's called on: its arguments go into it
const FILLS = new Set(["push", "unshift", "splice", "fill", "set", "add", "concat", "assign"]);
const MOST = 32;

const isStatement = (node) => node.name.endsWith("Statement") || node.name === "VariableDeclaration" || node.name === "FunctionDeclaration";

export function tracer(code) {
  const tree = parser.parse(code);
  const starts = [0];
  for (let at = code.indexOf("\n"); at >= 0; at = code.indexOf("\n", at + 1)) starts.push(at + 1);
  const lineAt = (pos) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= pos) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  const text = (node) => code.slice(node.from, node.to);

  const scopeOf = (node) => {
    for (let up = node.parent; up; up = up.parent) if (SCOPES.has(up.name)) return up;
    return tree.topNode;
  };

  // every name the code makes: {name, line, at, scope, from: [nodes it's
  // made from], url (a doc it's imported from), fn (the function it names)}
  const bindings = [];
  const docImports = new Map();
  for (const use of scan(code)) if (use.kind === "import" && use.url) docImports.set(use.from, use.url);

  function bind(def, scope, from = [], extra = {}) {
    const binding = { name: text(def), line: lineAt(def.from), at: def.from, scope, from, ...extra };
    bindings.push(binding);
    return binding;
  }

  // what a declaration's name is given: the expression after the `=` its
  // name (or the pattern it's in) is followed by
  function initialiser(def) {
    let top = def;
    while (top.parent && top.parent.name !== "VariableDeclaration" && top.parent.name !== "ForSpec") top = top.parent;
    if (!top.parent) return null;
    const equals = top.nextSibling;
    return equals?.name === "Equals" ? equals.nextSibling : null;
  }

  // (lezer hands out a new node object each time: a node's known by where it is)
  const same = (a, b) => a && b && a.from === b.from && a.to === b.to && a.name === b.name;
  const KINDS = new Set(["ImportDeclaration", "ParamList", "ForOfSpec", "ForInSpec", "VariableDeclaration", "FunctionDeclaration", "ClassDeclaration", "CatchClause"]);

  const params = []; // [{binding, fn: the function node, index}]
  tree.iterate({
    enter(ref) {
      const node = ref.node;
      if (node.name !== "VariableDefinition") return;
      let kind = node.parent;
      while (kind && !KINDS.has(kind.name)) kind = kind.parent;
      if (!kind) return;
      if (kind.name === "ImportDeclaration") {
        bind(node, tree.topNode, [], { url: docImports.get(kind.from) ?? null });
      } else if (kind.name === "FunctionDeclaration" || kind.name === "ClassDeclaration") {
        const body = kind.getChild("Block") ?? kind.getChild("ClassBody");
        bind(node, scopeOf(kind), body ? [body] : [], { fn: kind });
      } else if (kind.name === "ParamList") {
        const fn = kind.parent;
        let index = 0;
        for (let child = kind.firstChild; child && child.from < node.from; child = child.nextSibling) if (child.name === ",") index++;
        params.push({ binding: bind(node, fn), fn, index });
      } else if (kind.name === "ForOfSpec" || kind.name === "ForInSpec") {
        const over = kind.getChild("of") ?? kind.getChild("in");
        bind(node, kind.parent, over?.nextSibling ? [over.nextSibling] : []);
      } else if (kind.name === "CatchClause") {
        bind(node, kind);
      } else {
        const value = initialiser(node);
        const fn = value && FUNCTIONS.has(value.name) ? value : undefined;
        bind(node, scopeOf(node), value ? [value] : [], { fn });
      }
    },
  });

  const contains = (scope, pos) => scope.from <= pos && pos <= scope.to;
  // the binding a name at `pos` is: the innermost in scope there
  function resolve(name, pos) {
    let best = null;
    for (const binding of bindings) {
      if (binding.name !== name || !contains(binding.scope, pos)) continue;
      if (!best || binding.scope.to - binding.scope.from < best.scope.to - best.scope.from) best = binding;
    }
    return best;
  }

  // the name a node's rooted at: `grid` in `grid[y].x`
  function root(node) {
    while (node?.name === "MemberExpression") node = node.firstChild;
    return node?.name === "VariableName" ? node : null;
  }

  // what's done to a name after it's made: `x = …`, `x[i] = …`, `x.push(…)`.
  // and a function's calls, for its parameters
  const calls = [];
  tree.iterate({
    enter(ref) {
      const node = ref.node;
      if (node.name === "AssignmentExpression") {
        const target = root(node.firstChild);
        const value = node.lastChild;
        const binding = target && resolve(text(target), target.from);
        if (binding && value !== node.firstChild) binding.from.push(value);
      } else if (node.name === "CallExpression") {
        const callee = node.firstChild;
        const args = node.getChild("ArgList");
        if (callee?.name === "MemberExpression" && args) {
          const method = callee.lastChild;
          const target = root(callee.firstChild);
          if (method?.name === "PropertyName" && FILLS.has(text(method)) && target) {
            const binding = resolve(text(target), target.from);
            if (binding) binding.from.push(args);
          }
        } else if (callee?.name === "VariableName" && args) {
          calls.push({ name: text(callee), at: callee.from, args });
        }
      }
    },
  });
  for (const { binding, fn, index } of params) {
    const named = bindings.find((each) => same(each.fn, fn));
    if (!named) continue;
    for (const call of calls) {
      if (call.name !== named.name || resolve(call.name, call.at) !== named) continue;
      let at = 0;
      for (let arg = call.args.firstChild; arg; arg = arg.nextSibling) {
        if (arg.name === "(" || arg.name === ")") continue;
        if (arg.name === ",") at++;
        else if (at === index) binding.from.push(arg);
      }
    }
  }

  // the names an expression uses, and the docs it reads with doc("…")
  function uses(node) {
    const names = [];
    const docs = [];
    (function walk(node) {
      if (node.name === "VariableName") names.push({ name: text(node), at: node.from });
      else if (node.name === "CallExpression") {
        const callee = node.firstChild;
        const string = callee?.nextSibling?.getChild("String");
        const url = string && /^["'](\/?automerge:[^"'\\]+)["']$/.exec(text(string))?.[1];
        if (callee?.name === "VariableName" && text(callee) === "doc" && url) {
          docs.push({ url: url.replace(/^\//, ""), at: callee.from });
        }
      }
      for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
    })(node);
    return { names, docs };
  }

  // the line's own statement (the outermost one that starts on it, or the
  // innermost it's part of), and the heads of the ifs and loops round it
  function startsOf(line) {
    const from = starts[line - 1];
    const to = line < starts.length ? starts[line] - 1 : code.length;
    if (from === undefined) return [];
    let found = null;
    tree.iterate({
      from,
      to,
      enter(ref) {
        if (found) return false;
        if (ref.from >= from && ref.from <= to && isStatement(ref.node)) {
          found = ref.node;
          return false;
        }
      },
    });
    if (!found) {
      for (let node = tree.resolveInner(from, 1); node; node = node.parent) {
        if (isStatement(node)) {
          found = node;
          break;
        }
      }
    }
    if (!found) return [];
    const heads = [found];
    for (let up = found.parent; up; up = up.parent) {
      if (up.name === "IfStatement" || up.name === "WhileStatement" || up.name === "SwitchStatement") {
        const head = up.getChild("ParenthesizedExpression");
        if (head) heads.push(head);
      } else if (LOOPS.has(up.name)) {
        const head = up.getChild("ForSpec") ?? up.getChild("ForOfSpec") ?? up.getChild("ForInSpec");
        if (head) heads.push(head);
        else if (up.name === "DoStatement") heads.push(up.getChild("ParenthesizedExpression") ?? up);
      }
    }
    return heads;
  }

  const traced = new Map();
  return function trace(line) {
    if (traced.has(line)) return traced.get(line);
    const found = new Map();
    const seen = new Set();
    // breadth first, so each doc's found the shortest way
    let edge = [];
    const visit = (node, via) => {
      const { names, docs } = uses(node);
      for (const { url, at } of docs) if (!found.has(url)) found.set(url, { url, name: null, line: lineAt(at), via });
      for (const { name, at } of names) {
        const binding = resolve(name, at);
        if (!binding || seen.has(binding)) continue;
        seen.add(binding);
        if (binding.url) {
          if (!found.has(binding.url)) found.set(binding.url, { url: binding.url, name: binding.name, line: binding.line, via });
        } else if (binding.from.length) edge.push({ binding, via: [...via, { name: binding.name, line: binding.line }] });
      }
    };
    // the line itself first, and only then the ifs and loops round it, so a
    // doc both reach is said the way the line uses it
    const [own, ...heads] = startsOf(line);
    for (const start of [own, ...heads]) {
      if (!start) continue;
      visit(start, start === own ? [] : [{ name: start.parent.name === "IfStatement" ? "if" : "loop", line: lineAt(start.from) }]);
      for (let steps = 0; edge.length && steps < MOST; steps++) {
        const next = edge;
        edge = [];
        for (const { binding, via } of next) for (const node of binding.from) visit(node, via);
      }
    }
    const result = [...found.values()];
    traced.set(line, result);
    return result;
  };
}
