// skitch's tool: a page of layers you draw four ways (marks.js says how each
// is kept), and move, turn and size (place.js). each library is only loaded
// once something wants it: atrament when there's paint, drauu when you pick
// up one of its pens, rough.js when there's something sketchy.
// perfect-freehand is wm's (for its ink), so it's here already. the other
// three are in vendor/ (`pnpm vendor`), as packages/ is served as it is and
// they aren't in patchwork's importmap
//
// every layer is a <g> in one svg, in the doc's order, placed by a matrix and
// rubbed out by a mask. paint is drawn by an atrament of its own, off the
// page, and shown as a picture of just that stroke; fills as a picture too.
// lines and arrows hold on to what their ends were drawn on, and follow it.
// the page is WIDTH by HEIGHT units, scaled to fit the pane with a transform:
// so atrament's offsetX, drauu's getScreenCTM and ours are all in page units
//
// while you drag, turn or size something, where it is goes to everyone else
// with the doc open (over its ephemeral channel, as wm's live drags do), and
// is written to the doc once, when you let go. what you've picked up goes
// too, in your colour, and wm's pointers find their way onto the page
// through element.inkSpace
import { getStroke } from "../wm/vendor/perfect-freehand.js";
import { colourFor } from "../wm/pointer.js";
import { WIDTH, HEIGHT, newId, flat, triples, cleanNode, nodeData, isLayer, regionOf, maskOf } from "./marks.js";
import { placeOf, onlyMoved, matrixOf, invert, transform, sizeOf, svgMatrix, matrixFrom, resized, turned, turnedAbout, sizedAbout, angleAbout, factorAbout } from "./place.js";
import { ICONS } from "./icons.js";

const SVG = "http://www.w3.org/2000/svg";
// chee.party's: plum ink, cherry, sun, mint, blue and a pink glow. 1 to 6, and 7's yours
const COLOURS = ["#3a2a43", "#ff2284", "#ffd23f", "#40dcba", "#2269ff", "#ffb3d4"];
const SIZES = [3, 6, 14];
// a handle's size, and how far the turning one is above what's picked up (css px)
const HANDLE = 9;
const TURNER = 26;
// how often a drag goes out (ms), how long someone's drag is shown with
// nothing more heard (as wm's LIVE_QUIET), and what they've picked up
const SEND_EVERY = 40;
const LIVE_QUIET = 4000;
const CHOSEN_QUIET = 10000;
const AGAIN = 3000;

// [id, label, key, what draws it, title]
const TOOLS = [
  ["move", "move", "v", "move", "pick things up (shift: more, or drag a box round them): drag them, size them by a corner, turn them by the knob. delete takes them away, ⌘g groups them, [ and ] restack them"],
  ["paint", "paint", "b", "atrament", "a brush of paint (atrament)"],
  ["fill", "fill", "f", "fill", "pour paint into a space, bounded by everything that's there (atrament)"],
  ["ink", "ink", "i", "freehand", "ink that thins as it goes, or with your pen's pressure (perfect-freehand)"],
  ["marker", "marker", "m", "drauu", "a smooth marker line (drauu)"],
  ["line", "line", "l", "shape", "a line: shift for 45°. drawn from or to something, it holds on to it"],
  ["arrow", "arrow", "a", "shape", "an arrow: shift for 45°. drawn from or to something, it holds on to it"],
  ["rect", "box", "r", "shape", "a box: shift for a square, alt from its middle (in clean)"],
  ["ellipse", "oval", "o", "shape", "an oval: shift for a circle, alt from its middle (in clean)"],
  ["eraser", "eraser", "e", "eraser", "rub out of whatever it touches"],
];
const TRAYS = [["move"], ["paint", "fill", "ink", "marker"], ["line", "arrow", "rect", "ellipse"], ["eraser"]];
const DRAUU_MODES = { marker: "draw", line: "line", arrow: "line", rect: "rectangle", ellipse: "ellipse" };

const STYLES = `
.skitch {
  --skitch-fill: var(--editor-fill, #fff);
  --skitch-line: var(--editor-line, #1a1a1a);
  --skitch-soft: color-mix(in oklch, var(--skitch-fill), var(--skitch-line) 7%);
  --skitch-hover: color-mix(in oklch, var(--skitch-fill), var(--skitch-line) 13%);
  --skitch-edge: color-mix(in oklch, var(--skitch-fill), var(--skitch-line) 18%);
  --skitch-accent: var(--studio-primary, #ff2284);
  height: 100%; display: flex; flex-direction: column; overflow: hidden;
  background: color-mix(in oklch, var(--skitch-fill), var(--skitch-line) 5%);
  color: var(--skitch-line); font: 13px var(--editor-family-sans, system-ui, sans-serif);
  user-select: none; outline: none;
}
.skitch-bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 8px; background: var(--skitch-fill); border-bottom: 1px solid var(--skitch-edge);
}
.skitch-tray { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 12px; background: var(--skitch-soft); }
.skitch-tray.skitch-colours { gap: 7px; padding: 3px 9px; height: 38px; box-sizing: border-box; }
.skitch-bar button {
  position: relative; display: grid; place-items: center; width: 32px; height: 32px; padding: 0;
  border: 0; border-radius: 9px; background: none; color: inherit; font: inherit; cursor: pointer;
  transition: background-color .12s, box-shadow .12s, transform .08s;
}
.skitch-bar button:hover { background: var(--skitch-hover); }
.skitch-bar button:active:not(:disabled) { transform: scale(.9); }
.skitch-bar button[aria-pressed="true"] { background: var(--skitch-fill); box-shadow: 0 0 0 1px var(--skitch-line), 1px 1px 0 1px var(--skitch-line); }
.skitch-bar button:disabled { opacity: .3; cursor: default; background: none; }
.skitch-bar .skitch-icon { width: 18px; height: 18px; }
.skitch-bar kbd {
  position: absolute; top: 2px; right: 3px; font: 600 8px/1 var(--editor-family-mono, ui-monospace, monospace);
  opacity: 0; pointer-events: none; transition: opacity .12s;
}
.skitch-bar button:hover:not(:disabled) kbd, .skitch-more:hover kbd { opacity: .55; }
.skitch-bar .skitch-tool[aria-pressed="true"]::after {
  content: ""; position: absolute; bottom: 3px; left: 50%; width: 10px; height: 3px; margin-left: -5px;
  border-radius: 2px; background: var(--skitch-colour);
}
.skitch-bar button.skitch-swatch {
  width: 22px; height: 22px; border-radius: 50%; background: var(--c);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.18);
}
.skitch-bar button.skitch-swatch[aria-pressed="true"] { box-shadow: inset 0 0 0 1px rgba(0,0,0,.18), 0 0 0 2px var(--skitch-soft), 0 0 0 3.5px var(--skitch-line); }
.skitch-bar .skitch-swatch kbd, .skitch-bar .skitch-more kbd {
  position: static; color: #fff; font-size: 10px; text-shadow: 0 0 2px rgba(0,0,0,.7);
}
.skitch-bar button.skitch-swatch:hover kbd, .skitch-more:hover kbd { opacity: .95; }
.skitch-more { position: relative; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; }
.skitch-more[data-on] { box-shadow: 0 0 0 2px var(--skitch-soft), 0 0 0 3.5px var(--skitch-line); }
.skitch-more input {
  position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 50%;
  background: conic-gradient(#ff2284, #ffd23f, #40dcba, #2269ff, #ffb3d4, #ff2284); cursor: pointer;
  appearance: none; -webkit-appearance: none;
}
.skitch-more[data-on] input { background: var(--skitch-colour); }
.skitch-more input::-webkit-color-swatch-wrapper { padding: 0; }
.skitch-more input::-webkit-color-swatch { border: 0; opacity: 0; }
.skitch-more input::-moz-color-swatch { border: 0; opacity: 0; }
.skitch-more kbd { z-index: 1; }
.skitch-bar .skitch-size::before {
  content: ""; display: block; width: var(--s); height: var(--s); border-radius: 50%; background: currentColor;
}
.skitch-stage { position: relative; flex: 1; overflow: hidden; }
.skitch-page {
  position: absolute; left: 0; top: 0; transform-origin: 0 0;
  background: #fffdf8; outline: 1px solid #000; box-shadow: 0 0 10px 2px #66003322; cursor: crosshair;
}
.skitch[data-tool="move"] .skitch-page { cursor: default; }
.skitch[data-over="layer"] .skitch-page { cursor: grab; }
.skitch[data-over="size"] .skitch-page { cursor: nwse-resize; }
.skitch[data-over="turn"] .skitch-page { cursor: alias; }
.skitch[data-grabbing] .skitch-page { cursor: grabbing; }
.skitch-page > * { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; touch-action: none; }
.skitch[data-layer="paint"] .skitch-paint,
.skitch[data-layer="live"] .skitch-live,
.skitch[data-layer="drauu"] .skitch-drauu { pointer-events: auto; }
.skitch-chosen .outline { fill: none; stroke: var(--who, var(--skitch-accent)); stroke-width: 1.5; stroke-dasharray: 5 4; vector-effect: non-scaling-stroke; }
.skitch-chosen .handle { fill: #fff; stroke: var(--skitch-accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.skitch-chosen .stem { stroke: var(--skitch-accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.skitch-chosen .hint { fill: var(--skitch-accent); fill-opacity: .08; stroke: var(--skitch-accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.skitch-chosen .whole { stroke-dasharray: none; stroke-opacity: .5; }
.skitch-chosen .marquee { fill: var(--skitch-accent); fill-opacity: .06; stroke: var(--skitch-accent); stroke-width: 1; vector-effect: non-scaling-stroke; }
.skitch-bar.skitch-float {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 2;
  padding: 0; border: 0; background: none;
}
.skitch-bar.skitch-float[hidden] { display: none; }
.skitch-float .skitch-tray { background: var(--skitch-fill); box-shadow: 0 0 0 1px var(--skitch-line), 2px 2px 0 1px var(--skitch-line); }
.skitch-chosen .name { fill: var(--who); font: 600 12px var(--editor-family-sans, system-ui, sans-serif); }
`;

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
};
const icon = (name) => {
  const made = svgEl("svg", { viewBox: "0 0 256 256", class: "skitch-icon", fill: "currentColor", "aria-hidden": "true" });
  made.innerHTML = ICONS[name]; // ours, from icons.js
  return made;
};
const round = (n) => Math.round(n * 10) / 10;
const HEX = /^#[\da-f]{6}$/i;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

// a mark as plain data again, for undo to put back (its bytes too)
const copy = (value) =>
  value instanceof Uint8Array
    ? new Uint8Array(value)
    : Array.isArray(value)
      ? value.map(copy)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]))
        : value;

// the fields of a mark that can be set, as they go in the doc: where it's
// placed (place.js), its group, and its place in the stack
const stored = {
  at: ([x, y]) => [round(x), round(y)],
  turn: (turn) => round(turn),
  scale: ([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000],
  pivot: ([x, y]) => [round(x), round(y)],
  group: (id) => String(id).slice(0, 40),
  z: (z) => Math.round(z * 1e6) / 1e6,
};

// perfect-freehand's outline as a path, its corners smoothed (as wm's ink)
function pathOf(outline) {
  if (!outline.length) return "";
  const d = ["M", round(outline[0][0]), round(outline[0][1]), "Q"];
  outline.forEach(([x0, y0], i) => {
    const [x1, y1] = outline[(i + 1) % outline.length];
    d.push(round(x0), round(y0), round((x0 + x1) / 2), round((y0 + y1) / 2));
  });
  return [...d, "Z"].join(" ");
}

const inkOptions = (mark, last = true) => ({
  size: mark.size,
  thinning: mark.pen ? 0.62 : 0.5,
  smoothing: 0.62,
  streamline: mark.pen ? 0.62 : 0.5,
  simulatePressure: !mark.pen,
  last,
});

function inkPath(mark, last) {
  return svgEl("path", { d: pathOf(getStroke(triples(mark.points), inkOptions(mark, last))), fill: mark.color });
}

// a drauu mark's data, as elements again (cleaned again: a doc is anyone's)
function build(node) {
  const clean = cleanNode(node);
  if (!clean) return null;
  const made = svgEl(clean.t, clean.a);
  for (const child of clean.c) made.append(build(child));
  return made;
}

// a drauu mark's line, if it's a line (or an arrow): its data
function lineOf(node, depth = 0) {
  if (!isObject(node) || depth > 6) return null;
  if (node.t === "line") return node;
  for (const child of Array.isArray(node.c) ? node.c : []) {
    const found = lineOf(child, depth + 1);
    if (found) return found;
  }
  return null;
}

// a line or an arrow, which can hold on to what its ends are on
const isConnector = (mark) =>
  (mark?.kind === "rough" && (mark.shape === "line" || mark.shape === "arrow")) || (mark?.kind === "drauu" && !!lineOf(mark.node));

// its ends as drawn: [[x1, y1], [x2, y2]]
function endsOf(mark) {
  if (mark.kind === "rough") return [[+mark.x1 || 0, +mark.y1 || 0], [+mark.x2 || 0, +mark.y2 || 0]];
  const a = lineOf(mark.node)?.a ?? {};
  return [[+a.x1 || 0, +a.y1 || 0], [+a.x2 || 0, +a.y2 || 0]];
}

// what an end holds on to: {id, x, y} (where on it, in its units), checked
const anchorOf = (value) =>
  isObject(value) && typeof value.id === "string" && Number.isFinite(+value.x) && Number.isFinite(+value.y)
    ? { id: value.id, x: +value.x, y: +value.y }
    : null;

// shift: a square, a circle, a line at a multiple of 45°
function constrain({ shape, x1, y1, x2, y2 }, shift) {
  if (!shift) return { x2, y2 };
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (shape === "rect" || shape === "ellipse") {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x2: x1 + Math.sign(dx || 1) * side, y2: y1 + Math.sign(dy || 1) * side };
  }
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return { x2: x1 + Math.cos(angle) * length, y2: y1 + Math.sin(angle) * length };
}

function roughShape(rc, mark) {
  const { shape, x1, y1, x2, y2, size, color } = mark;
  const options = {
    stroke: color,
    strokeWidth: size,
    roughness: 1.3,
    seed: mark.seed,
    ...(mark.fill && shape !== "line" && shape !== "arrow"
      ? { fill: color, fillStyle: "hachure", fillWeight: Math.max(1, size / 2), hachureGap: size * 2.5 + 4 }
      : {}),
  };
  const [left, top, w, h] = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
  if (shape === "rect") return rc.rectangle(left, top, w, h, options);
  if (shape === "ellipse") return rc.ellipse(left + w / 2, top + h / 2, w, h, options);
  const line = rc.line(x1, y1, x2, y2, options);
  if (shape !== "arrow") return line;
  const g = svgEl("g");
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(12, size * 5);
  const wing = (turn) => [x2 - Math.cos(angle + turn) * head, y2 - Math.sin(angle + turn) * head];
  g.append(line, rc.linearPath([wing(0.45), [x2, y2], wing(-0.45)], options));
  return g;
}

// a point and four around it, r away
const around = (x, y, r) => [[x, y], [x + r, y], [x - r, y], [x, y + r], [x, y - r]];

// is a layer of svg at this point (in its own units), or within r of it?
// an open line's inside isn't it: only what's filled in is
const filled = (shape) => !["none", "transparent"].includes(shape.getAttribute("fill") ?? "black");
const svgHit = (body) => (x, y, r) => {
  const box = body.getBBox();
  if (x < box.x - r - 10 || x > box.x + box.width + r + 10 || y < box.y - r - 10 || y > box.y + box.height + r + 10) return false;
  const point = new DOMPoint();
  const shapes = [body, ...body.querySelectorAll("*")].filter((one) => one instanceof SVGGeometryElement && !one.closest("marker"));
  return shapes.some((shape) =>
    around(x, y, r).some(([px, py]) => {
      point.x = px;
      point.y = py;
      return (filled(shape) && shape.isPointInFill(point)) || shape.isPointInStroke(point);
    }),
  );
};

// is a line through these points within r (and half its width) of a point?
const nearLine = (points, width) => (x, y, r) => {
  const reach = r + width / 2;
  return points.some(([x1, y1], i) => {
    const [x2, y2] = points[i + 1] ?? points[i];
    const [dx, dy] = [x2 - x1, y2 - y1];
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= reach;
  });
};

// a picture as a layer: {x, y, w, h, data: ImageData}, hit where it isn't clear
function pictureLayer({ x, y, w, h, data }) {
  const picture = el("canvas", { width: w, height: h });
  picture.getContext("2d").putImageData(data, 0, 0);
  const body = svgEl("image", { x, y, width: w, height: h, href: picture.toDataURL() });
  const alpha = data.data;
  const hit = (px, py, r) =>
    around(px - x, py - y, r).some(([ix, iy]) => {
      [ix, iy] = [Math.floor(ix), Math.floor(iy)];
      return ix >= 0 && iy >= 0 && ix < w && iy < h && alpha[(iy * w + ix) * 4 + 3] > 24;
    });
  return { body, hit };
}

function fillPicture(mark) {
  const { x, y, w, h, color } = mark;
  if (!(w > 0 && h > 0 && w <= WIDTH * 4 && h <= HEIGHT * 4) || !HEX.test(color)) return null;
  const mask = maskOf(mark);
  const data = new ImageData(w, h);
  const [r, g, b] = rgb(color);
  for (let i = 0; i < mask.length; i++) if (mask[i]) data.data.set([r, g, b, 255], i * 4);
  return { x: +x || 0, y: +y || 0, w, h, data };
}

// an erase, as a black line in a layer's mask, in that layer's units (it was
// rubbed out when the layer was placed by `matrix`)
function rubLine(points, matrix, weight) {
  const back = invert(matrix);
  const at = triples(points).map(([x, y]) => transform(back, [x, y]).map(round).join(" "));
  if (at.length === 1) at.push(at[0]);
  return svgEl("path", {
    d: at.length ? `M${at.join("L")}` : "",
    fill: "none",
    stroke: "#000",
    "stroke-width": weight / sizeOf(matrix),
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
}

const middleOf = (box) => [box.x + box.width / 2, box.y + box.height / 2];

export default function SkitchTool(handle, element) {
  const startDoc = handle.doc() ?? {};
  const W = startDoc.width || WIDTH;
  const H = startDoc.height || HEIGHT;
  const uid = newId(); // masks' ids are the page's, and the doc may be open twice

  const style = el("style", { textContent: STYLES });
  const root = el("div", { className: "skitch", tabIndex: -1 });
  const bar = el("div", { className: "skitch-bar" });
  const stage = el("div", { className: "skitch-stage" });
  const page = el("div", { className: "skitch-page" });
  page.style.width = `${W}px`;
  page.style.height = `${H}px`;
  const canvas = el("canvas", { className: "skitch-paint", width: W, height: H });
  const layer = (name) => svgEl("svg", { class: `skitch-${name}`, viewBox: `0 0 ${W} ${H}` });
  const marksSvg = layer("marks");
  const masks = svgEl("defs");
  marksSvg.append(masks);
  const liveSvg = layer("live");
  const drauuSvg = layer("drauu");
  const chosenSvg = layer("chosen");
  page.append(marksSvg, canvas, liveSvg, drauuSvg, chosenSvg);
  stage.append(page);
  root.append(bar, stage);
  element.append(style, root);

  const state = { tool: "ink", colour: COLOURS[0], size: 1, sketchy: true, filled: false };
  let gone = false;
  let zoom = 1; // css px to a page unit

  // ── the libraries, when they're wanted ──────────────────────────────────

  const once = (load) => {
    let promise;
    return () => (promise ??= load());
  };
  let rc; // rough.js, drawing into the page's svg
  const loadRough = once(async () => {
    const { default: rough } = await import("./vendor/rough.js");
    return (rc = rough.svg(marksSvg));
  });
  const loadAtrament = once(async () => (await import("./vendor/atrament.js")).default);
  let pad; // atrament, on the page, for painting
  const loadPad = once(async () => {
    const Atrament = await loadAtrament();
    pad = new Atrament(canvas, { width: W, height: H });
    pad.recordStrokes = true;
    pad.addEventListener("strokerecorded", ({ stroke }) => painted(stroke));
    settle();
    return pad;
  });
  let replay; // atrament, off the page, drawing each stroke to be a layer
  const loadReplay = once(async () => {
    const Atrament = await loadAtrament();
    // atrament's line is weight / offsetWidth * width, and this canvas is
    // never on the page to have an offsetWidth: it's as big as it's drawn
    const off = el("canvas");
    Object.defineProperties(off, { offsetWidth: { get: () => W }, offsetHeight: { get: () => H } });
    replay = new Atrament(off, { width: W, height: H });
    return replay;
  });
  let drauu;
  const loadDrauu = once(async () => {
    const { createDrauu } = await import("./vendor/drauu.js");
    drauu = createDrauu({ el: drauuSvg });
    drauu.on("committed", (node) => {
      if (!node) return;
      const data = nodeData(node);
      drauu.clear();
      if (!data) return;
      const mark = { id: newId(), kind: "drauu", node: data };
      if (isConnector(mark)) {
        const ends = holdOn(...endsOf(mark));
        if (ends) mark.ends = ends;
      }
      act({ add: [mark] });
    });
    settle();
    return drauu;
  });
  let worker; // atrament's flood fill
  const loadFill = once(async () => (worker = new (await import("./vendor/atrament-fill.js")).default()));

  // ── changes, and undoing your own ───────────────────────────────────────

  const marksNow = () => handle.doc()?.marks ?? [];
  // where a mark is in the stack: its z, or (from before there were) where
  // it is in the list
  const keyOf = (mark, index) => (Number.isFinite(mark?.z) ? mark.z : index);

  // add some marks (each a mark, on top of everything unless it has a z, or
  // {at, mark} to go back in the list where it was), take some away (by id)
  // and set some of their fields ({id, fields}: where they're placed, their
  // group, their z; undefined to take one away). what puts it back as it was
  function apply({ add = [], remove = [], set = [] }) {
    const marks = marksNow();
    const byId = new Map(marks.map((mark) => [mark.id, mark]));
    const removing = new Set(remove.filter((id) => byId.has(id)));
    const setting = set.filter(({ id }) => byId.has(id) && !removing.has(id));
    if (!removing.size && !add.length && !setting.length) return null;
    let top = marks.reduce((most, mark, i) => Math.max(most, keyOf(mark, i)), -1);
    const adding = add.map((item) => (item.mark || Number.isFinite(item.z) ? item : { ...item, z: ++top }));
    const back = {
      add: [],
      remove: adding.map((item) => (item.mark ?? item).id),
      set: setting.map(({ id, fields }) => ({
        id,
        fields: Object.fromEntries(Object.keys(fields).map((key) => [key, copy(byId.get(id)[key])])),
      })),
    };
    handle.change((doc) => {
      doc.marks ??= [];
      for (const { id, fields } of setting) {
        const mark = doc.marks.find((one) => one.id === id);
        if (!mark) continue;
        for (const [key, value] of Object.entries(fields)) {
          if (!(key in stored)) continue;
          if (value === undefined || value === null) delete mark[key];
          else mark[key] = stored[key](value);
        }
      }
      for (let i = doc.marks.length - 1; i >= 0; i--) {
        if (!removing.has(doc.marks[i].id)) continue;
        back.add.unshift({ at: i, mark: copy(marks[i]) });
        doc.marks.deleteAt(i);
      }
      for (const item of adding) {
        if (item.mark) doc.marks.insertAt(Math.max(0, Math.min(item.at, doc.marks.length)), item.mark);
        else doc.marks.push(item);
      }
    });
    return back;
  }

  const history = [];
  let future = [];
  function act(change) {
    const back = apply(change);
    if (back) history.push(back), (future = []);
    drawBar();
  }
  function step(from, to) {
    const change = from.pop();
    const back = change && apply(change);
    if (back) to.push(back);
    drawBar();
  }
  const undo = () => step(history, future);
  const redo = () => step(future, history);

  // ── the layers ──────────────────────────────────────────────────────────

  // a mark's id, and {g, body, hit(x, y, r) in its own units, mark, place,
  // matrix, inverse, size, pivot, mask}
  const shown = new Map();

  // the layers, bottom to top
  function ordered() {
    return marksNow()
      .map((mark, i) => [mark, keyOf(mark, i), i])
      .filter(([mark]) => isLayer(mark))
      .sort((a, b) => a[1] - b[1] || a[2] - b[2])
      .map(([mark]) => mark);
  }

  async function layerOf(mark) {
    if (mark.kind === "paint") return paintLayer(mark, await loadReplay());
    if (mark.kind === "fill") {
      const picture = fillPicture(mark);
      return picture && pictureLayer(picture);
    }
    if (mark.kind === "ink") return { body: inkPath(mark, true), hit: nearLine(triples(mark.points), +mark.size || 4) };
    if (mark.kind === "rough") await loadRough();
    const body = mark.kind === "drauu" ? build(mark.node) : roughShape(rc, mark);
    return body && { body, hit: svgHit(body) };
  }

  // a line or an arrow, its ends where they are now (in its own units)
  function connectorBody(mark, [[x1, y1], [x2, y2]]) {
    if (mark.kind === "rough") return roughShape(rc, { ...mark, x1, y1, x2, y2 });
    const body = build(mark.node);
    const line = body?.localName === "line" ? body : body?.querySelector("line");
    if (line) for (const [name, value] of Object.entries({ x1, y1, x2, y2 })) line.setAttribute(name, round(value));
    return body;
  }

  // a stroke of paint, by atrament (its readme's way), cut out as a picture
  function paintLayer(mark, atrament) {
    const points = triples(mark.points);
    if (!points.length) return null;
    atrament.clear();
    stroke(atrament, mark);
    const margin = (+mark.weight || 2) * 2 + 6;
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const x = Math.max(0, Math.floor(Math.min(...xs) - margin));
    const y = Math.max(0, Math.floor(Math.min(...ys) - margin));
    const w = Math.min(W, Math.ceil(Math.max(...xs) + margin)) - x;
    const h = Math.min(H, Math.ceil(Math.max(...ys) + margin)) - y;
    if (w <= 0 || h <= 0) return null;
    const data = atrament.canvas.getContext("2d").getImageData(x, y, w, h);
    atrament.clear();
    return pictureLayer({ x, y, w, h, data });
  }

  function stroke(atrament, mark) {
    Object.assign(atrament, { recordStrokes: false, mode: "draw", weight: mark.weight, smoothing: mark.smoothing });
    Object.assign(atrament, { color: mark.color, adaptiveStroke: mark.adaptive });
    const [first, ...rest] = triples(mark.points);
    let prev = { x: first[0], y: first[1] };
    atrament.beginStroke(prev.x, prev.y);
    for (const [x, y, pressure] of rest) prev = atrament.draw(x, y, prev.x, prev.y, pressure);
    atrament.endStroke(prev.x, prev.y);
  }

  // what's rubbed out of each layer: its id, and [{mark, matrix}]. an old
  // skitch's erase rubbed out all the paint before it
  let rubbed = new Map();
  function rubsOf(marks) {
    const out = new Map();
    const add = (id, rub) => out.set(id, [...(out.get(id) ?? []), rub]);
    const paintSoFar = [];
    for (const mark of marks) {
      if (mark.kind === "erase") for (const [id, at] of Object.entries(mark.on ?? {})) add(id, { mark, matrix: matrixFrom(at) });
      else if (mark.kind === "paint" && mark.mode === "erase") for (const id of paintSoFar) add(id, { mark, matrix: matrixFrom([0, 0]) });
      else if (mark.kind === "paint" && isLayer(mark)) paintSoFar.push(mark.id);
    }
    return out;
  }

  // a layer's mask: what's rubbed out of it, and what you're rubbing out now
  function rub(id) {
    const entry = shown.get(id);
    if (!entry) return;
    const rubs = [...(rubbed.get(id) ?? [])];
    if (rubbing?.on.has(id)) rubs.push({ mark: rubbing, matrix: rubbing.on.get(id) });
    const key = rubs.map(({ mark }) => (mark === rubbing ? `${mark.id}+${mark.points.length}` : mark.id)).join();
    if (entry.rubs === key) return;
    entry.rubs = key;
    if (!rubs.length) {
      entry.g.removeAttribute("mask");
      entry.mask?.remove();
      entry.mask = null;
      return;
    }
    if (!entry.mask) {
      entry.mask = svgEl("mask", { id: `skitch-${uid}-${id}`, maskUnits: "userSpaceOnUse", x: -W * 2, y: -H * 2, width: W * 5, height: H * 5 });
      masks.append(entry.mask);
      entry.g.setAttribute("mask", `url(#${entry.mask.id})`);
    }
    entry.mask.replaceChildren(
      svgEl("rect", { x: -W * 2, y: -H * 2, width: W * 5, height: H * 5, fill: "#fff" }),
      ...rubs.map(({ mark, matrix }) => rubLine(mark.points, matrix, +mark.weight || 10)),
    );
  }

  // the middle of what a layer's drawn, in its own units: what it's turned
  // and sized about, till it has a pivot of its own
  function pivotOf(entry) {
    if (entry.pivot) return entry.pivot;
    const box = entry.body.getBBox();
    const middle = middleOf(box);
    // (not drawn yet, hidden: asked again next time)
    if (box.width || box.height) entry.pivot = middle;
    return middle;
  }

  // where a layer is: yours, as you hold it; someone's, as they do; or the doc's
  function placeFor(mark) {
    const yours = grab?.places?.get(mark.id);
    if (yours) return yours;
    const theirs = live.get(mark.id);
    if (theirs && theirs.until > Date.now()) return theirs.place;
    return placeOf(mark);
  }

  function place(entry, where) {
    entry.place = where;
    entry.matrix = matrixOf(where, onlyMoved(where) ? [0, 0] : (where.pivot ?? pivotOf(entry)));
    entry.inverse = invert(entry.matrix);
    entry.size = sizeOf(entry.matrix);
    const [a, b, c, d, e, f] = entry.matrix;
    if (a === 1 && b === 0 && c === 0 && d === 1 && !e && !f) entry.g.removeAttribute("transform");
    else entry.g.setAttribute("transform", svgMatrix(entry.matrix));
  }

  // where a line's or an arrow's ends are now: on what they hold on to, if
  // it's there, or where they were drawn (in its own units)
  function endsNow(entry) {
    const drawn = endsOf(entry.mark);
    return ["from", "to"].map((end, i) => {
      const anchor = anchorOf(entry.mark.ends?.[end]);
      const on = anchor && anchor.id !== entry.mark.id && shown.get(anchor.id);
      if (!on) return drawn[i];
      return transform(entry.inverse, transform(on.matrix, [anchor.x, anchor.y]));
    });
  }

  // lines and arrows, after what they hold on to's moved
  function reconnect() {
    for (const entry of shown.values()) {
      if (!entry.mark.ends || !isConnector(entry.mark)) continue;
      const ends = endsNow(entry);
      const key = ends.flat().map(round).join();
      if (entry.ends === key) continue;
      if (entry.mark.kind === "rough" && !rc) continue;
      const body = connectorBody(entry.mark, ends);
      if (!body) continue;
      entry.ends = key;
      entry.body.replaceWith(body);
      entry.body = body;
      entry.hit = svgHit(body);
    }
  }

  function placeAll() {
    for (const mark of marksNow()) {
      const entry = shown.get(mark.id);
      if (entry && isLayer(mark)) place(entry, placeFor(mark));
    }
    reconnect();
    showChosen();
  }

  let drawing = false;
  let drawAgain = false;
  async function draw() {
    if (drawing) return void (drawAgain = true);
    drawing = true;
    rubbed = rubsOf(marksNow());
    let before = masks; // what the next layer goes after
    const keep = new Set();
    for (const mark of ordered()) {
      let entry = shown.get(mark.id);
      if (!entry) {
        const made = await layerOf(mark).catch((error) => console.warn("[skitch] couldn't draw a mark", error));
        if (gone) return;
        if (!made) continue;
        const g = svgEl("g", { "data-id": mark.id });
        g.append(made.body);
        entry = { g, ...made, mark };
        shown.set(mark.id, entry);
      }
      entry.mark = mark;
      keep.add(mark.id);
      if (before.nextSibling !== entry.g) before.after(entry.g);
      before = entry.g;
      place(entry, placeFor(mark));
      rub(mark.id);
    }
    for (const [id, entry] of shown) if (!keep.has(id)) entry.g.remove(), entry.mask?.remove(), shown.delete(id);
    if (chosen.some((id) => !shown.has(id))) choose(chosen);
    reconnect();
    drawing = false;
    showChosen();
    drawBar();
    if (drawAgain) (drawAgain = false), draw();
  }

  // is a layer at this point (on the page), or within r of it?
  const hitsAt = (entry, x, y, r) => {
    const [lx, ly] = transform(entry.inverse, [x, y]);
    return entry.hit(lx, ly, r / entry.size);
  };

  // the topmost layer at a point, or within r of it (that `skip` doesn't skip)
  function topAt(x, y, r, skip = () => false) {
    const layers = ordered();
    for (let i = layers.length - 1; i >= 0; i--) {
      const entry = shown.get(layers[i].id);
      if (entry && !skip(layers[i]) && hitsAt(entry, x, y, r)) return layers[i].id;
    }
    return null;
  }

  // what's under each end of a new line or arrow, for it to hold on to:
  // {from, to}, or nothing (lines don't hold on to lines: they'd go round)
  function anchorAt([x, y]) {
    const id = topAt(x, y, 8, isConnector);
    const entry = id && shown.get(id);
    if (!entry) return null;
    const [lx, ly] = transform(entry.inverse, [x, y]);
    return { id, x: round(lx), y: round(ly) };
  }
  function holdOn(start, end) {
    const ends = { from: anchorAt(start), to: anchorAt(end) };
    if (!ends.from) delete ends.from;
    if (!ends.to) delete ends.to;
    return ends.from || ends.to ? ends : null;
  }

  // ── paint: a stroke of yours, just painted, becomes a layer ─────────────

  function painted(stroke) {
    const mark = {
      id: newId(),
      kind: "paint",
      color: stroke.color,
      weight: stroke.weight,
      smoothing: stroke.smoothing,
      adaptive: stroke.adaptiveStroke,
      points: flat(stroke.segments.map(({ point, pressure }) => [point.x, point.y, pressure])),
    };
    act({ add: [mark] });
    pad.clear(); // it's a layer now
  }

  // ── fill: over a picture of everything, then just above what it's on ────

  async function composite() {
    const all = marksSvg.cloneNode(true);
    all.setAttribute("width", W);
    all.setAttribute("height", H);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(all)], { type: "image/svg+xml" }));
    try {
      const picture = new Image();
      picture.src = url;
      await picture.decode();
      const context = el("canvas", { width: W, height: H }).getContext("2d", { willReadFrequently: true });
      context.drawImage(picture, 0, 0, W, H);
      return context;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  let pouring = false;
  async function pour(x, y) {
    const { colour } = state;
    const [fx, fy] = [Math.floor(x), Math.floor(y)];
    if (pouring || !(fx >= 0 && fy >= 0 && fx < W && fy < H) || !HEX.test(colour)) return;
    pouring = true;
    try {
      const [context] = await Promise.all([composite(), loadFill()]);
      const image = context.getImageData(0, 0, W, H).data;
      const before = image.slice();
      const startColor = [...image.subarray((fy * W + fx) * 4, (fy * W + fx) * 4 + 4)];
      const after = await new Promise((resolve) => {
        worker.onmessage = ({ data }) => data.type === "fill-result" && resolve(data.result);
        worker.postMessage({ image, color: colour, globalAlpha: 1, width: W, height: H, startColor, startX: fx, startY: fy }, [image.buffer]);
      });
      const region = gone ? null : regionOf(before, after, W, H);
      if (!region) return;
      // just above what it was poured onto, under the next thing up; or, on
      // nothing, under everything
      const keys = zs();
      const under = topAt(x, y, 0);
      const i = keys.findIndex(([id]) => id === under);
      const z = i < 0 ? (keys[0]?.[1] ?? 0) - 1 : i + 1 < keys.length ? (keys[i][1] + keys[i + 1][1]) / 2 : keys[i][1] + 1;
      act({ add: [{ id: newId(), kind: "fill", color: colour, ...region, z }], set: settled() });
    } catch (error) {
      console.warn("[skitch] couldn't fill", error);
    } finally {
      pouring = false;
    }
  }

  // ── the eraser: rubs out of every layer it touches, where it touches ────

  let rubbing = null; // {id, weight, raw, points, on: Map(id, matrix)}
  function rubTo(event) {
    const { x, y } = pagePoint(event);
    rubbing.raw.push([x, y]);
    rubbing.points = flat(rubbing.raw);
    for (const [id, entry] of shown)
      if (!rubbing.on.has(id) && hitsAt(entry, x, y, rubbing.weight / 2)) rubbing.on.set(id, entry.matrix.map((n) => Math.round(n * 10000) / 10000));
    for (const id of rubbing.on.keys()) rub(id);
    const trail = rubLine(rubbing.points, [1, 0, 0, 1, 0, 0], rubbing.weight);
    trail.setAttribute("stroke-opacity", ".08");
    liveSvg.replaceChildren(trail);
  }
  function rubOut() {
    const { id, weight, raw, on } = rubbing;
    rubbing = null;
    liveSvg.replaceChildren();
    if (on.size) act({ add: [{ id, kind: "erase", weight, points: flat(raw), on: Object.fromEntries(on) }] });
    draw();
  }

  // ── move: pick things up (one, a group, or several: shift adds, or drag a
  //    box round them), and drag them, size them by a corner, or turn them
  //    by the knob ──────────────────────────────────────────────────────────

  let chosen = []; // what's picked up: layers' ids
  // what's held: {kind: "move"|"size"|"turn", ids, start, from, places (each
  // id's place, as it was and as it is), and the handle's corners}, or
  // {kind: "box", start, at, base}: a box being dragged round things
  let grab = null;
  let lastDown = { id: null, at: 0 }; // (twice on one thing in a group: just it)

  function choose(ids) {
    const next = [...new Set(ids)].filter((id) => shown.has(id));
    if (next.length === chosen.length && next.every((id, i) => id === chosen[i])) return;
    chosen = next;
    say();
    drawBar();
  }

  const markOf = (id) => shown.get(id)?.mark;
  const groupOf = (id) => (typeof markOf(id)?.group === "string" ? markOf(id).group : null);
  // a layer, and everything in its group
  function withGroup(id) {
    const group = groupOf(id);
    return group ? [...shown.keys()].filter((one) => groupOf(one) === group) : [id];
  }
  // things that go together: a group's one, and anything not in one is one
  function unitsOf(ids) {
    const units = new Map();
    for (const id of ids) {
      const key = groupOf(id) ? `group ${groupOf(id)}` : id;
      units.set(key, [...(units.get(key) ?? []), id]);
    }
    return [...units.values()];
  }

  // what can be sized and turned: not a line holding on to something (it
  // goes where that does)
  const canTransform = (entry) => !(entry.mark.ends && isConnector(entry.mark));
  // one thing, on its own (not in a group): it's sized any way, in its own
  // box, turned as it is. several are in a box round them all, and sized
  // keeping their shapes
  const single = () => (chosen.length === 1 ? shown.get(chosen[0]) : null);

  // a layer's corners (in its units, and on the page), its middle, and
  // where its knob for turning is
  function handlesOf(entry) {
    const box = entry.body.getBBox();
    const local = [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x + box.width, box.y + box.height],
      [box.x, box.y + box.height],
    ];
    const corners = local.map((point) => transform(entry.matrix, point));
    const top = transform(entry.matrix, [box.x + box.width / 2, box.y]);
    const middle = transform(entry.matrix, middleOf(box));
    // (up from its middle, as it's turned: or, flat, as up is for it)
    const turn = (entry.place.turn * Math.PI) / 180;
    let up = [top[0] - middle[0], top[1] - middle[1]];
    const length = Math.hypot(...up);
    up = length > 1e-3 ? up.map((n) => n / length) : [Math.sin(turn), -Math.cos(turn)];
    const turner = [top[0] + (up[0] * TURNER) / zoom, top[1] + (up[1] * TURNER) / zoom];
    return { local, corners, top, middle, turner };
  }

  // the box round several, on the page
  function boxOf(ids) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of ids) {
      const entry = shown.get(id);
      if (!entry) continue;
      for (const [x, y] of handlesOf(entry).corners) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
    }
    if (!(x1 >= x0)) return null;
    return {
      corners: [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      top: [(x0 + x1) / 2, y0],
      middle: [(x0 + x1) / 2, (y0 + y1) / 2],
      turner: [(x0 + x1) / 2, y0 - TURNER / zoom],
    };
  }

  // the handles of what's picked up, if it can be sized and turned
  function chosenHandles() {
    if (state.tool !== "move" || !chosen.length) return null;
    const one = single();
    if (one) return canTransform(one) ? handlesOf(one) : null;
    return boxOf(chosen);
  }

  function outline(points, who, className = "outline") {
    const shape = svgEl("polygon", { class: className, points: points.map((p) => p.map(round).join(",")).join(" ") });
    if (who) shape.style.setProperty("--who", who);
    return shape;
  }

  function showChosen(hint = null) {
    const children = [];
    const now = Date.now();
    // what everyone else has picked up, in their colour, with their name
    for (const them of theirs.values()) {
      const ids = them.until > now ? them.chosen.filter((id) => shown.has(id)) : [];
      if (!ids.length) continue;
      for (const id of ids) children.push(outline(handlesOf(shown.get(id)).corners, them.colour));
      const box = them.name && boxOf(ids);
      if (box) {
        const label = svgEl("text", { class: "name", x: round(box.corners[0][0]), y: round(box.corners[0][1] - 8 / zoom) });
        label.style.setProperty("--who", them.colour);
        label.setAttribute("font-size", round(12 / zoom));
        label.textContent = them.name;
        children.push(label);
      }
    }
    // what a line you're drawing will hold on to
    const hinted = hint && shown.get(hint);
    if (hinted) children.push(outline(handlesOf(hinted).corners, null, "hint"));
    // yours: each, and (several) the box round them, and the handles
    if (state.tool === "move") {
      for (const id of chosen) children.push(outline(handlesOf(shown.get(id)).corners));
      const handles = chosenHandles();
      if (handles) {
        const size = HANDLE / zoom;
        if (!single()) children.push(outline(handles.corners, null, "outline whole"));
        children.push(svgEl("line", { class: "stem", x1: round(handles.top[0]), y1: round(handles.top[1]), x2: round(handles.turner[0]), y2: round(handles.turner[1]) }));
        children.push(svgEl("circle", { class: "handle", cx: round(handles.turner[0]), cy: round(handles.turner[1]), r: round(size / 1.6) }));
        for (const [x, y] of handles.corners)
          children.push(svgEl("rect", { class: "handle", x: round(x - size / 2), y: round(y - size / 2), width: round(size), height: round(size), rx: round(size / 4) }));
      }
    }
    // the box you're dragging round things
    if (grab?.kind === "box") {
      const [[x0, y0], [x1, y1]] = [grab.start, grab.at];
      children.push(svgEl("rect", { class: "marquee", x: round(Math.min(x0, x1)), y: round(Math.min(y0, y1)), width: round(Math.abs(x1 - x0)), height: round(Math.abs(y1 - y0)) }));
    }
    chosenSvg.replaceChildren(...children);
  }

  // which handle of what's picked up is at this point
  function handleAt(x, y) {
    const handles = chosenHandles();
    if (!handles) return null;
    const reach = HANDLE / zoom;
    if (Math.hypot(x - handles.turner[0], y - handles.turner[1]) <= reach) return { kind: "turn", middle: handles.middle };
    const i = handles.corners.findIndex(([cx, cy]) => Math.abs(x - cx) <= reach && Math.abs(y - cy) <= reach);
    if (i < 0) return null;
    return {
      kind: "size",
      corner: handles.local?.[i],
      opposite: handles.local?.[(i + 2) % 4],
      cornerAt: handles.corners[i],
      fixed: handles.corners[(i + 2) % 4],
    };
  }

  function pickUp(x, y, event) {
    const handleHere = handleAt(x, y);
    if (handleHere) return hold(handleHere.kind, [x, y], handleHere);
    const hit = topAt(x, y, 6);
    if (!hit) {
      grab = { kind: "box", start: [x, y], at: [x, y], base: event.shiftKey ? chosen : [] };
      if (!event.shiftKey) choose([]);
      return showChosen();
    }
    const now = Date.now();
    const into = lastDown.id === hit && now - lastDown.at < 400 && !!groupOf(hit);
    lastDown = { id: hit, at: now };
    const ids = into ? [hit] : withGroup(hit);
    if (event.shiftKey) {
      const had = ids.every((id) => chosen.includes(id));
      choose(had ? chosen.filter((id) => !ids.includes(id)) : [...chosen, ...ids]);
      if (had) return showChosen();
    } else if (into || !chosen.includes(hit)) choose(ids);
    hold("move", [x, y]);
  }

  function hold(kind, start, handleHere = {}) {
    const ids = chosen.filter((id) => kind === "move" || chosen.length === 1 || canTransform(shown.get(id)));
    const from = new Map(
      ids.map((id) => {
        const entry = shown.get(id);
        return [id, { ...entry.place, pivot: entry.place.pivot ?? pivotOf(entry) }];
      }),
    );
    grab = { ...handleHere, kind, start, ids, from, places: new Map(from) };
    root.dataset.grabbing = "";
    showChosen();
  }

  function grabTo(event) {
    const { x, y } = pagePoint(event);
    if (grab.kind === "box") return boxTo([x, y]);
    const { from, start, kind } = grab;
    const one = chosen.length === 1;
    for (const [id, was] of from) {
      let now;
      if (kind === "move") now = { ...was, at: [was.at[0] + x - start[0], was.at[1] + y - start[1]] };
      else if (one && kind === "size") now = resized(was, was.pivot, grab.corner, grab.opposite, [x, y], event.shiftKey);
      else if (one) now = turned(was, was.pivot, start, [x, y], event.shiftKey);
      else if (kind === "size") now = sizedAbout(was, was.pivot, grab.fixed, factorAbout(grab.fixed, grab.cornerAt, [x, y]));
      else now = turnedAbout(was, was.pivot, grab.middle, angleAbout(grab.middle, start, [x, y], event.shiftKey));
      grab.places.set(id, now);
      const entry = shown.get(id);
      if (entry) place(entry, now);
    }
    reconnect();
    showChosen();
    sendSoon(Object.fromEntries(grab.places));
  }

  // a box dragged round things picks up everything wholly inside it (and
  // the rest of their groups)
  function boxTo([x, y]) {
    grab.at = [x, y];
    const [x0, x1] = [Math.min(grab.start[0], x), Math.max(grab.start[0], x)];
    const [y0, y1] = [Math.min(grab.start[1], y), Math.max(grab.start[1], y)];
    const inside = [];
    for (const [id, entry] of shown) {
      const corners = handlesOf(entry).corners;
      if (corners.every(([cx, cy]) => cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1)) inside.push(...withGroup(id));
    }
    choose([...grab.base, ...inside]);
    showChosen();
  }

  // let go: what's changed goes in the doc, once
  function letGo(cancel) {
    const held = grab;
    grab = null;
    delete root.dataset.grabbing;
    if (held.kind === "box") return showChosen();
    const keys = held.kind === "move" ? ["at"] : held.kind === "size" ? ["at", "scale", "pivot"] : ["at", "turn", "pivot"];
    const set = [];
    for (const [id, was] of held.from) {
      const now = held.places.get(id);
      if (keys.every((key) => JSON.stringify(now[key]) === JSON.stringify(was[key]))) continue;
      set.push({ id, fields: Object.fromEntries(keys.map((key) => [key, now[key]])) });
    }
    sendNow(Object.fromEntries(cancel ? held.from : held.places), true);
    if (!cancel && set.length) act({ set });
    draw();
  }

  // ── the stack: what's on top of what (each layer's z), groups, and
  //    stacking things up in a row ─────────────────────────────────────────

  // each layer's id and z, bottom to top
  function zs() {
    const marks = marksNow();
    return ordered().map((mark) => [mark.id, keyOf(mark, marks.indexOf(mark))]);
  }
  // the layers with no z yet (from before there were), given where they are
  // in the list, before anything's put between them
  function settled() {
    return marksNow()
      .map((mark, i) => [mark, i])
      .filter(([mark]) => isLayer(mark) && !Number.isFinite(mark.z))
      .map(([mark, i]) => ({ id: mark.id, fields: { z: i } }));
  }

  // what's picked up: to the front, forward one, back one, or to the back
  function relayer(how) {
    const picked = new Set(chosen);
    if (!picked.size) return;
    const keys = new Map(zs());
    const was = [...keys.keys()];
    let list = [...was];
    if (how === "front") list = [...list.filter((id) => !picked.has(id)), ...list.filter((id) => picked.has(id))];
    else if (how === "back") list = [...list.filter((id) => picked.has(id)), ...list.filter((id) => !picked.has(id))];
    else if (how === "forward") {
      for (let i = list.length - 2; i >= 0; i--) if (picked.has(list[i]) && !picked.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else for (let i = 1; i < list.length; i++) if (picked.has(list[i]) && !picked.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    if (list.every((id, i) => id === was[i])) return;
    // each run of what's picked, spread out between what's either side of it
    const set = settled();
    for (let i = 0; i < list.length; ) {
      if (!picked.has(list[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < list.length && picked.has(list[j])) j++;
      const below = i > 0 ? keys.get(list[i - 1]) : null;
      const above = j < list.length ? keys.get(list[j]) : null;
      const low = below ?? (above ?? 0) - (j - i) - 1;
      const high = above ?? low + (j - i) + 1;
      for (let k = i; k < j; k++) set.push({ id: list[k], fields: { z: low + ((high - low) * (k - i + 1)) / (j - i + 1) } });
      i = j;
    }
    act({ set });
  }

  function group() {
    if (chosen.length < 2) return;
    const id = newId();
    act({ set: chosen.map((one) => ({ id: one, fields: { group: id } })) });
  }
  function ungroup() {
    const set = chosen.filter((id) => groupOf(id)).map((id) => ({ id, fields: { group: undefined } }));
    if (set.length) act({ set });
  }

  // what's picked up, in a row (across, or down), GAP apart, in the order
  // they're in that way now. a group goes as one
  const GAP = 16;
  function stackUp(across) {
    const a = across ? 0 : 1;
    const units = unitsOf(chosen)
      .map((ids) => ({ ids, box: boxOf(ids) }))
      .filter(({ box }) => box)
      .sort((p, q) => p.box.corners[0][a] - q.box.corners[0][a]);
    if (units.length < 2) return;
    let next = units[0].box.corners[0][a];
    const set = [];
    for (const { ids, box } of units) {
      const by = next - box.corners[0][a];
      next = box.corners[2][a] + by + GAP;
      if (Math.abs(by) < 0.05) continue;
      for (const id of ids) {
        const at = [...shown.get(id).place.at];
        at[a] += by;
        set.push({ id, fields: { at } });
      }
    }
    if (set.length) act({ set });
  }

  // ── presence: what you've picked up and how you're holding it, to
  //    everyone with the doc open, and theirs to you ──────────────────────

  const me = { id: uid, colour: colourFor(uid), name: "" };
  try {
    const contactUrl = globalThis.accountDocHandle?.doc()?.contactUrl;
    if (typeof contactUrl === "string" && contactUrl) {
      me.colour = colourFor(contactUrl);
      globalThis.repo
        ?.find(contactUrl)
        .then((contact) => {
          const doc = contact.doc();
          if (HEX.test(doc?.color ?? "")) me.colour = doc.color;
          if (typeof doc?.name === "string") me.name = doc.name.slice(0, 40);
          say();
        })
        .catch(() => {});
    }
  } catch {}

  let sent = 0;
  function broadcast(message) {
    try {
      handle.broadcast?.({ skitch: 1, from: me.id, n: ++sent, colour: me.colour, name: me.name, chosen: state.tool === "move" ? chosen : [], ...message });
    } catch {}
  }
  const say = () => broadcast({});
  let outgoing = {};
  let sendTimer = 0;
  function sendSoon(places) {
    Object.assign(outgoing, places);
    sendTimer ||= setTimeout(() => sendNow({}), SEND_EVERY);
  }
  function sendNow(places, done = false) {
    clearTimeout(sendTimer);
    sendTimer = 0;
    Object.assign(outgoing, places);
    if (!Object.keys(outgoing).length && !done) return;
    broadcast({ places: outgoing, done });
    outgoing = {};
  }
  // (and again, every so often, for anyone who's only just come)
  const again = setInterval(() => chosen.length && state.tool === "move" && say(), AGAIN);

  const theirs = new Map(); // who → {colour, name, chosen, until, n}
  const live = new Map(); // a layer's id → {place, until}: someone's holding it
  function heard({ message }) {
    if (message?.skitch !== 1 || typeof message.from !== "string" || message.from === me.id) return;
    const before = theirs.get(message.from);
    if (!(message.n > (before?.n ?? 0))) return; // (out of order: older)
    const now = Date.now();
    const picked = Array.isArray(message.chosen) ? message.chosen : [message.chosen];
    theirs.set(message.from, {
      n: message.n,
      colour: HEX.test(message.colour ?? "") ? message.colour : colourFor(message.from),
      name: typeof message.name === "string" ? message.name.slice(0, 40) : "",
      chosen: picked.filter((id) => typeof id === "string").slice(0, 1000),
      until: message.bye ? 0 : now + CHOSEN_QUIET,
    });
    if (isObject(message.places))
      for (const [id, value] of Object.entries(message.places)) {
        if (grab?.places?.has(id)) continue;
        live.set(id, { place: placeOf(value), until: now + (message.done ? 1500 : LIVE_QUIET) });
      }
    placeAll();
  }
  handle.on?.("ephemeral-message", heard);
  // theirs, gone quiet
  const prune = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, one] of live) if (one.until <= now) live.delete(id), (changed = true);
    for (const [who, one] of theirs) if (one.until <= now) theirs.delete(who), (changed = true);
    if (changed) placeAll();
  }, 500);

  // wm's pointers (and ink), on the page: a point's where it is in the page's
  // units, whatever size the pane is
  element.inkSpace = {
    at(x, y) {
      const m = liveSvg.getScreenCTM();
      if (!m) return null;
      const at = new DOMPoint(x, y).matrixTransform(m.inverse());
      return { x: round(at.x), y: round(at.y) };
    },
    place({ x, y }) {
      const m = liveSvg.getScreenCTM();
      if (!m || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const at = new DOMPoint(x, y).matrixTransform(m);
      return { x: at.x, y: at.y, scale: Math.hypot(m.a, m.b) };
    },
  };

  // ── ink and sketchy shapes: drawn here, in liveSvg ──────────────────────

  // every point the pointer went through (some browsers give none)
  const coalesced = (event) => {
    const all = event.getCoalescedEvents?.();
    return all?.length ? all : [event];
  };
  const pagePoint = (event) => new DOMPoint(event.clientX, event.clientY).matrixTransform(liveSvg.getScreenCTM().inverse());

  let drawn = null; // what's being drawn: {mark, el}
  liveSvg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const { x, y } = pagePoint(event);
    const { tool, colour } = state;
    const size = SIZES[state.size];
    if (tool === "fill") return void pour(x, y);
    liveSvg.setPointerCapture(event.pointerId);
    if (tool === "move") return pickUp(x, y, event);
    if (tool === "eraser") {
      rubbing = { id: newId(), weight: size * 3, raw: [], points: [], on: new Map() };
      return rubTo(event);
    }
    const mark =
      tool === "ink"
        ? { id: newId(), kind: "ink", color: colour, size: size * 1.6 + 2, pen: event.pointerType === "pen", raw: [[x, y, event.pressure || 0.5]] }
        : { id: newId(), kind: "rough", shape: tool, color: colour, size: size * 0.5 + 1, fill: state.filled, seed: Math.floor(Math.random() * 2 ** 31), x1: round(x), y1: round(y), x2: round(x), y2: round(y) };
    drawn = { mark, el: null };
    drawTo(event);
  });
  liveSvg.addEventListener("pointermove", (event) => {
    if (grab) return grabTo(event);
    if (rubbing) {
      if (event.buttons & 1) for (const one of coalesced(event)) rubTo(one);
      return;
    }
    if (drawn) return drawTo(event);
    if (state.tool === "move") {
      const { x, y } = pagePoint(event);
      root.dataset.over = handleAt(x, y)?.kind ?? (topAt(x, y, 6) ? "layer" : "");
    }
  });
  liveSvg.addEventListener("pointerup", () => {
    if (grab) letGo();
    if (rubbing) rubOut();
    end();
  });
  liveSvg.addEventListener("pointercancel", () => {
    if (grab) letGo(true);
    if (rubbing) (rubbing = null), draw();
    drawn = null;
    liveSvg.replaceChildren();
    showChosen();
  });

  async function drawTo(event) {
    const { mark } = drawn;
    if (mark.kind === "ink") {
      for (const one of coalesced(event)) {
        const { x, y } = pagePoint(one);
        mark.raw.push([x, y, mark.pen ? one.pressure : 0.5]);
      }
      mark.points = flat(mark.raw);
      return show(inkPath(mark, false));
    }
    const { x, y } = pagePoint(event);
    Object.assign(mark, constrain({ ...mark, x2: x, y2: y }, event.shiftKey));
    if (isConnector(mark)) showChosen(anchorAt([mark.x2, mark.y2])?.id);
    show(roughShape(await loadRough(), mark));
  }
  function show(made) {
    if (!drawn) return;
    drawn.el?.remove();
    liveSvg.append((drawn.el = made));
  }
  function end() {
    if (!drawn) return;
    const { mark } = drawn;
    drawn = null;
    liveSvg.replaceChildren();
    showChosen();
    if (mark.kind === "ink") {
      const { raw, ...rest } = mark;
      return act({ add: [{ ...rest, points: flat(raw) }] });
    }
    const { x1, y1, x2, y2 } = mark;
    if (Math.hypot(x2 - x1, y2 - y1) < 2) return;
    const made = { ...mark, x2: round(x2), y2: round(y2) };
    if (isConnector(made)) {
      const ends = holdOn([x1, y1], [made.x2, made.y2]);
      if (ends) made.ends = ends;
    }
    act({ add: [made] });
  }

  // ── tools: which layer gets the pointer, and the libraries' settings ────

  const libraryFor = (tool) => {
    const [, , , by] = TOOLS.find(([id]) => id === tool);
    return by === "shape" ? (state.sketchy ? "rough" : "drauu") : by;
  };
  function settle() {
    const { tool, colour } = state;
    const size = SIZES[state.size];
    const by = libraryFor(tool);
    root.dataset.layer = by === "atrament" ? "paint" : by === "drauu" ? "drauu" : "live";
    root.dataset.tool = tool;
    if (tool !== "move") root.dataset.over = "";
    if (by === "atrament") loadPad();
    if (by === "drauu") loadDrauu();
    if (pad) Object.assign(pad, { mode: "draw", color: colour, weight: size * 1.5 });
    if (drauu && DRAUU_MODES[tool])
      drauu.brush = { mode: DRAUU_MODES[tool], color: colour, size, arrowEnd: tool === "arrow", fill: state.filled && (tool === "rect" || tool === "ellipse") ? `${colour}33` : "transparent" };
    showChosen();
    drawBar();
    say();
  }

  // the bar's made once; drawBar says what's pressed and what can be
  const pressed = []; // [button, is it pressed?]
  const enabled = []; // [button, can it be?]
  const button = (content, title, onclick, { on, can, className = "", css, key } = {}) => {
    const b = el("button", { type: "button", title: key ? `${title} · ${key}` : title, className, onclick }, ...[content].flat().filter(Boolean));
    if (key) b.append(el("kbd", { textContent: key }));
    b.setAttribute("aria-label", title);
    if (css) b.style.setProperty(...css);
    if (on) pressed.push([b, on]);
    if (can) enabled.push([b, can]);
    return b;
  };
  const tray = (className, ...children) => el("div", { className: `skitch-tray ${className}` }, ...children);
  const picker = el("input", { type: "color", title: "another colour · 7" });
  picker.setAttribute("aria-label", "another colour");
  picker.oninput = () => set({ colour: picker.value });
  const more = el("label", { className: "skitch-more" }, picker, el("kbd", { textContent: "7" }));
  const isShape = () => ["line", "arrow", "rect", "ellipse"].includes(state.tool);
  const isBox = () => ["rect", "ellipse"].includes(state.tool);
  const tool = ([id, label, key, , title]) =>
    button(icon(id), `${label}: ${title}`, () => set({ tool: id }), { on: () => state.tool === id, className: "skitch-tool", key });
  // what's picked up: its place in the stack, groups, in a row. it's only
  // there while something is
  const several = () => unitsOf(chosen).length > 1;
  const arrange = tray(
    "skitch-arrange",
    button(icon("front"), "to the front", () => relayer("front"), { key: "⇧]" }),
    button(icon("forward"), "forward one", () => relayer("forward"), { key: "]" }),
    button(icon("backward"), "back one", () => relayer("backward"), { key: "[" }),
    button(icon("back"), "to the back", () => relayer("back"), { key: "⇧[" }),
    button(icon("group"), "group them: picking one picks them all (twice: just it)", group, { key: "⌘g", can: () => chosen.length > 1 }),
    button(icon("ungroup"), "ungroup them", ungroup, { key: "⇧⌘g", can: () => chosen.some((id) => groupOf(id)) }),
    button(icon("across"), "stack them up across, side by side", () => stackUp(true), { can: several }),
    button(icon("down"), "stack them up down, one under another", () => stackUp(false), { can: several }),
  );
  bar.append(
    ...TRAYS.map((ids) => tray("", ...ids.map((id) => tool(TOOLS.find(([one]) => one === id))))),
    tray(
      "",
      button(icon("sketchy"), "sketchy: shapes drawn by hand (rough.js), or clean (drauu)", () => set({ sketchy: !state.sketchy }), { on: () => state.sketchy, can: isShape, key: "s" }),
      button(icon("filled"), "filled: boxes and ovals filled in", () => set({ filled: !state.filled }), { on: () => state.filled, can: isBox, key: "⇧f" }),
    ),
    tray(
      "skitch-colours",
      ...COLOURS.map((colour, i) =>
        button(el("kbd", { textContent: i + 1 }), colour, () => set({ colour }), { on: () => state.colour === colour, className: "skitch-swatch", css: ["--c", colour] }),
      ),
      more,
    ),
    tray(
      "",
      ...SIZES.map((size, i) =>
        button("", `${["thin", "medium", "thick"][i]} · [ and ]`, () => set({ size: i }), { on: () => state.size === i, className: "skitch-size", css: ["--s", `${size + 2}px`] }),
      ),
    ),
    tray(
      "",
      button(icon("undo"), "undo what you did · ⌘z", undo, { can: () => history.length }),
      button(icon("redo"), "redo it · ⇧⌘z", redo, { can: () => future.length }),
      button(icon("clear"), "take everything off the page (undo puts it back)", () => act({ remove: marksNow().map((mark) => mark.id) }), {
        can: () => marksNow().length,
      }),
    ),
  );
  // (over the page, so picking something up doesn't move the page down)
  const floating = el("div", { className: "skitch-bar skitch-float" }, arrange);
  stage.append(floating);
  function drawBar() {
    for (const [b, on] of pressed) b.setAttribute("aria-pressed", String(!!on()));
    for (const [b, can] of enabled) b.disabled = !can();
    floating.hidden = !(state.tool === "move" && chosen.length);
    root.style.setProperty("--skitch-colour", state.colour);
    more.toggleAttribute("data-on", !COLOURS.includes(state.colour));
    if (document.activeElement !== picker) picker.value = state.colour;
  }

  function set(changes) {
    Object.assign(state, changes);
    settle();
  }

  root.addEventListener("pointerdown", () => root.focus({ preventScroll: true }));
  root.addEventListener("keydown", (event) => {
    if (event.target.closest?.("input")) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const holding = state.tool === "move" && chosen.length > 0;
    // [ and ]: what's picked up, back and forth in the stack (shift: all
    // the way); or else, the size
    const bracket = event.code === "BracketRight" ? 1 : event.code === "BracketLeft" ? -1 : 0;
    if (bracket && (holding || mod) && !event.altKey) {
      event.preventDefault();
      return relayer(bracket > 0 ? (event.shiftKey ? "front" : "forward") : event.shiftKey ? "back" : "backward");
    }
    if (mod && key === "z") return event.preventDefault(), event.shiftKey ? redo() : undo();
    if (mod && key === "y") return event.preventDefault(), redo();
    if (mod && key === "a") {
      event.preventDefault();
      if (state.tool !== "move") set({ tool: "move" });
      return choose([...shown.keys()]), showChosen();
    }
    if (mod && key === "g") return event.preventDefault(), event.shiftKey ? ungroup() : group();
    if (mod || event.altKey) return;
    if ((key === "backspace" || key === "delete") && holding) {
      event.preventDefault();
      const ids = chosen;
      choose([]);
      return act({ remove: ids });
    }
    if (key === "escape") return choose([]), showChosen();
    if (event.shiftKey && key === "f") return set({ filled: !state.filled });
    if (/^[1-6]$/.test(key)) return set({ colour: COLOURS[key - 1] });
    if (key === "7") return picker.click();
    if (bracket) return set({ size: Math.max(0, Math.min(SIZES.length - 1, state.size + bracket)) });
    if (key === "s") return set({ sketchy: !state.sketchy });
    const tool = TOOLS.find(([, , k]) => k === key);
    if (tool) set({ tool: tool[0] });
  });

  // the page, as big as fits
  const fit = new ResizeObserver(() => {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    zoom = Math.min((width - 24) / W, (height - 24) / H);
    page.style.transform = `translate(${(width - W * zoom) / 2}px, ${(height - H * zoom) / 2}px) scale(${zoom})`;
    showChosen();
  });
  fit.observe(stage);

  const changed = () => draw();
  handle.on("change", changed);
  settle();
  draw();

  return () => {
    gone = true;
    broadcast({ chosen: [], bye: true });
    clearInterval(again);
    clearInterval(prune);
    clearTimeout(sendTimer);
    handle.off?.("ephemeral-message", heard);
    handle.off("change", changed);
    delete element.inkSpace;
    fit.disconnect();
    pad?.destroy();
    replay?.destroy();
    drauu?.unmount();
    worker?.terminate();
    root.remove();
    style.remove();
  };
}
