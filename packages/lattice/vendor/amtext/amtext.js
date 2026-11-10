/**
 * amtext: plain-text format for one Automerge document.
 *
 *   {
 *     @patchwork { type = "essay" }
 *     title "hello"                 // "..." is text (collaborative string), JSON escapes
 *     body `line one
 *   line two`                        // backtick fence is text too, raw, no escapes.
 *                                    // use more backticks if the content has some: ``a ` b``
 *     slug string("hello")           // ImmutableString
 *     n 1.5                          // number
 *     ok true                        // true / false / null
 *     hits counter(3)                // Counter
 *     blob bytes(1, 2, 3)            // Uint8Array
 *     big bytes64("AQID")            // Uint8Array, base64
 *     at date("2026-10-30T00:00:00.000Z")   // Date (also accepts ms number)
 *     child link("./other.amtext")   // url of another doc in the same folder archive
 *     ref link("./other.amtext", "content", cursor(3, 8))
 *                                    // url of a part of one: like handle.sub(...), a path of
 *                                    // keys, list indexes and { match } maps, optionally
 *                                    // ending in cursor(from, to) (text positions)
 *     "key with space" [ 1, 2, 3 ]
 *     content richtext(              // text with marks and block markers (Automerge spans)
 *       block({ type string("heading"), parents [], attrs { level 1 } })
 *       "Hello, "
 *       text("world", { bold true })
 *     )
 *   }
 *
 * - The document is one map.
 * - Keys are bare ([A-Za-z_@$][A-Za-z0-9_@$-]*) or JSON-quoted.
 * - `=` or `:` between key and value is optional.
 * - Commas and newlines are both separators, and both optional.
 * - `//` starts a line comment.
 * - richtext() takes, in order: plain strings (unmarked text), text(string, { marks }),
 *   and block({ any map }). Mark values: string, number, bool, null, date(), bytes(), link().
 * - cursor(at) or cursor(from, to) only goes last in a link().
 */

export class Counter {
  constructor(value) { this.value = value; }
}
export class ImmutableString {
  constructor(value) { this.value = value; }
}
/**
 * path: the doc's file in the archive. segments: a path within the doc, as in
 * automerge-repo's handle.sub(...): string keys, number list indexes, { match }
 * maps, and lastly maybe a Cursor
 */
export class Link {
  constructor(path, segments = []) { this.path = path; this.segments = segments; }
}
/** a range of text, by position (from === to for a single point) */
export class Cursor {
  constructor(from, to = from) { this.from = from; this.to = to; }
}
/** spans: Array<{ type: "text", value: string, marks?: object } | { type: "block", value: object }> */
export class RichText {
  constructor(spans) { this.spans = spans; }
}

export class AmtextSyntaxError extends Error {
  constructor(message, src, pos) {
    let line = 1, col = 1;
    for (let i = 0; i < pos && i < src.length; i++) {
      if (src[i] === "\n") { line++; col = 1; } else col++;
    }
    super(`${message} (line ${line}, column ${col})`);
    this.name = "AmtextSyntaxError";
    this.reason = message;
    this.pos = pos;
    this.line = line;
    this.column = col;
  }
}

export const FUNCTIONS = ["counter", "string", "bytes", "bytes64", "date", "link", "cursor", "richtext", "text", "block"];

const IDENT_START = /[A-Za-z_@$]/;
const IDENT_CHAR = /[A-Za-z0-9_@$-]/;
const BARE_KEY = /^[A-Za-z_@$][A-Za-z0-9_@$-]*$/;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function setKey(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

const isPlainMap = v => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

const isMarkValue = v =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  || v instanceof Date || v instanceof Uint8Array || v instanceof Link;

function b64decode(s) {
  const bin = atob(s.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function parse(src) {
  let i = 0;
  const fail = (msg, at = i) => { throw new AmtextSyntaxError(msg, src, at); };

  function skip() {
    for (;;) {
      const c = src[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === ",") i++;
      else if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; }
      else return;
    }
  }

  function readIdent() {
    const start = i;
    i++;
    while (i < src.length && IDENT_CHAR.test(src[i])) i++;
    return src.slice(start, i);
  }

  function parseJsonString() {
    const start = i;
    i++;
    while (i < src.length && src[i] !== '"') {
      if (src[i] === "\\") i++;
      if (src[i] === "\n") fail('newline inside "..." string; use a `fenced` string for multiline text');
      i++;
    }
    if (i >= src.length) fail('unclosed "', start);
    i++;
    try { return JSON.parse(src.slice(start, i)); }
    catch { return fail("bad string escape", start); }
  }

  function parseFence() {
    const start = i;
    let n = 0;
    while (src[i] === "`") { i++; n++; }
    const contentStart = i;
    let j = contentStart;
    for (;;) {
      const k = src.indexOf("`", j);
      if (k < 0) fail("unclosed `", start);
      let r = 0;
      while (src[k + r] === "`") r++;
      if (r === n) { i = k + n; return src.slice(contentStart, k); }
      j = k + r;
    }
  }

  function parseNumber() {
    const start = i;
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(src);
    if (!m) fail("bad number");
    i += m[0].length;
    if (i < src.length && (IDENT_CHAR.test(src[i]) || src[i] === ".")) fail("bad number", start);
    return Number(m[0]);
  }

  function parseArgs(name, at, item = parseValue) {
    i++; // (
    const args = [];
    for (;;) {
      skip();
      if (src[i] === ")") { i++; return args; }
      if (i >= src.length) fail(`unclosed ${name}(`, at);
      args.push(item());
    }
  }

  function parseRichItem() {
    skip();
    const c = src[i];
    if (c === '"') return { type: "text", value: parseJsonString() };
    if (c === "`") return { type: "text", value: parseFence() };
    if (c !== undefined && IDENT_START.test(c)) {
      const at = i;
      const name = readIdent();
      if (src[i] !== "(" || (name !== "text" && name !== "block")) fail("richtext() takes strings, text() and block()", at);
      const args = parseArgs(name, at);
      if (name === "text") {
        if (args.length < 1 || args.length > 2 || typeof args[0] !== "string" || (args.length === 2 && !isPlainMap(args[1]))) {
          fail('text() takes a string and an optional { marks } map', at);
        }
        if (args.length === 1) return { type: "text", value: args[0] };
        for (const [k, v] of Object.entries(args[1])) {
          if (!isMarkValue(v)) fail(`mark "${k}" must be a string, number, bool, null, date(), bytes() or link()`, at);
        }
        return { type: "text", value: args[0], marks: args[1] };
      }
      if (args.length !== 1 || !isPlainMap(args[0])) fail("block() takes one { map }", at);
      return { type: "block", value: args[0] };
    }
    return fail("richtext() takes strings, text() and block()");
  }

  function parseLink(at) {
    const args = parseArgs("link", at, () => parseValue(true));
    const [path, ...segments] = args;
    if (typeof path !== "string") fail("link() takes a path string, then the path within that doc", at);
    segments.forEach((seg, n) => {
      if (seg instanceof Cursor) {
        if (n !== segments.length - 1) fail("cursor() goes last in link()", at);
      } else if (typeof seg !== "string" && !(Number.isInteger(seg) && seg >= 0) && !isPlainMap(seg)) {
        fail("link() path segments are keys, list indexes, { match } maps and a last cursor()", at);
      }
    });
    return new Link(path, segments);
  }

  function parseCall(name, at, inLink) {
    if (name === "richtext") return new RichText(parseArgs(name, at, parseRichItem));
    if (name === "text" || name === "block") fail(`${name}() only goes inside richtext()`, at);
    if (name === "link") return parseLink(at);
    if (name === "cursor" && !inLink) fail("cursor() only goes inside link()", at);
    const args = parseArgs(name, at);
    const one = (pred, what) => {
      if (args.length !== 1 || !pred(args[0])) fail(`${name}() takes ${what}`, at);
      return args[0];
    };
    switch (name) {
      case "counter":
        return new Counter(one(Number.isInteger, "one integer"));
      case "string":
        return new ImmutableString(one(a => typeof a === "string", "one string"));
      case "bytes":
        if (!args.every(a => Number.isInteger(a) && a >= 0 && a <= 255)) fail("bytes() takes integers 0-255", at);
        return new Uint8Array(args);
      case "bytes64": {
        const s = one(a => typeof a === "string", "one base64 string");
        try { return b64decode(s); } catch { return fail("bad base64 in bytes64()", at); }
      }
      case "date": {
        const d = new Date(one(a => typeof a === "string" || typeof a === "number", "an ISO string or ms number"));
        if (Number.isNaN(d.getTime())) fail("invalid date", at);
        return d;
      }
      case "cursor": {
        const position = a => Number.isInteger(a) && a >= 0;
        if (args.length < 1 || args.length > 2 || !args.every(position)) fail("cursor() takes one or two text positions", at);
        return new Cursor(...args);
      }
      default:
        return fail(`unknown function ${name}()`, at);
    }
  }

  function parseMap() {
    const start = i;
    i++; // {
    const obj = {};
    for (;;) {
      skip();
      if (src[i] === "}") { i++; return obj; }
      if (i >= src.length) fail("unclosed {", start);
      const keyAt = i;
      let key;
      if (src[i] === '"') key = parseJsonString();
      else if (IDENT_START.test(src[i])) key = readIdent();
      else fail("expected a key");
      if (Object.hasOwn(obj, key)) fail(`duplicate key ${JSON.stringify(key)}`, keyAt);
      skip();
      if (src[i] === "=" || src[i] === ":") i++;
      setKey(obj, key, parseValue());
    }
  }

  function parseList() {
    const start = i;
    i++; // [
    const arr = [];
    for (;;) {
      skip();
      if (src[i] === "]") { i++; return arr; }
      if (i >= src.length) fail("unclosed [", start);
      arr.push(parseValue());
    }
  }

  function parseValue(inLink = false) {
    skip();
    const c = src[i];
    if (c === undefined) fail("unexpected end of input");
    if (c === "{") return parseMap();
    if (c === "[") return parseList();
    if (c === '"') return parseJsonString();
    if (c === "`") return parseFence();
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    if (IDENT_START.test(c)) {
      const at = i;
      const word = readIdent();
      if (word === "true") return true;
      if (word === "false") return false;
      if (word === "null") return null;
      if (src[i] === "(") return parseCall(word, at, inLink);
      fail(`unexpected word "${word}"`, at);
    }
    fail(`unexpected character ${JSON.stringify(c)}`);
  }

  skip();
  if (src[i] !== "{") fail("document must be a { map }");
  const doc = parseMap();
  skip();
  if (i < src.length) fail("unexpected content after the document");
  return doc;
}

/**
 * opts:
 *   asCounter(v)          -> number | undefined     (recognise a foreign Counter, e.g. Automerge's)
 *   asImmutableString(v)  -> string | undefined
 *   asLink(str, path)     -> link path | Link | undefined  (turn a string into link(...)); path = key path
 *   asRichText(str, path) -> spans | undefined      (write a text string as richtext(...))
 *   indent                -> default "  "
 */
export function stringify(doc, opts = {}) {
  const { asCounter, asImmutableString, asLink, asRichText, indent = "  " } = opts;
  const pad = d => indent.repeat(d);
  const WIDTH = 72;

  const str = s => {
    if (s.includes("\n") && !s.includes("\r") && s[0] !== "`" && s[s.length - 1] !== "`") {
      let longest = 0;
      for (const m of s.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
      const fence = "`".repeat(longest + 1);
      return fence + s + fence;
    }
    return JSON.stringify(s);
  };

  const key = k => (BARE_KEY.test(k) ? k : JSON.stringify(k));

  function writeLink(link, depth) {
    const segments = link.segments.map(seg => {
      if (seg instanceof Cursor) return seg.from === seg.to ? `cursor(${seg.from})` : `cursor(${seg.from}, ${seg.to})`;
      if (typeof seg === "string") return JSON.stringify(seg);
      return write(seg, depth + 1, [], { inline: true, plain: true });
    });
    return `link(${[JSON.stringify(link.path), ...segments].join(", ")})`;
  }

  function writeRich(spans, depth, path) {
    if (!spans.length) return "richtext()";
    const inner = { inline: true, inRich: true };
    const items = spans.map((s, n) => {
      const p = [...path, "#richtext", n];
      if (s.type === "block") return `block(${write(s.value ?? {}, depth + 1, p, inner)})`;
      const marks = s.marks && Object.keys(s.marks).length ? s.marks : undefined;
      return marks ? `text(${str(s.value)}, ${write(marks, depth + 1, [...p, "marks"], inner)})` : str(s.value);
    });
    return `richtext(\n${items.map(x => pad(depth + 1) + x).join("\n")}\n${pad(depth)})`;
  }

  function write(v, depth, path, mode = {}) {
    if (v === null) return "null";
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new TypeError(`amtext can't store ${v} (at ${path.join(".")})`);
      return Object.is(v, -0) ? "0" : String(v);
    }
    if (typeof v === "string") {
      if (mode.plain) return str(v);
      const l = asLink?.(v, path);
      if (l instanceof Link) return writeLink(l, depth);
      if (l !== undefined) return `link(${JSON.stringify(l)})`;
      if (!mode.inRich) {
        const spans = asRichText?.(v, path);
        if (spans) return writeRich(spans, depth, path);
      }
      return str(v);
    }
    const c = v instanceof Counter ? v.value : asCounter?.(v);
    if (c !== undefined) return `counter(${c})`;
    const im = v instanceof ImmutableString ? v.value : asImmutableString?.(v);
    if (im !== undefined) return `string(${str(im)})`;
    if (v instanceof Link) return writeLink(v, depth);
    if (v instanceof RichText) return writeRich(v.spans, depth, path);
    if (v instanceof Uint8Array) {
      return v.length <= 64 ? `bytes(${Array.from(v).join(", ")})` : `bytes64(${JSON.stringify(b64encode(v))})`;
    }
    if (v instanceof Date) {
      if (Number.isNaN(v.getTime())) throw new TypeError(`invalid date at ${path.join(".")}`);
      return `date(${JSON.stringify(v.toISOString())})`;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      const items = v.map((x, n) => write(x, depth + 1, [...path, n], mode));
      const inline = `[ ${items.join(", ")} ]`;
      if (!items.some(x => x.includes("\n")) && inline.length <= WIDTH) return inline;
      return `[\n${items.map(x => pad(depth + 1) + x).join("\n")}\n${pad(depth)}]`;
    }
    if (typeof v === "object") {
      const keys = Object.keys(v).filter(k => v[k] !== undefined);
      if (keys.length === 0) return "{}";
      const entries = keys.map(k => `${key(k)} ${write(v[k], depth + 1, [...path, k], mode)}`);
      if (mode.inline) {
        const inline = `{ ${entries.join(", ")} }`;
        if (!entries.some(x => x.includes("\n")) && inline.length <= WIDTH) return inline;
      }
      return `{\n${entries.map(x => pad(depth + 1) + x).join("\n")}\n${pad(depth)}}`;
    }
    throw new TypeError(`amtext can't store ${typeof v} (at ${path.join(".")})`);
  }

  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new TypeError("amtext document must be a map");
  }
  return write(doc, 0, []) + "\n";
}
