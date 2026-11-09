// fonts to pick from in the settings: the ones lattice brings (fonts/
// fonts.css), there wherever you are, and the ones this computer has, out of
// a list of likely ones. a font's there if text in it isn't the same width as
// in each of the generic families it'd otherwise fall back to
const GENERIC = { sans: "sans-serif", serif: "serif", mono: "monospace", hand: "cursive" };

const BROUGHT = [
  ["Jost", "sans"],
  ["Atkinson Hyperlegible Next", "sans"],
  ["Fraunces", "serif"],
  ["Fantasque Sans Mono", "mono"],
  ["IBM Plex Mono", "mono"],
  ["JetBrains Mono", "mono"],
  ["Victor Mono", "mono"],
];

const LIKELY = {
  sans: [
    "system-ui",
    "Helvetica Neue",
    "Avenir Next",
    "Gill Sans",
    "Futura",
    "Optima",
    "Verdana",
    "Inter",
    "IBM Plex Sans",
    "Segoe UI",
    "Ubuntu",
    "Arial",
  ],
  serif: [
    "Iowan Old Style",
    "Palatino",
    "Georgia",
    "Charter",
    "Baskerville",
    "Hoefler Text",
    "Didot",
    "Times New Roman",
  ],
  mono: [
    "SF Mono",
    "Menlo",
    "Monaco",
    "Fira Code",
    "Cascadia Code",
    "Iosevka",
    "Berkeley Mono",
    "Consolas",
    "Courier New",
  ],
  hand: ["Comic Sans MS", "Chalkboard SE", "Marker Felt", "Bradley Hand"],
};

export const KINDS = Object.keys(LIKELY);

let canvas = null;
function has(name) {
  canvas ??= document.createElement("canvas").getContext("2d");
  const text = "mmmmmmmmmlli1|WQ@#";
  return Object.values(GENERIC).some((generic) => {
    canvas.font = `40px ${generic}`;
    const without = canvas.measureText(text).width;
    canvas.font = `40px "${name}", ${generic}`;
    return canvas.measureText(text).width !== without;
  });
}

// how a font's written as a font-family
export const stackOf = (name, kind) => (name === "system-ui" ? "system-ui, sans-serif" : `"${name}", ${GENERIC[kind]}`);

let found = null;
/**
 * [{name, kind, stack, brought}]: lattice's own (`brought`), and then the
 * ones this computer has, each sans to hand
 */
export function fonts() {
  found ??= [
    ...BROUGHT.map(([name, kind]) => ({ name, kind, stack: stackOf(name, kind), brought: true })),
    ...KINDS.flatMap((kind) =>
      LIKELY[kind]
        .filter((name) => name === "system-ui" || has(name))
        .map((name) => ({ name, kind, stack: stackOf(name, kind), brought: false })),
    ),
  ];
  return found;
}

// the first family a font-family names, as a person would say it
export function firstFamily(stack) {
  const first = String(stack ?? "")
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!first) return "";
  if (/^(-apple-system|BlinkMacSystemFont|system-ui|ui-sans-serif)$/i.test(first)) return "system";
  if (/^ui-monospace$/i.test(first)) return "system mono";
  return first;
}
