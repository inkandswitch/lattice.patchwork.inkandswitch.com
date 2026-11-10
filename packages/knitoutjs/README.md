# knitoutjs

knitout in patchwork. write a pattern in javascript, build it into knitout
(a .k), watch it knit, and turn it into kcode for a kniterate. these are the
tools lattice opens .js and .k files with, and "Knitout JS", a patchwork
project of its own.

## what's here

- `core/`: the tools. the editor, the visualiser, running a pattern, yarns,
  and `vendor/` (below). none of them knows about the panes they're in.
- `wm.js`: what knitoutjs adds to a [wm](../wm) workspace: a .js linked to
  the .k it writes, how its builds are going, and new patterns.
- `look.css` and `look.js`: knitout.js's look, for a workspace. lattice wears
  it too.
- `app/`: "Knitout JS", the patchwork project of its own.

## publishing Knitout JS

its app imports knitoutjs's tools and wm from beside it, which a pushed
folder can't reach, so it's staged first, into one folder with both:

```
pnpm stage knitoutjs --state ~/soft/agnescameron/knitoutjs.pushwork
cd stage/knitoutjs && pushwork sync
```

`--state` links in the `.pushwork` that says which patchwork folder it is,
so its url (the one people's module settings have) stays the same. `pushwork
url` in `stage/knitoutjs` says which one it is before anything's synced.
(this folder's own `.pushwork`, from when it was lattice's submodule, is
another one.) lattice's frame is staged the same way: `pnpm stage lattice
--state src/frame/.pushwork`.

## where it comes from

most of the knitting here is other people's work, carried over.

- **knitout** itself is [Jim McCann](https://github.com/ixchow)'s, from the
  [carnegie mellon textiles lab](https://textiles-lab.github.io/knitout/knitout.html).
- **the visualiser** (`core/vendor/show-knitout.js`, `CellMachine.js`,
  `VectorTiles.js`, `VectorTilesLib.js`, `parseKnitout.js`, `evalJS.js`) is
  Jim's [knitout live visualizer](https://github.com/textiles-lab/knitout-live-visualizer),
  with work from Mark Gillespie, Catherine Yu, Lea Albaugh, Vidya Narayanan
  and Himalini Gururaj.
- **this grew out of** [Agnes Cameron](https://github.com/agnescameron)'s
  [kniterate fork](https://github.com/agnescameron/knitout-visualizer-kniterate)
  of the visualiser, which she uses
  [to teach](https://soup.agnescameron.info/2025/09/20/kniterate.html). it
  brought the kniterate's colours, the
  [waste section](https://soup.agnescameron.info/2026/03/25/kniterate-waste-section.html)
  and cast on, and the kcode export.
- **knitout to kcode** (`core/vendor/knitout-to-kcode.js`) is
  [Gabrielle Ohlson](https://github.com/gabrielle-ohlson) and Jim's
  [kniterate backend](https://github.com/textiles-lab/knitout-backend-kniterate),
  as Agnes adapted it for the visualiser.
- **javascript highlighting** (`core/vendor/lezer-javascript.js`) is
  [lezer](https://lezer.codemirror.net)'s javascript grammar, by Marijn
  Haverbeke, bundled.

all of these are MIT licensed: the visualiser © 2018–2019, the kniterate
backend © 2020 Carnegie Mellon Textiles Lab, and lezer © Marijn Haverbeke and
others. their notices are in [`core/vendor/LICENSE.md`](core/vendor/LICENSE.md),
and that code keeps its licence.

the patchwork side (the panes, the editor and the projects) is by chee, with
Mimi Reyburn.

## licence

knitoutjs is [AGPL-3.0-or-later](LICENSE), apart from `core/vendor`, which is
MIT (above).
