import { EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { completionAt, docRefAt, keysOf } from "./doc-refs.js";
import { fileExtension } from "./files.js";
import { plainValue } from "./graph.js";

const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? "");

// cmd+click (ctrl+click off a mac) on an imported doc's url, or on a name an
// import of one bound, opens it (`open(url)`); and `doc("…").` or `r.` of an
// imported doc completes the doc's own fields.
//
// returns {extension, source}: the extension has both in it, and `source` is
// the completion source on its own, for a language server's hook to be given
// (when it's on, its completions stand in for these)
export function docRefs({ repo, open }) {
  // a doc's handle, found once for as long as the editor lives. a find that
  // rejects is no completions
  const found = new Map();
  const find = (url) => {
    if (!found.has(url)) found.set(url, Promise.resolve().then(() => repo.find(url)));
    return found.get(url);
  };
  // isJs needs the doc to be loaded, so it's what's learnt of each so far
  const extensions = new Map();
  const isJs = (url) => extensions.get(url) === "js";

  async function source(context) {
    const code = context.state.doc.toString();
    const pos = context.pos;
    // completions of a binding wait on its doc: a .js is a module, so none
    let hit = completionAt(code, pos, { isJs });
    if (!hit) return null;
    let handle;
    try {
      handle = await find(hit.url);
    } catch {
      return null;
    }
    const doc = handle.doc();
    if (!doc) return null;
    extensions.set(hit.url, fileExtension(doc));
    hit = completionAt(code, pos, { isJs });
    if (!hit) return null;
    const options = keysOf(plainValue(doc), hit.path).map(({ label, detail }) => ({
      label,
      detail,
      type: "property",
    }));
    return options.length ? { from: hit.from, options } : null;
  }

  const click = Prec.high(
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(isMac() ? event.metaKey : event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const url = docRefAt(view.state.doc.toString(), pos);
        if (!url) return false;
        event.preventDefault();
        open(url);
        return true;
      },
    }),
  );

  return {
    extension: [click, EditorState.languageData.of(() => [{ autocomplete: source }])],
    source,
  };
}
