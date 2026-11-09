# Knit Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Machine, yarn and swatch profiles as patchwork docs that a .k links to, so lattice's checks panel reports the finished size for each relaxation state from real measurements, saying where each number came from.

**Architecture:** Three new patchwork datatypes (`lattice:machine`, `lattice:yarn`, `lattice:swatch`), each with an editor. A .k gets a `profiles` key of lattice's own. `profiles.js` resolves a .k's profiles on the main thread into plain data. `size.js` (pure) matches each carrier, stitch number and structure to a size, tier by tier. `knitcheck.js`, which runs in a worker, sizes the knitting for each relaxation state. `checks.js` shows the readout and the "what's loaded" controls.

**Tech Stack:** Plain ES modules in `src/frame`, DOM built by hand (no framework), automerge docs through patchwork's repo, and `node --test` for tests.

**Spec:** `docs/superpowers/specs/2026-11-07-knit-profiles-design.html`

## Global Constraints

- **Don't change anything under `src/frame/knitoutjs/`** (it's a submodule, shared with knitoutjs). Lattice only imports from it.
- `src/frame/index.js` must have **no top-level imports**: patchwork may read it in a worker. Each plugin's `load()` imports what it needs.
- Code style follows `.prettierrc.toml`: tabs, no semicolons, double quotes, `bracketSpacing = false`, `arrowParens = "avoid"`. Comments are lowercase plain English, in the voice of `size.js`.
- Everything handed to the check worker must survive `structuredClone`. No handles, no automerge proxies.
- A .k keeps its links in `doc.profiles = {machine: url|null, carriers: {"3": [url, url?]}}`. Never write profile links into `doc.yarns` (knitoutjs replaces each entry when its colour changes).
- Carrier names are `"1"`–`"6"`. The carrier named N is `doc.yarns[N - 1]`.
- Relaxation states are `["dry", "steamed", "wet", "full"]`. `steamed` is measured only, never estimated from another state or used to estimate one.
- Structures are `["jersey", "rib-1x1", "rib-2x2", "other"]`. Only `jersey` gets the from-loop tier.
- Converter defaults (from `knitoutjs/core/vendor/knitout-to-kcode.js`): stitch `"5"`, roller `100`, speed `100`.
- Plated pairs: the manual recommends Nm 6–8 combined, i.e. tex from 1000/8 = 125 to 1000/6 ≈ 166.7.
- Machine defaults (Kniterate): gauge 7, needles 252, beds 2, carriers `"1"`–`"6"`, stitch sizes 0–15, float limit 7.
- Every tool is `(handle, element, context = {}) => cleanup`, and `context` is `{repo, open, project: {files, createFile}, events, …}` from knitoutjs's latticework (`latticework.js:563`). Outside lattice, patchwork calls the same function with `(handle, element)`.

## Review Focus

1. **A swatch measured in mm whose needles or rows aren't known** (the real lambswool swatch). Expected: that dimension is unknown, not NaN or Infinity, and wales or courses entered per 10 cm still work. *Pinned in Task 2.*
2. **A .k that links profiles for some carriers but not others.** Expected: unlinked carriers size from the old localStorage fabric, exactly as before. *Pinned in Task 6.*
3. **A pasted link to a doc of the wrong kind** (a .k where a yarn should be). Expected: listed in `missing` with why `"not a yarn"`, and that carrier drops to the legacy path. *Pinned in Task 7.*
4. **The resolved profile posted to the worker.** Expected: `structuredClone(resolved)` doesn't throw, even when the docs hold automerge strings or counters. *Pinned in Task 7.*
5. **Rib passes with odd edges** (`F B B F F B B F`, and a single needle on one bed at an end). Expected: still classified as 2×2 rib. *Pinned in Task 3.*

---

### Task 1: Yarn counts, and a test runner

**Files:**
- Create: `src/frame/counts.js`
- Create: `src/frame/test/counts.test.js`
- Modify: `src/frame/package.json` (add `"test": "node --test test/*.test.js"`)
- Modify: `package.json:19` (`"test": "cd src/frame && node --test test/*.test.js"`)

**Interfaces:**
- Produces: `COUNT_SYSTEMS = ["Nm", "Ne", "tex", "denier"]`, `texOf(count: {system, value, ply}) -> number|null`, `nmOf(tex: number) -> number|null`, `PLATED_TEX = {low: 125, high: 1000 / 6}`

- [ ] **Step 1: Write the failing tests** in `test/counts.test.js` (`node:test`, `node:assert/strict`):
  - `texOf({system: "Nm", value: 30, ply: 2})` ≈ 66.667 (within 0.001)
  - `texOf({system: "Ne", value: 30, ply: 1})` ≈ 19.683
  - `texOf({system: "denier", value: 90, ply: 1})` === 10
  - `texOf({system: "tex", value: 20, ply: 3})` === 60
  - ply missing, 0 or negative counts as 1: `texOf({system: "Nm", value: 30})` ≈ 33.333
  - `texOf({system: "Nm", value: 0, ply: 2})` === null, `texOf({system: "Nm", value: null})` === null, `texOf({system: "yards", value: 3})` === null, `texOf(null)` === null
  - `nmOf(66.667)` ≈ 15; `nmOf(0)` === null
- [ ] **Step 2: Run `cd src/frame && node --test test/counts.test.js`.** Expect FAIL (module not found).
- [ ] **Step 3: Implement `counts.js`.** Nm gives `1000 × ply ÷ value`; Ne gives `590.5 × ply ÷ value`; denier gives `value × ply ÷ 9`; tex gives `value × ply`. Add the two `package.json` scripts.
- [ ] **Step 4: Run `pnpm test` from the repo root.** Expect PASS.
- [ ] **Step 5: Commit** `counts.js`, the test, and both `package.json`s: "yarn counts, to tex and back".

---

### Task 2: What a profile doc holds

**Files:**
- Create: `src/frame/profile-docs.js`
- Create: `src/frame/test/profile-docs.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MACHINE_TYPE = "lattice:machine"`, `YARN_TYPE = "lattice:yarn"`, `SWATCH_TYPE = "lattice:swatch"`
  - `RELAX_STATES`, `STRUCTURES` (as in Global Constraints)
  - `newMachine() / newYarn() / newSwatch() -> object`: each with `"@patchwork": {type}` and the spec's fields (§3), defaulting to the Kniterate values. `newSwatch().knit.sure === "guessed"`, `newSwatch().knit.structure === "jersey"`, and every `relaxed` state is `null`.
  - `datatypeFor(type) -> {init(doc), getTitle(doc), setTitle(doc, title)}`. `init` copies `newX()` into `doc` without `"@patchwork"`, since patchwork sets that itself. The title lives in `doc.title`.
  - `profileKind(doc) -> "machine"|"yarn"|"swatch"|null`
  - `swatchDensity(swatch, state) -> {wales: number|null, courses: number|null}|null`
  - `swatchYarns(swatch) -> string[]`: the distinct yarn urls across `knit.feeds`
  - `indexChanges(before: string[], after: string[]) -> {add: string[], remove: string[]}`

- [ ] **Step 1: Write the failing tests:**
  - `profileKind(newYarn()) === "yarn"`; `profileKind({"@patchwork": {type: "file"}}) === null`
  - `datatypeFor(SWATCH_TYPE).init(doc)` leaves `doc.relaxed` as `{dry: null, steamed: null, wet: null, full: null}`; `getTitle({title: "x"}) === "x"`
  - `swatchDensity` with `entered: "per10", wales: 49, courses: 74` gives `{wales: 49, courses: 74}`
  - `swatchDensity` with `entered: "mm", width: 186, height: 142`, `needles: 51, rows: 100` gives wales ≈ 27.42 and courses ≈ 70.42
  - **Review Focus 1:** `entered: "mm"` with `needles: null, rows: 100` gives `{wales: null, courses: ≈70.42}`; with both null it gives `null`; a null state gives `null`
  - `swatchYarns` for feeds `[{yarns: ["a", "b"]}, {yarns: ["a"]}]` gives `["a", "b"]`
  - `indexChanges(["a", "b"], ["b", "c"])` gives `{add: ["c"], remove: ["a"]}`
- [ ] **Step 2: Run `node --test test/profile-docs.test.js`.** Expect FAIL.
- [ ] **Step 3: Implement `profile-docs.js`.** Use the field shapes in spec §3, adding `title` to each (`"kniterate"`, `"yarn"`, `"swatch"`).
- [ ] **Step 4: Run it again.** Expect PASS.
- [ ] **Step 5: Commit:** "what a machine, a yarn and a swatch hold".

---

### Task 3: How each pass is knit

**Files:**
- Create: `src/frame/structure.js`
- Modify: `src/frame/knitting.js:20-90` (`readKnitout`)
- Create: `src/frame/test/structure.test.js`

**Interfaces:**
- Consumes: `readKnitout`, `carriageTrack` from `knitting.js`
- Produces:
  - `knitting.js`: `ROLLER = 100`, `SPEED = 100`. Every op carries `roller` and `speed` the way it carries `stitch` (`knitting.js:48`). `x-roller-advance N` sets roller, `x-add-roller-advance N` adds to it, and `x-speed-number N` sets speed.
  - `structureOf(stitches: [{back: boolean, x: number}]) -> "jersey"|"rib-1x1"|"rib-2x2"|"other"|null`. `x` is the needle's place along the row: `n` on the front and `n + rack` on the back.
  - `passStructures(ops, track) -> (string|null)[]`: for each op, the structure of the pass it's in. Passes are counted exactly as `knitcheck.js:155` counts them (a new pass whenever `track[i]?.turn != null`), and a pass's structure comes from its `knit` ops. Ops in passes with no knits get `null`.

`structureOf` decides as follows: sort by `x` and split into runs of the same bed. One run is jersey. Otherwise the inner runs (all but the first and last) decide. All inner runs of length 1, with edge runs ≤ 1, is 1×1 rib. All inner runs of length 2, with edge runs ≤ 2, is 2×2 rib. With no inner runs: all runs of 1 is 1×1 rib, all ≤ 2 with some 2 is 2×2 rib. Anything else is other.

- [ ] **Step 1: Write the failing tests:**
  - `structureOf([])` === null; front-only stitches give `"jersey"`
  - alternating F B F B at half rack (`x` = 0, 0.5, 1, 1.5…) gives `"rib-1x1"`
  - F F B B F F B B gives `"rib-2x2"`
  - **Review Focus 5:** `F B B F F B B F` gives `"rib-2x2"`, and `B F F B B F F` gives `"rib-2x2"`
  - F F F B gives `"other"`
  - `passStructures` on knitout text: a 2-row front-only swatch gives `"jersey"` for its knit ops; `rack 0.5` followed by passes knitting `f1 b1 f2 b2…` gives `"rib-1x1"`; a 2×2 rib cuff (4 passes) then a jersey body (4 passes) gives rib for the cuff's ops and jersey for the body's
  - `readKnitout("x-roller-advance 150\nknit + f1 1\n").ops` has its knit's `roller === 150` and `speed === 100`. Then `x-add-roller-advance 20` makes the next op 170
- [ ] **Step 2: Run `node --test test/structure.test.js`.** Expect FAIL.
- [ ] **Step 3: Implement** the roller and speed in `readKnitout`, and `structure.js`.
- [ ] **Step 4: Run `pnpm test`.** Expect PASS, including Task 1's and Task 2's tests.
- [ ] **Step 5: Commit:** "which structure each pass knits, and its roller and speed".

---

### Task 4: A stitch's size in each relaxation state

**Files:**
- Modify: `src/frame/size.js` (add after `munden`)
- Create: `src/frame/test/size-states.test.js`

**Interfaces:**
- Consumes: `RELAXED`, `FIBRES`, `munden` (already in `size.js`); `RELAX_STATES` from `profile-docs.js`
- Produces:
  - `kOf(relaxesLike, state) -> {kc, kw}|null`: `munden({relax: state, fibre: relaxesLike})` for dry, wet and full, and `null` for steamed.
  - `statesFrom(measured, relaxesLike, loop = null) -> {dry, steamed, wet, full}`. `measured` is `{[state]: {across: mm|null, up: mm|null}}`. Each output state is `{across, up, loop, estimated: boolean}` or `null`.

The rules for `statesFrom`:
- A state with both `across` and `up` measured is used as is, with `estimated: false`.
- A non-steamed state with one of them measured gets the other from its loop (`loop = up × kc` or `across × kw`), and is `estimated: true`.
- The base is the first of dry, wet, full that has anything measured. Every other non-steamed state is estimated from the base with the loop held constant: `across_t = across_b × kw_b ÷ kw_t` and `up_t = up_b × kc_b ÷ kc_t`, with `estimated: true`.
- `loop` is the `loop` argument if given, else `across_b × kw_b`.
- Steamed is only ever present when it was measured, and its loop is the base's loop (or `null` when it's the only state).

- [ ] **Step 1: Write the failing tests:**
  - `kOf("wool", "dry")` gives `{kc: 5.0, kw: 3.8}`; `kOf("wool", "steamed")` === null
  - dry measured as `{across: 3.65, up: 1.42}`: dry comes back unchanged and not estimated; wet.across ≈ 3.65 × 3.8 ÷ 4.1 and wet.up ≈ 1.42 × 5.0 ÷ 5.3, estimated; full is estimated the same way; steamed === null
  - only steamed measured: steamed is present and `estimated: false`; dry, wet and full are all `null`
  - dry with only `up` measured: dry.across = (up × 5.0) ÷ 3.8, and dry is estimated
  - with `loop = 14` given, every state's `loop` is 14
- [ ] **Step 2: Run** `node --test test/size-states.test.js`. Expect FAIL.
- [ ] **Step 3: Implement `kOf` and `statesFrom`.**
- [ ] **Step 4: Run** `pnpm test`. Expect PASS.
- [ ] **Step 5: Commit:** "a stitch's size in each relaxation state".

---

### Task 5: Matching a carrier to a size, tier by tier

**Files:**
- Modify: `src/frame/size.js`
- Create: `src/frame/test/size-match.test.js`

**Interfaces:**
- Consumes: `statesFrom`, `kOf`, `stitchSize`, `fabricOf` (`size.js`); `PLATED_TEX`, `nmOf` (Task 1); the `Resolved` carrier shape (Task 7, below). A `ResolvedSwatch`'s `relaxed[state]` is already a density `{wales, courses}` or null, so this task never reads raw swatch entries.
- Produces:
  - `machineTier(swatchMachine, machine, gauge) -> "measured"|"other-machine"|null`. Same `url` is `"measured"`. The same `make`, `model` and `gauge` is `"other-machine"`. With `machine` null, a swatch machine whose `gauge === gauge` is `"other-machine"`.
  - `feedMatches(swatch, carrier) -> boolean`. Some feed's yarn urls equal the carrier's as a multiset, and for two strands, `feed.plated === carrier.plated`.
  - `stitchSizes({carrier, stitch, structure, machine, gauge, fabric}) -> StitchSize`, where `StitchSize = {tier: "measured"|"other-machine"|"loop"|"guess", swatches: [{url, title, sure, machine}], states: {dry, steamed, wet, full}, roller: number|null, speed: number|null}`
  - `platingNote(carrier) -> string|null`

`stitchSizes`, in order:
1. **`carrier` is null (legacy):** `s = stitchSize(fabricOf({fabric}), stitch, 25.4 / gauge)`. Tier: `"swatch"` becomes `"measured"`, `"loop"` stays `"loop"`, `"guess"` stays `"guess"`. States: `statesFrom({[fabric.relax]: {across: s.across, up: s.up}}, fabric.fibre, s.loop)`. No swatches. Roller and speed are null.
2. **Measured tiers:** the swatches that pass `feedMatches`, have `swatch.stitch === stitch` and `swatch.structure === structure`, and get a non-null `machineTier`, where at least one state has a density. If any score `"measured"`, use only those. Otherwise use the `"other-machine"` ones. For each state, average the matching swatches' `100 ÷ wales` (across) and `100 ÷ courses` (up), skipping nulls. Pass that to `statesFrom` with `relaxesLike` from `carrier.yarns[0]` and loop as the mean of the swatches' `loop`, if any. Roller and speed come from the first matching swatch.
3. **Loop (jersey only):** a swatch matching as in 2, but with `loop` and no densities. `kc` and `kw` for the dry state are the mean of `loop × courses ÷ 100` and `loop × wales ÷ 100` over **all** of `carrier.swatches` with `structure === "jersey"`, a `loop`, and a dry density, on any machine. Failing that, `kOf(relaxesLike, "dry")`. Then dry is `{across: loop ÷ kw, up: loop ÷ kc}` through `statesFrom`.
4. **Guess:** `pitch = 25.4 / gauge`, `k = kOf(relaxesLike, "dry")`, and dry is `{across: pitch, up: pitch × k.kw ÷ k.kc}` through `statesFrom`.

`platingNote`: if `carrier.plated` and `carrier.tex` is outside `PLATED_TEX`, return `` `the two strands come to Nm ${nmOf(tex).toFixed(1)} together: the kniterate's manual says Nm 6–8 knits best` ``. Otherwise return null.

- [ ] **Step 1: Write the failing tests** with hand-built carriers. Use `swatch(overrides)` and `carrier(overrides)` helpers in the test file, in the Resolved shape from Task 7.
  - A swatch on the same machine url, same yarns, stitch `"5"`, `"jersey"`, dry per10 `{wales: 27.5, courses: 70}` gives tier `"measured"` and dry.across ≈ 3.636
  - The same swatch on another machine with the same make, model and gauge gives `"other-machine"`, and when both exist, only the same-machine swatch is listed
  - A different model gives no match, so the result is `"guess"`
  - A rib swatch never sizes jersey and a jersey swatch never sizes rib: structure `"jersey"` against a `"rib-2x2"` swatch gives `"guess"`
  - Plated vs held: a carrier with `plated: true` doesn't match a two-strand swatch with `plated: false`
  - Yarn order doesn't matter: `["a", "b"]` matches `["b", "a"]`
  - A loop-only jersey swatch with `loop: 14` and no fitted swatches gives `"loop"` and dry.up ≈ 14 ÷ 5.0
  - A loop-only rib swatch gives `"guess"`
  - Legacy: `carrier: null` with a `fabric` whose `stitches: {"5": {across: 27.5, up: 70}}` gives `"measured"` and dry.across ≈ 3.636
  - `platingNote` is non-null for a plated carrier with tex 66.7 and null for one with tex 140
- [ ] **Step 2: Run** `node --test test/size-match.test.js`. Expect FAIL.
- [ ] **Step 3: Implement** `machineTier`, `feedMatches`, `stitchSizes` and `platingNote`.
- [ ] **Step 4: Run** `pnpm test`. Expect PASS.
- [ ] **Step 5: Commit:** "match a carrier's stitch to a swatch, a loop, or a guess".

---

### Task 6: The check sizes each carrier, stitch and structure, in each state

**Files:**
- Modify: `src/frame/knitcheck.js` (the setup at `:35-45`, sizing inside the op loop at `:250-270`, the result at `:305-325`, and `sizeOfFabric` at `:330-365`)
- Create: `src/frame/test/knitcheck-size.test.js`

**Interfaces:**
- Consumes: `stitchSizes`, `platingNote` (Task 5); `passStructures`, `ROLLER`, `SPEED` (Task 3); `RELAX_STATES` (Task 2); `Resolved` (Task 7)
- Produces: `checkKnitout(text, converted, settings)`, where `settings.profiles` is a `Resolved` or absent. `result.size` becomes:
  ```js
  {
    states: {dry: {width, around, length}|null, steamed, wet, full}, // as sizeOfFabric's are now, for each state
    sources: [{carrier, stitch, structure, tier, swatches, count, roller, speed, kRoller, kSpeed}],
    notes: [string],          // platingNote per carrier, and roller/speed differences
    on,                       // as now, from the first non-null state
    stitches, relaxed,        // kept as now (from the first non-null state) until Task 11 removes them
  }
  ```
  `result.yarn[i].grams` uses the carrier's resolved `tex` when it has one. `machineLimits(profiles) -> {needles, carriers}` is exported, using `profiles.machine` or else `KNITERATE`.

What changes:
- The pitch is `25.4 / (profiles?.machine?.gauge ?? settings.gauge ?? 7)`.
- The cache key for `sizeOf` becomes `${carrier}|${stitch}|${structure}`, and each value is `{...stitchSizes(...), count}`. The carrier is `op.carriers[0]`, and `stitchSizes` gets `carrier: profiles?.carriers?.[carrier] ?? null`.
- Structure comes from `passStructures(ops, track)[i] ?? "jersey"`.
- Keep `tall`, `rows` and `passes[].front/back.mm` **for each state**, as `tallBy[state]` etc., skipping states whose size is null.
- The width, carrier and float checks use `machineLimits`.
- A roller or speed note is added when a source's `roller`/`speed` (from its swatch) differs from the .k's (the op's `roller`/`speed` at the source's first loop): `` `carrier 3, stitch 5: the swatch was knitted at roller 80, this at 100` ``.

- [ ] **Step 1: Write the failing tests.** Build a `Resolved` by hand: machine `{url: "m", make: "Kniterate", model: "Kniterate", gauge: 7, needles: 252, carriers: ["1"…"6"]}`.
  - A 20-needle × 10-row jersey .k on carrier 3, with a measured jersey swatch at stitch 5 (dry per10 wales 27.5, courses 70), gives `size.states.dry.width.mm` ≈ 20 × 100 ÷ 27.5 and `length.mm` ≈ 10 × 100 ÷ 70. `sources[0]` is `{carrier: "3", stitch: "5", structure: "jersey", tier: "measured"}`
  - `size.states.steamed` is null unless the swatch has steamed measured, and `size.states.wet` is present and estimated
  - A 2×2 rib cuff then a jersey body, with only a jersey swatch, gives two sources: rib is `"guess"` and jersey is `"measured"`
  - **Review Focus 2:** profiles with carrier 3 linked and carrier 4 unlinked: carrier 4's source tier comes from the legacy `settings.fabric` (`"guess"` with an empty fabric, `"measured"` with `fabric.stitches["5"]` set)
  - With no `settings.profiles` at all, `checkKnitout` gives the same `size.width`, `length` and `stitches` as before (snapshot the old output of a fixture first, in this step, before changing any code)
  - A plated carrier with tex 66.7 puts the plating note in `size.notes`
  - `x-roller-advance 150` in the .k, with the swatch's `roller: 100`, puts a roller note in `size.notes`
- [ ] **Step 2: Run** `node --test test/knitcheck-size.test.js`. Expect FAIL on everything except the snapshot.
- [ ] **Step 3: Implement** the changes listed above.
- [ ] **Step 4: Run** `pnpm test`. Expect PASS.
- [ ] **Step 5: Commit:** "the check sizes each carrier, stitch and structure, in each state".

---

### Task 7: Resolving a .k's profiles

**Files:**
- Create: `src/frame/profiles.js`
- Modify: `src/frame/loopsim.js:166-180` (`sizer`)
- Create: `src/frame/test/profiles.test.js`

**Interfaces:**
- Consumes: `profileKind`, `swatchYarns` (Task 2); `texOf` (Task 1); `stitchSizes`, `RELAX_STATES`
- Produces:
  - `resolveProfiles({find, k, projectFiles = []}) -> Promise<Resolved>`. `find(url) -> Promise<doc|null>`, and it may reject. `projectFiles` is `[{url, extension}]`.
  - `Resolved = {machine: {url, title, make, model, gauge, needles, carriers, stitches, floatLimit}|null, carriers: {[name]: {yarns: [{url, title, tex, relaxesLike, colour}], plated, tex, swatches: [ResolvedSwatch]}}, missing: [{url, why}], urls: string[]}`
  - `ResolvedSwatch = {url, title, sure, machine: {url, make, model, gauge}|null, stitch, structure, needles, rows, feeds, relaxed, loop: number|null, roller, speed}`. `relaxed` holds each state's density from `swatchDensity`, not the raw entry: `{dry: {wales, courses}|null, …}`.
  - `watchProfiles({repo, handle, project, onChange}) -> {stop(), current()}`
  - `loopsim.js`: `sizer({fabric, yarns, gauge, profiles})`

`resolveProfiles`, in order:
1. **Machine:** `k.profiles?.machine`, or else the only `projectFiles` entry with `extension === "machine"`, or else null. A doc that isn't a machine goes into `missing` as `"not a machine"`.
2. **Carriers:** for each `[name, urls]` of `k.profiles?.carriers`, find each yarn. A rejected or null find is `"not found"`, and a doc of the wrong kind is `"not a yarn"`. A carrier with no good yarns is left out, so it falls to the legacy path. `plated` is `!!k.yarns?.[Number(name) - 1]?.plated && urls.length > 1`. `tex` is the sum of each yarn's `texOf(yarn.count)`, or null if any is unknown.
3. **Swatches:** the union of the yarns' `swatches` indexes, deduplicated. Each must be a swatch (or it's `"not a swatch"`) and must list the yarn in `swatchYarns`, or it's silently dropped. Load each swatch's machine too.
4. **Plain data only:** build every field fresh, coercing strings with `String()` and numbers with `Number()` (or null), so nothing automerge leaks through. `urls` lists every doc read.

`watchProfiles`: `find = url => repo.find(url).then(h => h.doc()).catch(() => null)`. Resolve on start, and again 150 ms after any `"change"` on `handle` or on any handle in `urls`, using `project?.files?.() ?? []` each time. Re-subscribe to the new `urls` after each resolve. Call `onChange(resolved)` after each one.

`sizer`: when `profiles` is given, `size(number, yarn)` uses `stitchSizes({carrier: profiles.carriers[String(yarn + 1)] ?? null, stitch: number, structure: "jersey", machine: profiles.machine, gauge: profiles.machine?.gauge ?? gauge, fabric})`, taking the first non-null state of `RELAX_STATES`. It returns `{up, far, across}` in pitches as now, and `size.key` includes `profiles`. (The 3D view sizes everything as jersey for now. Loopsim's yarn index is the carrier's place in the .k's `;;Carriers:` header, which the Kniterate writer always gives as `1 2 3 4 5 6`.)

- [ ] **Step 1: Write the failing tests** with `find` over a `Map` of plain docs built with `newMachine`, `newYarn` and `newSwatch`:
  - One machine in `projectFiles` and no `k.profiles.machine` resolves that machine. Two machines resolve null.
  - A carrier linking yarn `y1` (Nm 2/30) gives `tex` ≈ 66.67 and `plated: false`. Two yarns with `k.yarns[2].plated = true` on carrier `"3"` give `plated: true` and tex summed.
  - **Review Focus 3:** linking a .k doc as a yarn gives `missing: [{url, why: "not a yarn"}]` and no entry for that carrier.
  - A yarn whose index lists a swatch that doesn't feed that yarn: the swatch isn't included. An index listing the same swatch twice: it's included once.
  - A `find` that rejects: `"not found"`, and no throw.
  - **Review Focus 4:** `structuredClone(await resolveProfiles(...))` doesn't throw when a doc field holds an object with a method (stand-in for an automerge string): `{toString() {return "x"}}`.
  - `sizer({profiles})` for a measured carrier gives `across` equal to dry.across ÷ pitch.
- [ ] **Step 2: Run** `node --test test/profiles.test.js`. Expect FAIL.
- [ ] **Step 3: Implement** `resolveProfiles`, `watchProfiles` and the `sizer` change.
- [ ] **Step 4: Run** `pnpm test`. Expect PASS.
- [ ] **Step 5: Commit:** "resolve a .k's machine, yarns and swatches into plain data".

---

### Task 8: The profile datatypes, the + menu, and the machine editor

**Files:**
- Create: `src/frame/profile-form.js`, `src/frame/profiles.css`, `src/frame/machine.js`
- Modify: `src/frame/index.js` (add three datatypes and three tools to `plugins`)
- Modify: `src/frame/files.js` (`fileExtension` and `TOOLS`)
- Modify: `src/frame/project.js:10` (`latticeOptions(baseRepo, repo = baseRepo)`, with three menu entries) and its callers `project.js:40` and `frame.js:463` (pass `repo`)

**Interfaces:**
- Consumes: `datatypeFor`, `newMachine`, `newYarn`, `newSwatch`, `profileKind`, the `*_TYPE` constants (Task 2)
- Produces:
  - `profile-form.js`: `form(root, title) -> HTMLElement` (a section); `field(label, hint, ...controls) -> HTMLLabelElement`; `numberInput({step, title, onValue}) -> HTMLInputElement` (blank or ≤ 0 calls `onValue(null)`); `textInput({title, onValue})`; `choice(options: [[value, label]], onValue) -> HTMLSelectElement`; `show(input, value)`, which sets the value unless the input is focused (as `checks.js`'s `setValue`); and `docChoice({files, kind, value, onValue, allowPaste: true}) -> HTMLElement`, a select of the project's files of that kind plus "paste a link…", which uses knitoutjs's `urlFromText`.
  - `machine.js`: `export default function MachineTool(handle, element, context = {}) -> () => void`
  - `files.js`: `fileExtension(doc)` returns `profileKind(doc)` when it's non-null. `TOOLS.machine`, `TOOLS.yarn` and `TOOLS.swatch` (`position: 1`, `extensions: [kind]`, `load: () => import("./machine.js")` and so on). Tasks 9 and 10 create `yarn.js` and `swatch.js`; until then their `TOOLS` entries load a module that throws "not yet".
  - `index.js`: `{type: "patchwork:datatype", id: "lattice:machine", name: "Knitting machine", icon: "Cog", load: async () => (await import("./profile-docs.js")).datatypeFor("lattice:machine")}`. Likewise `lattice:yarn` ("Yarn", icon `"Spool"` or, if patchwork's icon set lacks it, `"Tag"`) and `lattice:swatch` ("Swatch", `"Square"`), plus a `patchwork:tool` for each with `supportedDatatypes: [type]` loading the editor's default export.
  - Menu entries: `{icon: "build", label: "machine", detail: "a knitting machine: its gauge, beds and stitch table"}`, `{icon: "link", label: "yarn", …}`, and `{icon: "fit", label: "swatch", …}`. Each `create()` does `(await repo.create2(newX())).url`.

The machine editor, written to the copy rules in spec §6:
- Fields: title, make, model, gauge ("needles per inch"), needles ("per bed"), beds, carriers (as text, split on spaces), float limit ("longest float, in needles"), notes.
- The stitch table: one row per `stitches` entry, showing the stitch number, front and rear stitch size (0 to `stitchSizes.max`) and a note, plus an "add a stitch number" input that takes `0`–`9` or `A`–`Z`. The hint is: "knitout's x-stitch-number names an entry in the kniterate's own stitch table: what that entry's set to, on each bed".
- Each field writes with `handle.change(doc => …)`, one key at a time. The editor listens for `"change"` and redraws through `show()`.

- [ ] **Step 1: Run `pnpm dev`** and open a lattice project. Confirm the + menu has no machine entry yet. (This is the baseline; this task's checks are by hand.)
- [ ] **Step 2: Implement** `profile-form.js`, `profiles.css` (using the `--knitoutjs-*`/theme tokens that `checks.css` uses), `machine.js`, and the `index.js`, `files.js` and `project.js`/`frame.js` changes.
- [ ] **Step 3: Check by hand in `pnpm dev`.**
  - **Machine in the + menu:** + → machine creates a doc, files it in the project and opens it in the machine editor.
  - **Edits merge:** editing gauge in two tabs merges.
  - **Standalone:** the doc opens in patchwork's own view, through the `patchwork:tool`, outside lattice.
  - **Yarn and swatch:** they appear in the + menu.
- [ ] **Step 4: Run** `pnpm test`. Expect PASS (nothing in it should break).
- [ ] **Step 5: Commit:** "machines are docs: make one from the + menu, and edit it".

---

### Task 9: The yarn editor

**Files:**
- Create: `src/frame/yarn.js`
- Modify: `src/frame/profiles.css`

**Interfaces:**
- Consumes: `profile-form.js` (Task 8); `texOf`, `nmOf`, `COUNT_SYSTEMS` (Task 1); `newSwatch`, `swatchDensity`, `RELAX_STATES` (Task 2)
- Produces: `export default function YarnTool(handle, element, context = {}) -> () => void`, and `swatchSummary(swatch) -> string` (exported, so the checks panel can reuse it)

The yarn editor:
- Fields: title; fibres (rows of fibre and percent, plus "add a fibre"); "relaxes like" (`wool`/`cotton`/`synthetic`, labelled with `size.js`'s `FIBRES` names); count, as a value, a system choice and ply, with a greyed "= 66.7 tex" beside it; supplier; colourway; colour (`<input type=color>`); lot; notes.
- **Its swatches:** loaded with `context.repo.find`, one line each from `swatchSummary`. The format is `"2×2 rib · st 5 · plated · 48 × 100 · steamed: 98 × 142 mm · guessed"`: the structure label, `st N`, plated or held when there are two strands, needles × rows when known, and the first measured state with its mm (or per 10 cm), then `sure`. Clicking a line calls `context.open?.(url, element)`.
- **"new swatch with this yarn":** `repo.create2(newSwatch())` with `knit.feeds = [{carrier: "1", yarns: [handle.url], plated: false}]`, and the new swatch's url pushed onto `yarn.swatches`. Then `context.open?.(url, element)`, or, outside lattice, a link to it.

- [ ] **Step 1: Write a failing test** for `swatchSummary` in `test/yarn.test.js`. A rib-2x2 swatch with stitch 5, plated, needles 48, rows 100 and steamed `{entered: "mm", width: 98, height: 142}` gives exactly `"2×2 rib · st 5 · plated · 48 × 100 · steamed: 98 × 142 mm · guessed"`. Unknown needles and rows leave that part out.
- [ ] **Step 2: Run it.** Expect FAIL.
- [ ] **Step 3: Implement `yarn.js`** (`swatchSummary` mustn't touch the DOM, so it can be tested).
- [ ] **Step 4: Run `pnpm test`** (expect PASS), then check by hand in `pnpm dev`. Make a yarn, set Nm 2/30, see 66.7 tex, make a swatch from it, and confirm the swatch is listed and opens.
- [ ] **Step 5: Commit:** "yarns are docs, and know their swatches".

---

### Task 10: The swatch editor

**Files:**
- Create: `src/frame/swatch.js`, `src/frame/swatch-fill.js`
- Create: `src/frame/test/swatch-fill.test.js`
- Modify: `src/frame/profiles.css`

**Interfaces:**
- Consumes: `profile-form.js`; `swatchDensity`, `swatchYarns`, `indexChanges`, `RELAX_STATES`, `STRUCTURES` (Task 2); `checkKnitout`'s `result` (Task 6); `textHash`, `docText` from `files.js`; `size.js` `tightness` and `grams`
- Produces:
  - `knitFromCheck(result, k, kUrl, kText) -> object`, the swatch fields to merge into `knit`: `{needles: result.width, rows: <the largest non-null state's length.rows>, stitch, structure, roller, speed}` from the source with the highest `count`, plus `feeds` (one for each carrier in `result.yarn`: `{carrier, yarns: k.profiles?.carriers?.[carrier] ?? [], plated: !!k.yarns?.[Number(carrier) - 1]?.plated}`), `k: kUrl` and `kHash: textHash(kText)`.
  - `export default function SwatchTool(handle, element, context = {}) -> () => void`

The swatch editor:
- **"how it was knit":**
  - The machine (`docChoice`, kind `machine`).
  - Feeds: a row per feed with a carrier choice of `"1"`–`"6"`, then one or two yarns (`docChoice` of kind `yarn`, labelled "knitting hole" and "plating slit") and plated/held.
  - The stitch number, the stitch size on each bed (0–15), roller, speed, needles ("every needle in use, both beds"), rows, and structure (with a note field for "other").
  - The known/believed/guessed switch with a note, and the manual's hint, verbatim: "a good size for a reliable tension swatch is 80 needles by 80 rows", plus ", bigger for rib, which pulls in".
- **Keeping the yarns' indexes right:** whenever feeds change, compute `indexChanges(before, after)` over `swatchYarns`. Then `repo.find` each added yarn and push this swatch's url onto its `swatches` (if it isn't there already), and remove it from each removed yarn's.
- **"fill from a .k":** a `docChoice` of kind `k` (project files with extension `k`). Run `checkKnitout(docText(kDoc), null, {...readSettings()})` on the page and merge in `knitFromCheck`. If `knit.k` is set and `textHash(docText(kDoc)) !== knit.kHash`, show: "the .k this was filled from has changed since: the swatch hasn't, so nothing's changed here" with a "fill again" button.
- **"measured":** one row per `RELAX_STATES`, with labels from spec §3 (*off the machine*, *steamed*, *washed*, *washed hot & tumbled*). Each has an mm/per-10 cm toggle that sets `entered`, two numbers, grams, date and who. The other pair is shown greyed, from `swatchDensity`; when needles or rows are needed but unknown, it shows "needles and rows turn mm into per 10 cm". For rib, the labels read "needles / 10 cm" instead of "wales / 10 cm".
- **A feed that doesn't fit the machine:** a warning beside the feeds when a feed's carrier isn't one of the machine's `carriers`, or `needles` is more than `machine.needles × machine.beds`. It still saves.
- **Loop length:** mm, date and who.
- **Notes.**
- **"what follows":** the tightness factor and g/m² for the first measured state, when the tex is known. Use `size.js`'s `tightness`/`grams` with a fabric built from the first feed's yarns (tex summed, strands 1), and this swatch's kc and kw (`loop × courses ÷ 100`, `loop × wales ÷ 100`) when it has a loop length.
- **Photos are left out of this task** (spec open question).

- [ ] **Step 1: Write the failing tests** for `knitFromCheck`, using a real `checkKnitout` result from a 48-needle × 100-row 2×2 rib fixture on carrier 3 with `x-stitch-number 7` and `x-roller-advance 80`: `needles === 48`, `rows === 100`, `stitch === "7"`, `structure === "rib-2x2"`, `roller === 80`, and `feeds` equal to `[{carrier: "3", yarns: [], plated: false}]`. Then with `k.profiles.carriers["3"] = ["a", "b"]` and `k.yarns[2].plated = true`, `feeds[0]` is `{carrier: "3", yarns: ["a", "b"], plated: true}`.
- [ ] **Step 2: Run** `node --test test/swatch-fill.test.js`. Expect FAIL.
- [ ] **Step 3: Implement `swatch-fill.js` and `swatch.js`.**
- [ ] **Step 4: Run `pnpm test`** (expect PASS), then check by hand in `pnpm dev`:
  - **Measuring:** enter a steamed state as per 10 cm with no needles known (Review Focus 1), and see the greyed mm say what it needs.
  - **Yarn indexes:** switch a feed's yarn and confirm the old yarn no longer lists the swatch and the new one does.
  - **Fill from a .k:** fill from a .k, edit that .k, and see the notice.
- [ ] **Step 5: Commit:** "swatches are docs: how they were knit, and what they measure".

---

### Task 11: The checks panel: what's loaded, the readout, and migrating

**Files:**
- Modify: `src/frame/checks.js` (`checkPanel` `:103`, `sizeFacts` `:398-440`, and the fabric box `:190-315`)
- Modify: `src/frame/kniterate.js:278`, `src/frame/animation.js:229` and `:1163-1168`, `src/frame/knit3d.js:370`, `:447` and `:1006-1011`
- Create: `src/frame/migrate-fabric.js`, `src/frame/test/migrate-fabric.test.js`
- Modify: `src/frame/knitcheck.js` (drop `size.stitches` and `size.relaxed`)
- Modify: `src/frame/checks.css`

**Interfaces:**
- Consumes: `watchProfiles` (Task 7); `size` result (Task 6); `swatchSummary` (Task 9); `docChoice` (Task 8); `newYarn`, `newSwatch` (Task 2)
- Produces:
  - `checkPanel(stage, onPick, {handle = null, context = {}, onProfiles = null} = {})`. With a `handle` it runs `watchProfiles({repo: context.repo, handle, project: context.project, onChange})`, checks with `{...readSettings(), profiles: resolved}`, and calls `onProfiles?.(resolved)`. Without one, it behaves as now.
  - `Knit3dTool(handle, element, context = {})`. All three tools pass `{handle, context, onProfiles}`, and animation and 3D do `loopSize = sizer({...settings, profiles})` from it.
  - `profilesFromFabric(fabric) -> {yarn: object, swatches: object[]}` in `migrate-fabric.js`. The yarn is `newYarn()` with `relaxesLike: fabric.fibre` and `count: {system: "tex", value: fabric.tex, ply: fabric.strands}`. There's one `newSwatch()` per `fabric.stitches` entry, with `knit.stitch`, `structure: "jersey"`, `sure: "believed"`, `loop.mm = entry.loop`, and `relaxed[fabric.relax] = {entered: "per10", wales: entry.across, courses: entry.up}` when both are known.

The panel:
- **"what's loaded"** sits above the results, shown only when the tool passed a `handle`.
  - The machine: `docChoice` of kind `machine`, with an extra option "no machine (7 gauge)" that writes null.
  - One row for each carrier in the last result's `yarn`, with one `docChoice` of kind `yarn` (two when `doc.yarns[N - 1].colours.length > 1`), labelled "knitting hole" and "plating slit".
  - Writes go through `handle.change(doc => {doc.profiles ??= {machine: null, carriers: {}}; …})`.
  - It lists `resolved.missing` as "couldn't load …: <why>".
  - Until the first resolve arrives, it says "loading profiles…". The check runs anyway, without profiles, so the readout shows the legacy numbers in the meantime and is never blank.
- **The readout** (replacing `sizeFacts`):
  - A table with a row per non-null `size.states` entry, labelled as in Task 10. Columns are width (or round) × length in mm, with an "estimated" chip when that state's sizes were estimated for any source, and grams (the sum of `result.yarn[].grams`).
  - Then a line per `size.sources` entry: `carrier 3, st 5, 2×2 rib: measured from <swatch title, a link through context.open> (guessed), on <machine title>`. "on another kniterate: <title>" is used for `other-machine`. For loop it says "from its loop length, by Munden's constants". For guess it says "a guess: knit a swatch at stitch 5 in jersey, or measure its loop length", and for rib it adds "relaxed rib comes out much narrower than this".
  - Then each of `size.notes`, then the `size.on` line as now.
- **The old fabric box** shows only when `!handle || !doc.profiles`. It gains "make profiles from this", which uses `profilesFromFabric` and creates the docs with `context.repo.create2`. It then sets the yarn's `swatches` to the new swatch urls, links the yarn to every carrier the last result used (through `doc.profiles`), and opens the yarn with `context.open(url, element)`, which also files it in the project. The swatches aren't filed in the project themselves. They're reached from the yarn's editor, and the tool context has no way to file a doc without opening it. (This is a small departure from spec §7, which says the migrated docs are filed in the project.)

- [ ] **Step 1: Write the failing test** for `profilesFromFabric`. The fabric `{relax: "dry", fibre: "wool", tex: 67, strands: 2, stitches: {"5": {loop: 14, across: 27.5, up: 70}}}` gives a yarn with `count` `{system: "tex", value: 67, ply: 2}` and one swatch with `knit.stitch === "5"`, `loop.mm === 14`, and `relaxed.dry` equal to `{entered: "per10", wales: 27.5, courses: 70}`.
- [ ] **Step 2: Run it.** Expect FAIL.
- [ ] **Step 3: Implement** `migrate-fabric.js`, then the panel, the three callers, and the removal of `size.stitches`/`size.relaxed` (update Task 6's tests that read them to read `states` instead).
- [ ] **Step 4: Run `pnpm test`** (expect PASS), then check end to end by hand in `pnpm dev`:
  - **Linking a .k:** in a project with a machine, a yarn and a measured jersey swatch at stitch 5, open a .k knitting jersey on carrier 3 at stitch 5. Link the yarn to carrier 3 in "what's loaded". The readout should say measured and link to the swatch, with washed and full estimated and steamed absent.
  - **Rib cuff:** add a 2×2 rib cuff to the .k. It should show a rib "guess" line with the narrower warning.
  - **A second Kniterate:** with a second Kniterate machine doc holding the swatch, the line should read "on another kniterate".
  - **Migrating:** with a .k that has no profiles, "make profiles from this" should create a yarn and a swatch from the old fabric, and the readout should then come from them.
  - **3D view:** it still renders, and resizes when the swatch changes.
- [ ] **Step 5: Commit:** "the check reads a .k's profiles: what's loaded, and how big it comes out".

---

## After the plan

- **Round trip:** once the lambswool 2×2 rib swatch is measured and Agnes has its .k (or one has been rebuilt), link them. That .k's predicted size at its own stitch number should equal the swatch's measured size exactly. This is the first real end-to-end check (spec §9).
- **Left for later, from the spec's open questions:** photos on swatches, nesting swatches under yarns in the file tree (that needs a knitoutjs hook), Knapton's rib constants (rib's from-loop tier), and whether B counts rib by face wales.
