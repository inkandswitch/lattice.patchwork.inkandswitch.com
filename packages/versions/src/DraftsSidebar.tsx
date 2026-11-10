import "./styles.css";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
} from "solid-js";
import { createDocSignal } from "solid-automerge";
import type {
  AutomergeUrl,
  DocHandle,
  Repo,
  UrlHeads,
} from "@automerge/automerge-repo/slim";
import {
  decodeHeads,
  encodeHeads,
  isValidAutomergeUrl,
} from "@automerge/automerge-repo/slim";
import * as Automerge from "@automerge/automerge/slim";
import {
  subscribe,
  subscribeDoc,
} from "@inkandswitch/patchwork-providers-solid";
import type {
  ActorAttributionDoc,
  CheckedOutDraft,
  CloneEntry,
  DraftCheckpoint,
  DraftDoc,
  DraftList,
  DraftMemberDoc,
  DraftSummary,
  HasDrafts,
  Milestone,
} from "./draft-types";
import { computeRangeEditCounts } from "./change-group-cache";
import { ensureMainDraft } from "./draft-docs";
import {
  DEFAULT_GROUPING,
  GROUP_MODES,
  TIME_RESOLUTIONS,
  authorInitials,
  authorsPhrase,
  dayLabel,
  groupChanges,
  lullSpacing,
  milestonesByGroup,
  resolveAuthorNames,
  sameDay,
  whenPhrase,
  type AuthorResolver,
  type GroupMode,
  type Grouping,
  type TimeResolution,
  type TimelineChange,
  type TimelineGroup,
} from "./grouping";
import { createTimelineSource, type Timeline } from "./timeline";

// Seed for the read-only `draft:list` subscription until the provider answers.
// `main.url` is a placeholder; the Main card displays the host doc url instead.
const EMPTY_DRAFT_LIST: DraftList = {
  main: {
    url: "" as AutomergeUrl,
    parent: null,
    members: [],
    childCount: 0,
    name: null,
    changeGroupDocUrl: null,
  },
  drafts: [],
  actorAttributionUrl: null,
};

// Shown in the panel footer, logged on load, and stamped into fork
// diagnostics; bump on deploy to tell builds apart.
const DRAFTS_VERSION = "0.4.0";

// Logged at module load so the console shows which build is running even
// before the panel renders.
console.log(`[versions] DraftsSidebar v${DRAFTS_VERSION} loaded`);

export function DraftsSidebar(props: { element: HTMLElement }) {
  const [hostDoc, hostDocHandle] = subscribeDoc<HasDrafts>(props.element, {
    type: "draft:root-doc",
  });

  // Selection only: which draft is checked out (writeable).
  const [, checkedOutHandle] = subscribeDoc<CheckedOutDraft>(props.element, {
    type: "draft:checked-out",
  });

  // Read the checkout doc coarsely from the live handle (handle.doc()) rather
  // than a fine-grained patch-replay projection: the projection can render a
  // whole-value write doubled, whereas handle.doc() is always the correct
  // materialized document.
  const checkedOut = createDocSignal(checkedOutHandle);
  const selected = createMemo<AutomergeUrl | null>(
    () => checkedOut()?.checkedOut ?? null
  );

  // The eye toggle's state, derived from the checkpoint itself (no separate
  // flag): the eye is open — diffs showing — iff the current checkpoint
  // carries any diff baseline (`from`).
  const eyeOpen = createMemo<boolean>(() => {
    const at = checkedOut()?.at;
    return !!at && Object.values(at).some((e) => e.from !== undefined);
  });

  // Whether the view is actually pinned to history (any member has a `to`),
  // as opposed to live-with-baseline (eye open, nothing pinned).
  const isPinned = createMemo<boolean>(() => {
    const at = checkedOut()?.at;
    return !!at && Object.values(at).some((e) => e.to !== undefined);
  });

  // Where the scrubber sits: the change whose heads are displayed. Ephemeral,
  // client-only state: the stored checkpoint (`checkedOut.at`) is what
  // actually pins the view; this mirrors it to render the token and the
  // group highlight. Not persisted, so it resets on reload (the pinned view
  // survives).
  const [scrubber, setScrubber] = createSignal<ScrubberState | null>(null);

  // Where the diff baseline handle sits: an absolute point in history the
  // diff is measured from, independent of the head (`scrubber`). Ephemeral
  // like the head — resets on reload, while the persisted `from` keeps
  // driving the editor diff. Non-null only while the eye is open and a
  // version is pinned; that is also exactly when the handle renders.
  const [baseliner, setBaseliner] = createSignal<BaselineState | null>(null);

  // The derived drafts list (read-only): main plus each draft with its member
  // docs, recomputed and pushed by the provider.
  const list = subscribe<DraftList>(
    props.element,
    { type: "draft:list" },
    EMPTY_DRAFT_LIST
  );

  // Feed the module-level attribution store from this host doc's attribution
  // doc, so `AuthorAvatars` can render contacts instead of raw actor ids.
  createEffect(() => {
    const url = list().actorAttributionUrl;
    const repo = getRepo();
    if (!url || !repo) return;
    let disposed = false;
    let off: (() => void) | null = null;
    void repo.find<ActorAttributionDoc>(url).then(
      (handle) => {
        if (disposed) return;
        const update = () => {
          const actors = handle.doc()?.actors;
          if (actors && Object.keys(actors).length > 0) {
            setActorContacts((prev) => ({ ...prev, ...actors }));
          }
        };
        handle.on("change", update);
        off = () => handle.off("change", update);
        update();
      },
      (err) => {
        console.warn(
          "[versions] failed to load actor attribution:",
          url,
          err
        );
      }
    );
    onCleanup(() => {
      disposed = true;
      off?.();
    });
  });

  // The host doc's main draft, read live for its milestones. Null until the
  // first draft-ish action creates it (flagging a milestone does).
  const [mainDraftHandle, setMainDraftHandle] =
    createSignal<DocHandle<DraftDoc>>();
  createEffect(() => {
    const url = hostDoc()?.["@patchwork"]?.mainDraftUrl;
    const repo = getRepo();
    setMainDraftHandle(undefined);
    if (!url || !repo || !isValidAutomergeUrl(url)) return;
    let disposed = false;
    void repo.find<DraftDoc>(url).then(
      (handle) => {
        if (!disposed) setMainDraftHandle(handle);
      },
      (err) => {
        console.warn("[versions] failed to load main draft:", url, err);
      }
    );
    onCleanup(() => {
      disposed = true;
    });
  });
  const mainDraftDoc = createDocSignal(mainDraftHandle);
  const milestones = createMemo<Milestone[]>(() =>
    Object.values(mainDraftDoc()?.milestones ?? {})
  );
  const milestonesFor = (draftUrl: AutomergeUrl | null): Milestone[] =>
    milestones().filter((m) => (m.draftUrl ?? null) === draftUrl);

  // Flag a version as a milestone: the scrubbed version when the card is
  // pinned, otherwise its latest change. Prompts for a name (a blank one
  // takes the default), resolves the version's per-member heads, and writes
  // it onto the main draft — creating that doc if this is the first
  // draft-ish action on the host doc.
  const flagMilestone = async (draftUrl: AutomergeUrl | null) => {
    const repo = getRepo();
    const docHandle = hostDocHandle();
    if (!repo || !docHandle) return;
    const members = membersFor(draftUrl);
    const head =
      (selected() === draftUrl ? scrubber()?.head : undefined) ??
      (await latestHead(repo, members));
    if (!head) {
      window.alert("There are no changes to flag yet.");
      return;
    }
    const fallback = `Milestone ${milestones().length + 1}`;
    const entered = window.prompt("Name this milestone", fallback);
    if (entered === null) return;
    const name = entered.trim() || fallback;
    const at = await computeCheckpoint(repo, members, head, "none");
    const mainDraft = await ensureMainDraft(repo, docHandle);
    if (disposed) return;
    const id = `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    mainDraft.change((d) => {
      if (!d.milestones) d.milestones = {};
      d.milestones[id] = {
        id,
        name,
        createdAt: Date.now(),
        draftUrl,
        head: { docUrl: head.docUrl, hash: head.hash, time: head.time },
        at,
      };
    });
  };

  const renameMilestone = (id: string, name: string | null) => {
    mainDraftHandle()?.change((d) => {
      const m = d.milestones?.[id];
      if (m) m.name = name?.trim() || "Milestone";
    });
  };

  const removeMilestone = (id: string) => {
    const m = milestones().find((x) => x.id === id);
    if (!m) return;
    if (!window.confirm(`Remove the milestone "${m.name}"?`)) return;
    mainDraftHandle()?.change((d) => {
      if (d.milestones?.[id]) delete d.milestones[id];
    });
  };

  const isMainSelected = createMemo(() => selected() === null);
  // Drafting off a folder isn't supported yet, so creating a draft is disabled
  // while viewing a folder on Main.
  const isFolder = createMemo(
    () => hostDoc()?.["@patchwork"]?.type === "folder"
  );

  const selectDraft = (url: AutomergeUrl | null) => {
    const handle = checkedOutHandle();
    if (!handle || disposed) return;
    setScrubber(null);
    setBaseliner(null);
    handle.change((d) => {
      d.checkedOut = url;
      // Switching drafts (or to main) returns to the live latest heads.
      d.at = null;
    });
  };

  const getRepo = (): Repo | undefined =>
    "repo" in window ? window.repo : undefined;

  // Monotonic counter so a slow checkpoint computation can't overwrite a newer
  // scrub position (a drag fires one recompute per snapped change).
  let scrubSeq = 0;
  // The checkout doc outlives this sidebar (the provider reuses it across
  // mounts), so work still in flight at unmount must not write into it.
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    scrubSeq++;
  });

  // Recompute and persist the checkpoint from the current head (`scrubber`)
  // and baseline (`baseliner`) signals: `to`s follow the head, `from`s follow
  // the baseline (absolute, independent of the head). With the eye closed the
  // baseline is null and no `from` is written. The token and row highlight
  // update immediately from the signals; the checkpoint follows async.
  // `draftUrl` is `null` for main. Guarded by `scrubSeq` so a slower
  // computation can't clobber a newer drag.
  const applyPins = (
    draftUrl: AutomergeUrl | null,
    members: DraftMemberDoc[]
  ) => {
    const handle = checkedOutHandle();
    const repo = getRepo();
    if (!handle || !repo) return;
    const head = scrubber();
    if (!head) return;
    const bl = baseliner();
    const base: CheckpointBase = bl ? { beforeTime: bl.time } : "none";
    const seq = ++scrubSeq;
    void (async () => {
      const checkpoint = await computeCheckpoint(repo, members, head.head, base);
      // A newer scrub landed while this one was computing; drop it.
      if (seq !== scrubSeq) return;
      handle.change((d) => {
        d.checkedOut = draftUrl;
        d.at = checkpoint;
      });
    })();
  };

  // Move the head (the version being viewed); the baseline stays where it is.
  const onScrub = (
    draftUrl: AutomergeUrl | null,
    members: DraftMemberDoc[],
    scrub: ScrubberState
  ) => {
    setScrubber(scrub);
    applyPins(draftUrl, members);
  };

  // Move the diff baseline; the head stays where it is. Only reachable while
  // the eye is open and pinned (that is when the handle renders).
  const onBaselineScrub = (
    draftUrl: AutomergeUrl | null,
    members: DraftMemberDoc[],
    base: BaselineState
  ) => {
    setBaseliner(base);
    applyPins(draftUrl, members);
  };

  // The member docs of the current selection (`null` = main), for the eye
  // and checkpoint handlers below.
  const membersFor = (draftUrl: AutomergeUrl | null): DraftMemberDoc[] =>
    draftUrl
      ? (list().drafts.find((s) => s.url === draftUrl)?.members ?? [])
      : list().main.members;

  // The eye-open checkpoint for a live (unpinned) draft: every cloned member
  // diffs against its fork point, nothing pinned.
  const forkBaselines = (draftUrl: AutomergeUrl): DraftCheckpoint => {
    const at: DraftCheckpoint = {};
    for (const member of membersFor(draftUrl)) {
      if (member.clonedAt) at[member.url] = { from: member.clonedAt };
    }
    return at;
  };

  // Drop the time pin but stay on the same draft: back to live latest heads.
  // With the eye open on a draft the diff baselines survive — the view goes
  // live but keeps showing what changed since the fork point. (A live main
  // has nothing to diff against, so there the eye closes with the pin.)
  const clearCheckpoint = () => {
    const handle = checkedOutHandle();
    if (!handle) return;
    setScrubber(null);
    // Unpinned: the baseline handle only shows while pinned, so drop it.
    setBaseliner(null);
    const draftUrl = selected();
    const baselines = eyeOpen() && draftUrl ? forkBaselines(draftUrl) : null;
    handle.change((d) => {
      d.at =
        baselines && Object.keys(baselines).length > 0 ? baselines : null;
    });
  };

  // The eye toggle: show or hide diff highlighting. The eye holds no state of
  // its own — it rewrites the checkpoint's per-member `from`s (which the
  // provider serves as `draft:baseline`), and its open/closed state is read
  // back off the checkpoint (`eyeOpen`).
  const toggleEye = () => {
    const handle = checkedOutHandle();
    const repo = getRepo();
    if (!handle || !repo) return;

    if (eyeOpen()) {
      // Close: strip the baselines; a pin (`to`) stays untouched. Baseline-
      // only entries disappear entirely, so a live view's `at` goes to null.
      setBaseliner(null);
      handle.change((d) => {
        if (!d.at) return;
        const urls = Object.keys(d.at) as AutomergeUrl[];
        if (!urls.some((u) => d.at?.[u]?.to !== undefined)) {
          d.at = null;
          return;
        }
        for (const url of urls) {
          const entry = d.at[url];
          if (!entry) continue;
          if (entry.to === undefined) delete d.at[url];
          else delete entry.from;
        }
      });
      return;
    }

    const draftUrl = selected();
    const s = scrubber();
    if (isPinned() && s) {
      // Pinned with a known scrub position: seed the baseline handle at the
      // scrubbed group's start and recompute the checkpoint against it. The
      // handle's exact offset is resolved by the changes list, which knows
      // the group's size (BASELINE_GROUP_START).
      setBaseliner({
        groupId: s.groupId,
        offset: BASELINE_GROUP_START,
        time: s.groupStartTime,
      });
      const members = membersFor(draftUrl);
      const seq = ++scrubSeq;
      void (async () => {
        const checkpoint = await computeCheckpoint(repo, members, s.head, {
          beforeTime: s.groupStartTime,
        });
        if (seq !== scrubSeq) return;
        handle.change((d) => {
          d.at = checkpoint;
        });
      })();
      return;
    }

    if (isPinned()) {
      // Pinned but the scrub position is unknown (the sidebar remounted
      // while the pin survived): fall back to diffing the pinned view
      // against the fork point.
      const clonedAt = new Map(
        membersFor(draftUrl).map((m) => [m.url, m.clonedAt])
      );
      handle.change((d) => {
        if (!d.at) return;
        for (const url of Object.keys(d.at) as AutomergeUrl[]) {
          const entry = d.at[url];
          if (!entry) continue;
          entry.from = clonedAt.get(url) ?? encodeHeads([]);
        }
      });
      return;
    }

    // Live on a draft: show what changed since the fork point. (Live on
    // main the button is disabled — there is no baseline to diff against.)
    if (!draftUrl) return;
    const baselines = forkBaselines(draftUrl);
    if (Object.keys(baselines).length === 0) return;
    handle.change((d) => {
      d.at = baselines;
    });
  };

  // While the eye is open on a live (unpinned) draft, keep the baseline map
  // in step with the member list: a doc forked after the eye was opened gets
  // its fork-point baseline added here. (The provider serves baselines only
  // from the checkpoint — there is no implicit fallback to cover it.)
  createEffect(() => {
    const at = checkedOut()?.at;
    const draftUrl = selected();
    const handle = checkedOutHandle();
    if (!at || !draftUrl || !handle) return;
    const entries = Object.values(at);
    if (entries.length === 0) return;
    if (entries.some((e) => e.to !== undefined)) return; // pinned: onScrub owns it
    if (!entries.some((e) => e.from !== undefined)) return; // eye closed
    const missing = membersFor(draftUrl).filter(
      (m) => m.clonedAt !== null && !at[m.url]
    );
    if (missing.length === 0) return;
    handle.change((d) => {
      if (!d.at) return;
      for (const m of missing) {
        if (m.clonedAt) d.at[m.url] = { from: m.clonedAt };
      }
    });
  });

  // Fork the current selection as a new child draft. `atVersion` picks the
  // fork point (the two menu items): true clones every member doc at the
  // heads it had as of the scrubbed version, false forks at the latest
  // heads. The new draft is parented to the selection — merging it later
  // lands back here, not on main. Pre-populating `DraftDoc.clones` means the
  // overlay's lazy `resolveClone` reuses these entries instead of forking
  // the originals at current heads (which matters when forking off a draft:
  // the clones must branch off the draft's clones). Forking main live needs
  // no eager clones — main's members are the originals, so the lazy path is
  // exactly right. Members with no changes at or before a pinned version
  // (created later) are left out; the version's docs don't reference them
  // yet, so they are normally never resolved beneath the draft.
  const onForkSelection = async (atVersion: boolean) => {
    if (isFolder()) return;
    const docHandle = hostDocHandle();
    if (!docHandle) return;
    const repo = getRepo();
    if (!repo) {
      console.warn("[versions] window.repo is not set");
      return;
    }

    const parentUrl = selected(); // null = main
    const members = membersFor(parentUrl);
    const head = atVersion ? (scrubber()?.head ?? null) : null;

    const clones: Record<AutomergeUrl, CloneEntry> = {};
    if (head) {
      // Reuse the scrub machinery to resolve per-doc heads at this version
      // (only the `to`s are read, so no diff baseline).
      const checkpoint = await computeCheckpoint(repo, members, head, "none");
      for (const member of members) {
        const to = checkpoint[member.url]?.to;
        if (!to) continue;
        let handle: DocHandle<unknown> | null = null;
        try {
          // Clone the doc the timeline read its changes from (the draft's
          // clone when forking off a draft), pinned to the version's heads.
          // Keyed by the original url so baselines and merge-back resolve.
          handle = await repo.find<unknown>(member.cloneUrl ?? member.url);
          const clone = cloneAtVersion(repo, handle, to);
          clones[member.url] = { cloneUrl: clone.url, clonedAt: to };
        } catch (err) {
          reportForkFailure(
            handle ? collectForkDiagnostic(handle, member, to) : null,
            err
          );
        }
      }
    } else if (parentUrl) {
      // Forking a draft at its latest heads: branch each member off the
      // draft's clone (not the original, which lacks the draft's changes).
      for (const member of members) {
        try {
          const source = await repo.find<unknown>(
            member.cloneUrl ?? member.url
          );
          const clonedAt = source.heads();
          const clone = repo.clone(source);
          clones[member.url] = { cloneUrl: clone.url, clonedAt };
        } catch (err) {
          console.warn(
            "[versions] failed to fork member:",
            member,
            err
          );
        }
      }
    }

    const mainDraft = await ensureMainDraft(repo, docHandle);
    const parentHandle = parentUrl
      ? await repo.find<DraftDoc>(parentUrl)
      : mainDraft;
    // Default name from a monotonic counter on the main draft, stamped at
    // creation so numbering stays stable as drafts are merged or deleted.
    let draftNumber = 1;
    mainDraft.change((d) => {
      d.draftCounter = (d.draftCounter ?? 0) + 1;
      draftNumber = d.draftCounter;
    });
    const draft = repo.create<DraftDoc>({
      "@patchwork": { type: "draft" },
      name: `Draft ${draftNumber}`,
      parent: parentHandle.url,
      drafts: [],
      clones,
    });
    parentHandle.change((d) => {
      d.drafts.push(draft.url);
    });
    selectDraft(draft.url);
  };

  // Rename a draft, or main (`url === null`). Names live on the `DraftDoc`;
  // renaming main creates the main draft doc if this is the first draft-ish
  // action on the host doc. `null` clears back to the default label.
  const onRename = async (url: AutomergeUrl | null, name: string | null) => {
    const repo = getRepo();
    if (!repo) return;
    let handle: DocHandle<DraftDoc>;
    if (url === null) {
      const docHandle = hostDocHandle();
      if (!docHandle) return;
      handle = await ensureMainDraft(repo, docHandle);
    } else {
      handle = await repo.find<DraftDoc>(url);
    }
    handle.change((d) => {
      if (name) d.name = name;
      else delete d.name;
    });
  };

  // The selected draft's summary and parent, driving the merge button on the
  // selected draft's header (it merges up into the parent).
  const selectedSummary = createMemo<DraftSummary | null>(
    () => list().drafts.find((s) => s.url === selected()) ?? null
  );
  const mergeParentUrl = createMemo<AutomergeUrl | null>(
    () => selectedSummary()?.parent ?? null
  );
  // Display name of the merge target (the parent): the tooltip and the
  // confirm dialog both name it.
  const mergeTargetName = createMemo<string>(() => {
    const parentUrl = mergeParentUrl();
    if (parentUrl === null || parentUrl === list().main.url) {
      return list().main.name ?? "main";
    }
    return list().drafts.find((s) => s.url === parentUrl)?.name ?? "Draft";
  });

  // Label of the menu's fork-from-version item, e.g. "Fork from Jul 24,
  // 3:12 PM" — the change the scrubber sits on. Null (item hidden) while
  // the timeline isn't pinned.
  const forkAtLabel = createMemo<string | null>(() => {
    if (!isPinned()) return null;
    const time = scrubber()?.head.time;
    if (!time) return null;
    return `Fork from ${formatVersionTime(time)}`;
  });

  // Label of the menu's flag item: names the version it would flag.
  const flagLabel = createMemo<string>(() => {
    const time = isPinned() ? scrubber()?.head.time : undefined;
    return time
      ? `Flag ${formatVersionTime(time)} as a milestone`
      : "Flag the latest version as a milestone";
  });

  // True while the menu's merge item is hovered: the target card (the
  // selected draft's parent) lights up via `data-merge-target`.
  const [mergeHighlight, setMergeHighlight] = createSignal(false);

  // Nesting depth for a card's indentation: hops up the parent chain until
  // main (a top-level draft's parent is the main draft, which isn't in the
  // drafts list, so it counts 0). Cycle-guarded — parents are plain urls.
  const draftDepth = (summary: DraftSummary): number => {
    const byUrl = new Map(list().drafts.map((s) => [s.url, s]));
    const seen = new Set<AutomergeUrl>();
    let depth = 0;
    let parent = summary.parent;
    while (parent && byUrl.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      depth++;
      parent = byUrl.get(parent)!.parent;
    }
    return depth;
  };

  // Merge the selected draft into its parent — the draft it was forked off,
  // or main for a top-level draft — then check the parent out. The merged
  // draft's `mergedAt` stamp hides it from the list.
  const onMergeDraft = async () => {
    const draftUrl = selected();
    if (!draftUrl) return;
    const parentUrl = mergeParentUrl();
    if (!window.confirm(`Merge this draft into "${mergeTargetName()}"?`))
      return;
    const repo = getRepo();
    if (!repo) {
      console.warn("[versions] window.repo is not set");
      return;
    }
    const draftHandle = await repo.find<DraftDoc>(draftUrl);
    await mergeDraft(repo, draftHandle);
    selectDraft(parentUrl && parentUrl !== list().main.url ? parentUrl : null);
  };

  // Delete the selected draft: unlink it from its parent's `drafts` list,
  // which drops it — along with any drafts forked from it — from every
  // peer's tree walk. Nothing is merged and the docs themselves are left in
  // place; the draft just becomes unreachable.
  const onDeleteDraft = async () => {
    const draftUrl = selected();
    if (!draftUrl) return;
    const childCount = selectedSummary()?.childCount ?? 0;
    const warning =
      childCount > 0
        ? "Delete this draft? Drafts forked from it will be deleted too. This can't be undone."
        : "Delete this draft? This can't be undone.";
    if (!window.confirm(warning)) return;
    const repo = getRepo();
    if (!repo) {
      console.warn("[versions] window.repo is not set");
      return;
    }
    const parentUrl = mergeParentUrl();
    let parentHandle: DocHandle<DraftDoc>;
    if (parentUrl) {
      parentHandle = await repo.find<DraftDoc>(parentUrl);
    } else {
      // Legacy drafts without a `parent` field hang off the main draft.
      const docHandle = hostDocHandle();
      if (!docHandle) return;
      parentHandle = await ensureMainDraft(repo, docHandle);
    }
    parentHandle.change((d) => {
      const i = d.drafts.indexOf(draftUrl);
      if (i >= 0) d.drafts.splice(i, 1);
    });
    selectDraft(parentUrl && parentUrl !== list().main.url ? parentUrl : null);
  };

  return (
    <div class="dgr-panel">
      <Show
        when={hostDoc()}
        fallback={<div class="dgr-empty">No document selected.</div>}
      >
        <GroupingPicker />
        <div class="dgr-list">
          <MainCard
            hostDocUrl={hostDocHandle()?.url}
            isSelected={isMainSelected()}
            members={() => list().main.members}
            name={list().main.name}
            onRename={(name) => void onRename(null, name)}
            onSelect={() => selectDraft(null)}
            onScrub={(scrub) => onScrub(null, list().main.members, scrub)}
            scrubber={() => (isMainSelected() ? scrubber() : null)}
            onBaselineScrub={(base) =>
              onBaselineScrub(null, list().main.members, base)
            }
            baseliner={() => (isMainSelected() ? baseliner() : null)}
            checkpoint={() => (isMainSelected() ? (checkedOut()?.at ?? null) : null)}
            hasCheckpoint={isMainSelected() && isPinned()}
            onReturnToLatest={clearCheckpoint}
            eyeOpen={isMainSelected() && eyeOpen()}
            eyeDisabled={!isPinned()}
            onToggleEye={toggleEye}
            forkDisabled={isFolder()}
            onFork={() => void onForkSelection(false)}
            forkAtLabel={forkAtLabel()}
            onForkAt={() => void onForkSelection(true)}
            flagLabel={flagLabel()}
            onFlag={() => void flagMilestone(null)}
            milestones={() => milestonesFor(null)}
            onRenameMilestone={renameMilestone}
            onRemoveMilestone={removeMilestone}
            isMergeTarget={
              mergeHighlight() && mergeParentUrl() === list().main.url
            }
          />
          <For each={list().drafts}>
            {(summary) => (
              <DraftCard
                url={summary.url}
                members={summary.members}
                mainDocUrl={hostDocHandle()?.url}
                isSelected={selected() === summary.url}
                name={summary.name}
                depth={draftDepth(summary)}
                onRename={(name) => void onRename(summary.url, name)}
                onSelect={selectDraft}
                onScrub={(scrub) =>
                  onScrub(summary.url, summary.members, scrub)
                }
                scrubber={() =>
                  selected() === summary.url ? scrubber() : null
                }
                onBaselineScrub={(base) =>
                  onBaselineScrub(summary.url, summary.members, base)
                }
                baseliner={() =>
                  selected() === summary.url ? baseliner() : null
                }
                checkpoint={() =>
                  selected() === summary.url ? (checkedOut()?.at ?? null) : null
                }
                hasCheckpoint={selected() === summary.url && isPinned()}
                onReturnToLatest={clearCheckpoint}
                eyeOpen={selected() === summary.url && eyeOpen()}
                eyeDisabled={false}
                onToggleEye={toggleEye}
                onFork={() => void onForkSelection(false)}
                forkAtLabel={forkAtLabel()}
                onForkAt={() => void onForkSelection(true)}
                flagLabel={flagLabel()}
                onFlag={() => void flagMilestone(summary.url)}
                milestones={() => milestonesFor(summary.url)}
                onRenameMilestone={renameMilestone}
                onRemoveMilestone={removeMilestone}
                mergeLabel={`Merge into "${mergeTargetName()}"`}
                onMerge={() => void onMergeDraft()}
                onMergeHover={setMergeHighlight}
                onDelete={() => void onDeleteDraft()}
                isMergeTarget={
                  mergeHighlight() && mergeParentUrl() === summary.url
                }
              />
            )}
          </For>
        </div>
      </Show>
      <div class="dgr-version">v{DRAFTS_VERSION}</div>
    </div>
  );
}

// Merges every cloned doc back into the parent draft's copy of it — the
// parent's clone when it has one, the original otherwise (the main draft's
// identity clones make those the same thing, so a top-level draft merges
// into the originals) — recording per-clone merge heads for auditing, and
// marks the draft as merged (which hides it from the list). The merged
// draft's children are handed up to the merge target, so they never dangle
// under a hidden draft.
async function mergeDraft(
  repo: Repo,
  draftHandle: DocHandle<DraftDoc>
): Promise<void> {
  const doc = draftHandle.doc();
  const parentHandle = await findMergeTarget(repo, doc?.parent);
  const parentClones = parentHandle?.doc()?.clones ?? {};
  const entries = Object.entries(doc?.clones ?? {}) as [
    AutomergeUrl,
    CloneEntry,
  ][];
  for (const [originalUrl, entry] of entries) {
    const targetUrl = parentClones[originalUrl]?.cloneUrl ?? originalUrl;
    if (entry.cloneUrl === targetUrl) continue;
    const [target, clone] = await Promise.all([
      repo.find<unknown>(targetUrl),
      repo.find<unknown>(entry.cloneUrl),
    ]);
    target.merge(clone);
    const mergedAt = target.heads();
    draftHandle.change((d) => {
      const e = d.clones[originalUrl];
      if (e) e.mergedAt = mergedAt;
    });
  }
  draftHandle.change((d) => {
    d.mergedAt = Date.now();
  });

  // Re-parent the merged draft's children onto the merge target: they list
  // under it and their own merges land there (where this draft's changes
  // now live). Their clones branched off this draft's clones, whose history
  // was just merged into the target, so they still merge back cleanly.
  if (parentHandle) {
    const children = (draftHandle.doc()?.drafts ?? []).filter(
      isValidAutomergeUrl
    );
    for (const childUrl of children) {
      try {
        const child = await repo.find<DraftDoc>(childUrl);
        child.change((d) => {
          d.parent = parentHandle.url;
        });
        parentHandle.change((d) => {
          if (!d.drafts.includes(childUrl)) d.drafts.push(childUrl);
        });
        draftHandle.change((d) => {
          const i = d.drafts.indexOf(childUrl);
          if (i >= 0) d.drafts.splice(i, 1);
        });
      } catch (err) {
        console.warn(
          "[versions] failed to re-parent child draft after merge:",
          childUrl,
          err
        );
      }
    }
  }
}

// Resolve the draft the merge should land in: the nearest non-merged
// ancestor. A parent that was itself merged away hands its role up the
// chain (its changes live in *its* merge target), ending at the main draft,
// which is never merged. Null when the chain can't be resolved — the caller
// then falls back to merging into the originals.
async function findMergeTarget(
  repo: Repo,
  parentUrl: AutomergeUrl | undefined
): Promise<DocHandle<DraftDoc> | null> {
  const seen = new Set<AutomergeUrl>();
  let cursor = parentUrl;
  while (cursor && isValidAutomergeUrl(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    try {
      const candidate = await repo.find<DraftDoc>(cursor);
      if (candidate.doc()?.mergedAt === undefined) return candidate;
      cursor = candidate.doc()?.parent;
    } catch (err) {
      console.warn(
        "[versions] failed to load ancestor draft for merge; " +
          "falling back to merging into the originals:",
        cursor,
        err
      );
      return null;
    }
  }
  return null;
}

// --- Cloning a member at a version -------------------------------------------
// The obvious way — `repo.clone(handle.view(to))`, i.e. wasm `fork_at` — is
// broken upstream: on documents whose history contains certain concurrent
// merge changes (as anything synced through subduction ends up with),
// `fork_at` panics with `MissingOps` in `ChangeCollector::from_build_meta`
// at *any* heads, and the panic poisons the doc object for the rest of the
// session (every later call throws "recursive use of an object detected").
// Confirmed offline against automerge 3.3.0-fragments.1 and .2 with a
// 26-change minimal repro.
//
// So the version clone is built without `fork_at`: collect the ancestor
// closure of the pin heads from the change metadata, bundle exactly those
// changes (`saveBundle`), hydrate a fresh doc from the bundle
// (`loadIncremental`), and install it into a new repo handle — the same move
// `repo.clone` performs internally, minus the panicking wasm path. The
// resulting doc's heads are exactly `to`, it shares history with the
// original, and merges back cleanly.

// Build a clone of `handle`'s doc pinned to the `to` heads and register it
// with the repo. Throws (a plain JS error, no wasm panic) when the pin's
// ancestry can't be resolved from the doc's change metadata.
function cloneAtVersion(
  repo: Repo,
  handle: DocHandle<unknown>,
  to: UrlHeads
): DocHandle<unknown> {
  const doc = handle.doc() as Automerge.Doc<unknown>;
  const pinHeads = decodeHeads(to);

  // Ancestor closure of the pin heads, walked over the full change metadata.
  const metas = Automerge.getChangesMetaSince(doc, []);
  const byHash = new Map(metas.map((m) => [m.hash, m]));
  const closure = new Set<string>();
  const stack = [...pinHeads];
  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (closure.has(hash)) continue;
    const meta = byHash.get(hash);
    if (!meta) {
      throw new Error(
        `[drafts] change ${hash} is not in the doc's history metadata`
      );
    }
    closure.add(hash);
    stack.push(...meta.deps);
  }

  const bundle = Automerge.saveBundle(doc, [...closure]);
  const pinned = Automerge.loadIncremental(Automerge.init<unknown>(), bundle);

  const gotHeads = [...Automerge.getHeads(pinned)].sort();
  const wantHeads = [...pinHeads].sort();
  if (JSON.stringify(gotHeads) !== JSON.stringify(wantHeads)) {
    throw new Error(
      `[drafts] version clone heads mismatch: wanted ${wantHeads}, got ${gotHeads}`
    );
  }

  const clone = repo.create<unknown>();
  clone.update(() => pinned);
  return clone;
}

// --- Fork-at-version diagnostics --------------------------------------------
// When `cloneAtVersion` fails, everything we can learn about the member and
// the pinned heads is dumped as one JSON block tagged
// [versions][fork-diagnostic]; paste that back when reporting.

// Everything we could learn about the member and the pinned heads, plus the
// final error.
type ForkDiagnostic = {
  draftsVersion: string;
  memberUrl: AutomergeUrl;
  sourceUrl: AutomergeUrl;
  memberClonedAt: UrlHeads | null;
  // The version being forked at, as url-encoded heads and as hex hashes.
  to: UrlHeads;
  toHex: string[];
  // The doc's live frontier (hex), for comparison with `toHex`.
  currentHeads: string[] | null;
  // Does the doc itself consider `toHex` a valid point in its history?
  hasHeads: boolean | null;
  // Change hashes the doc knows it is missing ops for, as of `toHex`.
  missingDeps: string[] | null;
  stats: { numChanges: number; numOps: number } | null;
  automerge: {
    jsGitHead: string;
    wasmGitHead: string | null;
    wasmVersion: string | null;
  } | null;
  // Where each pinned hash sits in the doc's history: its topological index,
  // metadata, and whether it is a live head. `known: false` means the doc has
  // no change with that hash at all.
  pinnedChanges: {
    hash: string;
    known: boolean;
    topoIndex: number | null;
    time: number | null;
    actor: string | null;
    seq: number | null;
    deps: string[] | null;
    isCurrentHead: boolean;
  }[];
  // Sedimentree fragment coverage: how the doc's history is bundled.
  // `topoRange` is the [min, max] topological index of the fragment's member
  // changes and `containsPin` whether a pinned hash is one of them — so a
  // fork-depth failure boundary can be read directly against bundle
  // boundaries. A pinned hash buried inside a higher-level bundle is the
  // prime MissingOps suspect.
  fragments:
    | {
        level: number;
        head: string;
        memberCount: number;
        topoRange: [number, number] | null;
        containsPin: boolean;
      }[]
    | null;
  probeErrors: string[];
  failure?: { message: string; stack?: string };
};

// The saved doc bytes captured before the failing fork, kept out of the JSON
// report (too big) and exposed on `window.__draftsForkRepro` instead, so the
// exact failing document can be reproduced offline.
type ForkRepro = {
  url: AutomergeUrl;
  toHex: string[];
  docBase64: string;
};

// Snapshot everything we can read about `handle`'s doc and the pinned heads.
// Every probe is individually guarded so one bad call doesn't lose the rest.
function collectForkDiagnostic(
  handle: DocHandle<unknown>,
  member: DraftMemberDoc,
  to: UrlHeads
): ForkDiagnostic {
  const diagnostic: ForkDiagnostic = {
    draftsVersion: DRAFTS_VERSION,
    memberUrl: member.url,
    sourceUrl: member.cloneUrl ?? member.url,
    memberClonedAt: member.clonedAt,
    to,
    toHex: [],
    currentHeads: null,
    hasHeads: null,
    missingDeps: null,
    stats: null,
    automerge: null,
    pinnedChanges: [],
    fragments: null,
    probeErrors: [],
  };
  const probe = (name: string, run: () => void) => {
    try {
      run();
    } catch (err) {
      diagnostic.probeErrors.push(`${name}: ${String(err)}`);
    }
  };

  probe("decodeHeads", () => {
    diagnostic.toHex = decodeHeads(to);
  });

  const doc = handle.doc() as Automerge.Doc<unknown>;

  probe("getHeads", () => {
    diagnostic.currentHeads = Automerge.getHeads(doc);
  });
  probe("hasHeads", () => {
    diagnostic.hasHeads = Automerge.hasHeads(doc, diagnostic.toHex);
  });
  probe("getMissingDeps", () => {
    diagnostic.missingDeps = Automerge.getMissingDeps(doc, diagnostic.toHex);
  });
  probe("stats", () => {
    const s = Automerge.stats(doc);
    diagnostic.stats = { numChanges: s.numChanges, numOps: s.numOps };
  });
  probe("releaseInfo", () => {
    const info = Automerge.releaseInfo();
    diagnostic.automerge = {
      jsGitHead: info.js.gitHead,
      wasmGitHead: info.wasm?.gitHead ?? null,
      wasmVersion: info.wasm?.cargoPackageVersion ?? null,
    };
  });
  probe("pinnedChanges", () => {
    const topo = Automerge.topoHistoryTraversal(doc);
    const metas = Automerge.getChangesMetaSince(doc, []);
    const metaByHash = new Map(metas.map((m) => [m.hash, m]));
    diagnostic.pinnedChanges = diagnostic.toHex.map((hash) => {
      const meta = metaByHash.get(hash);
      const topoIndex = topo.indexOf(hash);
      return {
        hash,
        known: !!meta || topoIndex >= 0,
        topoIndex: topoIndex >= 0 ? topoIndex : null,
        time: meta?.time ?? null,
        actor: meta?.actor ?? null,
        seq: meta?.seq ?? null,
        deps: meta?.deps ?? null,
        isCurrentHead: diagnostic.currentHeads?.includes(hash) ?? false,
      };
    });
  });
  probe("fragments", () => {
    const topo = Automerge.topoHistoryTraversal(doc);
    const topoIndex = new Map(topo.map((h, i) => [h, i]));
    const pinned = new Set(diagnostic.toHex);
    diagnostic.fragments = Automerge.getFragmentMetadata(doc).map((f) => {
      let min = Infinity;
      let max = -Infinity;
      let containsPin = false;
      for (const h of f.members) {
        const i = topoIndex.get(h);
        if (i !== undefined) {
          if (i < min) min = i;
          if (i > max) max = i;
        }
        if (pinned.has(h)) containsPin = true;
      }
      return {
        level: f.level,
        head: f.head,
        memberCount: f.members.length,
        topoRange: min <= max ? ([min, max] as [number, number]) : null,
        containsPin,
      };
    });
  });
  probe("saveDoc", () => {
    // Capture the full doc bytes for an offline repro; published to
    // `window.__draftsForkRepro` by `reportForkFailure`.
    const bytes = Automerge.save(doc);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    lastForkRepro = {
      url: member.url,
      toHex: diagnostic.toHex,
      docBase64: btoa(binary),
    };
  });

  return diagnostic;
}

// The most recent member's saved bytes, captured by `collectForkDiagnostic`
// and published by `reportForkFailure` when its member's fork fails.
let lastForkRepro: ForkRepro | null = null;

// Dump the diagnostic and the error as one copy-pasteable JSON block.
function reportForkFailure(
  diagnostic: ForkDiagnostic | null,
  err: unknown
): void {
  const failure = {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  if (!diagnostic) {
    console.error(
      "[versions][fork-diagnostic] failed before diagnostics could be gathered:",
      failure
    );
    return;
  }
  diagnostic.failure = failure;
  if (lastForkRepro && lastForkRepro.url === diagnostic.memberUrl) {
    (window as unknown as Record<string, unknown>).__draftsForkRepro =
      lastForkRepro;
  }
  console.error(
    "[versions][fork-diagnostic] failed to fork member at version — paste this block back:\n" +
      JSON.stringify(diagnostic, null, 2) +
      "\n[versions][fork-diagnostic] the failing doc's bytes are on " +
      "window.__draftsForkRepro — to save them for an offline repro, run:\n" +
      "  const r = window.__draftsForkRepro;\n" +
      "  const bytes = Uint8Array.from(atob(r.docBase64), c => c.charCodeAt(0));\n" +
      "  const a = document.createElement('a');\n" +
      "  a.href = URL.createObjectURL(new Blob([bytes]));\n" +
      "  a.download = 'fork-repro.automerge'; a.click();\n" +
      "  console.log('pin heads:', r.toHex);"
  );
}

function MainCard(props: {
  hostDocUrl: AutomergeUrl | undefined;
  isSelected: boolean;
  members: Accessor<DraftMemberDoc[]>;
  name: string | null;
  onRename: (name: string | null) => void;
  onSelect: () => void;
  onScrub: (scrub: ScrubberState) => void;
  scrubber: Accessor<ScrubberState | null>;
  onBaselineScrub: (base: BaselineState) => void;
  baseliner: Accessor<BaselineState | null>;
  checkpoint: Accessor<DraftCheckpoint | null>;
  hasCheckpoint: boolean;
  onReturnToLatest: () => void;
  eyeOpen: boolean;
  eyeDisabled: boolean;
  onToggleEye: () => void;
  forkDisabled: boolean;
  onFork: () => void;
  forkAtLabel: string | null;
  onForkAt: () => void;
  flagLabel: string;
  onFlag: () => void;
  milestones: Accessor<Milestone[]>;
  onRenameMilestone: (id: string, name: string | null) => void;
  onRemoveMilestone: (id: string) => void;
  // True while the merge menu item is hovered and this card is the target.
  isMergeTarget: boolean;
}) {
  return (
    <div
      class="dgr-card"
      data-selected={props.isSelected ? "" : undefined}
      data-merge-target={props.isMergeTarget ? "" : undefined}
    >
      {/* A div, not a <button>: the rename input rendered inside would be
          invalid (and misbehave) nested in a button. */}
      <div
        class="dgr-card-header"
        onClick={props.onSelect}
        title="Main version (host document)"
      >
        <div class="dgr-card-title">
          <DraftName
            name={props.name}
            fallback="main"
            onRename={props.onRename}
          />
          {/* Shown left of the tools while the timeline is pinned: drops the
              pin and returns to the live latest heads. It lives inside the
              clickable header, so the click is stopped from also
              re-selecting the card. */}
          <Show when={props.hasCheckpoint}>
            <button
              type="button"
              class="dgr-card-return"
              onClick={(e) => {
                e.stopPropagation();
                props.onReturnToLatest();
              }}
              title="Return to the latest version"
            >
              Return to latest
            </button>
          </Show>
          <Show when={props.isSelected}>
            <span class="dgr-card-tools">
              <EyeToggle
                open={props.eyeOpen}
                disabled={props.eyeDisabled}
                onToggle={props.onToggleEye}
              />
              <CardActions
                forkDisabled={props.forkDisabled}
                onFork={props.onFork}
                forkAtLabel={props.forkAtLabel}
                onForkAt={props.onForkAt}
                flagLabel={props.flagLabel}
                onFlag={props.onFlag}
              />
            </span>
          </Show>
        </div>
      </div>
      <Show when={props.isSelected}>
        <DraftChangesList
          members={props.members}
          mainDocUrl={props.hostDocUrl}
          milestones={props.milestones}
          onRenameMilestone={props.onRenameMilestone}
          onRemoveMilestone={props.onRemoveMilestone}
          onScrub={props.onScrub}
          scrubber={props.scrubber}
          onBaselineScrub={props.onBaselineScrub}
          baseliner={props.baseliner}
          eyeOpen={() => props.eyeOpen}
          checkpoint={props.checkpoint}
          onReturnToLatest={props.onReturnToLatest}
        />
      </Show>
    </div>
  );
}

function DraftCard(props: {
  url: AutomergeUrl;
  members: DraftMemberDoc[];
  mainDocUrl: AutomergeUrl | undefined;
  isSelected: boolean;
  name: string | null;
  // Nesting depth below main (0 = top-level draft); indents the card so a
  // fork reads as a child of the card above it. Rendering adds one level so
  // every draft — main's children included — sits indented under the Main
  // card.
  depth: number;
  onRename: (name: string | null) => void;
  onSelect: (url: AutomergeUrl) => void;
  onScrub: (scrub: ScrubberState) => void;
  scrubber: Accessor<ScrubberState | null>;
  onBaselineScrub: (base: BaselineState) => void;
  baseliner: Accessor<BaselineState | null>;
  checkpoint: Accessor<DraftCheckpoint | null>;
  hasCheckpoint: boolean;
  onReturnToLatest: () => void;
  eyeOpen: boolean;
  eyeDisabled: boolean;
  onToggleEye: () => void;
  onFork: () => void;
  forkAtLabel: string | null;
  onForkAt: () => void;
  flagLabel: string;
  onFlag: () => void;
  milestones: Accessor<Milestone[]>;
  onRenameMilestone: (id: string, name: string | null) => void;
  onRemoveMilestone: (id: string) => void;
  // Menu item text naming the merge target (this draft's parent, e.g.
  // `Merge into "Main"`); merging goes up.
  mergeLabel: string;
  onMerge: () => void;
  // Fires with true/false as the merge item is hovered/left, so the parent
  // card can light up as the target.
  onMergeHover: (over: boolean) => void;
  // True while the merge menu item is hovered and this card is the target.
  isMergeTarget: boolean;
  // Unlinks the draft (and its forks) from the tree, after a confirm dialog.
  onDelete: () => void;
}) {
  return (
    <div
      class="dgr-card"
      data-selected={props.isSelected ? "" : undefined}
      data-merge-target={props.isMergeTarget ? "" : undefined}
      style={{ "margin-left": `${Math.min(props.depth + 1, 5)}rem` }}
    >
      {/* A div, not a <button>: see MainCard. */}
      <div
        class="dgr-card-header"
        onClick={() => props.onSelect(props.url)}
        title="Open draft"
      >
        <div class="dgr-card-title">
          <DraftName
            name={props.name}
            fallback="Draft"
            onRename={props.onRename}
          />
          {/* See MainCard: pinned-only "return to latest" control in the title. */}
          <Show when={props.hasCheckpoint}>
            <button
              type="button"
              class="dgr-card-return"
              onClick={(e) => {
                e.stopPropagation();
                props.onReturnToLatest();
              }}
              title="Return to the latest version"
            >
              Return to latest
            </button>
          </Show>
          <Show when={props.isSelected}>
            <span class="dgr-card-tools">
              <EyeToggle
                open={props.eyeOpen}
                disabled={props.eyeDisabled}
                onToggle={props.onToggleEye}
              />
              <CardActions
                onFork={props.onFork}
                forkAtLabel={props.forkAtLabel}
                onForkAt={props.onForkAt}
                flagLabel={props.flagLabel}
                onFlag={props.onFlag}
                merge={{
                  label: props.mergeLabel,
                  onMerge: props.onMerge,
                  onHoverTarget: props.onMergeHover,
                }}
                onDelete={props.onDelete}
              />
            </span>
          </Show>
        </div>
      </div>
      <Show when={props.isSelected}>
        <DraftChangesList
          members={() => props.members}
          mainDocUrl={props.mainDocUrl}
          milestones={props.milestones}
          onRenameMilestone={props.onRenameMilestone}
          onRemoveMilestone={props.onRemoveMilestone}
          onScrub={props.onScrub}
          scrubber={props.scrubber}
          onBaselineScrub={props.onBaselineScrub}
          baseliner={props.baseliner}
          eyeOpen={() => props.eyeOpen}
          checkpoint={props.checkpoint}
          onReturnToLatest={props.onReturnToLatest}
        />
      </Show>
    </div>
  );
}

// The action buttons in a selected card's title, one icon each with its
// label as the tooltip: fork at the latest heads, fork from the scrubbed
// version (only while the timeline is pinned), flag a milestone, and — on
// draft cards — merge up into the parent and delete. Hovering the merge
// button highlights the target card via `onHoverTarget`.
function CardActions(props: {
  forkDisabled?: boolean;
  onFork: () => void;
  // "Fork from Jul 24, 3:12 PM" while pinned; null hides the button.
  forkAtLabel: string | null;
  onForkAt: () => void;
  // "Flag … as a milestone": names the version (scrubbed or latest).
  flagLabel: string;
  onFlag: () => void;
  // Draft cards only: the merge-up button.
  merge?: {
    label: string;
    onMerge: () => void;
    onHoverTarget: (over: boolean) => void;
  };
  // Draft cards only: the delete button (confirmed via a dialog in the
  // handler).
  onDelete?: () => void;
}) {
  // The buttons sit inside the clickable header, so clicks must not also
  // re-select the card.
  const run = (e: MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };
  // Unhighlight the merge target if the buttons unmount mid-hover.
  onCleanup(() => props.merge?.onHoverTarget(false));

  return (
    <>
      <button
        type="button"
        class="dgr-card-action"
        disabled={props.forkDisabled}
        title={
          props.forkDisabled
            ? "Drafts aren't supported for folders yet"
            : "Fork a new draft from the latest version"
        }
        onClick={(e) => run(e, props.onFork)}
      >
        <GitBranchIcon />
      </button>
      <Show when={props.forkAtLabel}>
        {(label) => (
          <button
            type="button"
            class="dgr-card-action"
            title={`${label()} — fork a new draft from the version you're viewing`}
            onClick={(e) => run(e, props.onForkAt)}
          >
            <HistoryIcon />
          </button>
        )}
      </Show>
      <button
        type="button"
        class="dgr-card-action"
        title={`${props.flagLabel} — give it a name and mark it in the timeline`}
        onClick={(e) => run(e, props.onFlag)}
      >
        <FlagIcon />
      </button>
      <Show when={props.merge}>
        {(merge) => (
          <button
            type="button"
            class="dgr-card-action"
            title={`${merge().label} — the target card lights up`}
            onClick={(e) => run(e, merge().onMerge)}
            onMouseEnter={() => merge().onHoverTarget(true)}
            onMouseLeave={() => merge().onHoverTarget(false)}
          >
            <GitMergeIcon />
          </button>
        )}
      </Show>
      <Show when={props.onDelete}>
        {(onDelete) => (
          <button
            type="button"
            class="dgr-card-action dgr-card-action--danger"
            title="Delete this draft and any drafts forked from it"
            onClick={(e) => run(e, onDelete())}
          >
            <TrashIcon />
          </button>
        )}
      </Show>
    </>
  );
}

// "Jul 24, 3:12 PM" (with the year when it isn't the current one), for the
// fork-from-version menu item. Takes an Automerge change time (Unix SECONDS).
function formatVersionTime(timeSeconds: number): string {
  const date = new Date(timeSeconds * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function GitBranchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function GitMergeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

// A solid flag on a pole, in the milestone colour wherever it appears.
function FlagIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      class="dgr-flag-icon"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M5 22V3" fill="none" />
      <path
        d="M5 3h11.5a1 1 0 0 1 .8 1.6L15 8l2.3 3.4a1 1 0 0 1-.8 1.6H5z"
        fill="currentColor"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

// A clock rewinding: the fork-from-a-past-version item.
function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

// A card's display name. Double-click to rename inline: Enter or clicking
// away commits, Escape cancels, and committing an empty value clears the
// name back to the default label.
function DraftName(props: {
  name: string | null;
  fallback: string;
  onRename: (name: string | null) => void;
}) {
  const [editing, setEditing] = createSignal(false);
  return (
    <Show
      when={editing()}
      fallback={
        <span
          class="dgr-name"
          title="Double-click to rename"
          onDblClick={() => setEditing(true)}
        >
          {props.name ?? props.fallback}
        </span>
      }
    >
      <input
        class="dgr-name-input"
        value={props.name ?? ""}
        placeholder={props.fallback}
        // Focus once mounted; the ref fires before insertion, hence the tick.
        ref={(el) => setTimeout(() => el.select())}
        onClick={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={(e) => {
          if (!editing()) return; // already cancelled via Escape
          setEditing(false);
          const value = e.currentTarget.value.trim();
          if (value !== (props.name ?? "")) props.onRename(value || null);
        }}
      />
    </Show>
  );
}

// The diff toggle in a card title, right-aligned. Open = diff highlighting
// showing. It holds no state: open/closed is derived from the checkpoint's
// baselines and toggling rewrites them (see `toggleEye`). Disabled on a live
// main view, where there is nothing to diff against — via aria-disabled
// rather than the disabled attribute, so the explanatory tooltip still shows
// on hover (browsers don't reliably show titles on disabled buttons).
function EyeToggle(props: {
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      class="dgr-card-eye"
      data-active={props.open ? "" : undefined}
      data-disabled={props.disabled ? "" : undefined}
      aria-disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (props.disabled) return;
        props.onToggle();
      }}
      title={
        props.disabled
          ? "Nothing to compare yet — select a version in the timeline first"
          : props.open
            ? "Hide changes"
            : "Show what changed"
      }
    >
      <Show when={props.open} fallback={<EyeOffIcon />}>
        <EyeIcon />
      </Show>
    </button>
  );
}

function EyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// A reference to one change in the interleaved timeline, by document and
// hash. `time` steers how the *other* member docs' heads are resolved around
// it (see `computeCheckpoint`).
type ChangeRef = {
  docUrl: AutomergeUrl;
  hash: string;
  time: number;
};

// Where the scrubber sits: the change whose heads the view displays,
// anchored to the group it was picked in. `offset` is the change's position
// within that group, 0 = the group's newest change; `head` identifies the
// exact change for the checkpoint machinery — and, since the reader can
// re-fold the timeline under another grouping at any time, the list places
// the token by `head.hash` first and only falls back to group/offset.
// `groupStartTime` is the group's span start, carried so the checkpoint's
// diff baseline can anchor at the group's beginning while the eye is on.
type ScrubberState = {
  groupId: string;
  offset: number;
  head: ChangeRef;
  groupStartTime: number;
};

// Where the diff baseline handle sits: an absolute point in history the diff
// is measured from, independent of the head. `time` resolves each member's
// `from` (see `computeCheckpoint`); `hash` (when known) places the handle in
// the track regardless of grouping, with `groupId`/`offset` as the fallback.
// `offset` of `BASELINE_GROUP_START` means "the start of the group" — the
// changes list resolves it to the group's oldest change. Ephemeral like
// `ScrubberState`.
type BaselineState = {
  groupId: string;
  offset: number;
  time: number;
  hash?: string;
};

// Sentinel `BaselineState.offset` meaning "the group's start" (its oldest
// change / the bottom of its band), used when the eye seeds the handle before
// the group is looked up.
const BASELINE_GROUP_START = -1;

// Renders a draft's (or main's) timeline from its flat change list, folded
// under the reader's chosen grouping (see `grouping.ts`). The list is
// gathered client-side from the member docs (`timeline.ts`) and re-folded
// whenever the grouping, the attribution, or the history changes. A gutter
// on the left spans the whole history (top = latest version, bottom =
// first); the indicator — a calendar-style dot + line — marks the version
// being looked at: the dot on top of everything, the line behind the rows.
// Dragging starts only from its handles in the gutter; dragging it all the
// way to the top returns to the latest version (`onReturnToLatest`). While
// pinned, a sticker overlays the row at the head with the exact change the
// line sits on.
function DraftChangesList(props: {
  members: Accessor<DraftMemberDoc[]>;
  mainDocUrl: AutomergeUrl | undefined;
  // This timeline's milestones, drawn as markers at their versions.
  milestones: Accessor<Milestone[]>;
  onRenameMilestone: (id: string, name: string | null) => void;
  onRemoveMilestone: (id: string) => void;
  onScrub: (scrub: ScrubberState) => void;
  scrubber: Accessor<ScrubberState | null>;
  onBaselineScrub: (base: BaselineState) => void;
  baseliner: Accessor<BaselineState | null>;
  eyeOpen: Accessor<boolean>;
  // The live checkpoint (`CheckedOutDraft.at`): per-member `to`/`from`
  // heads, read for the sticker's whole-range diff counts.
  checkpoint: Accessor<DraftCheckpoint | null>;
  onReturnToLatest: () => void;
}) {
  const repo = "repo" in window ? window.repo : undefined;

  // The flat change list, kept current by the timeline source.
  const [timeline, setTimeline] = createSignal<Timeline>({
    changes: [],
    building: true,
  });
  createEffect(() => {
    const members = props.members();
    const mainDocUrl = props.mainDocUrl;
    setTimeline({ changes: [], building: true });
    if (!repo) return;
    const source = createTimelineSource(repo, members, mainDocUrl, setTimeline);
    onCleanup(() => source.dispose());
  });

  // Member doc handles, resolved once per member set — needed for the
  // sticker's diff counts and the Document mode's labels, never for the rows.
  type MemberSource = { member: DraftMemberDoc; handle: DocHandle<unknown> };
  const [sources, setSources] = createSignal<MemberSource[] | null>(null);
  createEffect(() => {
    const list = props.members();
    if (!repo) return;
    let disposed = false;
    setSources(null);
    void (async () => {
      const next: MemberSource[] = [];
      for (const member of list) {
        try {
          const handle = await repo.find<unknown>(
            member.cloneUrl ?? member.url
          );
          next.push({ member, handle });
        } catch (err) {
          console.warn(
            "[versions] failed to resolve member:",
            member,
            err
          );
        }
      }
      if (disposed) return;
      setSources(next);
    })();
    onCleanup(() => {
      disposed = true;
    });
  });

  const isBuilding = createMemo<boolean>(() => timeline().building);

  // Who is behind the actor ids: contacts by name, everyone else numbered
  // "Anon N" in order of first appearance.
  const authors = createMemo<AuthorResolver>(() =>
    resolveAuthorNames(timeline().changes, actorContacts(), contactName)
  );

  // What the Document mode calls a member: the doc's own title when it has
  // one, else its datatype, else a short form of its url. The host doc is
  // named as such so it stands out from the embedded docs.
  const memberLabel = (url: AutomergeUrl): string => {
    const src = sources()?.find((s) => s.member.url === url);
    const doc = src?.handle.doc() as Record<string, unknown> | undefined;
    // a doc's title, or a file's name (files have no title)
    const named = (key: string) =>
      doc && typeof doc[key] === "string" && (doc[key] as string).trim()
        ? (doc[key] as string).trim()
        : null;
    const title = named("title") ?? named("name");
    if (url === props.mainDocUrl) return title ?? "This document";
    const type = (doc?.["@patchwork"] as { type?: string } | undefined)?.type;
    return title ?? type ?? url.slice("automerge:".length, 18);
  };

  // The rendered groups, newest-first, re-folded on every input change.
  // Metadata-only groups (no edits) are dropped, as in `drafts`.
  const groups = createMemo<TimelineGroup[]>(() => {
    nowMs(); // time-bucket labels say "Today"; keep them honest overnight
    return groupChanges(
      timeline().changes,
      grouping(),
      authors(),
      memberLabel
    ).filter((g) => g.additions > 0 || g.deletions > 0);
  });

  // Milestones placed under the current folding, by the group they sit in.
  const groupMilestones = createMemo(() =>
    milestonesByGroup(groups(), props.milestones())
  );

  // The largest single count in the card: the scale every row's bars share.
  const maxCount = createMemo<number>(() =>
    groups().reduce((m, g) => Math.max(m, g.additions, g.deletions), 1)
  );

  // Where a change sits in the current folding, by hash. Groupings change
  // under the scrubber, so every lookup goes through here first.
  const locate = (
    hash: string
  ): { group: TimelineGroup; offset: number } | null => {
    for (const group of groups()) {
      const offset = group.rows.findIndex((r) => r.hash === hash);
      if (offset >= 0) return { group, offset };
    }
    return null;
  };

  // Expand the BASELINE_GROUP_START sentinel to the group's oldest change.
  const resolveOffset = (group: TimelineGroup, offset: number): number =>
    offset === BASELINE_GROUP_START
      ? Math.max(0, group.changeCount - 1)
      : Math.min(Math.max(0, offset), group.changeCount - 1);

  // The change at `offset` within `group` (0 = the group's newest change).
  const changeAt = (group: TimelineGroup, offset: number): TimelineChange =>
    group.rows[resolveOffset(group, offset)];

  // Build the head scrub state for `offset` within `group`.
  const buildHead = (group: TimelineGroup, offset: number): ScrubberState => {
    const row = changeAt(group, offset);
    return {
      groupId: group.id,
      offset: resolveOffset(group, offset),
      head: { docUrl: row.memberUrl, hash: row.hash, time: row.time },
      groupStartTime: group.startTime,
    };
  };

  // A position's rank in the flat change order (higher = older), so the head
  // and baseline can be compared for clamping. Hash first; group/offset when
  // the hash isn't known (the eye's seeded baseline).
  const linearIndex = (
    groupId: string,
    offset: number,
    hash?: string
  ): number => {
    let acc = 0;
    const found = hash ? locate(hash) : null;
    for (const g of groups()) {
      if (found ? g.id === found.group.id : g.id === groupId) {
        return acc + (found ? found.offset : resolveOffset(g, offset));
      }
      acc += g.changeCount;
    }
    return acc + Math.max(0, offset);
  };

  // Move the head to `offset` within `group`. With the eye open the baseline
  // stays put (absolute), except that dragging the head older than the
  // baseline pushes the baseline down with it — they can meet but not cross.
  // The baseline is pushed first so the diff never momentarily inverts.
  const scrubTo = (group: TimelineGroup, offset: number) => {
    if (group.rows.length === 0) return;
    const head = buildHead(group, offset);
    if (props.eyeOpen()) {
      const bl = props.baseliner();
      if (
        bl &&
        linearIndex(head.groupId, head.offset, head.head.hash) >
          linearIndex(bl.groupId, bl.offset, bl.hash)
      ) {
        props.onBaselineScrub({
          groupId: group.id,
          offset: head.offset,
          time: head.head.time,
          hash: head.head.hash,
        });
      }
    }
    props.onScrub(head);
  };

  // Select a group (click on its row): the head pins to the group's newest
  // change and the baseline anchors to the group's start, so the diff reads
  // "everything this group changed" — the eye opens by itself (its state is
  // derived from the checkpoint's `from`s). Dragging the head, by contrast,
  // leaves the baseline where it is (see `scrubTo`).
  const selectGroup = (group: TimelineGroup) => {
    const oldest = group.rows[group.rows.length - 1];
    props.onBaselineScrub({
      groupId: group.id,
      offset: BASELINE_GROUP_START,
      time: group.startTime,
      hash: oldest?.hash,
    });
    scrubTo(group, 0);
  };

  // Move the baseline to `offset` within `group`, clamped so it never crosses
  // above (newer than) the head — the diff always reads old -> new. When the
  // clamp bites, the baseline snaps to the head (an empty diff).
  const baselineScrubTo = (group: TimelineGroup, offset: number) => {
    const head = props.scrubber();
    if (!head) return;
    const row = changeAt(group, offset);
    if (
      linearIndex(group.id, offset, row.hash) <
      linearIndex(head.groupId, head.offset, head.head.hash)
    ) {
      props.onBaselineScrub({
        groupId: head.groupId,
        offset: head.offset,
        time: head.head.time,
        hash: head.head.hash,
      });
      return;
    }
    props.onBaselineScrub({
      groupId: group.id,
      offset: resolveOffset(group, offset),
      time: row.time,
      hash: row.hash,
    });
  };

  // --- Scrubber geometry ---------------------------------------------------
  // The track mirrors the rows column: each group row is one vertical band,
  // and the group's changes distribute evenly across the band's height, so
  // every individual change — including ones in the middle of a group — is a
  // valid stop for the token, not just group boundaries.
  const rowEls = new Map<string, HTMLElement>();
  // Milestone markers, by milestone id: each is a band of its own in the
  // track (see `bands`), so the head can rest on the flag itself.
  const milestoneEls = new Map<string, HTMLElement>();
  const [rowsEl, setRowsEl] = createSignal<HTMLDivElement>();
  // Bumped after layout changes so `bands` re-measures the rendered rows.
  const [measureTick, setMeasureTick] = createSignal(0);

  createEffect(() => {
    const el = rowsEl();
    if (!el) return;
    const observer = new ResizeObserver(() => setMeasureTick((t) => t + 1));
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  // Rows and markers render after the groups memo recomputes, so measure
  // again on the next frame once the DOM has settled.
  createEffect(() => {
    groups();
    groupMilestones();
    requestAnimationFrame(() => setMeasureTick((t) => t + 1));
  });

  // A band in the track: a group row (its changes spread down its height),
  // or a milestone marker, which stands for exactly one change (`offset`
  // within `group`) — the flag is that moment, so the head rests on the
  // marker's middle rather than somewhere inside the row below it.
  type Band = {
    group: TimelineGroup;
    top: number;
    height: number;
    milestone?: Milestone;
    offset?: number;
  };
  const bands = createMemo<Band[]>(() => {
    measureTick();
    const out: Band[] = [];
    for (const group of groups()) {
      for (const milestone of groupMilestones().get(group.id) ?? []) {
        const el = milestoneEls.get(milestone.id);
        const offset = group.rows.findIndex(
          (r) => r.hash === milestone.head.hash
        );
        if (el && offset >= 0) {
          out.push({
            group,
            top: el.offsetTop,
            height: el.offsetHeight,
            milestone,
            offset,
          });
        }
      }
      const el = rowEls.get(group.id);
      if (el) {
        out.push({ group, top: el.offsetTop, height: el.offsetHeight });
      }
    }
    return out;
  });

  // A scrub position's y in the track: offsets interpolate across their
  // group's band; a milestone band is one point, its vertical middle (level
  // with the flag and name).
  const yForPosition = (band: Band, offset: number): number => {
    if (band.milestone) return band.top + band.height / 2;
    const count = Math.max(1, band.group.changeCount);
    return band.top + (Math.min(offset, count - 1) / count) * band.height;
  };

  // Inverse: the (group, offset) position nearest a pointer y (in track
  // coordinates). Over a milestone marker (or the space above it) the
  // position is the flagged change.
  const positionForY = (
    y: number
  ): { group: TimelineGroup; offset: number } | null => {
    const bs = bands();
    if (bs.length === 0) return null;
    for (const b of bs) {
      if (b.milestone) {
        if (y < b.top + b.height) return { group: b.group, offset: b.offset! };
        continue;
      }
      if (y < b.top) return { group: b.group, offset: 0 };
      if (y < b.top + b.height) {
        const count = Math.max(1, b.group.changeCount);
        const offset = Math.min(
          Math.round(((y - b.top) / b.height) * count),
          count - 1
        );
        return { group: b.group, offset };
      }
    }
    const last = bs[bs.length - 1];
    return {
      group: last.group,
      offset: Math.max(0, last.group.changeCount - 1),
    };
  };

  // The band and offset a scrub/baseline position maps to under the current
  // folding: by hash when known, else by the group it was picked in (whose
  // id survives a re-fold only if the same change still heads it), else by
  // time.
  const bandFor = (
    hash: string | undefined,
    groupId: string,
    offset: number,
    time: number
  ): { band: Band; offset: number } | null => {
    const bs = bands();
    // A flagged change sits on its marker, not inside its row.
    const flagged = hash
      ? bs.find((b) => b.milestone && b.milestone.head.hash === hash)
      : undefined;
    if (flagged) return { band: flagged, offset: flagged.offset! };
    const found = hash ? locate(hash) : null;
    if (found) {
      const band = bs.find((b) => b.group.id === found.group.id && !b.milestone);
      return band ? { band, offset: found.offset } : null;
    }
    const byId = bs.find((b) => b.group.id === groupId && !b.milestone);
    if (byId) return { band: byId, offset: resolveOffset(byId.group, offset) };
    const byTime = bs.find(
      (b) =>
        !b.milestone && time >= b.group.startTime && time <= b.group.endTime
    );
    if (!byTime) return null;
    const i = byTime.group.rows.findIndex((r) => r.time <= time);
    return { band: byTime, offset: i < 0 ? 0 : i };
  };

  // The indicator's pixel position: the head line's y in the track. The
  // zero-height box is fine — the dot and line overflow it and stay
  // grabbable. With nothing pinned it idles at the very top — you're looking
  // at the live latest.
  const tokenGeometry = createMemo(() => {
    const bs = bands();
    if (bs.length === 0) return null;
    const s = props.scrubber();
    if (!s) return { top: bs[0].top };
    const pos = bandFor(s.head.hash, s.groupId, s.offset, s.head.time);
    if (!pos) return { top: bs[0].top };
    return { top: yForPosition(pos.band, pos.offset) };
  });

  // The baseline handle's y in the track, or null when it should not show:
  // only while the eye is open and a version is pinned (a head is set). Idle
  // on the latest version there is no baseline to drag.
  const baselineGeometry = createMemo(() => {
    if (!props.eyeOpen() || !props.scrubber()) return null;
    const b = props.baseliner();
    if (!b) return null;
    const pos = bandFor(b.hash, b.groupId, b.offset, b.time);
    if (!pos) return null;
    return { top: yForPosition(pos.band, pos.offset) };
  });

  let trackEl: HTMLDivElement | undefined;

  // Pointer y relative to the track's top edge. The rect is re-read per event
  // so scrolling the card mid-drag stays accurate.
  const yInTrack = (ev: PointerEvent): number => {
    const rect = trackEl!.getBoundingClientRect();
    return ev.clientY - rect.top;
  };

  // Begin an indicator drag: the head follows the pointer. Grabbing one of
  // the indicator's own handles (dot, line) keeps the grab point under the
  // pointer; pressing the bare gutter (`jumpToPointer`) lands the head where
  // you pressed and scrubs from there. The rows themselves don't scrub.
  // Every position snaps to an individual change, so the indicator can rest
  // anywhere in history — between groups or in the middle of one. Dragging
  // all the way to the top (the newest change) means "return to the latest
  // version": it drops the pin rather than freezing at the newest change.
  const beginDrag = (ev: PointerEvent, jumpToPointer = false) => {
    if (!trackEl || bands().length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const grabOffset = jumpToPointer
      ? 0
      : yInTrack(ev) - (tokenGeometry()?.top ?? 0);

    const s = props.scrubber();
    let last = s ? `${s.groupId}:${s.offset}` : null;
    const onMove = (e: PointerEvent) => {
      const pos = positionForY(yInTrack(e) - grabOffset);
      if (!pos) return;
      const key = `${pos.group.id}:${pos.offset}`;
      if (key === last) return;
      last = key;
      const first = bands()[0];
      if (first && pos.group.id === first.group.id && pos.offset === 0) {
        props.onReturnToLatest();
      } else {
        scrubTo(pos.group, pos.offset);
      }
    };
    // A gutter press must land before any movement, so a plain click jumps.
    if (jumpToPointer) onMove(ev);

    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  // Begin a baseline-handle drag: the baseline follows the pointer, clamped so
  // it never crosses above the head (see `baselineScrubTo`). Unlike the head,
  // it has no return-to-latest gesture — the baseline is only meaningful while
  // pinned, so there is nowhere at the top to drop it.
  const beginBaselineDrag = (ev: PointerEvent) => {
    if (!trackEl || bands().length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const grabOffset = yInTrack(ev) - (baselineGeometry()?.top ?? 0);

    let last: string | null = null;
    const onMove = (e: PointerEvent) => {
      const pos = positionForY(yInTrack(e) - grabOffset);
      if (!pos) return;
      const key = `${pos.group.id}:${pos.offset}`;
      if (key === last) return;
      last = key;
      baselineScrubTo(pos.group, pos.offset);
    };

    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  // The exact change the scrubber head sits on; feeds the sticker that
  // overlays the group row with the version being looked at. Suppressed when
  // the head sits exactly on a group's newest change (the row already shows
  // that version).
  const headChange = createMemo<TimelineChange | null>(() => {
    const s = props.scrubber();
    if (!s) return null;
    // On a milestone the marker itself names the version.
    if (props.milestones().some((m) => m.head.hash === s.head.hash)) {
      return null;
    }
    const pos = locate(s.head.hash);
    if (!pos || pos.offset === 0) return null;
    return pos.group.rows[pos.offset];
  });

  // The sticker's +/- counts. With the eye open they cover the whole diff
  // range — each member diffed from the checkpoint's `from` (the baseline)
  // to its `to` (the head), summed — so extending the baseline grows them.
  // With the eye closed there is no range, so they fall back to the single
  // change under the head.
  const headCounts = createMemo(() => {
    const change = headChange();
    if (!change) return null;
    const srcs = sources();
    if (props.eyeOpen()) {
      const at = props.checkpoint();
      if (at && srcs) {
        let additions = 0;
        let deletions = 0;
        let spans = 0;
        for (const { member, handle } of srcs) {
          const entry = at[member.url];
          if (!entry?.from || !entry.to) continue;
          const doc = handle.doc() as Automerge.Doc<unknown> | undefined;
          if (!doc) continue;
          spans++;
          const counts = computeRangeEditCounts(
            doc,
            decodeHeads(entry.from),
            decodeHeads(entry.to)
          );
          additions += counts.additions;
          deletions += counts.deletions;
        }
        if (spans > 0) return { additions, deletions };
      }
    }
    return { additions: change.additions, deletions: change.deletions };
  });

  return (
    <div class="dgr-card-changes">
      <Show
        when={groups().length > 0}
        fallback={
          <Show
            when={isBuilding()}
            fallback={<div class="dgr-changes-empty">No changes yet.</div>}
          >
            <div class="dgr-changes-building">
              <span class="dgr-building-spinner" />
              Building history…
            </div>
          </Show>
        }
      >
        <div class="dgr-changes-body">
          <div
            class="dgr-scrubber"
            ref={trackEl}
            title="Click or drag anywhere in the gutter to scrub through history"
            onPointerDown={(ev) => beginDrag(ev, true)}
          />
          <div class="dgr-changes-rows" ref={setRowsEl}>
            <For each={groups()}>
              {(group, i) => {
                const prev = () => (i() > 0 ? groups()[i() - 1] : null);
                const gap = () => {
                  const p = prev();
                  return p ? lullSpacing(p.startTime - group.endTime) : 0;
                };
                // A day heading sits between two rows whenever the calendar
                // day changes going down the list — unless the rows already
                // say the day themselves (Time mode at day/week resolution).
                // Where there is a heading, the lull spacing is dropped: the
                // heading marks the break, and a long silence shouldn't open
                // a gap above it as well.
                const dayBreak = () => {
                  const p = prev();
                  if (!p || !sameDay(p.startTime, group.endTime)) {
                    if (!p) return false;
                    const { mode, resolution } = grouping();
                    return !(
                      mode === "time" &&
                      (resolution === "day" || resolution === "week")
                    );
                  }
                  return false;
                };
                return (
                  <>
                    {/* A day heading is the break: it carries no lull
                        spacing of its own, so the row above runs straight
                        into it and the next day's rows start right under. */}
                    <Show when={dayBreak()}>
                      <div class="dgr-day-divider">
                        <span class="dgr-day-divider-label">
                          {dayLabel(group.endTime, nowMs())}
                        </span>
                      </div>
                    </Show>
                    {/* Flagged versions in this group, each a marker
                        above the row; clicking one shows that exact
                        version. */}
                    <For each={groupMilestones().get(group.id) ?? []}>
                      {(milestone) => (
                        <MilestoneMarker
                          milestone={milestone}
                          selected={
                            props.scrubber()?.head.hash === milestone.head.hash
                          }
                          markerRef={(el) => milestoneEls.set(milestone.id, el)}
                          onSelect={() => {
                            const pos = locate(milestone.head.hash);
                            if (pos) scrubTo(pos.group, pos.offset);
                          }}
                          onRename={(name) =>
                            props.onRenameMilestone(milestone.id, name)
                          }
                          onRemove={() => props.onRemoveMilestone(milestone.id)}
                        />
                      )}
                    </For>
                    <GroupRow
                      group={group}
                      mode={grouping().mode}
                      resolution={grouping().resolution}
                      authors={authors()}
                      maxCount={maxCount()}
                      gap={dayBreak() ? 0 : gap()}
                      rowRef={(el) => rowEls.set(group.id, el)}
                      onSelect={() => selectGroup(group)}
                    />
                  </>
                );
              }}
            </For>
            <Show when={isBuilding()}>
              <div class="dgr-changes-building">
                <span class="dgr-building-spinner" />
                Building history…
              </div>
            </Show>
          </div>
          {/* A dot in the gutter at each milestone, so the flagged versions
              read as stops on the track (the head rests exactly on them). */}
          <For each={bands().filter((b) => b.milestone)}>
            {(band) => (
              <div
                class="dgr-scrubber-stop"
                style={{ top: `${yForPosition(band, 0)}px` }}
                title={band.milestone!.name}
              />
            )}
          </For>
          <Show when={tokenGeometry()}>
            <div
              class="dgr-scrubber-token"
              style={{ top: `${tokenGeometry()!.top}px` }}
            >
              {/* The head line, painted behind the group rows. */}
              <div class="dgr-scrubber-line" />
              {/* Grab handle, confined to the gutter. */}
              <div
                class="dgr-scrubber-edge"
                title="Drag to scrub through history — drop at the top to return to the latest version"
                onPointerDown={beginDrag}
              />
              <div
                class="dgr-scrubber-dot"
                title="Drag to scrub through history — drop at the top to return to the latest version"
                onPointerDown={beginDrag}
              />
              {/* Pinned inside a group: overlay the row with the exact
                  version the head sits on (the card's Fork button forks
                  from it). */}
              <Show when={headChange()}>
                {(change) => (
                  <div
                    class="dgr-scrubber-sticker"
                    title="The version being viewed — Fork below to branch from here"
                  >
                    <EditCounts
                      additions={headCounts()?.additions ?? 0}
                      deletions={headCounts()?.deletions ?? 0}
                      max={maxCount()}
                    />
                    <span class="dgr-sticker-author">
                      {authors().authorName(
                        authors().authorKey(change().actor)
                      )}
                    </span>
                    <span class="dgr-sticker-time">
                      {whenPhrase(change().time, nowMs())}
                    </span>
                  </div>
                )}
              </Show>
            </div>
          </Show>
          {/* The diff baseline: a second handle (line + hollow circle) shown
              only with the eye open and a version pinned. Independent of the
              head — dragging it re-anchors the diff's older bound — and joined
              to the head by a connector so the two read as one range. */}
          <Show when={baselineGeometry()}>
            <div
              class="dgr-scrubber-connector"
              style={{
                top: `${Math.min(tokenGeometry()?.top ?? 0, baselineGeometry()!.top)}px`,
                height: `${Math.abs((tokenGeometry()?.top ?? 0) - baselineGeometry()!.top)}px`,
              }}
            />
            <div
              class="dgr-scrubber-token dgr-scrubber-token--baseline"
              style={{ top: `${baselineGeometry()!.top}px` }}
            >
              <div class="dgr-scrubber-line" />
              <div
                class="dgr-scrubber-edge"
                title="Drag to move the diff baseline"
                onPointerDown={beginBaselineDrag}
              />
              <div
                class="dgr-scrubber-baseline"
                title="Drag to move the diff baseline"
                onPointerDown={beginBaselineDrag}
              />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// A flagged version: a flag, its name in bold (double-click to rename), a
// × beside it on hover that removes the flag (after a confirm), and when it
// was, right-aligned like the rows' times. Clicking it shows that exact
// version.
function MilestoneMarker(props: {
  milestone: Milestone;
  // True while the scrubber head rests on this milestone's version.
  selected: boolean;
  markerRef: (el: HTMLElement) => void;
  onSelect: () => void;
  onRename: (name: string | null) => void;
  onRemove: () => void;
}) {
  return (
    <div
      class="dgr-milestone"
      data-selected={props.selected ? "" : undefined}
      ref={props.markerRef}
      title="A flagged version — click to view it, double-click the name to rename"
      onClick={props.onSelect}
    >
      <span class="dgr-milestone-flag">
        <FlagIcon />
      </span>
      <span class="dgr-milestone-name">
        <DraftName
          name={props.milestone.name}
          fallback="Milestone"
          onRename={props.onRename}
        />
      </span>
      <button
        type="button"
        class="dgr-milestone-remove"
        title="Remove this milestone"
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
      >
        ×
      </button>
      <span class="dgr-milestone-time">
        {whenPhrase(props.milestone.head.time, nowMs())}
      </span>
    </div>
  );
}

// One group, rendered as a single non-expandable row in three columns: the
// aggregated +/- counts, the authors (avatars and names, plus "in" the
// document in Document mode), and the date and time ("Tue 28 Oct, 14:40":
// the bucket's time in Time mode, the group's newest change otherwise). Clicking the row parks the scrubber at the
// top of the group (the scrubber token is the selection indicator — the row
// itself doesn't highlight). `gap` is the extra air above the row for the
// lull since the row above (see `lullSpacing`), so a pause reads as a pause
// without the list claiming where one sitting ended and the next began.
function GroupRow(props: {
  group: TimelineGroup;
  mode: GroupMode;
  resolution: TimeResolution;
  authors: AuthorResolver;
  // Scale for the count bars (the card's largest count).
  maxCount: number;
  gap: number;
  rowRef: (el: HTMLElement) => void;
  onSelect: () => void;
}) {
  const title = () =>
    `${props.group.changeCount} change${props.group.changeCount === 1 ? "" : "s"} by ${props.group.authors
      .map(props.authors.authorName)
      .join(", ")} — click to view the draft as of this group`;
  return (
    <button
      type="button"
      class="dgr-group-row"
      data-mode={props.mode}
      style={{ "margin-top": props.gap > 0 ? `${props.gap}px` : undefined }}
      ref={props.rowRef}
      title={title()}
      onClick={props.onSelect}
    >
      {/* The row reads left to right in three columns: "+X -Y" on the far
          left, the person (and "in DOCUMENT") in the middle, the date and
          time ("Tue 28 Oct, 14:40") on the far right. The name gives way first when the row is
          narrow; the counts and time stay whole. */}
      <EditCounts
        additions={props.group.additions}
        deletions={props.group.deletions}
        max={props.maxCount}
      />
      <AuthorAvatars authors={props.group.authors} names={props.authors} />
      <span class="dgr-group-author">
        {authorsPhrase(props.group.authors, props.authors)}
      </span>
      <Show when={props.mode === "document" && props.group.label}>
        <span class="dgr-group-word">in</span>
        <span class="dgr-group-label">{props.group.label}</span>
      </Show>
      <span class="dgr-group-time">
        {whenPhrase(
          props.group.endTime,
          nowMs(),
          props.mode === "time" ? props.resolution : "exact"
        )}
      </span>
    </button>
  );
}

// A stack of author avatars, newest-contributor first. Authors with a known
// contact embed the contact tool's own avatar view (image or name initials —
// see account/src/contact/InlineContactAvatar.ts); anonymous authors get a
// coloured circle with their number ("A1", "A2", …) and their name as the
// tooltip.
function AuthorAvatars(props: { authors: string[]; names: AuthorResolver }) {
  const visible = () => props.authors.slice(0, 3);
  const extra = () => Math.max(0, props.authors.length - 3);
  return (
    <div class="dgr-avatars">
      <For each={visible()}>
        {(key, i) => {
          const contact = isValidAutomergeUrl(key) ? key : null;
          return (
            <div
              class="dgr-avatar"
              // Attributed avatars carry their own name tooltip (set by the
              // embedded contact view); the fallback names the author.
              title={contact ? undefined : props.names.authorName(key)}
              style={{
                background: contact ? undefined : authorColor(key),
                "margin-left": i() === 0 ? "0" : "-4px",
                "z-index": String(visible().length - i()),
              }}
            >
              <Show
                when={contact}
                fallback={authorInitials(props.names.authorName(key))}
              >
                <patchwork-view doc-url={contact!} tool-id="contact-inline" />
              </Show>
            </div>
          );
        }}
      </For>
      <Show when={extra() > 0}>
        <div class="dgr-avatar dgr-avatar--extra">+{extra()}</div>
      </Show>
    </div>
  );
}

// The +N / -N edit-size counts that open a group row, each over a bar
// sized against `max` (the largest count in the card) on a square-root
// scale, so a small edit still shows a sliver next to a big paste. Both
// slots always render, so the two bars share one scale down the list; a
// zero count is an empty slot.
function EditCounts(props: { additions: number; deletions: number; max: number }) {
  const size = (n: number) =>
    n > 0 ? Math.max(0.06, Math.min(1, Math.sqrt(n / Math.max(1, props.max)))) : 0;
  return (
    <span class="dgr-counts">
      <span
        class="dgr-count dgr-count--add"
        style={{ "--dgr-size": String(size(props.additions)) }}
      >
        {props.additions > 0 ? `+${props.additions}` : ""}
      </span>
      <span
        class="dgr-count dgr-count--del"
        style={{ "--dgr-size": String(size(props.deletions)) }}
      >
        {props.deletions > 0 ? `-${props.deletions}` : ""}
      </span>
    </span>
  );
}

// The panel's grouping controls: which way to fold the history, and the
// bucket size when folding by time. The choice is the reader's, not the
// document's, so it is remembered per browser rather than written to a doc.
function GroupingPicker() {
  const mode = () => grouping().mode;
  return (
    <div
      class="dgr-grouping"
      title={GROUP_MODES.find((m) => m.value === mode())?.hint}
    >
      <label class="dgr-grouping-field">
        <span class="dgr-grouping-caption">group by</span>
        <select
          class="dgr-grouping-select"
          value={mode()}
          onChange={(e) =>
            setGrouping({
              ...grouping(),
              mode: e.currentTarget.value as GroupMode,
            })
          }
        >
          <For each={GROUP_MODES}>
            {(m) => (
              <option value={m.value} title={m.hint}>
                {m.label}
              </option>
            )}
          </For>
        </select>
      </label>
      <Show when={mode() === "time"}>
        <label class="dgr-grouping-field">
          <span class="dgr-grouping-caption">every</span>
          <select
            class="dgr-grouping-select"
            value={grouping().resolution}
            onChange={(e) =>
              setGrouping({
                ...grouping(),
                resolution: e.currentTarget.value as TimeResolution,
              })
            }
          >
            <For each={TIME_RESOLUTIONS}>
              {(r) => <option value={r.value}>{r.label}</option>}
            </For>
          </select>
        </label>
      </Show>
    </div>
  );
}
// The newest change across `members` (by time, then causal order), as a
// head for flagging the live version. Null when nothing has changed yet.
async function latestHead(
  repo: Repo,
  members: DraftMemberDoc[]
): Promise<ChangeRef | null> {
  let best: ChangeRef | null = null;
  for (const member of members) {
    try {
      const handle = await repo.find<unknown>(member.cloneUrl ?? member.url);
      const doc = handle.doc();
      if (!doc) continue;
      const since = member.clonedAt ? decodeHeads(member.clonedAt) : [];
      const metas = Automerge.getChangesMetaSince(doc, since);
      const last = metas[metas.length - 1];
      if (last && (!best || last.time >= best.time)) {
        best = { docUrl: member.url, hash: last.hash, time: last.time };
      }
    } catch (err) {
      console.warn("[versions] failed to read latest change:", member, err);
    }
  }
  return best;
}

// Diff baseline mode for a checkpoint. `"none"` writes no `from` (no diff);
// `{ beforeTime }` anchors each member's `from` at its state just before that
// absolute time — the draggable baseline handle's position — so everything
// from there up to the head reads as the diff. The baseline is independent of
// the head (see `onScrub`/`onBaselineScrub`): the two are resolved separately
// and only clamped so the baseline stays at or older than the head.
type CheckpointBase = "none" | { beforeTime: number };

// Build the checkpoint map for a scrub position. Each member's displayed
// version (`to`) is its heads as of `head`: the doc that owns that change is
// pinned exactly to it, every other member to its latest change at or before
// it (approximate but good enough). The diff baseline (`from`) follows
// `base`: omitted for `"none"`, or the member's heads just before
// `beforeTime` (falling back to the fork point — empty heads on main — when
// no post-fork change precedes it). Members with no change at or before
// `head` are omitted entirely: they didn't exist yet, so they fall through to
// live.
async function computeCheckpoint(
  repo: Repo,
  members: DraftMemberDoc[],
  head: ChangeRef,
  base: CheckpointBase
): Promise<DraftCheckpoint> {
  const checkpoint: DraftCheckpoint = {};
  for (const member of members) {
    try {
      const handle = await repo.find<unknown>(member.cloneUrl ?? member.url);
      const doc = handle.doc();
      if (!doc) continue;
      const since = member.clonedAt ? decodeHeads(member.clonedAt) : [];
      const metas = Automerge.getChangesMetaSince(doc, since);

      // Displayed version: exactly the head change for the doc that owns it,
      // otherwise the member's latest change at or before it.
      let to: UrlHeads;
      if (member.url === head.docUrl) {
        // Pin the head's doc exactly even if it falls outside the metas
        // window (robust against a mismatched fork point).
        to = encodeHeads([head.hash]);
      } else {
        let pinnedIndex = -1;
        let bestTime = -Infinity;
        metas.forEach((m, i) => {
          if (m.time <= head.time && m.time >= bestTime) {
            bestTime = m.time;
            pinnedIndex = i;
          }
        });
        if (pinnedIndex < 0) continue;
        to = encodeHeads([metas[pinnedIndex].hash]);
      }

      if (base === "none") {
        checkpoint[member.url] = { to };
        continue;
      }

      // Diff baseline: the member's newest change strictly before the
      // baseline's time. None post-fork means the baseline sits at or before
      // the start of the member's history in this timeline, so diff against
      // the fork point (empty heads on main — the whole doc reads as added).
      let fromIndex = -1;
      let fromTime = -Infinity;
      metas.forEach((m, i) => {
        if (m.time < base.beforeTime && m.time >= fromTime) {
          fromTime = m.time;
          fromIndex = i;
        }
      });
      const from =
        fromIndex >= 0
          ? encodeHeads([metas[fromIndex].hash])
          : (member.clonedAt ?? encodeHeads([]));
      checkpoint[member.url] = { from, to };
    } catch (err) {
      console.warn(
        "[versions] failed to compute checkpoint for member:",
        member,
        err
      );
    }
  }
  return checkpoint;
}

// ---- Author attribution ----------------------------------------------------
// Module-level, like the `nowMs` ticker below: attribution (actor id ->
// contact url) is globally true, not per host doc, so one merged store can
// serve every card and survive doc switches. Fed by the sidebar's
// attribution-doc subscription. Avatars are delegated to the contact tool
// (`tool-id="contact-inline"`); names are read off the contact docs here so
// the Author grouping and the tooltips can print them.

const [actorContacts, setActorContacts] = createSignal<
  Record<string, AutomergeUrl>
>({});

// Contact names by contact url, loaded lazily the first time a timeline
// asks. `null` is a contact with no name (an anonymous contact doc, or one
// that failed to load) — those authors get numbered like unattributed ones.
const [contactNames, setContactNames] = createSignal<
  Record<string, string | null>
>({});
const contactLoads = new Set<string>();

function contactName(url: AutomergeUrl): string | null {
  const names = contactNames();
  if (url in names) return names[url];
  loadContactName(url);
  return null;
}

function loadContactName(url: AutomergeUrl): void {
  if (contactLoads.has(url)) return;
  contactLoads.add(url);
  const repo: Repo | undefined = "repo" in window ? window.repo : undefined;
  if (!repo) return;
  void repo.find<{ name?: unknown }>(url).then(
    (handle) => {
      const update = () => {
        const doc = handle.doc();
        const name =
          doc && typeof doc.name === "string" && doc.name.trim()
            ? doc.name.trim()
            : null;
        setContactNames((prev) =>
          prev[url] === name ? prev : { ...prev, [url]: name }
        );
      };
      handle.on("change", update);
      update();
    },
    (err) => {
      console.warn("[versions] failed to load contact:", url, err);
      setContactNames((prev) => ({ ...prev, [url]: null }));
    }
  );
}

// A stable-ish color for an author, so the same person reads the same across
// rows. Keyed by the author key (contact url or actor id).
function authorColor(authorKey: string): string {
  let hash = 0;
  for (let i = 0; i < authorKey.length; i++) {
    hash = authorKey.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 45%, 63%)`;
}

// ---- Grouping choice -------------------------------------------------------
// The reader's pick of how to fold the history, shared by every card and
// remembered per browser (it is a way of looking, not a fact about the doc).

const GROUPING_STORAGE_KEY = "versions:grouping";
// where it was kept while this was drafts-grouped: moved on first read
const OLD_GROUPING_STORAGE_KEY = "drafts-grouped:grouping";

function loadGrouping(): Grouping {
  try {
    const old = localStorage.getItem(OLD_GROUPING_STORAGE_KEY);
    if (old !== null) {
      if (localStorage.getItem(GROUPING_STORAGE_KEY) === null)
        localStorage.setItem(GROUPING_STORAGE_KEY, old);
      localStorage.removeItem(OLD_GROUPING_STORAGE_KEY);
    }
    const raw = localStorage.getItem(GROUPING_STORAGE_KEY);
    if (!raw) return DEFAULT_GROUPING;
    const parsed = JSON.parse(raw) as Partial<Grouping>;
    const mode = GROUP_MODES.some((m) => m.value === parsed.mode)
      ? (parsed.mode as GroupMode)
      : DEFAULT_GROUPING.mode;
    const resolution = TIME_RESOLUTIONS.some(
      (r) => r.value === parsed.resolution
    )
      ? (parsed.resolution as TimeResolution)
      : DEFAULT_GROUPING.resolution;
    return { mode, resolution };
  } catch {
    return DEFAULT_GROUPING;
  }
}

const [grouping, setGroupingSignal] = createSignal<Grouping>(loadGrouping());

function setGrouping(next: Grouping): void {
  setGroupingSignal(next);
  try {
    localStorage.setItem(GROUPING_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: the choice just won't survive reload.
  }
}

// Ticks so "today"/"yesterday" in the rows and day headings stay fresh while
// the panel is open. Module-level: one timer serves every row of every card,
// and it lives as long as the module does.
const [nowMs, setNowMs] = createSignal(Date.now());
setInterval(() => setNowMs(Date.now()), 30_000);

