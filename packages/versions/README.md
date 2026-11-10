# Versions

Lattice's history panel: who changed what and when, drafts to try things
in, and milestones to name the versions worth keeping. It's a copy of
`drafts` whose history can be folded the way you want to read it.
`drafts` shows one row per burst of editing, split wherever ten minutes pass
without a change. This keeps the same cards, scrubber, diff baseline, fork
and merge, but puts a **Group by** picker at the top of the panel:

- **Activity** — bursts split by ten-minute lulls (what `drafts` shows).
- **Time** — fixed calendar buckets, at a resolution you pick alongside:
  1 minute, 1 hour, 1 day or 1 week. The row's time is the bucket ("Tue 28
  Oct, 14:00", "Tue 28 Oct", "Week of 2 Nov").
- **Author** — consecutive runs of changes by the same person.
- **File** — consecutive runs of changes in the same file (the host doc or
  one embedded in it), named in the row ("in Notes"). This is what you see
  until you pick another.

Each row reads left to right in three aligned columns: the edit counts on
the far left, each over a bar sized against the card's largest change
(square-root scale, so small edits still show); the authors (avatar and
name) in the middle; and the date and time on the far right — "13:28"
for today, "Yesterday, 14:40", "Tue 28 Oct, 14:40" beyond that.

The space between rows follows the pause between them, on a log scale: a
few minutes add nothing, an hour adds a little air, a day a clear gap, and
a week or more the same capped gap. Nothing decides where one sitting ends
and the next begins; the spacing only makes the silences visible.

Wherever the calendar day changes going down the list, a small bold heading
("Today", "Yesterday", "Tue 28 Oct") divides the rows and stands in for the
lull spacing there, so no extra gap opens above it. Time mode at day or
week resolution skips it, since those rows already say the day.

## Milestones

Any version can be flagged and named with the flag button in the card
title. With a version pinned in the timeline it flags that version;
unpinned it flags the latest. You're asked for a name
(blank takes "Milestone N"). The milestone appears as a flagged marker in
the timeline above the row its version sits in, in every grouping. Click
it to view that exact version, double-click its name to rename it, and
use the × that appears on hover to remove it.

Milestones are stored on the host doc's main draft doc (`milestones`, keyed
by id, each with the flagged change and the per-member heads of that
version), so they sync to everyone and survive regrouping. A milestone
flagged in a draft belongs to that draft's timeline; one flagged on Main to
Main's.

Every mode keeps the timeline in order (top = latest, bottom = first), so
scrubbing, pinning and the diff baseline work the same whichever is chosen;
switching modes keeps the pinned version where it is.

Authors with a contact show that contact's avatar and name. Everyone else is
**Anon 1**, **Anon 2**, … — numbered by first appearance in the
history, oldest first, so the numbers hold still as new changes arrive. A
contact without a name is numbered the same way.

Grouping happens in the browser from the member docs' change history, so the
persisted change-group doc that `drafts` reads is left untouched and the two
tools can be installed side by side. The choice of grouping is remembered per
browser (localStorage, `versions:grouping`), not written to any document.

Registers the same `patchwork:draft` datatype and the same draft-state /
draft-overlay providers as `drafts` (same ids). If both packages are
installed, whichever loads last supplies those; the code is identical, so it
doesn't matter which. Lattice loads this in place of `drafts`. The sidebar
tool and component are registered as `versions`.

Its CSS classes and variables are prefixed `dgr-` rather than `draft-`.
Tools render into the light DOM and every drafts fork injects its stylesheet
into the same page, so a fork that keeps the `draft-` names picks up the
rules of whichever sibling loaded last (`drafts-flow` stretches the selected
card, `drafts-river` paints an axis in the gutter). The prefix keeps this
tool's look its own whatever else is installed.

## Credits

Versions is by Mimi Reyburn, made from `drafts` in
[patchwork-pkg-base](https://github.com/inkandswitch/patchwork-pkg-base).

## Changelog

- **0.4.0** — Now Versions, lattice's own: the tool and component are
  `versions`, and the history is grouped by file unless you've picked
  otherwise ("Document" is now "File"). A grouping remembered as
  `drafts-grouped:grouping` moves to `versions:grouping`.

- **0.3.8** — The current-position line runs behind the rows and markers
  instead of over their text; the handles stay on top.
- **0.3.7** — Flags are solid and dark pink, as are the milestone dots in
  the gutter.
- **0.3.6** — The milestone's gutter dot (and the head, when on it) sit
  level with the middle of the marker's text.
- **0.3.5** — A dot in the scrubber gutter marks each milestone's position
  on the track.
- **0.3.4** — A milestone's date and time sit flush right, in line with the
  rows' times; its × moves beside the name.
- **0.3.3** — Clicking a milestone puts the scrubber on the flag itself (no
  separate sticker): the flag is that version. Markers lose their border and
  fill and read as labels.
- **0.3.2** — Unknown authors are "Anon 1", "Anon 2", … rather than
  "Anonymous 1".
- **0.3.1** — The ⋯ menu is gone: fork, fork-from-version, flag milestone,
  merge and delete are icon buttons in the card title, labelled on hover.
- **0.3.0** — Any version can be flagged as a milestone and named: "Flag …
  as a milestone" in the card menu flags the version you're looking at (or
  the latest). Milestones show as flagged markers in the timeline; click to
  view that version, double-click the name to rename, × to remove.
- **0.2.3** — Dates carry the weekday and a comma takes the place of "at":
  "Tue 28 Oct, 14:40", "Yesterday, 14:40", "14:32" for today.
- **0.2.2** — The word "on" is gone from the dates too: "28 Oct at 14:40".
- **0.2.1** — The word "by" is gone from the rows and the three columns
  have more air between them.
- **0.2.0** — A tinted bar behind each +N / −N count shows the size of the
  change against the largest in the card, so big edits stand out down the
  list without reading the numbers.
- **0.1.8** — The rows line up in three columns: counts on the far left,
  the author in the middle, the date and time on the far right.
- **0.1.7** — Each row reads as a sentence, left to right: "+X −Y by PERSON
  on date at time" ("at 13:28" for today, "yesterday at 14:40"); Document
  mode adds "in DOCUMENT" after the person.
- **0.1.6** — The time leads every row, in a fixed-width column, so the
  stamps line up down the list; avatars and captions follow it.
- **0.1.5** — No gap opens above a day heading any more: where there is a
  heading it marks the break on its own, and the lull spacing is dropped.
- **0.1.4** — A small bold day heading ("Today", "Yesterday", "Tue 28 Oct")
  divides the rows wherever the calendar day changes, except in Time mode at
  day or week resolution, where the rows already say the day.
- **0.1.3** — Rows sit further apart the longer the pause between them: a
  few minutes add nothing, an hour a little air, a day a clear gap. No
  session length is assumed; the spacing just follows the silence.
- **0.1.2** — The panel no longer picks up styling from the other drafts
  tools installed alongside it (the floating scrubber and the stretched card
  were their rules leaking in): every class and variable now carries its own
  `dgr-` prefix.
- **0.1.1** — The selected card ends right under its last history row and
  never takes more than three quarters of the panel; longer histories scroll
  inside it.
- **0.1.0** — Forked from `drafts` 0.1.2. The history can be grouped by
  activity, by time (1 minute / 1 hour / 1 day / 1 week), by author or by
  document; unknown authors are named Anonymous 1, 2, …
