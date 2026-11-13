// what's under a point in a pane, said so that someone else can find the
// same thing in theirs: their pane's not the size of yours, nor scrolled or
// zoomed as yours is, so where it is in the pane won't do. ink's strokes are
// pinned to one (ink.js), and so are pointers (workspace.js). one's:
//   space    a point in a tool's own space, for a tool that says what's
//            where (its element's inkSpace, below): it's where that point
//            is, and grows and shrinks as it's zoomed
//   text     a character in a codemirror editor: it's where that character
//            is, as it scrolls
//   element  an element in the tool (by child indices from the tool's own),
//            and where in it: it's there, wherever that is now. in what it
//            scrolls, if it does
//   pane     else, a place in the pane, as a fraction of it
//
// a tool's element can have `inkSpace`: {at(x, y), place(at)}. at takes a
// point on the page (client px) and gives something plain (json) saying what's
// there, or null for nothing; place takes that and gives {x, y, scale} (where
// it is on the page now, and how many page px a unit of its space is), or null
// if it isn't to be seen
//
// a pane here is {body, el}: body is where its tool is (the part under its
// tabs), el the tool's element (or null, before there is one)

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const fraction = (n) => Math.round(n * 10000) / 10000;
// how far down an element's looked for, and past how many children it isn't
const MAX_DEPTH = 64;
const MAX_CHILDREN = 1000;

// codemirror's view, which the editors in the panes share (patchwork's
// importmap has it): for pinning to a character. without it, text's an
// element
let EditorView = null;
import("@codemirror/view").then(
  (view) => (EditorView = view.EditorView),
  () => {},
);

function editorsIn(el) {
  return el ? [...el.querySelectorAll(".cm-editor")] : [];
}
export const inside = (rect, x, y) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

// the deepest element of `root`'s that (x, y) is in, and its path from
// there (child indices). it's by where they are, not hit testing: while
// you're following, the panes are inert, and nothing in them can be hit.
// later ones first, as they're drawn over earlier ones
function elementUnder(root, x, y) {
  const path = [];
  let at = root;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const children = at.children;
    if (children.length > MAX_CHILDREN) break;
    let next = -1;
    for (let i = children.length - 1; i >= 0; i--) {
      const rect = children[i].getBoundingClientRect();
      if (rect.width && rect.height && inside(rect, x, y)) {
        next = i;
        break;
      }
    }
    if (next < 0) break;
    path.push(next);
    at = children[next];
  }
  return { el: at, path };
}
function elementAt(root, path) {
  let at = root;
  for (const index of path) at = at?.children[index];
  return at ?? null;
}

// where in an element a point is: fractions of it, or of what it scrolls,
// if it does (so it's on the same part of what's in it, scrolled however).
// and back
const scrolls = (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
function within(el, x, y) {
  const rect = el.getBoundingClientRect();
  if (scrolls(el)) {
    return {
      x: (x - rect.left - el.clientLeft + el.scrollLeft) / el.scrollWidth,
      y: (y - rect.top - el.clientTop + el.scrollTop) / el.scrollHeight,
    };
  }
  return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
}
function placeWithin(el, x, y) {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  if (scrolls(el)) {
    return {
      x: rect.left + el.clientLeft - el.scrollLeft + x * el.scrollWidth,
      y: rect.top + el.clientTop - el.scrollTop + y * el.scrollHeight,
    };
  }
  return { x: rect.left + x * rect.width, y: rect.top + y * rect.height };
}

/**
 * what's under (x, y) (client px) in `pane`: {anchor, scale, origin}.
 * origin is where the anchor is on the page, which needn't be (x, y) (a
 * character's corner, say); scale is how many page px a unit of its space
 * is, there
 */
export function anchorAt(pane, x, y) {
  const space = pane.el?.inkSpace;
  if (space) {
    try {
      const at = space.at(x, y);
      const placed = at == null ? null : space.place(at);
      if (placed && finite(placed.x) && finite(placed.y) && finite(placed.scale) && placed.scale > 0) {
        return { anchor: { kind: "space", at }, scale: placed.scale, origin: { x: placed.x, y: placed.y } };
      }
    } catch (error) {
      console.warn("[wm] anchor: a tool's inkSpace failed", error);
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
  if (pane.el && inside(pane.el.getBoundingClientRect(), x, y)) {
    const { el, path } = elementUnder(pane.el, x, y);
    const at = within(el, x, y);
    if (finite(at.x) && finite(at.y)) {
      return {
        anchor: { kind: "element", path, tag: el.localName, x: fraction(at.x), y: fraction(at.y) },
        scale: 1,
        origin: { x, y },
      };
    }
  }
  const box = pane.body.getBoundingClientRect();
  return {
    anchor: { kind: "pane", x: fraction((x - box.left) / box.width), y: fraction((y - box.top) / box.height) },
    scale: 1,
    origin: { x, y },
  };
}

/**
 * where `anchor` is in `pane` now (client px), and how much more (or less)
 * zoomed in it is than when it was made at `scale`: {x, y, k}, or null if
 * it's not to be seen there
 */
export function placeAnchor(anchor, scale, pane) {
  if (anchor.kind === "space") {
    const space = pane.el?.inkSpace;
    if (!space) return null;
    try {
      const placed = space.place(anchor.at);
      if (!placed || !finite(placed.x) || !finite(placed.y) || !finite(placed.scale)) return null;
      return { x: placed.x, y: placed.y, k: placed.scale / scale };
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
  if (anchor.kind === "element") {
    const el = pane.el && elementAt(pane.el, anchor.path);
    if (!el || el.localName !== anchor.tag) return null;
    const at = placeWithin(el, anchor.x, anchor.y);
    return at ? { ...at, k: 1 } : null;
  }
  const box = pane.body.getBoundingClientRect();
  return { x: box.left + anchor.x * box.width, y: box.top + anchor.y * box.height, k: 1 };
}

/** an anchor someone sent, checked, or null */
export function anchorFrom(value) {
  if (!isObject(value)) return null;
  if (value.kind === "space" && "at" in value) return { kind: "space", at: value.at };
  if (value.kind === "text" && Number.isInteger(value.editor) && Number.isInteger(value.pos) && value.pos >= 0) {
    return { kind: "text", editor: value.editor, pos: value.pos };
  }
  if (
    value.kind === "element" &&
    Array.isArray(value.path) &&
    value.path.length <= MAX_DEPTH &&
    value.path.every((n) => Number.isInteger(n) && n >= 0) &&
    typeof value.tag === "string" &&
    finite(value.x) &&
    finite(value.y)
  ) {
    return { kind: "element", path: value.path, tag: value.tag, x: value.x, y: value.y };
  }
  if (value.kind === "pane" && finite(value.x) && finite(value.y)) return { kind: "pane", x: value.x, y: value.y };
  return null;
}
