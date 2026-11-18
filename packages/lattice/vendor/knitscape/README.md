# knitscape's yarn simulation, in lattice

Hannah Twigg-Smith's
[knitscape](https://github.com/knitscape/knitscape), `unified` branch, at
`fdcfd1810cd04fa47605b67abfebde70582c72da`: its contact-node topology
(knitbit's), the yarn relaxation, and the noodle and fibre renderers (with
the ambient occlusion and fibres she ported from chainstitch). MIT, as
`LICENSE` here says.

the folders are hers: `shared/` is her `shared/`, `knitbit/simulation/` her
`knitbit/src/simulation/`. it was typescript; the types were stripped
(node's `stripTypeScriptTypes`, then prettier as it comes), so it's her code,
comments and all, and can be diffed against hers.

what lattice changed, besides imports (`@shared/…` to relative paths, with
`.js`):

- `shared/opData.js`: only `Op` and `BACK_OPS` (hers makes chart symbols as
  it loads, `Path2D`s, which a worker hasn't got)
- `shared/simulation/fiber.js`: `FiberYarn`'s constructor assigns `gl` and
  `radius` itself (typescript's parameter properties don't strip)
- `knitbit/simulation/topology.js`: a program with `castOn: false` starts
  from empty needles (hers always has a loop on every front needle to start)
- `shared/simulation/renderer.js`: `createNoodleRenderer()`, a renderer for
  each canvas (hers is the module's, one a page), with a `destroy()`
- `shared/simulation/relaxationDriver.js`: a renderer of its own, and the
  worker made by `options.createWorker(url)` if it's given (lattice's
  `moduleWorker`, for when the package is from another origin)
