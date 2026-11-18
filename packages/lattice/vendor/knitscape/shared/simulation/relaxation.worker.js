import { yarnRelaxation } from "./relaxation.js";
import { segmentsToPoints } from "./segments.js";

// ─── Message types ────────────────────────────────────────────────────────────

// ─── Worker state ─────────────────────────────────────────────────────────────

let nodes = [];
let segments = {};
let yarnKeys = [];
let settings = null;
let sim;
let looping = false;

// ─── Message handling ─────────────────────────────────────────────────────────

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      if (sim) sim.stop();
      looping = false;
      sim = undefined;
      nodes = msg.nodes;
      segments = msg.segments;
      yarnKeys = Object.keys(segments).map(Number);
      settings = msg.settings;
      // Send an initial frame so the main thread has pts before relax starts.
      postTick(false);
      break;

    case "setSettings":
      // Mutate in place — the yarnRelaxation closure captures `settings` by
      // reference, so updates take effect on the next tick without rebuilding.
      if (settings) Object.assign(settings, msg.settings);
      break;

    case "start":
      if (!settings) return;
      if (!sim) sim = yarnRelaxation(settings);
      startLoop();
      break;

    case "restart":
      if (!settings) return;
      if (sim) sim.stop();
      sim = yarnRelaxation(settings);
      startLoop();
      break;

    case "stop":
      if (sim) sim.stop();
      looping = false;
      break;
  }
};

// ─── Tick loop ────────────────────────────────────────────────────────────────

function startLoop() {
  if (looping) return;
  looping = true;
  tickLoop();
}

function tickLoop() {
  if (!looping || !sim) return;
  if (!sim.running()) {
    looping = false;
    postTick(false);
    return;
  }
  const start = performance.now();
  sim.tick(segments, nodes);
  const tickMs = performance.now() - start;
  postTick(true, tickMs);
  // setTimeout 0 yields so incoming messages (setSettings, stop, …) are
  // handled between ticks instead of being starved by a tight while-loop.
  setTimeout(tickLoop, 0);
}

function postTick(stillRunning, tickMs = 0) {
  const pts = {};
  const transferables = [];
  for (const k of yarnKeys) {
    const arr = new Float32Array(segmentsToPoints(segments[k], nodes));
    pts[k] = arr;
    transferables.push(arr.buffer);
  }
  const payload = {
    type: "tick",
    pts,
    alpha: sim?.alpha() ?? 1,
    tickMs,
    running: stillRunning,
  };
  self.postMessage(payload, transferables);
}
