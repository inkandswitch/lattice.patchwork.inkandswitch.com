# lattice

## looking in chee's tab: `node scripts/page.mjs`

While `pnpm dev` is running, `node scripts/page.mjs` (`pnpm page` for chee)
runs code in the lattice tab chee has open (its own localhost page, or the
site with `?dev=<tunnel>`) and prints what came back. Use it to look at the
live DOM, styles and console, and to make projects and files the way the
frame does (through the account's home folder, and keyhive when it's on),
instead of guessing or asking chee to paste things.

Run it with node, not pnpm: a call takes ~0.3s, and pnpm adds ~1.2s to each
(the global pnpm hands off to the one `packageManager` pins).

```sh
node scripts/page.mjs tabs                  # which tabs are in (none: ask chee to open `pnpm page link`)
node scripts/page.mjs eval 'document.title' # an expression is its value; else `return`
node scripts/page.mjs eval - <<'EOF'        # longer code on stdin
const files = await lattice.files(lattice.projects()[0].url)
return files.map(f => f.name)
EOF
node scripts/page.mjs dom '.lattice-shell' --depth 2
node scripts/page.mjs inspect '.some-pane'  # box + layout styles
node scripts/page.mjs logs                  # console errors/warnings, uncaught
node scripts/page.mjs projects
node scripts/page.mjs new-project 'cables'  # makes it, shows it, prints its url
node scripts/page.mjs add-file <project-url> swatch.js < swatch.js
node scripts/page.mjs read <file-url>
node scripts/page.mjs write <file-url> < swatch.js  # merged in (updateText), not replaced
```

Keep it quick: do a check in one `eval -` rather than many, and wait on the
thing itself (a doc's field changing, an element appearing), polled every
50ms or so, rather than a fixed sleep. When `document.visibilityState` is
"hidden" (chee's in another window), the tab runs no animation frames and no
ResizeObserver callbacks: `requestAnimationFrame` never resolves (the call
times out), canvases don't draw, and a pane shown since has no size, so
clicks on it miss. Docs and handles still work; for what needs drawing, ask
chee to bring the tab to the front.

In code, `lattice` is the helpers (`packages/lattice/page.js`): `projects()
open(url) newProject(title) files(project) addFile(project, name, content)
read(url) write(url, content) dom(selector, {depth}) inspect(selector)
logs()`, and `lattice.repo`, `.hive`, `.home` for anything else. `--tab ID`
picks a tab (else the focused one), `--timeout MS` (10000).

What it does in the tab is real: it's chee's account, and other people may
be in the project. Ask before deleting or rewriting anything that's theirs.
Never print or send the token (`node_modules/.lattice-page.json`), or the
link from `pnpm page link`.

## updating packages

patchcrow (`.github/workflows/update-packages.yml`) already bumps
`@inkandswitch/patchwork`, `patchwork-pkg-base` and `patchwork-e2e` hourly
and opens an "update patchwork packages" PR from `update-patchwork-packages`.
a hand update is for everything else, and lands as one "update packages"
commit on main. run pnpm from the repo root.

- **pnpm 11**, pinned in `packageManager` (and `netlify.toml`). the root
  workspace is `.` and `packages/*`, with one lockfile, `pnpm-lock.yaml`.
  `packages/versions/pnpm-lock.yaml` and `packages/lattice/pnpm-lock.yaml`
  are stale leftovers: leave them alone.
- **latticex is its own workspace** (its own `pnpm-workspace.yaml` and lock,
  so the site's install never builds node-pty): `cd latticex && pnpm
  outdated / pnpm install / pnpm test` separately.
- start with `pnpm outdated -r`, but it misses the **automerge-repo
  subduction pins**: npm's `latest` for automerge-repo is an old alpha, the
  fork is the `subduction` dist-tag. match what patchwork uses
  (`node_modules/@inkandswitch/patchwork/package.json`), in
  `packages/versions/package.json` and `latticex/package.json`.
- **`@automerge/automerge`** is pinned exactly in `packages/knitoutjs`,
  `packages/wm`, `packages/versions` and the `overrides` in
  `pnpm-workspace.yaml`. bump all four together.
- `@inkandswitch/*`, `@chee/*` and `@automerge/*` skip pnpm's minimum
  release age; anything else that's only just out won't install yet.
- **solid-js stays on 1.x** (patchwork provides solid 1, and solid-automerge
  and vite-plugin-solid are 1.x): don't take 2.0 in a routine update. other
  majors are fine if tests and the build pass.

vendored code, not in any lockfile:

- `packages/lattice/vendor/solid-automerge.js`: chee's solid-automerge,
  bundled. its header says the version and the esbuild command. if `npm view
  solid-automerge version` is newer, check out that tag in
  `~/soft/chee/solid-automerge`, run the command into the scratchpad, diff it
  against the vendored file (skip its 5-line header), then swap it in with
  the header's version bumped.
- `packages/lattice/vendor/amtext/`: a copy of
  `../knit.patchwork.inkandswitch.com/packages/amtext/{amtext,patchworkfolder}.js`.
  `diff -q` them, and copy over if knit's have moved.
- `packages/skitch/vendor/`: atrament, drauu and rough.js, minified from
  skitch's devDependencies. bump those like any other, then `pnpm vendor`
  in packages/skitch.
- `packages/wm/vendor/perfect-freehand.js` (a hand port) and
  `packages/knitoutjs/core/vendor/` (textiles-lab code, adapted): not
  updated from upstream. leave them.

then `pnpm test`, `pnpm build`, `(cd latticex && pnpm test)`, and if
`pnpm dev` is up, look at the tab with `node scripts/page.mjs logs`.
