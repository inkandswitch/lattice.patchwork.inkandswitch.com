// what the language server is told about the docs a pattern uses, so hovering
// `doc("automerge:…").width` (lattice's doc, imported) says `number`, and an import of a doc completes
// its fields. each doc that isn't code gets a .d.ts of its own, beside where
// its code would be (written by ./language-server.js); a .js doc is given to
// the server as itself. nothing
// here touches a handle, so it can be tested in node
import { docIdOf } from "./sources.js";
import { KNITOUT_TYPES } from "./knitout-types.js";
import { LATTICE_ALIASES } from "./instrument.js";

// a doc's value (made plain, as graph.js's plainValue does) as a typescript
// type. a list is the type of its first element; a map's keys are quoted.
// past `depth` it's just unknown
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
export function typeOf(value, depth = 4) {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value instanceof Uint8Array) return "Uint8Array";
  if (value instanceof Date) return "Date";
  if (Array.isArray(value)) {
    if (depth <= 0) return "unknown";
    if (!value.length) return "unknown[]";
    return `${typeOf(value[0], depth - 1)}[]`;
  }
  if (typeof value === "object") {
    if (depth <= 0) return "unknown";
    const fields = Object.entries(value).filter(([, field]) => field !== undefined);
    if (!fields.length) return "{}";
    // a key that isn't a name ("@patchwork", say) is only said to be there.
    // named, it'd be completed from the dot as `["@patchwork"]`, and the
    // editor filters all the completions by what's after where that starts,
    // so it'd be the only one offered. (as knitfold's given.ts has it)
    const named = fields.filter(([key]) => IDENTIFIER.test(key));
    const others = named.length < fields.length ? "[key: string]: unknown; " : "";
    return `{ ${others}${named.map(([key, field]) => `${JSON.stringify(key)}: ${typeOf(field, depth - 1)}; `).join("")}}`;
  }
  return "unknown";
}

// words that can't be a `const`'s name in a module
const RESERVED = new Set(
  ("break case catch class const continue debugger default delete do else enum export extends false finally for " +
    "function if import in instanceof new null return super switch this throw true try typeof var void while with " +
    "yield let static implements interface package private protected public await arguments eval").split(" "),
);
const isName = (key) => /^[A-Za-z_$][\w$]*$/.test(key) && !RESERVED.has(key);

// a doc's own .d.ts, for /<id>/index.d.ts: it's the module an import of the
// doc finds (the language server's paths send `automerge:<id>` and
// `/automerge:<id>` both to /<id>/index.js, which is this when there's no .js
// there), its value the default and its fields that can be names named too.
// and `doc("automerge:<id>")`, with or without the `/`, is its value: the
// url's put in LatticeDocs, which lattice's doc() looks a url up in (GLOBALS)
// (a `declare module "/automerge:…"` would never be found: a name starting
// with / is a path to typescript, not a module's name)
export function docDeclarations(url, value) {
  const id = docIdOf(url);
  const type = typeOf(value);
  const isMap = value && typeof value === "object" && !Array.isArray(value) &&
    !(value instanceof Uint8Array) && !(value instanceof Date);
  const fields = isMap ? Object.entries(value).filter(([key, field]) => field !== undefined && isName(key)) : [];
  // the default needs a name of its own, which no field has
  let name = "_default";
  while (fields.some(([key]) => key === name)) name = "_" + name;
  return [
    `declare const ${name}: ${type};`,
    `export default ${name};`,
    ...fields.map(([key, field]) => `export declare const ${key}: ${typeOf(field, 3)};`),
    "declare global {",
    "  interface LatticeDocs {",
    ...["", "/"].map((slash) => `    ${JSON.stringify(`${slash}automerge:${id}`)}: ${type};`),
    "  }",
    "}",
    "",
  ].join("\n");
}

// lattice's own, as `import {doc, get} from "lattice"` has them (get.js), and
// the kniterate helpers (kniterate.js). its aliases are the same module
const LATTICE_TYPES = `/** every doc a pattern's editor knows of: its url, and what's in it (each
 * doc's own .d.ts adds itself) */
interface LatticeDocs {}

declare module "lattice" {
  /** an automerge doc's value, by its url (\`automerge:…\`, or \`automerge:…#heads\`
   * for it as it was then). no await: the pattern's run again once it's got.
   * it's read-only, and the build says it was made from it */
  export function doc<Url extends keyof LatticeDocs>(url: Url): LatticeDocs[Url];
  export function doc(url: string): any;

  /** what's at a url (from the page's address, if it's relative). as: "bytes"
   * (a Uint8Array), "text", "json", or "clever" (the default: what its type
   * says it is. json's json, csv's rows of cells, an image a Picture, a sound
   * a Sound, other text text, anything else its bytes). no await: the
   * pattern's run again once it's got */
  export function get(url: string, as: "bytes"): Uint8Array;
  export function get(url: string, as: "text"): string;
  export function get(url: string, as: "json"): any;
  export function get(url: string, as?: "clever"): any;

  /** an image's pixels. x and y are the image's own: 0, 0 at its top left
   * (past its edges, it's its edges) */
  export interface Picture {
    readonly width: number;
    readonly height: number;
    /** red, green, blue, alpha, each 0–255, row by row from the top */
    readonly data: Uint8ClampedArray;
    /** [red, green, blue, alpha] at x, y, each 0–255 */
    at(x: number, y: number): [number, number, number, number];
    /** how light it is at x, y: 0 black to 1 white (see-through's white) */
    light(x: number, y: number): number;
  }

  /** a sound's samples, one channel. a spectrogram's a power for each moment
   * and pitch: \`sound.power(seconds, hz)\` */
  export interface Sound {
    readonly sampleRate: number;
    /** -1 to 1, sampleRate of them a second */
    readonly samples: Float32Array;
    /** how long it is, in seconds */
    readonly duration: number;
    /** the sample at a moment, in seconds: -1 to 1 */
    at(seconds: number): number;
    /** how loud hz is around a moment (in seconds): 0 to 1, a sine that
     * fills the sound's 1. heard over window samples (1024 if it's left
     * off: more hears pitches apart better, fewer moments) */
    power(seconds: number, hz: number, window?: number): number;
  }

  /** bind off the front bed, from min to max (dir "+") or max to min ("-"),
   * knitting each loop onto the next along with carrier */
  export function bindoff(
    k: import("knitout").Writer,
    dir: import("knitout").Direction,
    min: number,
    max: number,
    carrier: string,
  ): void;

  /** a kniterate waste section from min to max: brings in each of carriers
   * (the main yarns), the waste yarn and the draw thread, and casts on with
   * castOnCarrier (one of carriers) */
  export function addWasteSection(
    k: import("knitout").Writer,
    carriers: string[],
    castOnCarrier: string,
    min: number,
    max: number,
    options?: {
      /** "6" */
      wasteCarrier?: string;
      /** "1" */
      drawCarrier?: string;
      /** 450 */
      rollerAdvance?: number;
      /** 5 */
      stitchNumber?: number;
      /** 400 */
      speedNumber?: number;
    },
  ): void;

  const lattice: {
    doc: typeof doc;
    get: typeof get;
    bindoff: typeof bindoff;
    addWasteSection: typeof addWasteSection;
  };
  export default lattice;
}
${LATTICE_ALIASES.map(
  (alias) => `declare module ${JSON.stringify(alias)} {
  export * from "lattice";
  import lattice from "lattice";
  export default lattice;
}`,
).join("\n")}`;

// what every pattern can use: `repo` without importing it, and lattice's doc()
// and get() and the knitout library (by import, or require for knitout)
export const GLOBALS = `declare const repo: any;
${LATTICE_TYPES}
declare function require(name: "knitout"): typeof import("knitout");
${KNITOUT_TYPES}`;
