// a skitch: a page of layers, one for each mark, each drawn by one of four
// little libraries, in the order they were made. a mark is never changed
// once it's made, only made, placed (moved, turned or sized: each its own
// field, so two people at once both keep theirs) or taken away, so two people drawing
// at once both keep theirs
//
//   paint  atrament: {color, weight, smoothing, adaptive, points}
//   fill   a flood fill, worked out once by who poured it, over what was
//          there: {color, x, y, w, h, runs} (runs: regionOf's)
//   ink    perfect-freehand: {color, size, pen, points}
//   drauu  drauu's svg, as data: {node: {t, a, c}} (cleanNode's)
//   rough  rough.js: {shape: "line"|"arrow"|"rect"|"ellipse", color, size,
//          fill, seed, x1, y1, x2, y2}
//   erase  not a layer: a rub out of the layers it touched, {weight, points,
//          on: {id: matrix}}, each how that layer was placed when it was
//          rubbed (place.js; an old skitch's is only where it was moved to,
//          [dx, dy]), so the hole goes where the layer goes
//
// a layer's z is where it is in the stack (lowest at the bottom; an old
// skitch's, where it is in the list), and its group, if it's in one, the
// id the group's layers share. each is its own field, so two people
// restacking at once can't make two of anything, as moving it in the list
// would
//
// a layer can be placed (place.js: at, turn, scale, pivot), and a line or an
// arrow can hold on to what its ends were drawn on: ends: {from, to}, each
// {id, x, y}, where on it, in its own units
//
// points are flat, a tenth of a unit at most: x, y, pressure, x, y, …
// on a page WIDTH by HEIGHT, which every view scales to fit

export const WIDTH = 1600;
export const HEIGHT = 1000;

export const SkitchDatatype = {
  init(doc) {
    doc.title = "skitch";
    doc.width = WIDTH;
    doc.height = HEIGHT;
    doc.marks = [];
  },
  getTitle: (doc) => doc.title || "skitch",
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `copy of ${doc.title || "skitch"}`;
  },
};

export const newId = () => Math.random().toString(36).slice(2, 10);

const tenth = (n) => Math.round(n * 10) / 10;
const hundredth = (n) => Math.round(n * 100) / 100;

export const flat = (points) => points.flatMap(([x, y, p = 0.5]) => [tenth(x), tenth(y), hundredth(p)]);

export function triples(flat = []) {
  const out = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

// drauu's elements, as plain data and only what draws a shape: never a
// script, a link, a style or a handler, since what's in a doc is anyone's
const TAGS = new Set(["g", "path", "line", "rect", "ellipse", "circle", "polyline", "polygon", "defs", "marker"]);
const ATTRS = new Set(
  (
    "d x y x1 y1 x2 y2 cx cy r rx ry width height points id viewBox refX refY markerWidth markerHeight " +
    "markerUnits orient fill fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin " +
    "stroke-dasharray opacity marker-start marker-end"
  ).split(" "),
);
const MAX_DEPTH = 6;

export function cleanNode(node, depth = 0) {
  if (!node || typeof node !== "object" || !TAGS.has(node.t) || depth > MAX_DEPTH) return null;
  const a = {};
  for (const [name, value] of Object.entries(node.a ?? {})) {
    if (!ATTRS.has(name) || typeof value !== "string") continue;
    // the only url is one to an arrowhead beside it
    if (value.includes("(") && !/^url\(#[\w-]+\)$/.test(value)) continue;
    a[name] = value;
  }
  const c = (Array.isArray(node.c) ? node.c : []).map((child) => cleanNode(child, depth + 1)).filter(Boolean);
  return { t: node.t, a, c };
}

// an svg element, as cleanNode keeps it
export const nodeData = (el) =>
  cleanNode({
    t: el.localName,
    a: Object.fromEntries([...el.attributes].map((attr) => [attr.name, attr.value])),
    c: [...el.children].map(nodeData),
  });

// a mark that's a layer (not an erase, nor an old skitch's paint that was
// an erase or a fill of the one canvas everything was painted on)
export const isLayer = (mark) =>
  !!mark?.id && ["paint", "fill", "ink", "drauu", "rough"].includes(mark.kind) && !(mark.kind === "paint" && mark.mode && mark.mode !== "draw");

export const atOf = (mark) => (Array.isArray(mark?.at) ? [+mark.at[0] || 0, +mark.at[1] || 0] : [0, 0]);

// what a flood fill changed (two width by height rgba images, before and
// after), grown by a pixel or so to tuck under the lines around it: its box,
// and its runs, as bytes (uint16s, little end first: row, start, length, …,
// in the box). null if it changed nothing
export function regionOf(before, after, width, height, grow = 1) {
  let mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    if (before[p] !== after[p] || before[p + 1] !== after[p + 1] || before[p + 2] !== after[p + 2] || before[p + 3] !== after[p + 3]) mask[i] = 1;
  }
  for (let n = 0; n < grow; n++) {
    const grown = mask.slice();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) continue;
        if ((x > 0 && mask[y * width + x - 1]) || (x < width - 1 && mask[y * width + x + 1]) || (y > 0 && mask[(y - 1) * width + x]) || (y < height - 1 && mask[(y + 1) * width + x]))
          grown[y * width + x] = 1;
      }
    mask = grown;
  }
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[y * width + x]) (left = Math.min(left, x)), (right = Math.max(right, x)), (top = Math.min(top, y)), (bottom = Math.max(bottom, y));
  if (right < 0) return null;
  const runs = [];
  for (let y = top; y <= bottom; y++) {
    let start = -1;
    for (let x = left; x <= right + 1; x++) {
      const on = x <= right && mask[y * width + x];
      if (on && start < 0) start = x;
      if (!on && start >= 0) runs.push(y - top, start - left, x - start), (start = -1);
    }
  }
  const bytes = new Uint8Array(runs.length * 2);
  const view = new DataView(bytes.buffer);
  runs.forEach((n, i) => view.setUint16(i * 2, n, true));
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1, runs: bytes };
}

// a fill's runs as a w by h mask of 0s and 1s (what's out of its box is left out)
export function maskOf({ w, h, runs }) {
  const mask = new Uint8Array(w * h);
  if (!(runs instanceof Uint8Array)) return mask;
  const view = new DataView(runs.buffer, runs.byteOffset, runs.byteLength);
  for (let i = 0; i + 6 <= runs.byteLength; i += 6) {
    const [row, start, length] = [view.getUint16(i, true), view.getUint16(i + 2, true), view.getUint16(i + 4, true)];
    if (row >= h) continue;
    mask.fill(1, row * w + Math.min(start, w), row * w + Math.min(start + length, w));
  }
  return mask;
}
