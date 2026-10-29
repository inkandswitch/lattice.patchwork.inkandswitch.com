import { createMemo, createSignal, For, onCleanup } from "solid-js";
import html from "solid-js/html";
import { parseAutomergeUrl } from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers";

// the doc a comment's target is in: a ref can be the doc itself, or a range
// or a spot in it (the doc's url with more on the end)
function docOf(url) {
  try {
    return parseAutomergeUrl(url).documentId;
  } catch {
    return null;
  }
}

// one thread, shown by comments-view's own comment-thread tool, named as
// comments-view names it (older threads aren't stamped with their type). made
// with its attributes set, and put in the page in the same task, so it mounts
// under the project's providers
function Thread(props) {
  const view = document.createElement("patchwork-view");
  view.className = "lattice-comment-thread";
  view.setAttribute("doc-url", props.url);
  view.setAttribute("tool-id", "comment-thread");
  return view;
}

/**
 * the comments on every doc showing in the workspace, grouped by doc. it asks
 * the project's comments provider for all of them (it watches every doc
 * mounted beneath it) and keeps the ones on docs in `showing`, a list of
 * { url, name } from the workspace (a signal: solid's html hands it over as
 * a getter, so it's read off props). `open(url)` brings a doc's pane forward
 */
export function CommentsInspector(props) {
  const { element, open } = props;
  const [entries, setEntries] = createSignal([]);
  onCleanup(
    subscribe(element, { type: "patchwork:comments" }, (value) =>
      setEntries(Array.isArray(value) ? value : []),
    ),
  );

  const groups = createMemo(() => {
    const threads = new Map();
    for (const { targetUrl, threadUrl } of entries()) {
      const doc = docOf(targetUrl);
      if (!doc) continue;
      if (!threads.has(doc)) threads.set(doc, new Set());
      threads.get(doc).add(threadUrl);
    }
    return (props.showing ?? [])
      .map((shown) => ({ ...shown, threads: [...(threads.get(docOf(shown.url)) ?? [])] }))
      .filter((group) => group.threads.length);
  });

  return html`<div class="lattice-comments">
    <${For}
      each=${groups}
      fallback=${html`<p class="lattice-inspector-empty">no comments on anything showing</p>`}
    >
      ${(group) => html`<section class="lattice-comments-doc">
        <button
          class="lattice-comments-doc-name"
          title="bring it forward in the workspace"
          onClick=${() => open?.(group.url)}
        >
          ${group.name}
          <span class="lattice-comments-count">${group.threads.length}</span>
        </button>
        <${For} each=${() => group.threads}>${(url) => html`<${Thread} url=${url} />`}<//>
      </section>`}
    <//>
  </div>`;
}
