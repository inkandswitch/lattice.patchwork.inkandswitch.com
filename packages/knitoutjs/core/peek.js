import { EditorView, hoverTooltip, ViewPlugin } from "@codemirror/view";
import { docText, knitoutOf, textHash } from "./files.js";
import { buildGraph, buildRounds } from "./graph.js";
import { opPlace, probeTarget } from "./probe.js";
import { compile } from "./run.js";
import { unpinned } from "./sources.js";

// what a name in a pattern was as the stitch the animation's at was knitted:
// pointing at `r` in the .js says `r = 1 · as op 11,495 is knitted`, beside
// whatever else says what `r` is (the language server's type). the animation
// says which op it's at (a `knitout:at-stitch` event, for the .js that wrote
// its .k: {url: the .k, source: the .js, op, kLine}, op null for none); the
// pattern's run again with the name watched (probe.js), against the docs the
// .k was built from, and stopped as that op's written

const STITCH_EVENT = "knitout:at-stitch";

// the latest few looked at, as they're often looked at again
const KEPT = 48;
const looked = new Map();

async function look({ repo, handle, code, pos, at, signal }) {
  const k = await repo.find(at.url);
  const kDoc = k.doc();
  const kText = docText(kDoc);
  const built = knitoutOf(kDoc);
  const place = opPlace(kText, at.kLine);
  const graph = await buildGraph(code, repo, { self: handle, pinned: built.sources });
  const { result } = await buildRounds(
    (graph) => compile(code, { repo, signal, name: handle.doc()?.name, graph, probe: { at: pos, op: place } }),
    graph,
    repo,
  );
  const line = kText.split("\n")[at.kLine - 1] ?? "";
  return {
    ...result,
    // the run went another way to the build's: the .js has moved on, or
    // the pattern's random
    otherwise: result.probe?.reached && !line.startsWith(result.probe.op),
    changed: built.sourceHash != null && built.sourceHash !== textHash(code),
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function show(dom, text, at, seen) {
  const where = `op ${(at.op + 1).toLocaleString()}`;
  const head = element("div", "cm-knitout-peek-value");
  head.append(element("code", "cm-knitout-peek-name", text));
  const note = element("div", "cm-knitout-peek-note");
  const { probe, error } = seen;
  if (probe?.reached && probe.value != null) {
    head.append(" = ", element("code", "cm-knitout-peek-is", probe.value));
    note.textContent = `as ${where} is knitted`;
  } else if (probe?.reached && probe.unseen) {
    note.textContent = `not reached yet, by ${where}`;
  } else if (probe?.reached && probe.unset) {
    note.textContent = /before initiali[sz]ation/.test(probe.unset) ? `not set yet, at ${where}` : probe.unset;
  } else if (error && !error.stopped) {
    note.textContent = `couldn't run it to ${where}: ${error.message}`;
  } else if (probe && !probe.reached) {
    note.textContent = `the run stopped after ${probe.ops.toLocaleString()} ops, before ${where}`;
  } else {
    dom.hidden = true;
    return;
  }
  if (seen.otherwise || (probe && !probe.reached)) {
    note.textContent += seen.changed
      ? " (the .js has changed since the .k was built: build it again to match)"
      : " (this run went another way to the build's: is it random?)";
  }
  dom.replaceChildren(head, note);
}

const theme = EditorView.baseTheme({
  ".cm-knitout-peek": {
    padding: "3px 7px",
    borderTop: "1px solid color-mix(in srgb, currentColor 15%, transparent)",
    fontSize: "0.9em",
  },
  ".cm-knitout-peek:first-child": { borderTop: "none" },
  ".cm-knitout-peek-is": { fontWeight: "bold" },
  ".cm-knitout-peek-note": { opacity: 0.7, fontSize: "0.9em" },
  ".cm-knitout-peek[data-looking] .cm-knitout-peek-note": { fontStyle: "italic" },
});

/**
 * the codemirror extension, for a .js (`handle`): `events` is where the
 * animation's knitout:at-stitch events arrive
 */
export function stitchValues({ repo, events, handle }) {
  let at = null;
  let looking = null; // the run under way, to stop when another's wanted
  const self = unpinned(handle.url);

  const listen = ViewPlugin.define(() => {
    function onStitch(event) {
      const detail = event.detail;
      if (!detail?.source || unpinned(detail.source) !== self) return;
      at = detail.op == null || detail.kLine == null ? null : detail;
    }
    events.addEventListener(STITCH_EVENT, onStitch);
    return { destroy: () => events.removeEventListener(STITCH_EVENT, onStitch) };
  });

  function seen(code, pos, target) {
    const here = at;
    const key = [textHash(code), here.url, here.kLine, target.from, target.to].join("|");
    let found = looked.get(key);
    if (found) {
      looked.delete(key);
      looked.set(key, found);
      return { here, found };
    }
    looking?.abort();
    const stop = (looking = new AbortController());
    found = look({ repo, handle, code, pos, at: here, signal: stop.signal })
      .catch((error) => ({ error: { message: String(error?.message ?? error) } }))
      .then((result) => {
        if (looking === stop) looking = null;
        // (one stopped for another isn't what it is)
        if (result.error?.stopped) looked.delete(key);
        return result;
      });
    looked.set(key, found);
    while (looked.size > KEPT) looked.delete(looked.keys().next().value);
    return { here, found };
  }

  const tooltip = hoverTooltip((view, pos) => {
    if (!at) return null;
    const code = view.state.doc.toString();
    const target = probeTarget(code, pos);
    if (!target) return null;
    return {
      pos: target.from,
      end: target.to,
      above: true,
      create() {
        const dom = element("div", "cm-knitout-peek");
        const { here, found } = seen(code, pos, target);
        dom.toggleAttribute("data-looking", true);
        dom.append(element("div", "cm-knitout-peek-note", `running it to op ${(here.op + 1).toLocaleString()}…`));
        found.then((result) => {
          dom.toggleAttribute("data-looking", false);
          show(dom, target.text, here, result);
        });
        return { dom };
      },
    };
  });

  return [listen, tooltip, theme];
}
