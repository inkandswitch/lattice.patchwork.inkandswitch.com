/**
 * .patchworkfolder: a zip of .amtext files.
 *
 *   root.amtext          the doc you exported
 *   <uuid>.amtext        every doc reachable from it
 *
 * Docs reach each other with link("./<uuid>.amtext"). On export, any string
 * value that is exactly an automerge URL (optionally with #heads) of a doc in
 * the archive becomes a link(). So does the URL of a part of one (as made by
 * automerge-repo's handle.sub(), like a comment thread's refs), keeping its
 * path: link("./<uuid>.amtext", "content", cursor(3, 8)). Its cursors are op
 * ids, which a fresh doc won't have, so they're written as text positions and
 * made into cursors again on import. Heads are dropped, there being no
 * history to point into. On import, links resolve to the new docs' URLs.
 *
 * Not followed or rewritten: top-level @patchwork, whose mainDraftUrl (the
 * doc's own draft history) is left out altogether, and contactUrl, which says
 * who someone is, so stays pointing at them rather than a copy of them.
 *
 * Text with marks or block markers is written as richtext(...) from
 * Automerge.spans() and restored with Automerge.updateSpans(). Mark expand
 * settings aren't readable from a doc, so imported marks get updateSpans'
 * default ("both") unless you pass { defaultExpand, perMarkExpand }.
 *
 * No history is kept: import makes fresh docs.
 */

import { parse, stringify, Counter, Cursor, ImmutableString, Link, RichText } from "./amtext.js";

export const EXT = ".patchworkfolder";
export const ROOT = "root.amtext";

// ---------------------------------------------------------------- urls

// automerge:<doc id>[/<path>][#<heads>]. The path is automerge-repo's: keys
// (url-encoded, escaped with a leading \ if they start with one of \ @ { [),
// @<list index>, url-encoded {json} matching a list item, and lastly
// [<cursor>] or [<from cursor>-<to cursor>] for a range of text.
const URL_RE = /^automerge:([1-9A-HJ-NP-Za-km-z]+)((?:\/[^#\s]*)?)(?:#\S*)?$/;

/** { doc: "automerge:<id>", path: segments as in Link, cursors?: [from, to] }, or undefined */
function parseUrl(s) {
  const m = URL_RE.exec(s);
  if (!m) return undefined;
  const parts = m[2].split("/").filter(Boolean);
  const last = parts.at(-1);
  let cursors;
  if (last?.startsWith("[") && last.endsWith("]")) {
    parts.pop();
    const inner = last.slice(1, -1);
    const sep = inner.indexOf("-");
    cursors = sep < 0 ? [inner, inner] : [inner.slice(0, sep), inner.slice(sep + 1)];
    if (!cursors[0] || !cursors[1]) return undefined;
  }
  try {
    return { doc: `automerge:${m[1]}`, path: parts.map(parseSegment), cursors };
  } catch {
    return undefined;
  }
}

function parseSegment(s) {
  const index = /^@(\d+)$/.exec(s);
  if (index) return Number(index[1]);
  if (s.startsWith("{") || s.startsWith("%7B")) {
    const match = JSON.parse(decodeURIComponent(s));
    if (!isPlain(match)) throw new Error(`bad match ${s}`);
    return match;
  }
  if (s.startsWith("[")) throw new Error(`cursors before the end of ${s}`);
  if (s.startsWith("%5C")) return decodeURIComponent(s.slice(3));
  if (s.startsWith("\\")) return decodeURIComponent(s.slice(1));
  return decodeURIComponent(s);
}

function serializeSegment(seg) {
  if (typeof seg === "number") return `@${seg}`;
  if (typeof seg === "string") {
    if (seg === "") throw new Error("a url path can't have an empty key");
    return (/^[\\@{[]/.test(seg) ? "%5C" : "") + encodeURIComponent(seg);
  }
  const sorted = Object.fromEntries(Object.keys(seg).sort().map(k => [k, seg[k]]));
  return encodeURIComponent(JSON.stringify(sorted));
}

const isPlain = v => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

/** the keys and list indexes that `path` (which may hold { match } maps) goes through in `doc` */
function propPath(doc, path) {
  const props = [];
  let v = doc;
  for (const seg of path) {
    if (v === null || typeof v !== "object") return undefined;
    let prop = seg;
    if (isPlain(seg)) {
      if (!Array.isArray(v)) return undefined;
      prop = v.findIndex(item => item && Object.entries(seg).every(([k, x]) => item[k] === x));
      if (prop < 0) return undefined;
    }
    props.push(prop);
    v = v[prop];
  }
  return props;
}

// keys whose url says who someone is (a comment's author): it stays as it is,
// and the doc isn't brought into the archive
const IDENTITY_KEYS = new Set(["contactUrl"]);

// @patchwork keys about the doc itself rather than what's in it, which a copy
// shouldn't have: mainDraftUrl is the doc's draft history
const OWN_PATCHWORK_KEYS = new Set(["mainDraftUrl"]);

function withoutOwnPatchworkKeys(doc) {
  const pw = doc["@patchwork"];
  if (!pw || typeof pw !== "object" || !Object.keys(pw).some(k => OWN_PATCHWORK_KEYS.has(k))) return doc;
  const kept = {};
  for (const k of Object.keys(pw)) if (!OWN_PATCHWORK_KEYS.has(k)) kept[k] = pw[k];
  const out = {};
  for (const k of Object.keys(doc)) out[k] = k === "@patchwork" ? kept : doc[k];
  return out;
}

// ---------------------------------------------------------------- zip

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** files: [{ name, data: Uint8Array }] -> Uint8Array */
export async function zip(files) {
  if (files.length > 0xffff) throw new Error("too many files for a zip without zip64");
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    let method = 8;
    let body = await pipe(data, new CompressionStream("deflate-raw"));
    if (body.length >= data.length) { method = 0; body = data; }
    if (offset + body.length > 0xffffffff) throw new Error("archive too large for a zip without zip64");

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // utf-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x0314, true); // made by: unix, 2.0
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(38, 0o100644 << 16, true); // -rw-r--r--
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);

    parts.push(local, body);
    central.push(cen);
    offset += local.length + body.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

/** Uint8Array -> Map<name, Uint8Array>. Handles stored + deflate, no zip64, no encryption. */
export async function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error("zip64 archives are not supported");

  const utf8 = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error(`${name}: encrypted zip entries are not supported`);
    const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    const raw = bytes.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await pipe(raw, new DecompressionStream("deflate-raw"));
    else throw new Error(`${name}: unsupported zip compression method ${method}`);
    if (crc32(data) !== crc) throw new Error(`${name}: crc mismatch`);
    out.set(name, data);
  }
  return out;
}

// ---------------------------------------------------------------- paths

function resolvePath(fromFile, rel) {
  const parts = rel.startsWith("/") ? [] : fromFile.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

// ---------------------------------------------------------------- patchwork

/**
 * env (all optional, read at call time):
 *   repo       default window.repo
 *   hive       default window.hive
 *   Automerge  default window.Automerge
 *   plugins    default window.patchwork.plugins (needs getRegistry, createDocOfDatatype2)
 *   spanConfig passed to Automerge.updateSpans on import, e.g. { defaultExpand: "after" }
 *   extension  what an exported archive's name ends with, default .patchworkfolder.
 *              it's the same zip whatever it's called: import takes any name
 */
export function patchworkFolder(env = {}) {
  const ctx = () => {
    const g = globalThis;
    const c = {
      repo: env.repo ?? g.repo,
      hive: env.hive ?? g.hive,
      Automerge: env.Automerge ?? g.Automerge,
      plugins: env.plugins ?? g.patchwork?.plugins,
    };
    if (!c.repo) throw new Error("no repo (window.repo is unset)");
    if (!c.Automerge) throw new Error("no Automerge (window.Automerge is unset)");
    return c;
  };

  const detectors = A => ({
    asCounter: v => (A.Counter && v instanceof A.Counter ? v.value : undefined),
    asImmutableString: v => (A.ImmutableString && v instanceof A.ImmutableString ? v.val : undefined),
  });

  async function readDoc(repo, url) {
    const h = await repo.find(url);
    const doc = await h.doc();
    if (!doc) throw new Error(`${url} has no content`);
    return doc;
  }

  /** spans for a text string at path, or undefined if it has no marks and no blocks */
  function richSpans(A, doc, path) {
    if (!A.spans) return undefined;
    let spans;
    try { spans = A.spans(doc, path); } catch { return undefined; }
    return spans.some(s => s.type === "block" || (s.marks && Object.keys(s.marks).length)) ? spans : undefined;
  }

  // visits every plain string value (and strings inside rich text marks/blocks)
  // outside top-level @patchwork and identity keys, calling f with the doc of
  // each url
  function eachUrl(doc, A, f) {
    const visit = (v, path, inRich, key) => {
      if (typeof v === "string") {
        if (IDENTITY_KEYS.has(key)) return;
        const url = parseUrl(v);
        if (url) f(url.doc);
        else if (!inRich) {
          const spans = richSpans(A, doc, path);
          if (spans) for (const s of spans) visit(s.type === "block" ? s.value : s.marks ?? {}, [], true);
        }
        return;
      }
      if (v === null || typeof v !== "object") return;
      if (v instanceof Uint8Array || v instanceof Date) return;
      if (A.Counter && v instanceof A.Counter) return;
      if (A.ImmutableString && v instanceof A.ImmutableString) return;
      for (const k of Object.keys(v)) {
        if (!inRich && path.length === 0 && k === "@patchwork") continue;
        visit(v[k], inRich ? [] : [...path, Array.isArray(v) ? Number(k) : k], inRich, k);
      }
    };
    visit(doc, [], false);
  }

  async function collect(rootUrl) {
    const { repo, Automerge: A } = ctx();
    const root = parseUrl(rootUrl)?.doc;
    if (!root) throw new Error(`not an automerge url: ${rootUrl}`);
    const docs = new Map();
    const failed = new Set();
    const queue = [root];
    while (queue.length) {
      const url = queue.shift();
      if (docs.has(url) || failed.has(url)) continue;
      try {
        const doc = await readDoc(repo, url);
        docs.set(url, doc);
        eachUrl(doc, A, u => queue.push(u));
      } catch (e) {
        if (url === root) throw e;
        console.warn("patchworkFolder: could not load", url, e);
        failed.add(url);
      }
    }
    return { root, docs, failed: [...failed] };
  }

  async function exportFolder(rootUrl) {
    const { Automerge: A } = ctx();
    const { root, docs, failed } = await collect(rootUrl);
    const names = new Map();
    for (const url of docs.keys()) names.set(url, url === root ? ROOT : `${crypto.randomUUID()}.amtext`);
    const enc = new TextEncoder();
    const files = [];
    // the link for the url `s`, if it's of a doc in the archive
    const asLink = (s, path) => {
      if (path[0] === "@patchwork" || IDENTITY_KEYS.has(path.at(-1))) return undefined;
      const url = parseUrl(s);
      if (!url || !names.has(url.doc)) return undefined;
      const file = `./${names.get(url.doc)}`;
      if (!url.cursors) return url.path.length ? new Link(file, url.path) : file;
      // cursors become positions in the text they're in
      const target = docs.get(url.doc);
      const props = propPath(target, url.path);
      let from, to;
      try {
        from = props && A.getCursorPosition(target, props, url.cursors[0]);
        to = props && A.getCursorPosition(target, props, url.cursors[1]);
      } catch {}
      if (!Number.isInteger(from) || !Number.isInteger(to)) {
        console.warn("patchworkFolder: no text for the cursors in", s, "so it's kept as it is");
        return undefined;
      }
      return new Link(file, [...url.path, new Cursor(from, to)]);
    };
    for (const [url, doc] of docs) {
      const text = stringify(withoutOwnPatchworkKeys(doc), {
        ...detectors(A),
        asLink,
        asRichText: (_s, path) => richSpans(A, doc, path),
      });
      files.push({ name: names.get(url), data: enc.encode(text) });
    }
    const bytes = await zip(files);
    const title = docs.get(root).title;
    const base =
      (typeof title === "string" && title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-").trim().slice(0, 80)) ||
      root.slice("automerge:".length);
    return { bytes, filename: base + (env.extension ?? EXT), count: docs.size, failed };
  }

  async function downloadFolder(rootUrl) {
    const { bytes, filename, count, failed } = await exportFolder(rootUrl);
    const href = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return { filename, count, failed };
  }

  async function createFor(value) {
    const { repo, hive, plugins } = ctx();
    const pw = value["@patchwork"];
    const typeId = pw && typeof pw.type === "string" ? pw.type : undefined;
    let datatype;
    if (typeId && plugins?.getRegistry) {
      try { datatype = await plugins.getRegistry("patchwork:datatype").load(typeId); }
      catch (e) { console.warn(`patchworkFolder: loading datatype "${typeId}" failed`, e); }
    }
    if (datatype && plugins.createDocOfDatatype2) {
      return { handle: await plugins.createDocOfDatatype2(datatype, repo, undefined, hive), typed: true };
    }
    if (typeId) console.warn(`patchworkFolder: no datatype "${typeId}"; creating a plain doc and copying @patchwork`);
    const handle = repo.create2 ? await repo.create2() : repo.create();
    if (hive && plugins?.isKeyhiveDoc?.(handle.url)) await hive.addSyncServerRelayToDoc(handle.url);
    return { handle, typed: false };
  }

  // resolveLink(link, inRich) -> url string, or a CursorLink for one whose
  // cursors can only be made once the doc it's into has been filled
  function materialize(v, A, resolveLink, inRich = false) {
    if (v instanceof Link) return resolveLink(v, inRich);
    if (v instanceof RichText) {
      return new RichText(v.spans.map(s => (s.type === "block"
        ? { type: "block", value: materialize(s.value, A, resolveLink, true) }
        : s.marks ? { type: "text", value: s.value, marks: materialize(s.marks, A, resolveLink, true) }
        : { type: "text", value: s.value })));
    }
    if (v instanceof Counter) return new A.Counter(v.value);
    if (v instanceof ImmutableString) return new A.ImmutableString(v.value);
    if (v instanceof Uint8Array) return new Uint8Array(v);
    if (v instanceof Date) return new Date(v.getTime());
    if (Array.isArray(v)) return v.map(x => materialize(x, A, resolveLink, inRich));
    if (v !== null && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) {
        Object.defineProperty(o, k, {
          value: materialize(v[k], A, resolveLink, inRich), enumerable: true, writable: true, configurable: true,
        });
      }
      return o;
    }
    return v;
  }

  // a url whose cursors are made from positions once `file`'s doc is filled
  class CursorLink {
    constructor(file, url, path, cursor) { Object.assign(this, { file, url, path, cursor }); }
  }

  // replaces values that are `is` with `placeholder`, pushing [path, value]
  // pairs to put in after assignment onto `out`
  function extract(v, is, placeholder, out, path = []) {
    if (is(v)) { out.push([path, v]); return placeholder; }
    if (Array.isArray(v)) return v.map((x, n) => extract(x, is, placeholder, out, [...path, n]));
    if (isPlain(v)) {
      for (const k of Object.keys(v)) v[k] = extract(v[k], is, placeholder, out, [...path, k]);
    }
    return v;
  }

  /** fills the doc, returning the [path, CursorLink] pairs left to set */
  function fill(handle, content, typed, A) {
    const skip = k => typed && k === "@patchwork";
    const rich = [];
    const cursorLinks = [];
    content = extract(content, v => v instanceof CursorLink, null, cursorLinks);
    content = extract(content, v => v instanceof RichText, "", rich);
    if (rich.length && !A.updateSpans) throw new Error("this Automerge has no updateSpans; can't import richtext()");
    handle.change(d => {
      for (const k of Object.keys(d)) if (!skip(k) && !Object.hasOwn(content, k)) delete d[k];
      for (const k of Object.keys(content)) if (!skip(k)) d[k] = content[k];
      for (const [path, { spans }] of rich) {
        if (!skip(path[0])) A.updateSpans(d, path, spans, spanConfig);
      }
    });
    return cursorLinks.filter(([path]) => !skip(path[0]));
  }

  /** the url of `link`'s range of text, in the (filled) doc `target` */
  function cursorUrl(A, target, link) {
    const props = propPath(target, link.path);
    let from, to;
    try {
      from = props && A.getCursor(target, props, link.cursor.from);
      to = props && A.getCursor(target, props, link.cursor.to);
    } catch {}
    if (!from || !to) {
      console.warn("patchworkFolder: no text at", link.url, "for its cursors, so they're left off");
      return link.url;
    }
    return `${link.url}/[${from === to ? from : `${from}-${to}`}]`;
  }

  function setAt(doc, path, value) {
    let v = doc;
    for (const k of path.slice(0, -1)) v = v[k];
    v[path.at(-1)] = value;
  }
  const spanConfig = env.spanConfig; // { defaultExpand, perMarkExpand } passed through to updateSpans

  function eachLink(v, f) {
    if (v instanceof Link) return f(v);
    if (Array.isArray(v)) return v.forEach(x => eachLink(x, f));
    if (v !== null && typeof v === "object" && !(v instanceof Uint8Array) && !(v instanceof Date)
      && !(v instanceof Counter) && !(v instanceof ImmutableString)) {
      for (const k of Object.keys(v)) eachLink(v[k], f);
    }
  }

  /** input: File | Blob | ArrayBuffer | Uint8Array. returns { root, urls: Map<path, url> } */
  async function importFolder(input) {
    const { Automerge: A } = ctx();
    const bytes =
      input instanceof Uint8Array ? input
      : input instanceof ArrayBuffer ? new Uint8Array(input)
      : new Uint8Array(await input.arrayBuffer());
    const entries = await unzip(bytes);

    const paths = [...entries.keys()].filter(p => {
      const base = p.split("/").pop();
      return base.endsWith(".amtext") && !base.startsWith("._") && !p.startsWith("__MACOSX/");
    });
    if (!paths.length) throw new Error("no .amtext files in archive");
    // tolerate everything being inside one top-level directory
    const tops = new Set(paths.map(p => (p.includes("/") ? p.split("/")[0] : "")));
    const prefix = tops.size === 1 && !tops.has("") ? `${[...tops][0]}/` : "";

    const utf8 = new TextDecoder("utf-8", { fatal: true });
    const files = new Map();
    for (const p of paths) {
      const rel = p.slice(prefix.length);
      try { files.set(rel, parse(utf8.decode(entries.get(p)))); }
      catch (e) { e.message = `${rel}: ${e.message}`; throw e; }
    }

    const rootPath = files.has(ROOT) ? ROOT : files.size === 1 ? [...files.keys()][0] : undefined;
    if (!rootPath) throw new Error(`archive has several docs and no ${ROOT}`);

    for (const [p, v] of files) {
      eachLink(v, l => {
        if (!files.has(resolvePath(p, l.path))) throw new Error(`${p}: link(${JSON.stringify(l.path)}) is not in the archive`);
      });
    }

    const urls = new Map();
    const created = new Map();
    for (const [p, v] of files) {
      const c = await createFor(v);
      created.set(p, c);
      urls.set(p, c.handle.url);
    }
    const linkUrl = (p, link, inRich) => {
      const file = resolvePath(p, link.path);
      const last = link.segments.at(-1);
      const cursor = last instanceof Cursor ? last : undefined;
      const path = cursor ? link.segments.slice(0, -1) : link.segments;
      const url = [urls.get(file), ...path.map(serializeSegment)].join("/");
      if (!cursor) return url;
      if (inRich) {
        console.warn(`patchworkFolder: ${p}: cursors in rich text aren't supported, so they're left off`, url);
        return url;
      }
      return new CursorLink(file, url, path, cursor);
    };
    const toSet = [];
    for (const [p, v] of files) {
      const content = materialize(v, A, (link, inRich) => linkUrl(p, link, inRich));
      const { handle, typed } = created.get(p);
      for (const [path, link] of fill(handle, content, typed, A)) toSet.push([handle, path, link]);
    }
    // every doc has its text now, so cursors can be made in it
    for (const [handle, path, link] of toSet) {
      const url = cursorUrl(A, created.get(link.file).handle.doc(), link);
      handle.change(d => setAt(d, path, url));
    }
    return { root: urls.get(rootPath), urls };
  }

  function pickAndImport() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = [...new Set([env.extension ?? EXT, EXT, ".zip", ".amtext"])].join(",");
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return reject(new Error("no file chosen"));
        (f.name.endsWith(".amtext") ? f.text().then(importDocText).then(root => ({ root })) : importFolder(f))
          .then(resolve, reject);
      };
      input.click();
    });
  }

  /** resolves with the import result for the next file dropped anywhere on the page */
  function dropToImport() {
    return new Promise((resolve, reject) => {
      const over = e => e.preventDefault();
      const drop = e => {
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener("dragover", over, true);
        window.removeEventListener("drop", drop, true);
        const f = e.dataTransfer?.files?.[0];
        if (!f) return reject(new Error("no file dropped"));
        (f.name.endsWith(".amtext") ? f.text().then(importDocText).then(root => ({ root })) : importFolder(f))
          .then(resolve, reject);
      };
      window.addEventListener("dragover", over, true);
      window.addEventListener("drop", drop, true);
      console.log("patchworkFolder: drop a file on the page");
    });
  }

  /** one doc as amtext; urls stay as plain strings */
  async function exportDocText(url) {
    const { repo, Automerge: A } = ctx();
    const doc = await readDoc(repo, url);
    return stringify(withoutOwnPatchworkKeys(doc), { ...detectors(A), asRichText: (_s, path) => richSpans(A, doc, path) });
  }

  /** one amtext doc -> new doc url. link() is not allowed here. */
  async function importDocText(text) {
    const { Automerge: A } = ctx();
    const v = parse(text);
    eachLink(v, l => { throw new Error(`link(${JSON.stringify(l.path)}) needs a ${EXT} archive`); });
    const { handle, typed } = await createFor(v);
    fill(handle, materialize(v, A, () => undefined), typed, A);
    return handle.url;
  }

  return { exportFolder, downloadFolder, importFolder, pickAndImport, dropToImport, exportDocText, importDocText };
}
