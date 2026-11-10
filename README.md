# lattice

knitting together, in patchwork: write a pattern in javascript, watch it
knit, check it, and turn it into kcode for a kniterate, with everyone else
in the project there too. it's at
[lattice.patchwork.inkandswitch.com](https://lattice.patchwork.inkandswitch.com).

## what's here

- [`packages/lattice`](packages/lattice): the frame. your projects down the
  side, a project's panes in the middle, inspectors down the right, and the
  knitting tools that are lattice's own (the animation, the 3d view, checks,
  yarns, swatches and machines).
- [`packages/knitoutjs`](packages/knitoutjs): knitout in patchwork. the
  editor, the visualiser, building a pattern, and the standalone "Knitout JS".
- [`packages/wm`](packages/wm): the panes, the files, who else is here, and
  calls.
- [`packages/versions`](packages/versions): the history down the right.
- [`latticex`](latticex): a terminal on your computer, shared into a project.
- `src/main.ts`, `vite/`, `scripts/`: the site, and running it.

```
pnpm install
pnpm dev        # the site, and a tunnel to send someone (--no-tunnel for none)
pnpm test
pnpm build
```

## who made it

lattice is by chee and Mimi Reyburn, at [ink & switch](https://www.inkandswitch.com), on
[patchwork](https://patchwork.inkandswitch.com).

most of the knitting is other people's work, carried over:

- **knitout** itself is [Jim McCann](https://github.com/ixchow)'s, from the
  [carnegie mellon textiles lab](https://textiles-lab.github.io/knitout/knitout.html).
- **the visualiser** is Jim's
  [knitout live visualizer](https://github.com/textiles-lab/knitout-live-visualizer),
  with work from Mark Gillespie, Catherine Yu, Lea Albaugh, Vidya Narayanan
  and Himalini Gururaj.
- **knitoutjs grew out of** [Agnes Cameron](https://github.com/agnescameron)'s
  [kniterate fork](https://github.com/agnescameron/knitout-visualizer-kniterate)
  of the visualiser, which she uses
  [to teach](https://soup.agnescameron.info/2025/09/20/kniterate.html). it
  brought the kniterate's colours, the
  [waste section](https://soup.agnescameron.info/2026/03/25/kniterate-waste-section.html)
  and cast on, and the kcode export.
- **knitout to kcode** is [Gabrielle Ohlson](https://github.com/gabrielle-ohlson)
  and Jim's [kniterate backend](https://github.com/textiles-lab/knitout-backend-kniterate),
  as Agnes adapted it for the visualiser.
- **javascript highlighting** is [lezer](https://lezer.codemirror.net)'s
  javascript grammar, by Marijn Haverbeke.

and the patchwork side:

- **versions** is by Mimi Reyburn, made from `drafts` in
  [patchwork-pkg-base](https://github.com/inkandswitch/patchwork-pkg-base).
- **calls** are made from chee's `call` experiment in patchwork.
- **patchwork** and **automerge** are ink & switch's.
- **solid-automerge** (`packages/lattice/vendor/solid-automerge.js`) is
  chee's, and **amtext** (`packages/lattice/vendor/amtext`), the
  .patchworkfolder format, is from knit.patchwork.inkandswitch.com.

the fonts lattice brings (`packages/lattice/fonts`) are all under the SIL Open
Font License: [Jost](https://github.com/indestructible-type/Jost),
[Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next),
[Fraunces](https://github.com/undercasetype/Fraunces),
[IBM Plex Mono](https://github.com/IBM/plex) (IBM),
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono),
[Victor Mono](https://github.com/rubjo/victor-mono-font) and
[Fantasque Sans Mono](https://github.com/belluzj/fantasque-sans) (Jany
Belluz), each by its project's authors.

## licence

knitoutjs and wm are [AGPL-3.0-or-later](packages/knitoutjs/LICENSE).
the code carried over keeps its own: the visualiser, the kniterate backend and
lezer are MIT (their notices are in
[`packages/knitoutjs/core/vendor/LICENSE.md`](packages/knitoutjs/core/vendor/LICENSE.md)),
and the fonts are OFL (each folder has its LICENSE).
