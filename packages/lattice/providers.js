// the providers threepane mounts, nested the same way. the frame's ones
// wrap the whole frame; the project ones wrap a project's files, workspace
// and inspector, with the project's folder as the draft host. so a draft is
// a draft of the whole project: its layout, its files, and every edit made
// to anything open in it
export const frameProviders = (accountUrl) => [
  { component: "patchwork-selected-doc-provider" },
  { component: "patchwork-account-provider", docUrl: accountUrl },
  { component: "patchwork-tool-storage-provider", docUrl: accountUrl },
  // listens at the document, so nothing waits for it. and patchwork-view
  // says nothing when a component fails to load, so waiting could hang
  { component: "patchwork-worker-provider", wait: false },
];

export const projectProviders = (projectUrl) => [
  { component: "patchwork-draft-state-provider", docUrl: projectUrl },
  { component: "patchwork-draft-overlay-provider" },
  { component: "patchwork-comments-provider" },
  { component: "patchwork-focus-provider" },
];

/**
 * <patchwork-view component=…> providers in `parent`, each inside the one
 * before. they go in one at a time: a provider asks the ones above it for
 * things as it mounts (the draft overlay asks the draft state which draft is
 * checked out), and before a provider has mounted nothing is listening, so
 * each waits for the one above it. `ready` resolves to the innermost, for
 * what uses them to go in (or null, if they were removed first)
 */
export function nestProviders(parent, list) {
  let removed = false;
  let outer = null;
  const ready = (async () => {
    let inner = parent;
    for (const { component, docUrl, wait = true } of list) {
      if (removed) return null;
      const view = document.createElement("patchwork-view");
      // a provider reads its doc-url once, at mount
      if (docUrl) view.setAttribute("doc-url", docUrl);
      view.setAttribute("component", component);
      const mounted =
        wait &&
        new Promise((resolve) => {
          // it bubbles, so the inner ones' arrive here too
          view.addEventListener("patchwork:mounted", function onMounted(event) {
            if (event.detail?.componentId !== component) return;
            view.removeEventListener("patchwork:mounted", onMounted);
            resolve();
          });
        });
      // in the same task as its attributes: a patchwork-view mounts a
      // moment after they change, connected or not, and one that mounts
      // while it's not in the page asks nobody
      inner.append(view);
      outer ??= view;
      inner = view;
      await mounted;
    }
    return removed ? null : inner;
  })();
  return {
    ready,
    remove() {
      removed = true;
      outer?.remove();
    },
  };
}
