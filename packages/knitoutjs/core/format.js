// a pattern, tidied by prettier (vendor/prettier.js, loaded the first time
// it's wanted), as the few changes that make it so, not the whole text again:
// each is a splice of the doc, so a caret anywhere else stays where it was,
// and anyone typing at the same time keeps what they typed. it's tidied in
// the style it's already in (tabs or spaces, semicolons or none, which
// quotes), so all that changes is what was untidy

// tokens: a run of space, a word, or one other character. changes are found
// between these, so a change is never half a word
const TOKENS = /\s+|[\w$]+|[^\s\w$]/g;
// past this many tokens changed, it's all changed: one change for the lot
const MOST = 5000;

let loading = null;
const prettier = () => (loading ??= import("./vendor/prettier.js"));

const count = (text, pattern) => (text.match(pattern) ?? []).length;

// prettier's options for code written the way `code` is
export function styleOf(code) {
  const tabbed = count(code, /^\t/gm);
  const spaced = count(code, /^ {2,}\S/gm);
  const indents = (code.match(/^ +(?=\S)/gm) ?? []).map((indent) => indent.length);
  const tabWidth = indents.length && Math.min(...indents) >= 4 ? 4 : 2;
  // lines that end a statement: with a semicolon, or without one
  const semis = count(code, /;[ \t]*(\/\/.*)?$/gm) - count(code, /^\s*for\s*\(.*;.*\)/gm);
  const bare = count(code, /[\w$)\]"'`][ \t]*$/gm);
  return {
    parser: "babel",
    useTabs: tabbed >= spaced,
    tabWidth,
    printWidth: 100,
    semi: semis >= bare / 2,
    singleQuote: count(code, /'/g) > count(code, /"/g),
    bracketSpacing: count(code, /\{ [^\s}]/g) >= count(code, /\{[^\s}]/g),
    arrowParens: count(code, /(^|[^\w$)])[\w$]+\s*=>/g) > count(code, /\([\w$]+\)\s*=>/g) ? "avoid" : "always",
  };
}

// `code`, tidied: {text} or {error: {message, line}} (code prettier can't read)
export async function format(code) {
  const { format, babel, estree } = await prettier();
  try {
    return { text: await format(code, { ...styleOf(code), plugins: [babel, estree] }) };
  } catch (error) {
    const line = error?.loc?.start?.line ?? null;
    return { error: { message: String(error?.message ?? error).split("\n")[0], line } };
  }
}

// the edit script from tokens `a` to `b`, as runs of "=" (the same), "-"
// (only in a) and "+" (only in b): myers's, keeping only what each step can
// reach, so its memory is the square of how much changed, not of the length
function script(a, b) {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MOST);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace, n, m) {
  const steps = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d];
    const at = (k) => v[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push("=");
      x--;
      y--;
    }
    steps.push(down ? "+" : "-");
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    steps.push("=");
    x--;
    y--;
  }
  return steps.reverse();
}

// the changes that turn `before` into `after`, as codemirror (and automerge's
// splice) take them: [{from, to, insert}], from and to in `before`, in order
// and not overlapping
export function changesBetween(before, after) {
  if (before === after) return [];
  const a = before.match(TOKENS) ?? [];
  const b = after.match(TOKENS) ?? [];
  // what's the same at either end needn't be diffed
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const offsets = [0];
  for (const token of a) offsets.push(offsets[offsets.length - 1] + token.length);
  const midA = a.slice(start, a.length - end);
  const midB = b.slice(start, b.length - end);
  const steps = script(midA, midB);
  if (!steps) {
    return [trimmed({ from: offsets[start], to: offsets[a.length - end], insert: midB.join("") })];
  }
  const changes = [];
  let i = start;
  let j = 0;
  let open = null;
  const flush = () => {
    if (open) changes.push(trimmed({ from: offsets[open.i], to: offsets[i], insert: midB.slice(open.j, j).join("") }));
    open = null;
  };
  for (const step of steps) {
    if (step === "=") {
      flush();
      i++;
      j++;
      continue;
    }
    open ??= { i, j };
    if (step === "-") i++;
    else j++;
  }
  flush();
  return changes.filter((change) => change.from !== change.to || change.insert);

  // a change that leaves its own ends as they were (`'a'` → `"a"` is just
  // the quotes) needn't touch them
  function trimmed({ from, to, insert }) {
    const old = before.slice(from, to);
    let head = 0;
    while (head < old.length && head < insert.length && old[head] === insert[head]) head++;
    let tail = 0;
    while (tail < old.length - head && tail < insert.length - head && old[old.length - 1 - tail] === insert[insert.length - 1 - tail]) tail++;
    return { from: from + head, to: to - tail, insert: insert.slice(head, insert.length - tail) };
  }
}

// apply changes to text, as codemirror would: to check them
export function applyChanges(text, changes) {
  let out = "";
  let at = 0;
  for (const { from, to, insert } of changes) {
    out += text.slice(at, from) + insert;
    at = to;
  }
  return out + text.slice(at);
}
