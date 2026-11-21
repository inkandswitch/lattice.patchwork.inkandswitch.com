import { createStore } from "solid-js/store";
import { headsOf } from "./sources.js";

// the heads each doc has now, as a pin would say them (`a|b`, what
// core/sources.js's headsOf reads off `automerge:<id>#a|b`), keyed by the
// doc's unpinned url. a store, so whatever reads one is told when it moves
const [heads, setHeads] = createStore({});
const watching = new Set();

function watch(url, repo) {
  watching.add(url);
  repo
    .find(url)
    .then((handle) => {
      // made the way a pin is made, so the two compare exactly
      const update = () => setHeads(url, headsOf(handle.view(handle.heads()).url));
      update();
      handle.on("change", update);
    })
    .catch(() => watching.delete(url));
}

// a doc's heads now, or undefined until they're found. the first ask finds it
export function headsNow(url, repo) {
  if (!watching.has(url)) watch(url, repo);
  return heads[url];
}
