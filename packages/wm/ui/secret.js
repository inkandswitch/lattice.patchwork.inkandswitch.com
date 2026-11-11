// what's hidden until ctrl, alt and command are tapped together twice, with
// nothing else in between (a key, a click), and hidden again by the same, or
// by itself after a couple of seconds (not while you're at one of them: the
// pointer over it, or typing in it): the phone (a call), and lattice's box
// for a project's automerge url. one for the page, whoever asks
//
// a tap is all three down together, then all let go, with no other key
// pressed meanwhile. anything else starts the count again
import { createRoot, createSignal, getOwner, onCleanup } from "solid-js";

const CHORD = ["Control", "Alt", "Meta"];
// how long it stays out after the second tap, or after you leave it
const SHOWN_FOR = 2500;

const [shown, setShown] = createRoot(() => createSignal(false));

let taps = 0;
let chorded = false;
let spoiled = false;
let hiding = null;
// what can hold it out (holdSecret's): while the pointer's over one, or the
// focus is in one. asked when it'd go, so nothing can leave it stuck out
const holders = new Set();
const holding = () =>
  [...holders].some((el) => el.isConnected && (el.matches(":hover") || el.matches(":focus-within")));

// it goes in a while, unless something's holding it out then: then it waits
// again
function hideSoon() {
  clearTimeout(hiding);
  if (!shown()) return;
  hiding = setTimeout(() => (holding() ? hideSoon() : setShown(false)), SHOWN_FOR);
}

function reset() {
  taps = 0;
  chorded = spoiled = false;
}

function onKey(event) {
  if (event.type === "keydown") {
    if (!CHORD.includes(event.key) || event.shiftKey) {
      reset();
      spoiled = true;
    } else if (event.ctrlKey && event.altKey && event.metaKey) chorded = true;
    return;
  }
  // a tap's done once none of the three is still down
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (chorded && !spoiled) taps++;
  else taps = 0;
  chorded = spoiled = false;
  if (taps === 2) {
    taps = 0;
    setShown(!shown());
    hideSoon();
  }
}

function listen() {
  if (typeof document === "undefined") return;
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", onKey, true);
  document.addEventListener("pointerdown", reset, true);
  addEventListener("blur", reset);
}

listen();

/** whether what's secret is showing (a signal: read it in an effect) */
export const secret = shown;

/**
 * a ref for what's secret: while the pointer's over it, or the focus is in
 * it, it doesn't go by itself, and once you leave it it waits a while again
 * before it does
 */
export function holdSecret(el) {
  holders.add(el);
  el.addEventListener("pointerleave", hideSoon);
  el.addEventListener("focusout", hideSoon);
  if (getOwner()) onCleanup(() => holders.delete(el));
}
