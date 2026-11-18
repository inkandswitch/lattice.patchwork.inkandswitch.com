// the call is pkg-base's call package: its provider is round the frame
// (lattice/providers.js, or whichever frame a project's in), and wm talks
// to it as any tool does, by its events and subscriptions (its
// protocol.js), never by importing it. so with the package missing, every
// one of these hears nothing and does nothing
import { createSignal } from "solid-js";
import { subscribe } from "@inkandswitch/patchwork-providers";

export const CALL_PROVIDER = "call-provider";

/**
 * `subscribe(element, selector, listen)`, asked again whenever the call
 * provider mounts: it's late-bound, so it can turn up after this asked (or
 * be swapped in anew). gives back the unsubscribe
 */
export function hearCall(element, selector, listen) {
  let unsubscribe = subscribe(element, selector, listen);
  function again(event) {
    if (event.detail?.componentId !== CALL_PROVIDER) return;
    unsubscribe();
    unsubscribe = subscribe(element, selector, listen);
  }
  addEventListener("patchwork:mounted", again);
  return () => {
    removeEventListener("patchwork:mounted", again);
    unsubscribe();
  };
}

/** ask the call for something: {action: "ask", url, at?} or {action: "hang-up"} */
export function sendCall(element, detail) {
  element.dispatchEvent(new CustomEvent("patchwork:call", { bubbles: true, composed: true, detail }));
}

// ── faces on cursors: lattice's, not the call's (cursors are lattice's) ──

const CURSORS_KEY = "lattice:call:cursors";

function savedCursors() {
  try {
    const own = localStorage.getItem(CURSORS_KEY);
    if (own != null) return own === "true";
    // from when the call was lattice's own, and kept it in its settings
    const old = JSON.parse(localStorage.getItem("lattice-wm:call") ?? "{}");
    return typeof old.cursors === "boolean" ? old.cursors : old.faces === "cursors";
  } catch {
    return false;
  }
}

const [cursors, setCursorsNow] = createSignal(savedCursors());

/** whether people in your call have their faces on their cursors */
export { cursors };

export function setCursors(on) {
  setCursorsNow(!!on);
  try {
    localStorage.setItem(CURSORS_KEY, String(!!on));
  } catch {}
}
