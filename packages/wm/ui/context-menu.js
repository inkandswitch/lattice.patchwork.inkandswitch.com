// a menu that's a row's (a project's, a file's), sideboard's way
// (patchwork's base/sideboard, popmenu.tsx and item.tsx): it comes up where
// you clicked, kept on screen, and grows out of that point (wm.css). a row
// opens it with a right click, a long press on a touch screen or with a pen,
// or from the keyboard: ctrl+enter (as sideboard), shift+f10 or the menu
// key. the menu's an ordinary .lattice-wm-menu popover, so menus.js has it
// by keyboard, and back on the row when it goes
import { onCleanup } from "solid-js";

// between it and the window's edge
const MARGIN = 4;
// how long a press is long
const LONG_PRESS = 700;
// how far a press can wander and still be one (rather than a scroll or drag)
const WANDER = 8;

/**
 * show `menu` (a popover) at `at` ({x, y}, the window's): down and right of
 * it, or wherever it fits, growing out of it
 */
export function showMenuAt(menu, at) {
  if (!menu.matches(":popover-open")) menu.showPopover();
  Object.assign(menu.style, { right: "auto", bottom: "auto" });
  // its own size, not as it's drawn: it's growing in, a little smaller
  const { offsetWidth: width, offsetHeight: height } = menu;
  let left = at.x;
  let top = at.y;
  if (left + width > innerWidth - MARGIN) left = at.x - width;
  if (top + height > innerHeight - MARGIN) top = at.y - height;
  left = Math.max(MARGIN, Math.min(left, innerWidth - MARGIN - width));
  top = Math.max(MARGIN, Math.min(top, innerHeight - MARGIN - height));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.transformOrigin = `${at.x - left}px ${at.y - top}px`;
}

/**
 * a ref for a row whose menu `open(at, event)` shows (at is where, {x, y}).
 * the row (or the first button in it) has the focus while it's open, so
 * that's where it comes back to
 */
export function rowMenu(open) {
  return (row) => {
    const focusable = () => (row.matches("button, [tabindex]") ? row : row.querySelector("button, [tabindex]"));
    function openAt(at, event) {
      focusable()?.focus({ preventScroll: true });
      open(at, event);
    }

    // a long press opens it, and the click that ends it doesn't also do
    // what a click on the row does
    let pressing = null;
    let pressedLong = false;
    const stopPressing = () => {
      clearTimeout(pressing?.timer);
      pressing = null;
    };
    function onPointerDown(event) {
      pressedLong = false;
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      const at = { x: event.clientX, y: event.clientY };
      stopPressing();
      pressing = {
        at,
        timer: setTimeout(() => {
          pressing = null;
          pressedLong = true;
          openAt(at, event);
        }, LONG_PRESS),
      };
    }
    function onPointerMove(event) {
      if (pressing && Math.hypot(event.clientX - pressing.at.x, event.clientY - pressing.at.y) > WANDER) stopPressing();
    }
    function onClick(event) {
      if (!pressedLong) return;
      pressedLong = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function onContextMenu(event) {
      event.preventDefault();
      event.stopPropagation();
      // a long press was it already (some browsers say both)
      if (pressedLong) return;
      stopPressing();
      openAt({ x: event.clientX, y: event.clientY }, event);
    }
    function onKeyDown(event) {
      const ctrlEnter = event.key === "Enter" && event.ctrlKey && !(event.altKey || event.shiftKey || event.metaKey);
      const shiftF10 = event.key === "F10" && event.shiftKey;
      if (!ctrlEnter && !shiftF10 && event.key !== "ContextMenu") return;
      event.preventDefault();
      event.stopPropagation();
      const box = row.getBoundingClientRect();
      openAt({ x: box.left + 10, y: box.bottom - 4 }, event);
    }

    row.addEventListener("pointerdown", onPointerDown);
    row.addEventListener("pointermove", onPointerMove);
    row.addEventListener("pointerup", stopPressing);
    row.addEventListener("pointercancel", stopPressing);
    row.addEventListener("dragstart", stopPressing);
    row.addEventListener("click", onClick, true);
    row.addEventListener("contextmenu", onContextMenu);
    row.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      stopPressing();
      row.removeEventListener("pointerdown", onPointerDown);
      row.removeEventListener("pointermove", onPointerMove);
      row.removeEventListener("pointerup", stopPressing);
      row.removeEventListener("pointercancel", stopPressing);
      row.removeEventListener("dragstart", stopPressing);
      row.removeEventListener("click", onClick, true);
      row.removeEventListener("contextmenu", onContextMenu);
      row.removeEventListener("keydown", onKeyDown);
    });
  };
}
