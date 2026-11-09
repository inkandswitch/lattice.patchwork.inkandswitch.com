# wm

a project's panes, and its files down the side: the workspace lattice is
built on, and Knitout JS too.

- `workspace.js`: `mountWorkspace`, the panes and the files.
- `project-view.js`: `mountProject`, a project doc shown with it, or a
  button to update one from before.
- `doc/`: the project's shape and its layout. nothing in it imports a
  package, so a datatype can use it in a worker.
- `ui/`: icons, tooltips, sidebars, and the stylesheet helper.
- `patchwork/`: finding and making docs.

it started as the panes in [knitoutjs](../knitoutjs), and is
[AGPL-3.0-or-later](LICENSE), as it was there.
