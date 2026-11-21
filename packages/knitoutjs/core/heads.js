import { createStore } from "solid-js/store";
import { headsOf } from "./sources.js";

// the heads each doc has now, as a pin would say them (`a|b`, what
// core/sources.js's headsOf reads off `automerge:<id>#a|b`), keyed by the
// doc's unpinned url. a store, so whatever reads one is told when it moves
const [heads, setHeads] = createStore({});
// every url asked about, found or not. one that couldn't be found isn't
// asked for again this page-session (status() reads this all the time)
const asked = new Set();

async function watch(url, repo) {
  let handle;
  try {
    handle = await repo.find(url);
    // made the way a pin is made, so the two compare exactly
    const update = () => setHeads(url, headsOf(handle.view(handle.heads()).url));
    update();
    handle.on("change", update);
  } catch (error) {
    console.warn(`couldn't watch the heads of ${url}`, error);
  }
}

// a doc's heads now, or undefined until they're found. the first ask finds it
export function headsNow(url, repo) {
  if (!asked.has(url)) {
    asked.add(url);
    watch(url, repo);
  }
  return heads[url];
}
