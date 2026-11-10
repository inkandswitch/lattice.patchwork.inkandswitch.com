// wm/doc imports nothing but itself, so a datatype can use it in a worker
// (which has no import map)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../doc/", import.meta.url);
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

test("nothing in wm/doc imports a package", () => {
  const files = readdirSync(dir).filter((name) => name.endsWith(".js"));
  assert.ok(files.length);
  for (const name of files) {
    const text = readFileSync(new URL(name, dir), "utf8");
    for (const [, specifier] of text.matchAll(SPECIFIER)) {
      assert.ok(specifier.startsWith("./"), `${name} imports ${specifier}`);
    }
  }
});
