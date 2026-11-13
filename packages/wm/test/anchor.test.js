import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorAt, anchorFrom, placeAnchor } from "../anchor.js";

// an element, as far as anchor.js looks at one: where it is, what's in it,
// and how it scrolls
function el(localName, box, children = [], scroll = {}) {
  const node = {
    localName,
    children,
    box,
    clientLeft: 0,
    clientTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: box.width,
    clientHeight: box.height,
    scrollWidth: box.width,
    scrollHeight: box.height,
    ...scroll,
    getBoundingClientRect() {
      const { left, top, width, height } = node.box;
      return { left, top, width, height, right: left + width, bottom: top + height };
    },
  };
  return node;
}

// a pane: a tool that scrolls a list of rows, `rowHeight` tall each, at
// `left`, `top`, `width` wide, scrolled down `scrollTop`
function pane({ left, top, width, height, rowHeight, scrollTop }) {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push(el("li", { left, top: top + i * rowHeight - scrollTop, width, height: rowHeight }));
  }
  const list = el("ul", { left, top, width, height }, rows, {
    scrollTop,
    scrollHeight: rows.length * rowHeight,
  });
  const tool = el("div", { left, top, width, height }, [list]);
  return { body: tool, el: tool };
}

test("a point on a row is on that row in a pane of another size, scrolled otherwise", () => {
  const mine = pane({ left: 0, top: 0, width: 400, height: 300, rowHeight: 20, scrollTop: 0 });
  // row 3, a quarter of the way along it, three quarters down it
  const { anchor, origin } = anchorAt(mine, 100, 3 * 20 + 15);
  assert.deepEqual(origin, { x: 100, y: 75 });
  assert.equal(anchor.kind, "element");
  assert.deepEqual(anchor.path, [0, 3]);
  assert.equal(anchor.tag, "li");

  const theirs = pane({ left: 50, top: 80, width: 800, height: 500, rowHeight: 40, scrollTop: 100 });
  const at = placeAnchor(anchorFrom(anchor), 1, theirs);
  const row = theirs.el.children[0].children[3].getBoundingClientRect();
  assert.equal(at.x, row.left + row.width / 4);
  assert.equal(at.y, row.top + row.height * 0.75);
});

test("over empty space in what scrolls, it's where it is in what's scrolled", () => {
  const list = el("ul", { left: 0, top: 0, width: 100, height: 100 }, [], {
    scrollTop: 50,
    scrollHeight: 400,
  });
  const tool = el("div", { left: 0, top: 0, width: 100, height: 100 }, [list]);
  const { anchor } = anchorAt({ body: tool, el: tool }, 10, 10);
  assert.equal(anchor.y, (10 + 50) / 400);
  list.scrollTop = 0;
  assert.equal(placeAnchor(anchor, 1, { body: tool, el: tool }).y, 60);
});

test("an element that isn't there (or isn't the same) isn't to be seen", () => {
  const tool = el("div", { left: 0, top: 0, width: 100, height: 100 }, [el("p", { left: 0, top: 0, width: 100, height: 10 })]);
  const at = (anchor) => placeAnchor(anchor, 1, { body: tool, el: tool });
  assert.equal(at({ kind: "element", path: [0], tag: "li", x: 0, y: 0 }), null);
  assert.equal(at({ kind: "element", path: [3], tag: "p", x: 0, y: 0 }), null);
  assert.deepEqual(at({ kind: "element", path: [0], tag: "p", x: 0.5, y: 0.5 }), { x: 50, y: 5, k: 1 });
});

test("off the tool, it's where it is in the pane", () => {
  const tool = el("div", { left: 0, top: 0, width: 100, height: 100 });
  const { anchor } = anchorAt({ body: tool, el: null }, 25, 50);
  assert.deepEqual(anchor, { kind: "pane", x: 0.25, y: 0.5 });
});

test("anchors sent are checked", () => {
  assert.equal(anchorFrom({ kind: "element", path: [-1], tag: "p", x: 0, y: 0 }), null);
  assert.equal(anchorFrom({ kind: "element", path: [0], x: 0, y: 0 }), null);
  assert.equal(anchorFrom({ kind: "element", path: [0], tag: "p", x: NaN, y: 0 }), null);
  assert.equal(anchorFrom({ kind: "nope" }), null);
  assert.deepEqual(anchorFrom({ kind: "pane", x: 0.1, y: 0.2, extra: 1 }), { kind: "pane", x: 0.1, y: 0.2 });
});
