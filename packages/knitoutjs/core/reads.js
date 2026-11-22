// which values of its docs a pattern read for each stitch: the docs it's given
// (graph.js's snapshots) are handed to it watched (`watched`), every plain
// value read out of one is noted, and each op the knitout writer writes takes
// the reads since the op before (`readLog`). in the .k, an op says them in a
// tag after its source, `;!read:0:pixels/12/4=2`, and the docs they're of are
// listed once, last, `;!read-docs: automerge:…#… …` (0 is the first)
//
// it can't follow a value once it's copied: a read made long before the op
// (a whole picture copied into an array first, say) is too far from it to be
// sure, so an op only takes the reads since the one before when there are a
// few (`FEW`). trace.js finds the rest in the code

// at most this many reads since the op before are taken to be what it's made
// from; more, and they're everything the pattern looked over, not this stitch
export const FEW = 8;
// and an op says at most this many, the last
const SAID = 4;
// a string read is said up to this long
const LONGEST = 48;

const READ_TAG = ";!read:";
const DOCS_TAG = ";!read-docs:";

const plain = (value) => value === null || (typeof value !== "object" && typeof value !== "function");

// `value` (a frozen doc, see modules.js's deepFreeze), as the pattern sees
// it: the same, read-only, but each plain value read from it is told to
// `note(path, value)`. a frozen object's own fields can't be handed out as
// anything but themselves, so what's watched is a stand-in, empty, that asks
// the doc for everything
export function watched(value, note) {
  const made = new WeakMap();
  function wrap(value, path) {
    if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
    if (made.has(value)) return made.get(value);
    const array = Array.isArray(value);
    const stand = array ? [] : Object.create(Object.getPrototypeOf(value));
    if (array) stand.length = value.length;
    const proxy = new Proxy(stand, {
      get(_, key) {
        const field = Reflect.get(value, key);
        if (typeof key === "symbol" || !Object.hasOwn(value, key) || (array && key === "length")) return field;
        if (plain(field)) {
          note([...path, key], field);
          return field;
        }
        return wrap(field, [...path, key]);
      },
      has: (_, key) => Reflect.has(value, key),
      ownKeys: () => Reflect.ownKeys(value),
      getOwnPropertyDescriptor(_, key) {
        if (array && key === "length") return Reflect.getOwnPropertyDescriptor(stand, key);
        const own = Reflect.getOwnPropertyDescriptor(value, key);
        if (!own) return undefined;
        return { value: proxy[key], writable: false, enumerable: own.enumerable, configurable: true };
      },
      // read-only, as the frozen doc is
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
      setPrototypeOf: () => false,
    });
    made.set(value, proxy);
    return proxy;
  }
  return wrap(value, []);
}

// what a run read, op by op. `note(pinned, path, value)` says a read of a
// doc (pinned: its pinned url; `docs` are the ones read, in the order first
// read, and a read says which by its place there); `turn()` that a loop's
// gone round; `take()`, as an op is written, is the reads it's made from, as
// its tag (or ""). those are the reads since the op before, but none from
// before the loop's last turn but one (a `for (const c of row)` reads its `c`
// just before the turn it's for; anything before that was for something
// else), each once. an op with no reads of its own since the one before
// takes that one's, unless a loop's turned since: in one turn, everything's
// made from what that turn read
export function readLog() {
  const docs = [];
  let since = [];
  let turns = []; // where in `since` each turn since the op before came
  let last = [];
  return {
    docs,
    note(pinned, path, value) {
      let doc = docs.indexOf(pinned);
      if (doc < 0) doc = docs.push(pinned) - 1;
      since.push({ doc, path, value });
      // (more than FEW since the turn before last, and there's no telling which)
      const from = turns.length > 1 ? turns[turns.length - 2] : 0;
      if (since.length - from > FEW + 1) {
        since = since.slice(-(FEW + 1));
        turns = turns.map((at) => Math.max(0, at - (since.length - FEW - 1)));
      }
    },
    turn() {
      turns.push(since.length);
      if (turns.length > 2) {
        const drop = turns[turns.length - 3];
        since = since.slice(drop);
        turns = turns.slice(-2).map((at) => at - drop);
      }
    },
    // what's been read since the last op isn't any op's
    forget() {
      since = [];
      turns = [];
    },
    take() {
      const from = turns.length > 1 ? turns[turns.length - 2] : 0;
      const mine = since.slice(from);
      if (mine.length) {
        if (mine.length > FEW) last = [];
        else {
          const each = new Map();
          for (const read of mine) {
            const key = `${read.doc}:${read.path.join("/")}`;
            each.delete(key);
            each.set(key, read);
          }
          last = [...each.values()].slice(-SAID);
        }
      } else if (turns.length) last = [];
      since = [];
      turns = [];
      return readTag(last);
    },
  };
}

// a doc's own values, said as they are in a tag: each field of a path, and
// the value (as json), escaped so a tag has no spaces or commas
const escape = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);

function said(value) {
  if (typeof value === "string" && value.length > LONGEST) value = `${value.slice(0, LONGEST)}…`;
  return JSON.stringify(value) ?? "null";
}

// " ;!read:0:pixels/12/4=2,0:width=50", or "" for none
export function readTag(reads) {
  if (!reads.length) return "";
  const each = reads.map(({ doc, path, value }) => `${doc}:${path.map(escape).join("/")}=${escape(said(value))}`);
  return ` ${READ_TAG}${each.join(",")}`;
}

// the line listing the docs, for the end of the .k (or "" if nothing was read)
export function docsLine(docs) {
  return docs.length ? `${DOCS_TAG} ${docs.join(" ")}` : "";
}

// knitout with the docs its reads are of, last (and as it was, if none)
export function withReadDocs(knitout, docs) {
  const line = docsLine(docs);
  if (!line || !knitout) return knitout;
  return `${knitout.replace(/\n?$/, "\n")}${line}\n`;
}

// a line of a .k's reads: [{doc, path, value}] (none, if it says none)
export function readsOf(line) {
  const at = line.indexOf(READ_TAG);
  if (at < 0) return [];
  const tag = line.slice(at + READ_TAG.length).split(/\s/, 1)[0];
  const reads = [];
  for (const each of tag.split(",")) {
    const match = /^(\d+):([^=]*)=(.*)$/.exec(each);
    if (!match) continue;
    let value;
    try {
      value = JSON.parse(decodeURIComponent(match[3]));
    } catch {
      value = decodeURIComponent(match[3]);
    }
    const path = match[2] === "" ? [] : match[2].split("/").map(decodeURIComponent);
    reads.push({ doc: Number(match[1]), path, value });
  }
  return reads;
}

// the docs a .k's reads are of, as pinned urls ([] if it has none)
export function readDocsOf(text) {
  const at = text.lastIndexOf(`\n${DOCS_TAG}`);
  const line = at < 0 ? (text.startsWith(DOCS_TAG) ? text : "") : text.slice(at + 1);
  return line.split("\n", 1)[0].slice(DOCS_TAG.length).split(/\s+/).filter(Boolean);
}

// a path as it'd be written in javascript: pixels[12][4]
export function pathText(path) {
  return path
    .map((key, index) =>
      /^\d+$/.test(key) ? `[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? (index ? `.${key}` : key) : `[${JSON.stringify(key)}]`,
    )
    .join("");
}
