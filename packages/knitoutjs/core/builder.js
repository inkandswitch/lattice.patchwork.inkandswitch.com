// the builders on this page: one for each source (a .js, a .k, a
// patternstoat), shared by whoever shows or edits it (wm's bar for it, the
// code editor), with solid's signals. whoever takes one drops it when
// they're gone, and the last to drop it ends it: its watching stops, a build
// still going is stopped, and the frame's told (builds.js). what a builder
// is and does is ./builder-logic.js; drawing one is ./build-bar.js
import { createRoot, createSignal } from "solid-js";
import { createBuilder } from "./builder-logic.js";
import { setBuild } from "./builds.js";

const held = new Map(); // source url → { kind, builder, holders: [{ env }], end }

function end(entry, { keep = false } = {}) {
  if (entry.ended) return;
  entry.ended = true;
  if (held.get(entry.builder.url) === entry) held.delete(entry.builder.url);
  entry.builder.dispose({ keep });
  entry.end();
}

/**
 * the builder for `url`, of `kind` (./builder-logic.js), made if there isn't
 * one yet. env is what to build with while you hold it ({repo, createFile?,
 * openIfClosed?(url, tool)}: the last to take it is listened to); `source`,
 * the source's handle if you have it (else it's found). gives
 * {builder, drop({keep}?)}: keep, if this is the last drop, leaves the
 * frame saying what the builder said last
 */
export function takeBuilder(kind, url, env, { source } = {}) {
  let entry = held.get(url);
  // a doc that's become another kind of source (a .js renamed to a .k)
  // starts over
  if (entry && entry.kind !== kind) {
    end(entry);
    entry = null;
  }
  if (!entry) {
    entry = { kind, holders: [], ending: null };
    const made = entry;
    made.builder = createRoot((end) => {
      made.end = end;
      return createBuilder(kind, url, {
        source: source ?? env.repo.find(url),
        env: () => made.holders.at(-1)?.env ?? env,
        signal: createSignal,
        report: (said) => setBuild(url, said),
      });
    });
    held.set(url, entry);
  }
  const holder = { env };
  entry.holders.push(holder);
  entry.ending = null;
  let dropped = false;
  const taken = entry;
  return {
    builder: taken.builder,
    drop({ keep = false } = {}) {
      if (dropped) return;
      dropped = true;
      taken.holders.splice(taken.holders.indexOf(holder), 1);
      if (taken.holders.length) return;
      // a pane that moves drops its bar and takes it again straight away:
      // it's only over if nobody's taken it again by the end of this tick
      const ending = (taken.ending = { keep });
      queueMicrotask(() => {
        if (taken.ending !== ending || taken.holders.length) return;
        end(taken, { keep: ending.keep });
      });
    },
  };
}

// build a source into its target once, with no bar or editor holding a
// builder for it (wm's rebuild, from a target's pane), saying how it went
// in the frame as a builder would
export async function buildOnce(kind, sourceUrl, targetUrl, repo) {
  setBuild(sourceUrl, { state: "running", line: undefined, message: undefined });
  try {
    const [source, target] = await Promise.all([repo.find(sourceUrl), repo.find(targetUrl)]);
    const { error, message } = (await kind.build(source, target, { repo })) ?? {};
    setBuild(
      sourceUrl,
      error
        ? { state: "error", line: error.line ?? undefined, message: String(error.message ?? error) }
        : { state: "ok", message },
    );
  } catch (error) {
    setBuild(sourceUrl, { state: "error", line: undefined, message: String(error?.message ?? error) });
  }
}
