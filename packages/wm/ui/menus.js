// every .lattice-wm-menu popover (wm's, and the app's that share its look),
// by keyboard as by mouse: opening one puts you on its first item, the
// arrows (and home and end) go through what's in it, and when it closes —
// escape, a click away, or tab — you're back on what opened it. tab closes
// it and goes on from there, as it would have from the button
const MENU = ".lattice-wm-menu";
const ITEMS = "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex='0']";

let users = 0;
// a menu → what had the focus when it opened
const openers = new WeakMap();

const items = (menu) => [...menu.querySelectorAll(ITEMS)].filter((item) => item.getClientRects().length > 0);

function onToggle(event) {
  const menu = event.target;
  if (!(menu instanceof HTMLElement) || !menu.matches(MENU)) return;
  if (event.newState === "open") {
    const opener = document.activeElement;
    if (opener && opener !== document.body && !menu.contains(opener)) openers.set(menu, opener);
    // its first button, rather than a box to type in: what's in a menu is
    // mostly what it does
    const first = items(menu).find((item) => item.matches("button")) ?? items(menu)[0];
    first?.focus({ preventScroll: true });
    return;
  }
  const opener = openers.get(menu);
  openers.delete(menu);
  // back where you were, unless you've gone somewhere else meanwhile
  const lost = !document.activeElement || document.activeElement === document.body || menu.contains(document.activeElement);
  if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
}

function onKeyDown(event) {
  const menu = event.target instanceof Element && event.target.closest(MENU);
  if (!menu || !menu.matches(":popover-open")) return;
  const all = items(menu);
  const at = all.indexOf(document.activeElement);
  const go = (index) => {
    event.preventDefault();
    all[(index + all.length) % all.length]?.focus();
  };
  // in a box you type in, the left and right arrows, home and end are its own
  const typing = event.target.matches("input, select");
  if (event.key === "ArrowDown") go(at + 1);
  else if (event.key === "ArrowUp") go(at < 0 ? -1 : at - 1);
  else if (event.key === "Home" && !typing) go(0);
  else if (event.key === "End" && !typing) go(-1);
  else if (event.key === "Tab") {
    const opener = openers.get(menu);
    menu.hidePopover();
    // the browser's own tab, from the opener now
    opener?.focus({ preventScroll: true });
  }
}

/** turn it on (once, however many ask); returns a way to turn it off */
export function menuKeys() {
  if (users++ === 0) {
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("keydown", onKeyDown, true);
  }
  let off = false;
  return () => {
    if (off) return;
    off = true;
    if (--users === 0) {
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("keydown", onKeyDown, true);
    }
  };
}
