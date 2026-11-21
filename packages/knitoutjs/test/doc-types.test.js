import { test } from "node:test";
import assert from "node:assert/strict";
import { docDeclarations, GLOBALS, typeOf } from "../core/doc-types.js";

const ID = "2Qf9bTzK3xJvPq7YwHnE5RcLmA8d";
const A = `automerge:${ID}`;

test("a doc's value has a typescript type, with its keys quoted", () => {
  assert.equal(
    typeOf({ width: 20, name: "x", rows: [{ n: 1 }], at: new Date(0) }),
    `{ "width": number; "name": string; "rows": { "n": number; }[]; "at": Date; }`,
  );
});

test("plain values have their own types", () => {
  assert.equal(typeOf("x"), "string");
  assert.equal(typeOf(1.5), "number");
  assert.equal(typeOf(false), "boolean");
  assert.equal(typeOf(null), "null");
  assert.equal(typeOf(new Uint8Array(2)), "Uint8Array");
  assert.equal(typeOf(new Date(0)), "Date");
  assert.equal(typeOf(undefined), "unknown");
});

test("a list is the type of its first element, and an empty one is unknown[]", () => {
  assert.equal(typeOf([1, "two"]), "number[]");
  assert.equal(typeOf([]), "unknown[]");
  assert.equal(typeOf([[true]]), "boolean[][]");
});

test("an empty map is {}", () => {
  assert.equal(typeOf({}), "{}");
});

test("past the depth it's unknown", () => {
  assert.equal(typeOf({ a: { b: { c: 1 } } }, 2), `{ "a": { "b": unknown; }; }`);
  assert.equal(typeOf([[1]], 1), "unknown[]");
  assert.equal(typeOf({ a: 1 }, 0), "unknown");
});

test("a key that isn't an identifier is quoted as json", () => {
  assert.equal(typeOf({ "a b": 1, 'q"': 2 }), `{ "a b": number; "q\\"": number; }`);
});

test("a doc's declarations type doc() of its url, with or without a slash", () => {
  const text = docDeclarations(A, { width: 20 });
  const global = text.slice(text.indexOf("declare global {"));
  assert.match(global, new RegExp(`function doc\\(url: "${A}"\\): \\{ "width": number; \\};`));
  assert.match(global, new RegExp(`function doc\\(url: "/${A}"\\): \\{ "width": number; \\};`));
});

// it's the module an import of the doc finds, with or without a slash: the
// language server's paths send both to /<id>/index.js, which is
// /<id>/index.d.ts when there's one of those (a `declare module "/automerge:…"`
// would never be found: a name starting with / is a path, not a module name)
test("a doc's declarations are a module, its value the default and its fields named", () => {
  const text = docDeclarations(A, { width: 20, name: "x" });
  assert.match(text, /^declare const _default: \{ "width": number; "name": string; \};$/m);
  assert.match(text, /^export default _default;$/m);
  assert.match(text, /^export declare const width: number;$/m);
  assert.match(text, /^export declare const name: string;$/m);
  assert.doesNotMatch(text, /declare module/);
});

test("a doc's declarations use its id, whatever its url says", () => {
  const text = docDeclarations(`/${A}#abc|def`, { n: 1 });
  assert.match(text, new RegExp(`function doc\\(url: "${A}"\\)`));
  assert.match(text, new RegExp(`function doc\\(url: "/${A}"\\)`));
  assert.doesNotMatch(text, /#abc/);
});

test("a key that isn't an identifier isn't a named export", () => {
  const text = docDeclarations(A, { "a b": 1, class: 2, ok: 3 });
  assert.match(text, /"a b": number;/);
  assert.doesNotMatch(text, /const a b/);
  assert.doesNotMatch(text, /const class/);
  assert.match(text, /export declare const ok: number;/);
});

test("a doc with a field called what the default is called still has both", () => {
  const text = docDeclarations(A, { _default: 1 });
  const [, name] = /export default ([\w$]+);/.exec(text);
  assert.notEqual(name, "_default");
  assert.match(text, new RegExp(`declare const ${name.replace(/\$/g, "\\$")}: \\{ "_default": number; \\};`));
  assert.match(text, /export declare const _default: number;/);
});

test("the globals have doc() and repo", () => {
  assert.match(GLOBALS, /declare function doc\(url: string\): any;/);
  assert.match(GLOBALS, /declare const repo: any;/);
});

test("the knitout module declares a Writer class with typed members", () => {
  assert.match(GLOBALS, /declare module "knitout" \{/);
  assert.match(GLOBALS, /class Writer\b/);
  for (const member of ["knit(", "tuck(", "split(", "miss(", "drop(", "amiss(", "xfer(", "rack(", "inhook(", "releasehook(", "outhook(", "stitch(", "write("]) {
    assert.ok(GLOBALS.includes(member), `${member} is declared`);
  }
  assert.match(GLOBALS, /carriers:/);
  assert.match(GLOBALS, /racking: number/);
  assert.match(GLOBALS, /export default knitout;/);
  assert.match(GLOBALS, /declare function require\(name: "knitout"\): typeof import\("knitout"\);/);
});

test("the knitout module's types aren't any any", () => {
  assert.doesNotMatch(GLOBALS, /Writer: any/);
  assert.doesNotMatch(GLOBALS, /const knitout: any/);
});
