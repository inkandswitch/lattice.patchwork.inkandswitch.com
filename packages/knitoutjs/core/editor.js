import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { goToLine as goToLineIn, keepCaretInPlace, knitoutEditorIntegration, showError } from "./cm-knitout.js";
import { docText, fileExtension, knitoutOf } from "./files.js";
import { docRefs } from "./doc-refs-cm.js";
import { definitionDoc, dropImport, importLineAt, toolFor } from "./doc-refs.js";
import { languageServerDocs } from "./language-server.js";
import { runInto } from "./run.js";
import { importsOf, pinsOf, sourcesMoved, watchedSources } from "./knitout-links.js";
import { headsOf } from "./sources.js";
import { builderOf, setBuild } from "./builds.js";
import { icon } from "./icons.js";
import { stylesheet } from "./stylesheet.js";

const STYLESHEET = new URL("./editor.css", import.meta.url).href;

const AUTO_RUN_DELAY = 600;

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
 *
 * a .js file gets a build bar: it writes its knitout into a .k file. docs
 * dropped onto its code become imports (the frame asks `element.dropInto`)
 */
export default function KnitoutEditorTool(handle, element, context) {
  const { repo, events, project, hover, open, openIfClosed, docColour } = context;
  const isJs = fileExtension(handle.doc()) === "js";

  let view = null;
  let run;

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

  // build the pattern into its target .k: by hand, or after every pause in
  // your typing when autobuild is on (the default). turning it off is
  // remembered in this browser, for each .js (not in the doc, so it's each
  // person's choice). how it's going is shared with the frame (builds.js), for
  // the panes showing the .k
  function createRunner() {
    const [target, setTarget] = createSignal(knitoutOf(handle.doc()).target);
    const autorunKey = `knitoutjs:autorun:${handle.url}`;
    const [auto, setAutoSignal] = createSignal(readAutorun());

    function readAutorun() {
      try {
        return localStorage.getItem(autorunKey) !== "off";
      } catch {
        return true;
      }
    }

    function setAuto(on) {
      setAutoSignal(on);
      setBuild(handle.url, { auto: on });
      try {
        if (on) localStorage.removeItem(autorunKey);
        else localStorage.setItem(autorunKey, "off");
      } catch {}
    }
    const [status, setStatusSignal] = createSignal({ state: "idle" });
    const setStatus = (next) => {
      setStatusSignal(next);
      setBuild(handle.url, { line: undefined, message: undefined, ...next });
    };
    const running = () => status().state === "running";
    let timer;
    let current;

    // every doc that can make the target .k stale (the .js's imports, and
    // what the .k was last built from) is watched, so a change to one
    // rebuilds, if autobuild is on. never the .js or the .k themselves: a
    // build writes the .k. wm says a .k is "building…" on the promise of this
    const watching = new Map(); // unpinned url → { handle? }
    const warned = new Set();
    let kWatch = null; // { url, handle? }: the target .k, for its sources
    let closed = false;

    function warnOnce(url, error) {
      if (warned.has(url)) return;
      warned.add(url);
      console.warn(`knitoutjs: can't watch ${url}`, error);
    }

    // the heads a watched doc has now, as a pin says them, once it's found
    function headsNow(url) {
      const found = watching.get(url)?.handle;
      return found ? headsOf(found.view(found.heads()).url) : undefined;
    }

    // the docs the code reads at fixed heads (`#heads` written in it), which
    // never move: the .js's own, and those of the modules it uses, as found
    function pinnedNow() {
      return [handle.doc(), ...[...watching.values()].map((entry) => entry.handle?.doc())].flatMap(pinsOf);
    }

    // a doc the .k was built from may have moved before this was open (or
    // while it was being found), with no change to come to say so: if one
    // has, that's an edit too (so with autobuild off, still nothing). only
    // once for each set of sources the .k has: a build that comes out the
    // same (or fails) isn't tried again and again
    let builtFor = null;
    function buildIfMoved() {
      const kDoc = kWatch?.handle?.doc();
      if (!kDoc || !auto() || !sourcesMoved(kDoc, headsNow, { pinned: pinnedNow() })) return;
      const sources = knitoutOf(kDoc).sources.join(" ");
      if (sources === builtFor) return;
      builtFor = sources;
      edited();
    }

    function recompute() {
      if (closed) return;
      const want = watchedSources(handle.doc(), kWatch?.handle?.doc(), {
        self: handle.url,
        target: target(),
        pinned: pinnedNow(),
      });
      for (const [url, entry] of watching) {
        if (want.includes(url)) continue;
        entry.handle?.off("change", edited);
        watching.delete(url);
      }
      for (const url of want) {
        if (watching.has(url)) continue;
        const entry = {};
        watching.set(url, entry);
        repo.find(url).then((found) => {
          // it may have left the set (or this closed) while it was found
          if (closed || watching.get(url) !== entry) return;
          entry.handle = found;
          found.on("change", edited);
          // a module found says what it pins, which may need no watching
          recompute();
        }, (error) => warnOnce(url, error));
      }
      buildIfMoved();
    }

    // the target .k's own doc says what it was built from; a build writes it
    function watchTarget() {
      const url = target();
      if (kWatch?.url === url) return recompute();
      kWatch?.handle?.off("change", recompute);
      const entry = (kWatch = url ? { url } : null);
      recompute();
      if (!entry) return;
      repo.find(url).then((found) => {
        if (closed || kWatch !== entry) return;
        entry.handle = found;
        found.on("change", recompute);
        recompute();
      }, (error) => warnOnce(url, error));
    }

    const onChange = () => {
      setTarget(knitoutOf(handle.doc()).target);
      watchTarget();
      // an error is about the code as it was; once that changes, it's gone
      if (status().state === "error" && status().line != null) {
        setStatus({ state: "idle" });
      }
    };

    function edited() {
      if (!auto()) return;
      clearTimeout(timer);
      timer = setTimeout(() => now(), AUTO_RUN_DELAY);
    }
    handle.on("change", onChange);
    watchTarget();
    const builder = { now: () => now({ create: true }), goToLine: (line) => goToLine(line) };
    setBuild(handle.url, { state: "idle", auto: auto(), builder });
    onCleanup(() => {
      clearTimeout(timer);
      current?.abort();
      handle.off("change", onChange);
      closed = true;
      kWatch?.handle?.off("change", recompute);
      for (const entry of watching.values()) entry.handle?.off("change", edited);
      watching.clear();
      // another editor showing this .js may have taken over since
      if (builderOf(handle.url) === builder) {
        setBuild(handle.url, { state: "idle", line: undefined, message: undefined, builder: undefined });
      }
    });

    // a new run takes over from one still going. a generated .k is read
    // only; a .k with editable text in it (someone's copy, or one typed by
    // hand) isn't written over without asking
    // `create`: an explicit build (the button, ⌘↵, wm's rebuild) makes a .k
    // if there's none yet; autobuild never does
    async function now({ overwrite = false, create = false } = {}) {
      let url = target();
      if (!url && create) url = await newTarget();
      if (!url) {
        setStatus({ state: "error", message: "pick a .k file to write to" });
        return;
      }
      const kHandle = await repo.find(url);
      const content = kHandle.doc()?.content;
      if (typeof content === "string" && content.trim() && !overwrite) {
        setStatus({
          state: "ask",
          message: `${kHandle.doc()?.name ?? "the .k"} has editable text in it`,
        });
        return;
      }
      // a .k with nothing in it yet is new: once there's knitout in it, it
      // opens beside this, if it isn't open already
      const fresh = !docText(kHandle.doc()).trim();
      current?.abort();
      const run = (current = new AbortController());
      setStatus({ state: "running" });
      const result = await runInto(handle, kHandle, repo, {
        signal: run.signal,
      });
      if (current !== run) return;
      current = null;
      if (result.error?.stopped) {
        setStatus({ state: "idle", message: "stopped" });
      } else if (result.error) {
        const error = {
          line: result.error.line ?? null,
          message: String(result.error.message ?? result.error),
        };
        setStatus({ state: "error", ...error });
        if (view && error.line != null) showError(view, error);
      } else {
        if (view) showError(view, null);
        if (fresh) openIfClosed(url, element, "right");
        const lines = result.knitout.split("\n").length;
        setStatus({
          state: "ok",
          message: `built in ${
            Math.round(result.ms)
          }ms · ${lines.toLocaleString()} lines`,
        });
      }
    }

    function pickTarget(url) {
      handle.change((doc) => {
        doc.knitoutTarget = url;
      });
    }

    // one .k per ask: a second ask while the first is being made shares it
    let making = null;
    function newTarget() {
      return (making ??= makeTarget().finally(() => (making = null)));
    }

    async function makeTarget() {
      const base = (handle.doc()?.name ?? "pattern").replace(
        /\.knitout\.js$|\.js$/,
        "",
      );
      const url = await project.createFile(base + ".k");
      pickTarget(url);
      return url;
    }

    function stop() {
      current?.abort();
    }

    // says whether it could (there's no editor to go to the line in until
    // the file tool's made it)
    function goToLine(lineNumber) {
      if (!view) return false;
      goToLineIn(view, lineNumber);
      return true;
    }

    function keep() {
      setStatus({ state: "idle", message: "kept it as it is" });
    }

    return {
      target,
      auto,
      setAuto,
      status,
      running,
      now,
      edited,
      stop,
      keep,
      goToLine,
      pickTarget,
      newTarget,
    };
  }

  function BuildBar() {
    const kFiles = createMemo(() =>
      project.files().filter((file) => file.extension === "k")
    );
    const targetColour = () => docColour(run.target());

    function onPick(event) {
      const value = event.currentTarget.value;
      if (value === "+new") {
        event.currentTarget.value = run.target() ?? "";
        run.newTarget();
      } else if (value) {
        run.pickTarget(value);
      }
    }

    return html`<div class="knitoutjs-runbar">
      <button
        class="knitoutjs-button knitoutjs-run"
        data-running=${() => (run.running() ? "" : undefined)}
        title=${() =>
      run.running()
        ? "stop this build"
        : "build the pattern: it writes its knitout into the .k file chosen on the right (⌘↵)"}
        onClick=${() => (run.running() ? run.stop() : run.now({ create: true }))}
      >
        ${() => (run.running() ? "stop" : "build")}
      </button>
      <label
        class="knitoutjs-auto"
        title="build again by itself whenever you stop typing for a moment. this browser remembers it for this file"
      >
        <input
          type="checkbox"
          checked=${run.auto}
          onChange=${(event) => run.setAuto(event.currentTarget.checked)}
        />
        autobuild
      </label>
      <span class="knitoutjs-status" data-state=${() => run.status().state}>
        <${Show} when=${() => run.status().line != null}>
          <button
            class="knitoutjs-error-line"
            title="go to this line"
            onClick=${() => run.goToLine(run.status().line)}
          >
            ${icon("warning")} line ${() => run.status().line}:
          </button>
        <//>
        ${() =>
      run.status().state === "running"
        ? "building…"
        : (run.status().message ?? "")}
      </span>
      <${Show} when=${() => run.status().state === "ask"}>
        <span class="knitoutjs-ask">
          <button
            class="knitoutjs-button"
            onClick=${() => run.now({ overwrite: true })}
          >
            overwrite it
          </button>
          <button class="knitoutjs-button" onClick=${() => run.keep()}>
            keep it
          </button>
        </span>
      <//>
      <label
        class="knitoutjs-target"
        title="the .k file this pattern writes its knitout (the machine's instructions) into"
        style=${() => ({ "--knitoutjs-target-colour": targetColour() })}
        onPointerEnter=${() => hover(run.target())}
        onPointerLeave=${() => hover(null)}
      >
        <span class="knitoutjs-target-label">writes to ${icon("arrow-right")}</span>
        <span class="knitoutjs-swatch"></span>
        <select onChange=${onPick}>
          <option value="" disabled selected=${() => !run.target()}>
            choose a .k file
          </option>
          <${For} each=${kFiles}>
            ${(file) =>
      html`
        <option
          value=${file.url}
          selected=${() => file.url === run.target()}
        >
                        ${file.name}
                      </option>
      `}
          <//>
          <option value="+new">new .k file…</option>
        </select>
      </label>
      <button
        class="knitoutjs-open"
        title="show that .k file's text beside this one"
        disabled=${() => !run.target()}
        onClick=${() => open(run.target(), element, "right", "editor")}
      >
        ${icon("beside")} open
      </button>
    </div>`;
  }

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
  const dispose = render(() => {
    run = isJs ? createRunner() : null;
    return html`
      <div class="knitoutjs-editor" ref=${(el) => element.prepend((link = stylesheet(STYLESHEET, el)))}>
        <${Show} when=${isJs}>
          <${BuildBar} />
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
    dispose();
    link?.remove();
  };
}
