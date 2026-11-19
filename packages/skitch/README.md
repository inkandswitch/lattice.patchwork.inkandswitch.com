# skitch

a sketch: a page of layers, drawn four ways, each by a tiny library that's
only loaded when something wants it.

**move** (v) picks things up: click one, shift-click for more, drag a box
round some (whatever's wholly inside), or ⌘a for everything. drag them, size
them by a corner (going past the opposite one, it grows that way, as
tldraw's do; shift keeps its shape), turn them by the knob (shift: by 15°),
or delete them. one thing's sized in its own box, any way; several are in a
box round them all, sized keeping their shapes.

while something's picked up, a tray floats over the page: to the front,
forward, back, to the back (⇧], ], [, ⇧[, or ⌘ with them anywhere), group
(⌘g: picking one picks them all; twice on one, just it) and ungroup (⇧⌘g),
and stack them up across or down, 16 apart (a group goes as one).

- **paint**: [atrament](https://github.com/jakubfiala/atrament). each stroke
  is recorded, then drawn again by an atrament of its own off the page, as a
  picture of just that stroke, so paint is data in the doc, not a bitmap
- **fill**: atrament's flood fill, over a picture of everything on the page.
  what it covered is kept as runs of pixels, and it goes just above what it
  was poured onto, under the lines around it
- **ink**: [perfect-freehand](https://github.com/steveruizok/perfect-freehand)
  (wm's vendored port, as its ink uses), thinning as it goes, or with a pen's
  pressure
- **marker**, and clean **line**, **arrow**, **box**, **oval**: [drauu](https://github.com/antfu/drauu)'s
  svg, kept as data (marks.js's cleanNode keeps only shapes: nothing that
  runs or links)
- **sketchy** shapes: [rough.js](https://roughjs.com)
- the **eraser** rubs out of every layer it touches: a mask on each, which
  moves, turns and sizes with it
- a **line** or an **arrow** drawn from or to something holds on to it, and
  follows it wherever it's moved, turned or sized

keys (shown on a button as you point at it): v move, b brush, f fill, i
ink, m marker, l line, a arrow, r box, o oval, e eraser; 1 to 6 for a colour
(chee.party's) and 7 for your own, [ and ] for the size (with nothing
picked up), s for sketchy, ⇧f for
filled, ⌘z and ⇧⌘z. icons are [phosphor](https://phosphoricons.com)'s
(icons.js, MIT).

with other people: what each of you has picked up shows in your colour, and
a drag, a turn or a size goes to everyone as it happens (over the doc's
ephemeral channel, as wm's live drags do), and into the doc once, when it's
let go of. wm's pointers land on the page through `element.inkSpace`.

the doc is a list of marks (marks.js), one layer each, stacked by their z
(an old skitch's, by where they are in the list). a mark is
only ever made, placed (place.js) or taken away, never changed, so two people drawing at
once both keep theirs. undo is yours: it only takes back what you did. atrament, drauu and rough.js are minified into vendor/ (`pnpm vendor`,
from the devDependencies), as packages/ is served as it is. a project's +
menu makes one;
lattice's frame registers it (packages/lattice/index.js).
