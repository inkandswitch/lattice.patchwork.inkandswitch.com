import type { AutomergeUrl } from "@automerge/automerge-repo/slim";
import type { Milestone } from "./draft-types.js";

// Client-side grouping of a timeline's changes. Unlike `drafts`, which reads
// precomputed groups from the persisted ChangeGroupDoc (one fixed split on
// ten-minute lulls), this tool keeps the flat change list in memory and
// re-folds it on demand under whichever grouping the reader picks. The
// persisted group doc is left alone — the providers still maintain it for
// the `drafts` tool, and the two can be installed side by side.

// One change in a timeline, interleaved across the draft's member docs, with
// its edit counts already resolved. `seq` is the change's causal index within
// its member doc, used only to break same-second timestamp ties.
export type TimelineChange = {
  memberUrl: AutomergeUrl;
  hash: string;
  time: number; // seconds (automerge change time)
  actor: string;
  seq: number;
  deps: string[];
  additions: number;
  deletions: number;
};

export type GroupMode = "activity" | "time" | "author" | "document";

export type TimeResolution = "minute" | "hour" | "day" | "week";

export type Grouping = {
  mode: GroupMode;
  // Only read in `time` mode.
  resolution: TimeResolution;
};

export const DEFAULT_GROUPING: Grouping = { mode: "document", resolution: "hour" };

export const GROUP_MODES: { value: GroupMode; label: string; hint: string }[] = [
  {
    value: "activity",
    label: "activity",
    hint: "bursts of editing, split by pauses of ten minutes or more",
  },
  {
    value: "time",
    label: "time",
    hint: "fixed calendar buckets · pick how long alongside",
  },
  {
    value: "author",
    label: "author",
    hint: "runs of changes by the same person",
  },
  {
    value: "document",
    label: "file",
    hint: "runs of changes in the same file",
  },
];

export const TIME_RESOLUTIONS: { value: TimeResolution; label: string }[] = [
  { value: "minute", label: "1 minute" },
  { value: "hour", label: "1 hour" },
  { value: "day", label: "1 day" },
  { value: "week", label: "1 week" },
];

// The activity split: a pause longer than this between consecutive changes
// starts a new group. Same value as `drafts`, so the Activity mode reads the
// same as that tool's timeline.
export const INACTIVITY_GAP_MS = 10 * 60 * 1000;

// A group of consecutive changes as the timeline renders it. `rows` is the
// group's changes, newest first — the scrubber indexes straight into it, so
// there is no on-demand scan to keep in step with a persisted count.
export type TimelineGroup = {
  id: string; // `tg-${newestHash}` — stable across re-folds of the same list
  rows: TimelineChange[];
  startTime: number;
  endTime: number;
  newestMemberUrl: AutomergeUrl;
  newestHash: string;
  // Author keys (contact url when attributed, actor id otherwise), deduped,
  // newest contributor first.
  authors: string[];
  additions: number;
  deletions: number;
  changeCount: number;
  // Mode-specific caption for the row: the time bucket's label, the author's
  // name, or the document; null for Activity (the row shows the time).
  label: string | null;
};

// Everything grouping needs to know about the people behind the actor ids.
// `authorKey` collapses one person's many actor ids (one per device/session)
// into a single key; `authorName` is what a row prints for that key.
export type AuthorResolver = {
  authorKey: (actor: string) => string;
  authorName: (key: string) => string;
};

// Newest first by timestamp, per-doc causal order breaking same-second ties.
export function newestFirst(a: TimelineChange, b: TimelineChange): number {
  return b.time - a.time || b.seq - a.seq;
}

// Fold a newest-first change list into groups under `grouping`. Every mode
// keeps the list's order: groups are consecutive runs, so the scrubber reads
// top = latest, bottom = first whatever the mode.
export function groupChanges(
  changesNewestFirst: TimelineChange[],
  grouping: Grouping,
  authors: AuthorResolver,
  memberLabel: (memberUrl: AutomergeUrl) => string,
  now: number = Date.now()
): TimelineGroup[] {
  const runs = splitRuns(changesNewestFirst, grouping, authors);
  return runs.map((rows) => {
    const newest = rows[0];
    const oldest = rows[rows.length - 1];
    let additions = 0;
    let deletions = 0;
    const authorKeys: string[] = [];
    for (const row of rows) {
      additions += row.additions;
      deletions += row.deletions;
      const key = authors.authorKey(row.actor);
      if (!authorKeys.includes(key)) authorKeys.push(key);
    }
    let label: string | null = null;
    switch (grouping.mode) {
      case "time":
        label = bucketLabel(newest.time, grouping.resolution, now);
        break;
      case "author":
        label = authors.authorName(authorKeys[0]);
        break;
      case "document":
        label = memberLabel(newest.memberUrl);
        break;
    }
    return {
      id: `tg-${newest.hash}`,
      rows,
      startTime: oldest.time,
      endTime: newest.time,
      newestMemberUrl: newest.memberUrl,
      newestHash: newest.hash,
      authors: authorKeys,
      additions,
      deletions,
      changeCount: rows.length,
      label,
    };
  });
}

// Split a newest-first list into consecutive runs: a new run starts wherever
// `boundary` says two neighbours don't belong together.
function splitRuns(
  rows: TimelineChange[],
  grouping: Grouping,
  authors: AuthorResolver
): TimelineChange[][] {
  const boundary = boundaryFor(grouping, authors);
  const runs: TimelineChange[][] = [];
  let run: TimelineChange[] = [];
  for (const row of rows) {
    const prev = run[run.length - 1];
    if (prev && boundary(prev, row)) {
      runs.push(run);
      run = [];
    }
    run.push(row);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

// `newer` is the change just above `older` in the newest-first list. True
// when a group boundary falls between them.
function boundaryFor(
  grouping: Grouping,
  authors: AuthorResolver
): (newer: TimelineChange, older: TimelineChange) => boolean {
  switch (grouping.mode) {
    case "activity":
      return (newer, older) =>
        (newer.time - older.time) * 1000 > INACTIVITY_GAP_MS;
    case "time":
      return (newer, older) =>
        bucketStart(newer.time, grouping.resolution) !==
        bucketStart(older.time, grouping.resolution);
    case "author":
      return (newer, older) =>
        authors.authorKey(newer.actor) !== authors.authorKey(older.actor);
    case "document":
      return (newer, older) => newer.memberUrl !== older.memberUrl;
  }
}

// The start (ms, local time) of the calendar bucket a change time falls in.
// Weeks start on Monday.
export function bucketStart(
  timeSeconds: number,
  resolution: TimeResolution
): number {
  const d = new Date(timeSeconds * 1000);
  switch (resolution) {
    case "minute":
      d.setSeconds(0, 0);
      break;
    case "hour":
      d.setMinutes(0, 0, 0);
      break;
    case "day":
      d.setHours(0, 0, 0, 0);
      break;
    case "week": {
      d.setHours(0, 0, 0, 0);
      const weekday = (d.getDay() + 6) % 7; // Monday = 0
      d.setDate(d.getDate() - weekday);
      break;
    }
  }
  return d.getTime();
}

// What a time bucket's row prints: "14:32" for a minute, "14:00" for an
// hour, "Nov 4" for a day, "Week of Nov 2" for a week. Minute and hour
// buckets add the day when it isn't today; the year is added once it differs
// from the current one.
export function bucketLabel(
  timeSeconds: number,
  resolution: TimeResolution,
  now: number
): string {
  const start = new Date(bucketStart(timeSeconds, resolution));
  const today = new Date(now);
  const sameDay = start.toDateString() === today.toDateString();
  const day = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: start.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
  switch (resolution) {
    case "minute":
    case "hour": {
      const time = start.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      return sameDay ? time : `${day} ${time}`;
    }
    case "day":
      return sameDay ? "Today" : day;
    case "week":
      return `Week of ${day}`;
  }
}

// Name the people behind a timeline's actor ids. Attributed actors share
// their contact's key (one person, many sessions); everyone else is an
// anonymous author, numbered in order of first appearance in the history —
// oldest first, so the numbers hold still as new changes land at the top.
// A contact doc that is itself anonymous (no name) is numbered too.
export function resolveAuthorNames(
  changesNewestFirst: TimelineChange[],
  attribution: Record<string, AutomergeUrl>,
  contactName: (contactUrl: AutomergeUrl) => string | null
): AuthorResolver {
  const names = new Map<string, string>();
  let anonymous = 0;
  const authorKey = (actor: string): string => attribution[actor] ?? actor;
  for (let i = changesNewestFirst.length - 1; i >= 0; i--) {
    const key = authorKey(changesNewestFirst[i].actor);
    if (names.has(key)) continue;
    const contactUrl = attribution[changesNewestFirst[i].actor];
    const named = contactUrl ? contactName(contactUrl) : null;
    names.set(key, named ?? `Anon ${++anonymous}`);
  }
  return {
    authorKey,
    authorName: (key) => names.get(key) ?? "Anon",
  };
}

// Initials for an avatar: the first letters of up to two words ("Mimi
// Reyburn" → "MR"), or "A" plus the number for an anonymous author
// ("Anon 3" → "A3").
export function authorInitials(name: string): string {
  const anon = /^Anon (\d+)$/.exec(name);
  if (anon) return `A${anon[1]}`;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// Extra vertical space between two rows for the lull between them, in
// pixels. No session threshold: the gap grows smoothly with the silence, on
// a log scale so minutes, hours and days are all tellable apart without a
// week swallowing the panel. Roughly: a few minutes add nothing, an hour
// about a row's worth of air, a day twice that, a week the cap.
export const LULL_GAP_MAX = 40;

export function lullSpacing(seconds: number): number {
  if (!(seconds > 0)) return 0;
  const px = 12 * Math.log10(1 + seconds / 300);
  return Math.round(Math.max(0, Math.min(LULL_GAP_MAX, px)));
}

// Do two change times fall on the same local calendar day?
export function sameDay(aSeconds: number, bSeconds: number): boolean {
  return bucketStart(aSeconds, "day") === bucketStart(bSeconds, "day");
}

// The heading for a day divider in the timeline: "Today", "Yesterday", or
// the date with its weekday ("Tue 28 Oct"), plus the year once it differs
// from the current one.
export function dayLabel(timeSeconds: number, now: number): string {
  const day = bucketStart(timeSeconds, "day");
  const today = bucketStart(now / 1000, "day");
  if (day === today) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return "Yesterday";
  return weekdayDate(new Date(day), now);
}

// "Tue 28 Oct" (plus the year once it differs from `now`'s): weekday, day,
// month in that fixed order, with the locale's short names, so the stamp
// reads the same whatever order the locale would put them in.
export function weekdayDate(date: Date, now: number): string {
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const month = date.toLocaleDateString(undefined, { month: "short" });
  const year =
    date.getFullYear() === new Date(now).getFullYear()
      ? ""
      : ` ${date.getFullYear()}`;
  return `${weekday} ${date.getDate()} ${month}${year}`;
}

// The date-and-time column of a row: "Tue 28 Oct, 14:40" (the year added
// once it differs), "Yesterday, 14:40", or just "13:28" for today.
// `resolution` coarsens it to the bucket in Time mode: an hour bucket says
// "Tue 28 Oct, 14:00", a day bucket "Tue 28 Oct" (or "Today"), a week
// "Week of 2 Nov".
export function whenPhrase(
  timeSeconds: number,
  now: number,
  resolution: TimeResolution | "exact" = "exact"
): string {
  const day = bucketStart(timeSeconds, "day");
  const today = bucketStart(now / 1000, "day");
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const date = new Date(timeSeconds * 1000);
  if (resolution === "week") {
    const weekStart = new Date(bucketStart(timeSeconds, "week"));
    return `Week of ${weekStart.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    })}`;
  }
  const dayPart =
    day === today
      ? ""
      : day === yesterday.getTime()
        ? "Yesterday"
        : weekdayDate(date, now);
  if (resolution === "day") return dayPart || "Today";
  const at = new Date(
    resolution === "exact"
      ? timeSeconds * 1000
      : bucketStart(timeSeconds, resolution)
  ).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return dayPart ? `${dayPart}, ${at}` : at;
}

// The people behind a group, as text: the first two names, then "+N" for
// the rest ("Mimi, Paul +2").
export function authorsPhrase(
  authorKeys: string[],
  authors: AuthorResolver
): string {
  const names = authorKeys.map(authors.authorName);
  const shown = names.slice(0, 2).join(", ");
  const extra = names.length - 2;
  return extra > 0 ? `${shown} +${extra}` : shown;
}

// Which milestones sit in which group under the current folding, keyed by
// group id, each list newest first (by the flagged change's position in the
// group). A milestone whose change isn't in any group (not loaded yet, or
// in a metadata-only group the list drops) is left out.
export function milestonesByGroup(
  groups: TimelineGroup[],
  milestones: Milestone[]
): Map<string, Milestone[]> {
  const out = new Map<string, Milestone[]>();
  if (milestones.length === 0) return out;
  const byHash = new Map<string, Milestone[]>();
  for (const m of milestones) {
    const list = byHash.get(m.head.hash) ?? [];
    list.push(m);
    byHash.set(m.head.hash, list);
  }
  for (const group of groups) {
    const found: Milestone[] = [];
    for (const row of group.rows) {
      const hits = byHash.get(row.hash);
      if (hits) found.push(...hits);
    }
    if (found.length > 0) out.set(group.id, found);
  }
  return out;
}
