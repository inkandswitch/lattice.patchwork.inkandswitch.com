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
- [`packages/patternstoat`](packages/patternstoat): a light stoll create+ for
  the kniterate. a `.patternstoat` is a design painted in colours that stand
  for technique (with stitches painted on top, and a yarn a row for
  stripes), and a `.charm` is lattice's colour arrangement: what each colour
  does, a pass a row, as the kniterate editor paints them. the two build a
  `.k`. a project's + menu makes one (a striped wristwarmer, to start from).
- [`latticex`](latticex): a terminal on your computer, shared into a project.
- `src/main.ts`, `vite/`, `scripts/`: the site, and running it.

```
pnpm install
pnpm dev        # the site, and a tunnel to send someone (--no-tunnel for none)
pnpm test
pnpm build
```

an install while `pnpm dev`'s running (a new pkg-base, say) starts the site
again, on the same port, and the tunnel stays where it is.

the tunnel's a new `trycloudflare.com` address each time. for one that
stays the same, make a named tunnel on a domain your cloudflare account has,
once:

```
cloudflared tunnel login
cloudflared tunnel create lattice-dev
cloudflared tunnel route dns lattice-dev lattice-dev.example.com
```

then `LATTICE_TUNNEL_HOST=lattice-dev.example.com pnpm dev` (export it from
your shell's profile to have it always), and the link to send is the same
every time. `LATTICE_TUNNEL_NAME` is the tunnel's name, if it isn't
`lattice-dev`.

## claude, in your tab

while `pnpm dev`'s running, `pnpm page` runs code in the lattice tab you have
open, here or on the site with `?dev=`, and prints what came of it: so a
claude in this repo can look at the page (`pnpm page dom`, `inspect`, `logs`)
and make projects and files in it (`new-project`, `add-file`, `write`).
`pnpm page` on its own says all it does; `CLAUDE.md` says it for claude.

only a tab that's been given the token can be reached: `pnpm page link`
prints yours (with `?dev=` and the tunnel, and the localhost one). open one
once, or put its `#page=…` on the address of a tab that's open already, and
that browser stays in. it's yours, not for sending: anyone with the token and
the tunnel's address could run code in your tab, and see what comes back. the token's
in `node_modules/.lattice-page.json`; deleting it makes a new one.

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
- **the yarn path** is Hannah Twigg-Smith's
  [knitscape](https://github.com/knitscape/knitscape): its contact-node
  model, where a loop is the four points its yarn touches others at and the
  yarn's a path through them, relaxed as yarn would be, and its fibres, plies
  and shading (which she brought over from chainstitch). it was her idea that
  a loop for every stitch can't say what a tuck is, or what tucks and floats
  beside each other make, and that the yarn can. her code's in
  `packages/lattice/vendor/knitscape`.

and the patchwork side:

- **versions** is by Mimi Reyburn, made from `drafts` in
  [patchwork-pkg-base](https://github.com/inkandswitch/patchwork-pkg-base).
- **calls** are made from chee's `call` experiment in patchwork.
- **ink** (drawing on someone's screen while you follow them) is drawn by
  [perfect-freehand](https://github.com/steveruizok/perfect-freehand), Steve
  Ruiz's (MIT), set as [tldraw](https://tldraw.dev) sets it, in chee's port
  from aftersun, whose way of pinning ink to the words it's on it takes too.
- **faces** in a call are found by google's
  [mediapipe](https://ai.google.dev/edge/mediapipe) face detector (Apache
  2.0), fetched from jsdelivr, not kept here.
- **patchwork** and **automerge** are ink & switch's.
- **solid-automerge** (`packages/lattice/vendor/solid-automerge.js`) is
  chee's, and **amtext** (`packages/lattice/vendor/amtext`), the
  .patchworkfolder format (a .latticeproject is one), is from
  knit.patchwork.inkandswitch.com.

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
as is perfect-freehand (its notice is in
[`packages/wm/vendor/LICENSE.md`](packages/wm/vendor/LICENSE.md)), and the fonts
are OFL (each folder has its LICENSE).
