// Core simulation types — shared by every stitch model. Model-specific
// topology types live alongside their topology generator (see ds/types.ts and
// knitbit/src/simulation/types.ts).

// Fully resolved segment — all fields present. Used by relaxation after layout
// is complete.

// What the renderer consumes: one entry per yarn, with flat control points.

// ─── Relaxation settings (live-tunable) ──────────────────────────────────────

export const DEFAULT_RELAX_SETTINGS = {
  kYarn: 0.4,
  tYarn: 0.01,
  iterations: 4,
  velocityDecay: 0.5,
  alphaMin: 0.001,
  alphaTarget: 0,
};
