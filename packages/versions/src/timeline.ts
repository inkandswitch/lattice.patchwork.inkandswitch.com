import {
  decodeHeads,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";

import type { DraftMemberDoc } from "./draft-types.js";
import { editCountsSince, getDocCreationTime } from "./change-group-cache.js";
import { newestFirst, type TimelineChange } from "./grouping.js";

// Gathers one timeline's flat change list — every post-fork change of every
// member doc, with edit counts — and keeps it current as the members change.
// The list is what `groupChanges` folds under the reader's chosen grouping.
//
// Member histories are read incrementally: each member remembers the heads
// it was read through, and the next pass decodes only the tail since then
// (late-syncing changes with old timestamps included, since "since" is causal,
// not chronological). Decoding runs in idle slices, like the ChangeGrouper.

export type Timeline = {
  // Newest first.
  changes: TimelineChange[];
  // True while a gather pass is still decoding; the rows already published
  // stay valid meanwhile.
  building: boolean;
};

export type TimelineSource = {
  dispose: () => void;
};

// How long a gather may hold the main thread before yielding.
const SLICE_BUDGET_MS = 8;

// Coalesce bursts of member change events into one gather.
const GATHER_DEBOUNCE_MS = 250;

export function createTimelineSource(
  repo: Repo,
  members: DraftMemberDoc[],
  mainDocUrl: AutomergeUrl | undefined,
  onUpdate: (timeline: Timeline) => void
): TimelineSource {
  type Source = {
    member: DraftMemberDoc;
    handle: DocHandle<unknown>;
    // Heads the list has been read through; null before the first pass.
    consumed: Automerge.Heads | null;
    changes: TimelineChange[];
  };

  let disposed = false;
  let sources: Source[] = [];
  let createdAt: number | undefined;
  let running = false;
  let rerun = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const onChange = () => {
    if (disposed) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void gather();
    }, GATHER_DEBOUNCE_MS);
  };

  void (async () => {
    const next: Source[] = [];
    for (const member of members) {
      try {
        const handle = await repo.find<unknown>(member.cloneUrl ?? member.url);
        next.push({ member, handle, consumed: null, changes: [] });
      } catch (err) {
        console.warn(
          "[versions] failed to resolve member for timeline:",
          member,
          err
        );
      }
    }
    createdAt = await getDocCreationTime(repo, mainDocUrl);
    if (disposed) return;
    sources = next;
    for (const { handle } of sources) handle.on("change", onChange);
    await gather();
  })();

  return {
    dispose() {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      for (const { handle } of sources) handle.off("change", onChange);
      sources = [];
    },
  };

  // Publish the current flat list, sorted newest first.
  function publish(building: boolean): void {
    if (disposed) return;
    const changes = sources.flatMap((s) => s.changes).sort(newestFirst);
    onUpdate({ changes, building });
  }

  // One pass over every member's unread tail. A pass requested while one is
  // running queues a single follow-up rather than overlapping.
  async function gather(): Promise<void> {
    if (disposed) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      publish(true);
      let sliceStart = performance.now();
      const tick = async (): Promise<boolean> => {
        if (disposed) return false;
        if (performance.now() - sliceStart < SLICE_BUDGET_MS) return true;
        await idle();
        sliceStart = performance.now();
        return !disposed;
      };
      for (const source of sources) {
        if (!(await gatherMember(source, tick))) return;
        // Stream rows out as each member lands, so long histories paint
        // progressively instead of all at once at the end.
        publish(true);
      }
      publish(false);
    } finally {
      running = false;
      if (rerun && !disposed) {
        rerun = false;
        void gather();
      }
    }
  }

  // Append one member's changes since its consumed heads (or its fork point
  // on the first pass). Resolves false if the run was aborted.
  async function gatherMember(
    source: Source,
    tick: () => Promise<boolean>
  ): Promise<boolean> {
    const doc = source.handle.doc() as Automerge.Doc<unknown> | undefined;
    if (!doc) return true;
    const since =
      source.consumed ??
      (source.member.clonedAt ? decodeHeads(source.member.clonedAt) : []);
    const frontier = Automerge.getHeads(doc);
    let metas: Automerge.ChangeMetadata[];
    let counts: Map<string, { additions: number; deletions: number }> | null;
    try {
      metas = Automerge.getChangesMetaSince(doc, since);
      counts = await editCountsSince(doc, since, tick);
    } catch (err) {
      console.warn(
        "[versions] failed to read changes for member:",
        source.member.url,
        err
      );
      return true;
    }
    if (!counts) return false;
    const known = new Set(source.changes.map((c) => c.hash));
    const base = source.changes.length;
    metas.forEach((meta, i) => {
      if (known.has(meta.hash)) return;
      if (createdAt !== undefined && meta.time && meta.time < createdAt) return;
      source.changes.push({
        memberUrl: source.member.url,
        hash: meta.hash,
        time: meta.time,
        actor: meta.actor,
        seq: base + i,
        deps: meta.deps,
        ...(counts.get(meta.hash) ?? { additions: 0, deletions: 0 }),
      });
    });
    source.consumed = frontier;
    return true;
  }
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 200 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
