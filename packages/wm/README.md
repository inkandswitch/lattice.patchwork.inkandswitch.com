# wm

a project's panes, and its files down the side: the workspace lattice is
built on, and Knitout JS too.

- `workspace.js`: `mountWorkspace`, the panes and the files.
- `project-view.js`: `mountProject`, a project doc shown with it, or a
  button to update one from before.
- `doc/`: the project's shape and its layout. nothing in it imports a
  package, so a datatype can use it in a worker.
- `ui/`: icons, tooltips, sidebars, and the stylesheet helper. and
  `secret.js`: what's hidden till ctrl, alt and command are tapped together
  twice, with nothing else in between (the same again hides it).
- `ink.js`: following someone, you draw on their panes, they see it, and it
  fades a moment after. it's pinned to what it's drawn on: a character in a
  codemirror editor, a point in a tool's own space (a tool that says what's
  where sets `inkSpace` on its element: see the top of `ink.js`), or else a
  place in the pane. perfect-freehand draws it, as tldraw draws.
- `vendor/perfect-freehand.js`: Steve Ruiz's perfect-freehand (MIT), in
  chee's readable port from aftersun.
- `call/`: calls. `call.js` is the call itself (one in a tab, over webrtc,
  connecting over the project's room, the one presence is in), and `ui.js`
  its faces, the question before you join, and faces floating or down a
  sidebar. `face.js` finds your face in your own camera, so everyone's faces
  can be shown centred on it: the browser's FaceDetector if there is one,
  else google's mediapipe face detector, fetched from jsdelivr when it's
  first wanted. made from patchwork's `call` experiment. the phone's beside the
  files' +, while a call's on, or while it's not a secret.
- `patchwork/`: finding and making docs, and a + menu item for a new doc of
  one of patchwork's datatypes.
- `wm.css`: how it all looks, in `--lattice-wm-*` tokens made from the
  patchwork theme's. an app gives it a look of its own by setting those
  (knitoutjs's `look.css` does, for lattice and Knitout JS). its menus
  (`.lattice-wm-menu`), tooltips and sidebar resizers are an app's to use
  too.

what an app adds to the panes it adds as an extension: see the top of
`workspace.js`. knitoutjs's is `../knitoutjs/wm.js`.

it started as the panes in [knitoutjs](../knitoutjs), and is
[AGPL-3.0-or-later](LICENSE), as it was there.
