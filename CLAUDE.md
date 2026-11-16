# lattice

## looking in chee's tab: `pnpm page`

While `pnpm dev` is running, `pnpm page` runs code in the lattice tab chee
has open (its own localhost page, or the site with `?dev=<tunnel>`) and
prints what came back. Use it to look at the live DOM, styles and console,
and to make projects and files the way the frame does (through the account's
home folder, and keyhive when it's on), instead of guessing or asking chee
to paste things.

```sh
pnpm page tabs                         # which tabs are in (none: ask chee to open `pnpm page link`)
pnpm page eval 'document.title'        # an expression is its value; else `return`
pnpm page eval - <<'EOF'               # longer code on stdin
const files = await lattice.files(lattice.projects()[0].url)
return files.map(f => f.name)
EOF
pnpm page dom '.lattice-shell' --depth 2
pnpm page inspect '.some-pane'          # box + layout styles
pnpm page logs                          # console errors/warnings, uncaught
pnpm page projects
pnpm page new-project 'cables'          # makes it, shows it, prints its url
pnpm page add-file <project-url> swatch.js < swatch.js
pnpm page read <file-url>
pnpm page write <file-url> < swatch.js  # merged in (updateText), not replaced
```

In code, `lattice` is the helpers (`packages/lattice/page.js`): `projects()
open(url) newProject(title) files(project) addFile(project, name, content)
read(url) write(url, content) dom(selector, {depth}) inspect(selector)
logs()`, and `lattice.repo`, `.hive`, `.home` for anything else. `--tab ID`
picks a tab (else the focused one), `--timeout MS` (10000).

What it does in the tab is real: it's chee's account, and other people may
be in the project. Ask before deleting or rewriting anything that's theirs.
Never print or send the token (`node_modules/.lattice-page.json`), or the
link from `pnpm page link`.
