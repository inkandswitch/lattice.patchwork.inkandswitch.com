import { EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { completionAt, docRefAt, findWithin, keysOf } from "./doc-refs.js";
import { fileExtension } from "./files.js";
import { plainValue } from "./graph.js";

// how long a completion waits on a doc being found
const FIND_WAIT = 2000;

const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? "");

// cmd+click (ctrl+click off a mac) on an imported doc's url, or on a name an
// import of one bound, opens it (`open(url)`); and lattice's `doc("…").` or `r.` of an
// imported doc completes the doc's own fields.
//
// `names: false` leaves a click on a name to a language server's go to
// definition, which knows the line it's on in a .js
//
// returns {extension, click, source}: the extension has both in it, `click`
// is the cmd+click on its own, and `source` the completion source on its own,
// for a language server's hook to be given (it sits beside the server's own
// completions there, so it mustn't be language data as well: that would offer
// each field twice)
export function docRefs({ repo, open, names = true }) {
  // a doc's handle, found once for as long as the editor lives. a find that
  // rejects, or takes longer than FIND_WAIT, is no completions this time
  const find = findWithin((url) => repo.find(url), FIND_WAIT);
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
        const url = docRefAt(view.state.doc.toString(), pos, { names });
        if (!url) return false;
        event.preventDefault();
        open(url);
        return true;
      },
    }),
  );

  return {
    extension: [click, EditorState.languageData.of(() => [{ autocomplete: source }])],
    click,
    source,
  };
}
