import { createSignal, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { goToLine as goToLineIn, keepCaretInPlace, knitoutEditorIntegration, showError } from "./cm-knitout.js";
import { docText, fileExtension, knitoutOf } from "./files.js";
import { docRefs } from "./doc-refs-cm.js";
import { definitionDoc, dropImport, importLineAt, toolFor } from "./doc-refs.js";
import { languageServerDocs } from "./language-server.js";
import { importsOf } from "./knitout-links.js";
import { builderOf } from "./builds.js";
import { takeBuilder } from "./builder.js";
import { BuildBar } from "./build-bar.js";
import { jsBuild } from "./js-build.js";
import { icon } from "./icons.js";
import { stylesheet } from "./stylesheet.js";

const STYLESHEET = new URL("./editor.css", import.meta.url).href;

// patchwork's file tool asks for extra CodeMirror extensions with this event,
// just before it makes its editor (see base/file's README)
const EXTENSIONS_EVENT = "file:codemirror-extensions";

// and with its language server, it says so when a definition is in a file
// that isn't open, for us to open
const DEFINITION_EVENT = "file:open-definition";

// how long a .js opened for its definition has to show its editor
const DEFINITION_WAIT = 2000;

/**
 * the .js and .k files of a knitout project, in patchwork's own file editor
 * (a <patchwork-view tool-id="file">), with the knitout bits added to it.
 *
 * context:
 * - repo
 * - events: where visualizer events arrive and selection highlights go
 * - project: { files() → [{url, name, extension}], createFile(name, fields?) → url }
 * - hover(url | null): light up the panes showing a doc
 * - open(url, element, edge, toolId?): show a doc beside this one (or bring
 *   it forward); with a tool to open it with, else the file's first
 * - openIfClosed(url, element, edge): show a doc beside this one, unless it's
 *   showing somewhere already
 * - docColour(url): the colour a doc wears in every pane showing it (a css
 *   colour)
 * - bars: whether whoever's showing this draws its build bar over it (wm
 *   does, for a .js: its extensions' `bar`). if not, it's drawn here
 *
 * a .js file builds into a .k file (its builder, ./builder.js: ⌘↵ builds,
 * and your own edits autobuild). docs dropped onto its code become imports
 * (the frame asks `element.dropInto`)
 */
export default function KnitoutEditorTool(handle, element, context) {
  const { repo, events, project, hover, open, openIfClosed, docColour } = context;
  const isJs = fileExtension(handle.doc()) === "js";

  let view = null;

  // a .js's builder, shared with its bar and whatever else shows it: this
  // builds on ⌘↵ and after your own edits, marks the line a build failed on
  // in the code, and goes to it when asked
  const taken = isJs
    ? takeBuilder(jsBuild, handle.url, {
      repo,
      createFile: project.createFile,
      openIfClosed: (url, tool) => openIfClosed(url, element, "right", tool),
    }, { source: handle })
    : null;
  const run = taken?.builder ?? null;

  // the file tool's editor, once it's made
  const holdView = ViewPlugin.define((made) => {
    view = made;
    return {
      destroy() {
        if (view === made) view = null;
      },
    };
  });

  // which tool depends on the doc being opened, so look at it first (a find
  // that fails opens it with its own tool). says which tool it was
  function openDoc(url) {
    return Promise.resolve()
      .then(() => repo.find(url))
      .then((found) => toolFor(found.doc()), () => undefined)
      .then((tool) => (open(url, element, "right", tool), tool));
  }

  // the docs this pattern uses, given to the file tool's language server
  // (when it has one, see language-server.js), and again as the code changes
  let serverDocs = null;
  const giveServerDocs = () => serverDocs?.use(importsOf(handle.doc()));

  function onExtensions(event) {
    const { handle: fileHandle, extensions, languageServer, completionSources } = event.detail;
    if (fileHandle?.url !== handle.url) return;
    // with pkg-base's language server hooks, a click on an imported name is
    // its go to definition's (to the very line, in a .js), and a doc's
    // fields join the server's completions (which leaves its own of them
    // out). without them, it's all ours, and the fields are language data
    // beside the server's
    const refs = docRefs({ repo, open: openDoc, names: !languageServer });
    const hooked = Array.isArray(completionSources);
    if (hooked) completionSources.push(refs.source);
    if (isJs && languageServer && !serverDocs) {
      serverDocs = languageServerDocs(languageServer, repo, { self: handle.url });
      handle.on("change", giveServerDocs);
      giveServerDocs();
    }
    const named = String(fileHandle.doc()?.name ?? "").trim();
    extensions.push(
      holdView,
      // what a screen reader calls it, and how to get out of it: tab
      // indents in here, so escape then tab is the way on
      EditorView.contentAttributes.of({
        "aria-label": named ? `${named}, code` : "code",
        "aria-description": "escape, then tab, to leave the editor",
      }),
      // a paste or a drop can move the caret a long way: put it in the
      // middle, not just inside the edge, so you can see where you are.
      // (an import dropped in leaves the caret be: that's keepCaretInPlace's)
      EditorState.transactionExtender.of((tr) =>
        tr.docChanged && tr.selection && (tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop"))
          ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "center" }) }
          : null
      ),
      keepCaretInPlace,
      hooked ? refs.click : refs.extension,
      knitoutEditorIntegration({
        events,
        url: handle.url,
        onSelectLines: (detail) =>
          events.dispatchEvent(
            new CustomEvent("knitout:highlight-lines", { detail }),
          ),
      }),
    );
    if (run) {
      extensions.push(
        Prec.high(
          keymap.of([{ key: "Mod-Enter", run: () => (run.now({ create: true }), true) }]),
        ),
        // only your own edits autobuild: other people's arrive as
        // transactions with no user event, and their own editor builds them
        EditorView.updateListener.of((update) => {
          if (
            update.transactions.some((tr) =>
              tr.docChanged && tr.annotation(Transaction.userEvent)
            )
          ) {
            run.edited();
          }
        }),
      );
    }
  }
  element.addEventListener(EXTENSIONS_EVENT, onExtensions);

  // a definition in another doc: open it beside, and a .js at its line, once
  // its editor's there to go to it (an lsp line counts from 0)
  let gone = false;
  async function onDefinition(event) {
    const url = definitionDoc(event.detail?.uri);
    if (!url || url === handle.url) return;
    const line = event.detail.line;
    const tool = await openDoc(url);
    if (tool !== "editor" || typeof line !== "number") return;
    const until = Date.now() + DEFINITION_WAIT;
    while (!gone && Date.now() < until) {
      if (builderOf(url)?.goToLine(line + 1)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  element.addEventListener(DEFINITION_EVENT, onDefinition);

  // says whether it could (there's no editor to go to the line in until
  // the file tool's made it)
  function goToLine(lineNumber) {
    if (!view) return false;
    goToLineIn(view, lineNumber);
    return true;
  }
  const unjump = run?.lineJump(goToLine);

  // where a build failed, in the code; gone once one works
  const unheard = run?.subscribe((status) => {
    if (!view) return;
    if (status.state === "error" && status.line != null) showError(view, { line: status.line, message: status.message });
    else if (status.state === "ok") showError(view, null);
  });

  // a generated .k is read only (it's stored whole, which keeps big ones
  // fast); this makes a plain-text copy beside it to edit by hand
  async function editableCopy() {
    const doc = handle.doc();
    const stem = (doc?.name ?? "pattern.k").replace(/\.k$/, "");
    const copy = await project.createFile(`${stem}-copy.k`, {
      content: docText(doc),
      knitoutCopyOf: handle.url,
    });
    open(copy, element, "right", "editor");
  }

  // a .k that a .js wrote is stored whole, so it's read only here. so is a
  // .kc a .k was built into, which says which .k (and has no copy to make:
  // kcode isn't for editing by hand)
  function ReadOnlyNote() {
    const [doc, setDoc] = createSignal(handle.doc());
    const onChange = () => setDoc(handle.doc());
    handle.on("change", onChange);
    onCleanup(() => handle.off("change", onChange));
    const isKc = () => fileExtension(doc()) === "kc";
    const nameOf = (url) => project.files().find((file) => file.url === url)?.name;
    const writer = () => nameOf(knitoutOf(doc()).source);
    const kName = () => nameOf(knitoutOf(doc()).kcodeSource);
    return html`
      <${Show}
        when=${() => !isJs && doc() && typeof doc().content !== "string"}
      >
        <div class="knitoutjs-readonly">
          <${Show}
            when=${isKc}
            fallback=${html`<span>
                ${icon("lock")} read only: ${() =>
                  writer() ?? "a pattern"} writes this file each
                time it's built
              </span>
              <button
                class="knitoutjs-button"
                title="make a copy of this .k as text you can change by hand"
                onClick=${editableCopy}
              >
                ${icon("pencil")} make an editable copy
              </button>`}
          >
            <span>
              ${icon("lock")} read only: kcode built from ${() =>
                kName() ?? "a .k"}, each time it's built
            </span>
          <//>
        </div>
        <//>
    `;
  }

  let link;
  // the bar, where nobody draws it over this
  const barUi = {
    files: project.files,
    open: (url, tool) => open(url, element, "right", tool),
    hover,
    docColour,
  };
  const dispose = render(() => {
    return html`
      <div class="knitoutjs-editor" ref=${(el) => element.prepend((link = stylesheet(STYLESHEET, el)))}>
        <${Show} when=${() => run && !context.bars}>
          <${BuildBar} builder=${run} ui=${barUi} />
          <//>
          <${ReadOnlyNote} />
          <patchwork-view attr:doc-url=${handle
            .url} tool-id="file"></patchwork-view>
          </div>
    `;
  }, element);

  // dropping docs onto the code writes a line above the one under the pointer
  // (or, inside a function or a block, above the statement it's in, where an
  // import can go): an import of each, a .js or any other doc, so it's a
  // source of the build. the line said is the one it goes above, which the
  // frame shows
  function lineAt(x, y) {
    if (!view) return null;
    const { doc } = view.state;
    const under = doc.lineAt(view.posAtCoords({ x, y }, false)).number;
    const line = doc.line(importLineAt(doc.toString(), under));
    return {
      line: line.number,
      top: view.documentTop + view.lineBlockAt(line.from).top,
    };
  }

  async function drop(docs, x, y) {
    const under = lineAt(x, y);
    if (!under) return;
    const at = view.state.doc.line(under.line).from;
    const lines = await Promise.all(
      docs.map(async ({ url, name }) => {
        const doc = name == null ? (await repo.find(url)).doc() : null;
        return dropImport(name ?? doc?.name ?? doc?.title ?? "doc", url);
      }),
    );
    view.dispatch({
      changes: { from: at, insert: lines.join("") },
      userEvent: "input.drop",
    });
    view.focus();
  }

  if (isJs) element.dropInto = { label: "import here", lineAt, drop };

  return () => {
    gone = true;
    delete element.dropInto;
    element.removeEventListener(EXTENSIONS_EVENT, onExtensions);
    element.removeEventListener(DEFINITION_EVENT, onDefinition);
    handle.off("change", giveServerDocs);
    serverDocs?.close();
    unjump?.();
    unheard?.();
    taken?.drop();
    dispose();
    link?.remove();
  };
}
