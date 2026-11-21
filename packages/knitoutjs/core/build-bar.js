// a builder's bar (./builder.js): build (or stop), autobuild, how it's
// going, and the target it writes to, picked from the project's files of
// its kind or made new, in its colour, with a way to open it. every builder
// has the same one: a .js's, a .k's and a patternstoat's. wm draws it over
// whatever tool is showing the source (its extensions' `bar`: wmBuildBar,
// below); a tool somewhere without that draws it itself (mountBuildBar)
import { createMemo, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { takeBuilder } from "./builder.js";
import { icon } from "./icons.js";
import { stylesheet } from "./stylesheet.js";

const STYLESHEET = new URL("./build-bar.css", import.meta.url).href;

// how long the code editor has to show up, once it's asked for, to go to
// an error's line in
const LINE_WAIT = 2000;

/**
 * props:
 * - builder: the builder it draws (./builder-logic.js)
 * - ui: {files() → [{url, name, extension}], open(url, tool): show a doc
 *   beside (or bring it forward), hover(url | null): light up the panes
 *   showing a doc, docColour(url): the colour it wears, as a css colour}
 */
export function BuildBar(props) {
  const { builder, ui } = props;
  const kind = builder.kind;
  const ext = kind.targetExtension;
  const titles = kind.titles ?? {};
  const targets = createMemo(() => ui.files().filter((file) => file.extension === ext));
  const targetColour = () => ui.docColour(builder.target());
  const status = builder.status;
  let gone = false;
  onCleanup(() => (gone = true));

  function onPick(event) {
    const value = event.currentTarget.value;
    if (value === "+new") {
      event.currentTarget.value = builder.target() ?? "";
      builder.newTarget();
    } else if (value) {
      builder.pickTarget(value);
    }
  }

  // the line it failed on, in the code editor: this one's, or one opened
  // for it, once it's there
  async function goToLine(line) {
    if (builder.goToLine(line)) return;
    ui.open(builder.url, "editor");
    const until = Date.now() + LINE_WAIT;
    while (!gone && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (builder.goToLine(line)) return;
    }
  }

  return html`<div class="knitoutjs-runbar" ref=${(el) => el.prepend(stylesheet(STYLESHEET, el))}>
    <button
      class="knitoutjs-button knitoutjs-run"
      data-running=${() => (builder.running() ? "" : undefined)}
      title=${() =>
        builder.running()
          ? "stop this build"
          : (titles.build ?? `build it: it writes into the .${ext} file chosen on the right`)}
      onClick=${() => (builder.running() ? builder.stop() : builder.now({ create: true }))}
    >
      ${() => (builder.running() ? "stop" : "build")}
    </button>
    <label
      class="knitoutjs-auto"
      title=${titles.auto ?? "build again by itself whenever this changes. this browser remembers it for this file"}
    >
      <input
        type="checkbox"
        checked=${builder.auto}
        onChange=${(event) => builder.setAuto(event.currentTarget.checked)}
      />
      autobuild
    </label>
    <span class="knitoutjs-status" data-state=${() => status().state}>
      <${Show} when=${() => kind.lines && status().line != null}>
        <button
          class="knitoutjs-error-line"
          title="go to this line"
          onClick=${() => goToLine(status().line)}
        >
          ${icon("warning")} line ${() => status().line}:
        </button>
      <//>
      ${() => (status().state === "running" ? "building…" : (status().message ?? ""))}
    </span>
    <${Show} when=${() => status().state === "ask"}>
      <span class="knitoutjs-ask">
        <button class="knitoutjs-button" onClick=${() => builder.now({ overwrite: true })}>
          overwrite it
        </button>
        <button class="knitoutjs-button" onClick=${() => builder.keep()}>
          keep it
        </button>
      </span>
    <//>
    <label
      class="knitoutjs-target"
      title=${titles.target ?? `the .${ext} file this writes into`}
      style=${() => ({ "--knitoutjs-target-colour": targetColour() })}
      onPointerEnter=${() => ui.hover(builder.target())}
      onPointerLeave=${() => ui.hover(null)}
    >
      <span class="knitoutjs-target-label">writes to ${icon("arrow-right")}</span>
      <span class="knitoutjs-swatch"></span>
      <select onChange=${onPick}>
        <option value="" disabled selected=${() => !builder.target()}>
          choose a .${ext} file
        </option>
        <${For} each=${targets}>
          ${(file) => html`<option value=${file.url} selected=${() => file.url === builder.target()}>
            ${file.name}
          </option>`}
        <//>
        <option value="+new">new .${ext} file…</option>
      </select>
    </label>
    <button
      class="knitoutjs-open"
      title=${titles.open ?? `show that .${ext} file's text beside this one`}
      disabled=${() => !builder.target()}
      onClick=${() => ui.open(builder.target(), "editor")}
    >
      ${icon("beside")} open
    </button>
  </div>`;
}

// the bar for a source, drawn into an element of a tool's own, while
// `when()` says (it's read in an effect: whether nothing else draws one
// over the tool, as wm's context.bars(url) says): gives a way to take it away
export function mountBuildBar(element, builder, ui, { when = () => true } = {}) {
  return render(() => html`<${Show} when=${when}><${BuildBar} builder=${builder} ui=${ui} /><//>`, element);
}

// for a wm extension's bar(url, api) (see packages/wm/workspace.js): the bar
// for a source, holding its builder while it's shown. the same component
// each time it's asked for (a new one is drawn afresh), one for each
// workspace, kind and source
const bars = new WeakMap(); // api → Map(kind → Map(url → component))

export function wmBuildBar(kind, url, api) {
  let byKind = bars.get(api);
  if (!byKind) bars.set(api, (byKind = new Map()));
  let byUrl = byKind.get(kind);
  if (!byUrl) byKind.set(kind, (byUrl = new Map()));
  let bar = byUrl.get(url);
  if (bar) return bar;
  bar = (props) => {
    const open = (target, tool) => api.reveal(target, props.from, "right", tool);
    const { builder, drop } = takeBuilder(kind, url, {
      repo: api.repo,
      createFile: api.createFile,
      openIfClosed: (target, tool) => api.showing(target) || open(target, tool),
    });
    onCleanup(() => drop());
    return BuildBar({ builder, ui: { files: api.files, open, hover: api.hover, docColour: api.docColour } });
  };
  byUrl.set(url, bar);
  return bar;
}
