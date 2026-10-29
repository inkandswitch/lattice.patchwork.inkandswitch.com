# latticex

One program on a pty on your computer, shared over an automerge doc. The doc
is never written to: the screen goes out as ephemeral messages on it (seen
live, stored nowhere) and keys come back the same way. Anyone with the doc's
url can see the program and type into it.

## install

```sh
cd latticex
pnpm install
npm install --global .   # or: pnpm link --global
```

Needs node 22.13 or later.

## share a terminal

In lattice, hold ⌥ and press a frame's `+`: **terminal** makes a terminal doc
in the project. It shows the command to run:

```sh
latticex automerge:… zsh
```

That runs zsh here, in this terminal, and shares it there. Everything after
the url is the program (your `$SHELL` if there's none). Options go before the
url:

- `--readonly`: they can look; only this terminal types into it
- `--size COLSxROWS`: the size when latticex isn't run from a terminal (100x30)
- `--server URL`: the subduction server (wss://subduction.sync.inkandswitch.com)
- `-q`: say nothing before the program starts

It ends when the program does, with its status. The program can find the url
in `$LATTICEX_URL`.

## look and type (how Mimi uses it)

Give Mimi the url and she can see and control the terminal:

```sh
latticex look automerge:…                      # the screen, as text
latticex type automerge:… 'ls -la<enter>'      # type into it
latticex type --look automerge:… 'git status<enter>'   # type, then look
```

`type` types text as it is. Keys go in angle brackets: `<enter>` `<tab>`
`<esc>` `<backspace>` `<delete>` `<up>` `<down>` `<left>` `<right>` `<home>`
`<end>` `<pageup>` `<pagedown>` `<f1>`…`<f12>`, with `C-` (ctrl), `M-` (alt)
and `S-` (shift) in front: `<C-c>`, `<M-b>`, `<S-tab>`. Anything in angle
brackets that isn't a key stays text. `look` prints the size, the cursor and
the title on stderr.

## the messages

Each is a `handle.broadcast` on the doc, with a `latticex` field saying what
it is.

From latticex:

- `screen`: `{host, seq, full, cols, rows, lines, cursor: {x, y, visible},
  title, readonly, modes}`. `lines` maps a row number to its runs (all of
  them when `full`, else just the rows that changed). A run is `[x, text, fg,
  bg, flags]`: a colour is -1 for the default, 0–255 for the palette, or
  `0x1000000 | rgb`. flags: bold 1, italic 2, underline 4, inverse 8, dim 16,
  strike 32, invisible 64, wide 128 (a run of one character two columns wide)
- `alive`: `{host, seq}` every 2s
- `exit`: `{host, status}`

To latticex:

- `hello`: send me the whole screen
- `keys`: `{from, n, input}`. `input` is a list of strings (typed as they
  are), `{key: "C-c"}` and `{paste: "text"}`. Ephemeral messages can arrive
  out of order, so each viewer numbers its own from 1 (again for each new
  `host`) and latticex types them in that order. A viewer missing a `screen`
  `seq` waits a moment for it, then says `hello`.
