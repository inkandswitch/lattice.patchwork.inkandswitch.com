// what's hidden until ctrl, alt and command are tapped together twice, with
// nothing else in between (a key, a click), and hidden again by the same: the
// phone (a call), and lattice's box for a project's automerge url. one for
// the page, whoever asks
//
// a tap is all three down together, then all let go, with no other key
// pressed meanwhile. anything else starts the count again
import { createRoot, createSignal } from "solid-js";

const CHORD = ["Control", "Alt", "Meta"];

const [shown, setShown] = createRoot(() => createSignal(false));

let taps = 0;
let chorded = false;
let spoiled = false;

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
