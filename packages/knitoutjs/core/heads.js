import { createStore } from "solid-js/store";
import { findOnce } from "./knitout-links.js";
import { headsOf } from "./sources.js";

// the heads each doc has now, as a pin would say them (`a|b`, what
// core/sources.js's headsOf reads off `automerge:<id>#a|b`), keyed by the
// doc's unpinned url. a store, so whatever reads one is told when it moves
const [heads, setHeads] = createStore({});
// every url asked about is found once. one that couldn't be found is tried
// again on an ask 30s after (status() reads this all the time, so not on
// every one), and said so once
const finds = findOnce({ retryAfter: 30_000 });
const warned = new Set();

async function watch(url, repo) {
  try {
    const handle = await repo.find(url);
    // made the way a pin is made, so the two compare exactly
    const update = () => setHeads(url, headsOf(handle.view(handle.heads()).url));
    update();
    handle.on("change", update);
  } catch (error) {
    finds.failed(url);
    if (warned.has(url)) return;
    warned.add(url);
    console.warn(`couldn't watch the heads of ${url}`, error);
  }
}

// a doc's heads now, or undefined until they're found. the first ask finds it
export function headsNow(url, repo) {
  if (finds.ask(url)) watch(url, repo);
  return heads[url];
}
