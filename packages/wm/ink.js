// ink: while you follow someone, pressing and dragging over their panes
// draws, in your colour, and they see it too, as does anyone else looking at
// the same doc. it fades away a moment after you stop. perfect-freehand
// draws it, set as tldraw draws (a "m" stroke: tldraw's DrawShapeUtil and
// draw/getPath.ts, 5.2.5)
//
// a stroke is pinned to what's under where it starts, so it stays on that as
// each person's view moves, as aftersun's ink does:
//   text     a character in a codemirror editor: the stroke goes where that
//            character is, as it scrolls
//   space    a point in a tool's own space, for a tool that says what's
//            where (its element's inkSpace, below): it goes where that point
//            is, and grows and shrinks as it's zoomed
//   pane     else, a place in the pane, as a fraction of it
// a stroke's points are pixels from where it started, as it was drawn; on
// screen they're scaled by how much more (or less) zoomed in that place is now
//
// a tool's element can have `inkSpace`: {at(x, y), place(at)}. at takes a
// point on the page (client px) and gives something plain (json) saying what's
// there, or null for nothing; place takes that and gives {x, y, scale} (where
// it is on the page now, and how many page px a unit of its space is), or null
// if it isn't to be seen
import { getStroke } from "./vendor/perfect-freehand.js";

const KIND = "ink";
// tldraw's, for its default size: its theme's strokeWidth (2) times the "m"
// size (1.75), plus one
const STROKE = 2 * 1.75 + 1;
const easeOutSine = (t) => Math.sin((t * Math.PI) / 2);
const penEasing = (t) => t * 0.65 + Math.sin((t * Math.PI) / 2) * 0.35;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const modulate = (value, [fromLow, fromHigh], [low, high]) =>
  clamp(low + ((value - fromLow) / (fromHigh - fromLow)) * (high - low), Math.min(low, high), Math.max(low, high));
// a mouse's pressure is made up from its speed; a pen's is its own
const MOUSE = {
  size: STROKE,
  thinning: 0.5,
  streamline: modulate(STROKE, [9, 16], [0.64, 0.74]),
  smoothing: 0.62,
  easing: easeOutSine,
  simulatePressure: true,
};
const PEN = {
  size: 1 + STROKE * 1.2,
  thinning: 0.62,
  streamline: 0.62,
  smoothing: 0.62,
  easing: penEasing,
  simulatePressure: false,
};

// how long it stays after you stop drawing, then how long it takes to go
const HOLD = 1000;
const FADE = 700;
// a stroke still being drawn that's heard nothing for this long is done
const STALE = 4000;
// how often what's being drawn goes to everyone else, at most
const SEND_EVERY = 40;
const MAX_POINTS = 4000;

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const round = (n) => Math.round(n * 10) / 10;

// codemirror's view, which the editors in the panes share (patchwork's
// importmap has it): for pinning to a character. without it, text's a pane
let EditorView = null;
import("@codemirror/view").then(
  (view) => (EditorView = view.EditorView),
  () => {},
);

function editorsIn(el) {
  return el ? [...el.querySelectorAll(".cm-editor")] : [];
}
const inside = (rect, x, y) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

// what's under (x, y) in `pane`, to pin a stroke to: {anchor, scale, origin}
function anchorAt(pane, x, y) {
  const space = pane.el?.inkSpace;
  if (space) {
    try {
      const at = space.at(x, y);
      const placed = at == null ? null : space.place(at);
      if (placed && finite(placed.x) && finite(placed.y) && finite(placed.scale) && placed.scale > 0) {
        return { anchor: { kind: "space", at }, scale: placed.scale, origin: { x: placed.x, y: placed.y } };
      }
    } catch (error) {
      console.warn("[wm] ink: a tool's inkSpace failed", error);
    }
  }
  if (EditorView) {
    const editors = editorsIn(pane.el);
    const index = editors.findIndex((editor) => inside(editor.getBoundingClientRect(), x, y));
    const view = index >= 0 && EditorView.findFromDOM(editors[index]);
    if (view) {
      const pos = view.posAtCoords({ x, y }, false);
      const at = pos == null ? null : view.coordsAtPos(pos);
      if (at) return { anchor: { kind: "text", editor: index, pos }, scale: 1, origin: { x: at.left, y: at.top } };
    }
  }
  const box = pane.body.getBoundingClientRect();
  return {
    anchor: { kind: "pane", x: (x - box.left) / box.width, y: (y - box.top) / box.height },
    scale: 1,
    origin: { x, y },
  };
}

// where a stroke's start is in `pane` now, and how much it's scaled: {x, y,
// k}, or null if it's not to be seen there
function placeIn(stroke, pane) {
  const { anchor } = stroke;
  if (anchor.kind === "space") {
    const space = pane.el?.inkSpace;
    if (!space) return null;
    try {
      const placed = space.place(anchor.at);
      if (!placed || !finite(placed.x) || !finite(placed.y) || !finite(placed.scale)) return null;
      return { x: placed.x, y: placed.y, k: placed.scale / stroke.scale };
    } catch {
      return null;
    }
  }
  if (anchor.kind === "text") {
    const editors = editorsIn(pane.el);
    const editor = editors[anchor.editor] ?? editors[0];
    const view = editor && EditorView?.findFromDOM(editor);
    if (!view) return null;
    const at = view.coordsAtPos(Math.min(anchor.pos, view.state.doc.length));
    return at ? { x: at.left, y: at.top, k: 1 } : null;
  }
  const box = pane.body.getBoundingClientRect();
  return { x: box.left + anchor.x * box.width, y: box.top + anchor.y * box.height, k: 1 };
}

function anchorFrom(value) {
  if (!isObject(value)) return null;
  if (value.kind === "space" && "at" in value) return { kind: "space", at: value.at };
  if (value.kind === "text" && Number.isInteger(value.editor) && Number.isInteger(value.pos) && value.pos >= 0) {
    return { kind: "text", editor: value.editor, pos: value.pos };
  }
  if (value.kind === "pane" && finite(value.x) && finite(value.y)) return { kind: "pane", x: value.x, y: value.y };
  return null;
}

// an outline (perfect-freehand's polygon) as a path, its corners smoothed
function pathOf(outline) {
  if (!outline.length) return "";
  const d = ["M", round(outline[0][0]), round(outline[0][1]), "Q"];
  outline.forEach(([x0, y0], i) => {
    const [x1, y1] = outline[(i + 1) % outline.length];
    d.push(round(x0), round(y0), round((x0 + x1) / 2), round((y0 + y1) / 2));
  });
  d.push("Z");
  return d.join(" ");
}

/**
 * ink, for a workspace.
 *   panes()   the panes there are: [{body, svg, panel: {url, tool} or null,
 *             el}]: body is where the pane's tool is (the part under its
 *             tabs), svg is where ink's drawn in it, el the tool's element
 *   send(m)   says m to everyone else in the room
 *   me()      your colour: {colour}
 * returns {start(event), move(event), end(event), receive(message), stop()}:
 * start, move and end are a pointer's down, moves and up over the panes,
 * while you're following; receive is someone else's ink message
 */
export function createInk({ panes, send, me }) {
  const mine = crypto.randomUUID();
  // by id: {id, from, colour, url, tool, anchor, scale, pen, points, done,
  // at, path, version}
  const strokes = new Map();
  // by who drew: when they last did
  const lastBy = new Map();
  let frame = null;
  let drawing = null;
  let unsent = 0;
  let sendTimer = null;

  function touch(from) {
    lastBy.set(from, performance.now());
    if (frame == null) frame = requestAnimationFrame(draw);
  }

  // ── yours ────────────────────────────────────────────────────────────

  function paneAt(x, y) {
    return panes().find((pane) => pane.panel && inside(pane.body.getBoundingClientRect(), x, y)) ?? null;
  }

  function point(event, origin) {
    return [round(event.clientX - origin.x), round(event.clientY - origin.y), event.pointerType === "pen" ? round(event.pressure || 0.5) : 0.5];
  }

  function start(event) {
    if (event.button !== 0) return false;
    const pane = paneAt(event.clientX, event.clientY);
    if (!pane) return false;
    const { anchor, scale, origin } = anchorAt(pane, event.clientX, event.clientY);
    drawing = {
      id: crypto.randomUUID(),
      from: mine,
      colour: me().colour,
      url: pane.panel.url,
      tool: pane.panel.tool,
      anchor,
      scale,
      pen: event.pointerType === "pen",
      points: [],
      done: false,
      origin,
      version: 0,
    };
    strokes.set(drawing.id, drawing);
    unsent = 0;
    add(event);
    return true;
  }

  function add(event) {
    const events = event.getCoalescedEvents?.() ?? [];
    for (const one of events.length ? events : [event]) {
      if (drawing.points.length >= MAX_POINTS) break;
      drawing.points.push(point(one, drawing.origin));
    }
    drawing.version++;
    touch(mine);
    sendTimer ??= setTimeout(flush, SEND_EVERY);
  }

  function move(event) {
    if (drawing) add(event);
  }

  function end() {
    if (!drawing) return;
    drawing.done = true;
    drawing.version++;
    clearTimeout(sendTimer);
    flush();
    drawing = null;
    touch(mine);
  }

  // what's been drawn since it last went, to everyone else
  function flush() {
    sendTimer = null;
    const stroke = drawing ?? [...strokes.values()].findLast((s) => s.from === mine);
    if (!stroke) return;
    const { id, colour, url, tool, anchor, scale, pen, points, done } = stroke;
    send({ "lattice-wm": KIND, from: mine, id, colour, url, tool, anchor, scale, pen, at: unsent, points: points.slice(unsent), done });
    unsent = points.length;
  }

  // ── theirs ───────────────────────────────────────────────────────────

  function receive(message) {
    if (!isObject(message) || message["lattice-wm"] !== KIND) return;
    const { from, id, url, tool, scale, at, points } = message;
    const anchor = anchorFrom(message.anchor);
    if (typeof from !== "string" || from === mine || typeof id !== "string") return;
    if (typeof url !== "string" || typeof tool !== "string" || !anchor) return;
    if (!finite(scale) || scale <= 0 || !Number.isInteger(at) || at < 0 || at > MAX_POINTS || !Array.isArray(points)) return;
    let stroke = strokes.get(id);
    if (!stroke) {
      stroke = { id, from, url, tool, anchor, scale, pen: !!message.pen, points: [], done: false, version: 0 };
      strokes.set(id, stroke);
    }
    stroke.colour = typeof message.colour === "string" ? message.colour.slice(0, 100) : "";
    points.slice(0, MAX_POINTS - at).forEach((p, i) => {
      if (Array.isArray(p) && finite(p[0]) && finite(p[1])) stroke.points[at + i] = [p[0], p[1], finite(p[2]) ? p[2] : 0.5];
    });
    if (message.done) stroke.done = true;
    stroke.version++;
    touch(from);
  }

  // ── drawing them ─────────────────────────────────────────────────────

  // by pane svg, each stroke's <path> in it
  const drawn = new WeakMap();

  function opacityOf(stroke, now) {
    const since = now - (lastBy.get(stroke.from) ?? 0);
    const stillGoing = [...strokes.values()].some((s) => s.from === stroke.from && !s.done && since < STALE);
    if (stillGoing) return 1;
    return since < HOLD ? 1 : clamp(1 - (since - HOLD) / FADE, 0, 1);
  }

  function outlineOf(stroke) {
    if (stroke.path?.version === stroke.version) return stroke.path.d;
    const points = stroke.points.filter(Boolean);
    const outline = points.length ? getStroke(points, { ...(stroke.pen ? PEN : MOUSE), last: stroke.done }) : [];
    stroke.path = { version: stroke.version, d: pathOf(outline) };
    return stroke.path.d;
  }

  function draw() {
    frame = null;
    const now = performance.now();
    const opacity = new Map();
    for (const stroke of strokes.values()) {
      const o = opacityOf(stroke, now);
      if (o <= 0) strokes.delete(stroke.id);
      else opacity.set(stroke.id, o);
    }
    for (const pane of panes()) {
      const svg = pane.svg;
      if (!svg) continue;
      const paths = drawn.get(svg) ?? new Map();
      drawn.set(svg, paths);
      const box = svg.getBoundingClientRect();
      const seen = new Set();
      for (const stroke of strokes.values()) {
        if (!pane.panel || stroke.url !== pane.panel.url || stroke.tool !== pane.panel.tool) continue;
        const at = placeIn(stroke, pane);
        if (!at) continue;
        seen.add(stroke.id);
        let path = paths.get(stroke.id);
        if (!path) {
          path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          svg.append(path);
          paths.set(stroke.id, path);
        }
        path.setAttribute("d", outlineOf(stroke));
        path.setAttribute("transform", `translate(${round(at.x - box.left)} ${round(at.y - box.top)}) scale(${at.k})`);
        path.style.fill = stroke.colour || "currentColor";
        path.style.opacity = String(opacity.get(stroke.id));
      }
      for (const [id, path] of paths) {
        if (seen.has(id)) continue;
        path.remove();
        paths.delete(id);
      }
    }
    // again next frame while there's any: views move, and ink fades
    if (strokes.size) frame = requestAnimationFrame(draw);
  }

  return {
    start,
    move,
    end,
    receive,
    stop() {
      cancelAnimationFrame(frame);
      clearTimeout(sendTimer);
      strokes.clear();
      for (const pane of panes()) pane.svg?.replaceChildren();
    },
  };
}
