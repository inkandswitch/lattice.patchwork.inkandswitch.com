// the providers threepane mounts, nested the same way. the frame's ones
// wrap the whole frame; the doc ones wrap each pane, so a pane's comments,
// focus and drafts are about the doc it shows
export const frameProviders = (accountUrl) => [
  { component: "patchwork-selected-doc-provider" },
  { component: "patchwork-account-provider", docUrl: accountUrl },
  { component: "patchwork-tool-storage-provider", docUrl: accountUrl },
  // listens at the document, so nothing waits for it. and patchwork-view
  // says nothing when a component fails to load, so waiting could hang
  { component: "patchwork-worker-provider", wait: false },
];

export const docProviders = (docUrl) => [
  { component: "patchwork-draft-state-provider", docUrl },
  { component: "patchwork-draft-overlay-provider" },
  { component: "patchwork-comments-provider" },
  { component: "patchwork-focus-provider" },
];

/**
 * <patchwork-view component=…> elements, each inside the one before.
 * put `outer` in the page and what uses them in `inner`, but only start
 * that once `ready` resolves: before a provider has mounted, nothing is
 * listening for the requests its consumers send
 */
export function nestProviders(list) {
  let outer = null;
  let inner = null;
  const mounted = [];
  for (const { component, docUrl, wait = true } of list) {
    const view = document.createElement("patchwork-view");
    // set before it's connected: a provider reads its doc-url once, at mount
    if (docUrl) view.setAttribute("doc-url", docUrl);
    view.setAttribute("component", component);
    if (wait) {
      mounted.push(
        new Promise((resolve) => {
          // it bubbles, so the inner ones' arrive here too
          view.addEventListener("patchwork:mounted", function onMounted(event) {
            if (event.detail?.componentId !== component) return;
            view.removeEventListener("patchwork:mounted", onMounted);
            resolve();
          });
        }),
      );
    }
    if (inner) inner.append(view);
    else outer = view;
    inner = view;
  }
  return { outer, inner, ready: Promise.all(mounted) };
}
