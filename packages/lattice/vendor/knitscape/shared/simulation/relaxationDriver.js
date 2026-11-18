import { createNoodleRenderer } from "./renderer.js";
import { DEFAULT_RELAX_SETTINGS } from "./types.js";

/**
 * Owns the relaxation worker and the render loop for one piece of geometry.
 *
 * Everything here is independent of how the geometry was built, so each stitch
 * model only has to supply nodes + segments + yarn colors and can share this
 * driver. The worker lives next to this file so Vite's `new URL` worker
 * resolution stays a static relative path.
 */
export function createRelaxationDriver(initialGeometry, options) {
  const canvas = options.canvas;
  const relaxSettings = options.relaxSettings ?? {
    ...DEFAULT_RELAX_SETTINGS,
  };

  let geometry = initialGeometry;

  // Worker state mirrored on the main thread for the UI readouts.
  let lastTickMs = 0;
  let currentAlpha = 1;
  let running = false;
  let everStarted = false;
  // Set when start/restart is sent, cleared by the first tick that reports
  // running. Guards against a pre-start frame landing after start and making
  // the UI think relaxation already converged.
  let pendingStart = false;
  let geometryDirty = false;

  // (lattice: its own renderer, and its worker made as the page wants:
  // `createWorker(url)`, a module worker by default)
  const renderer = createNoodleRenderer();
  renderer.init(geometry.yarnData, canvas, options.resetCamera ?? true);

  const workerUrl = new URL("./relaxation.worker.js", import.meta.url);
  const worker = options.createWorker
    ? options.createWorker(workerUrl)
    : new Worker(workerUrl, { type: "module" });

  const send = (msg, transfer) => {
    worker.postMessage(msg, transfer ?? []);
  };

  function sendInit() {
    send({
      type: "init",
      nodes: geometry.nodes,
      segments: geometry.segments,
      settings: relaxSettings,
    });
  }

  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type !== "tick") return;

    for (const yd of geometry.yarnData) {
      const arr = msg.pts[Number(yd.yarnIndex)];
      if (arr) yd.pts = arr;
    }
    geometryDirty = true;
    currentAlpha = msg.alpha;
    lastTickMs = msg.tickMs;

    if (msg.running) {
      pendingStart = false;
      running = true;
    } else if (!pendingStart) {
      running = false;
    }
  };

  sendInit();

  function draw() {
    // The tick loop lives in the worker; the main thread just keeps the
    // renderer fed with whatever control points arrived most recently.
    if (everStarted && geometryDirty) {
      renderer.updateYarnGeometry(geometry.yarnData);
      geometryDirty = false;
    }
    renderer.draw();
  }

  function relax() {
    if (everStarted) return;
    send({ type: "start" });
    running = true;
    pendingStart = true;
    everStarted = true;
  }

  function restart() {
    send({ type: "restart" });
    running = true;
    pendingStart = true;
    everStarted = true;
  }

  function stopSim() {
    send({ type: "stop" });
    running = false;
    pendingStart = false;
  }

  function isRelaxing() {
    return running;
  }

  function updateSettings(partial) {
    Object.assign(relaxSettings, partial);
    send({ type: "setSettings", settings: partial });
  }

  /** Swap in freshly built geometry, reusing the same worker and canvas. */
  function rebuild(next) {
    send({ type: "stop" });
    running = false;
    pendingStart = false;
    everStarted = false;
    geometryDirty = false;
    geometry = next;
    renderer.init(geometry.yarnData, canvas, false);
    sendInit();
  }

  function terminate() {
    worker.terminate();
    renderer.destroy();
  }

  return {
    relax,
    restart,
    stopSim,
    draw,
    isRelaxing,
    updateSettings,
    rebuild,
    terminate,
    getTickMs: () => lastTickMs,
    getAlpha: () => currentAlpha,
    fitCamera: () => renderer.fitCamera(),
    setFiberMode: (on) => renderer.setFiberMode(on),
    setFiberStyle: (style) => renderer.setFiberStyle(style),
    setAmbientOcclusion: (settings) => renderer.setAmbientOcclusion(settings),
  };
}
