import { describe, expect, it } from "vitest";
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

import {
  LULL_GAP_MAX,
  authorInitials,
  authorsPhrase,
  bucketLabel,
  bucketStart,
  dayLabel,
  groupChanges,
  lullSpacing,
  milestonesByGroup,
  newestFirst,
  resolveAuthorNames,
  sameDay,
  whenPhrase,
  type AuthorResolver,
  type TimelineChange,
} from "./grouping";

const DOC_A = "automerge:docA" as AutomergeUrl;
const DOC_B = "automerge:docB" as AutomergeUrl;
const CONTACT_M = "automerge:contactM" as AutomergeUrl;

// Noon on a Wednesday, local time, so bucket boundaries are predictable.
const BASE = new Date(2026, 10, 4, 12, 0, 0).getTime() / 1000;

let seq = 0;
function change(
  offsetSeconds: number,
  actor: string,
  extra: Partial<TimelineChange> = {}
): TimelineChange {
  return {
    memberUrl: DOC_A,
    hash: `h${offsetSeconds}-${actor}`,
    time: BASE + offsetSeconds,
    actor,
    seq: seq++,
    deps: [],
    additions: 1,
    deletions: 0,
    ...extra,
  };
}

const plain: AuthorResolver = {
  authorKey: (actor) => actor,
  authorName: (key) => key,
};
const docLabel = (url: AutomergeUrl) => (url === DOC_A ? "A" : "B");

function ids(groups: ReturnType<typeof groupChanges>): string[][] {
  return groups.map((g) => g.rows.map((r) => r.hash));
}

describe("groupChanges", () => {
  const rows = [
    change(0, "x"),
    change(-30, "x"),
    change(-15 * 60, "y"), // 15 min lull before the two above
    change(-16 * 60, "y", { memberUrl: DOC_B }),
    change(-3 * 3600, "x"),
  ].sort(newestFirst);

  it("activity: splits on lulls longer than ten minutes", () => {
    const groups = groupChanges(
      rows,
      { mode: "activity", resolution: "hour" },
      plain,
      docLabel
    );
    expect(ids(groups)).toEqual([
      ["h0-x", "h-30-x"],
      ["h-900-y", "h-960-y"],
      ["h-10800-x"],
    ]);
    expect(groups[0].label).toBeNull();
    expect(groups[0].authors).toEqual(["x"]);
    expect(groups[1].changeCount).toBe(2);
    expect(groups[0].id).toBe("tg-h0-x");
  });

  it("time: folds into calendar buckets at the chosen resolution", () => {
    const byHour = groupChanges(
      rows,
      { mode: "time", resolution: "hour" },
      plain,
      docLabel,
      BASE * 1000
    );
    // 12:00:00 sits alone in the 12:00 bucket; 11:59:30, 11:45 and 11:44
    // share the 11:00 bucket; 09:00 is its own.
    expect(ids(byHour)).toEqual([
      ["h0-x"],
      ["h-30-x", "h-900-y", "h-960-y"],
      ["h-10800-x"],
    ]);
    expect(byHour.map((g) => g.label)).toEqual(["12:00", "11:00", "09:00"]);

    const byMinute = groupChanges(
      rows,
      { mode: "time", resolution: "minute" },
      plain,
      docLabel,
      BASE * 1000
    );
    expect(ids(byMinute)).toEqual([
      ["h0-x"],
      ["h-30-x"],
      ["h-900-y"],
      ["h-960-y"],
      ["h-10800-x"],
    ]);

    const byDay = groupChanges(
      rows,
      { mode: "time", resolution: "day" },
      plain,
      docLabel,
      BASE * 1000
    );
    expect(byDay).toHaveLength(1);
    expect(byDay[0].label).toBe("Today");
  });

  it("author: splits consecutive runs whenever the person changes", () => {
    const groups = groupChanges(
      rows,
      { mode: "author", resolution: "hour" },
      plain,
      docLabel
    );
    expect(ids(groups)).toEqual([
      ["h0-x", "h-30-x"],
      ["h-900-y", "h-960-y"],
      ["h-10800-x"],
    ]);
    expect(groups.map((g) => g.label)).toEqual(["x", "y", "x"]);
  });

  it("author: one person's many actor ids read as one run", () => {
    const resolver = resolveAuthorNames(
      rows,
      { x: CONTACT_M, y: CONTACT_M },
      () => "Mimi"
    );
    const groups = groupChanges(
      rows,
      { mode: "author", resolution: "hour" },
      resolver,
      docLabel
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Mimi");
    expect(groups[0].authors).toEqual([CONTACT_M]);
  });

  it("document: splits consecutive runs whenever the doc changes", () => {
    const groups = groupChanges(
      rows,
      { mode: "document", resolution: "hour" },
      plain,
      docLabel
    );
    expect(ids(groups)).toEqual([
      ["h0-x", "h-30-x", "h-900-y"],
      ["h-960-y"],
      ["h-10800-x"],
    ]);
    expect(groups.map((g) => g.label)).toEqual(["A", "B", "A"]);
  });

  it("sums edit counts and keeps authors newest-first", () => {
    const [g] = groupChanges(
      [
        change(0, "b", { additions: 2, deletions: 1 }),
        change(-1, "a", { additions: 3, deletions: 0 }),
        change(-2, "b", { additions: 0, deletions: 4 }),
      ],
      { mode: "activity", resolution: "hour" },
      plain,
      docLabel
    );
    expect(g.additions).toBe(5);
    expect(g.deletions).toBe(5);
    expect(g.authors).toEqual(["b", "a"]);
    expect(g.startTime).toBe(BASE - 2);
    expect(g.endTime).toBe(BASE);
  });
});

describe("bucketStart / bucketLabel", () => {
  it("floors to the resolution in local time, weeks starting Monday", () => {
    const t = new Date(2026, 10, 4, 14, 32, 17).getTime() / 1000; // Wed
    expect(new Date(bucketStart(t, "minute")).getSeconds()).toBe(0);
    expect(new Date(bucketStart(t, "hour")).getMinutes()).toBe(0);
    expect(new Date(bucketStart(t, "day")).getHours()).toBe(0);
    const week = new Date(bucketStart(t, "week"));
    expect(week.getDay()).toBe(1);
    expect(week.getDate()).toBe(2);
  });

  it("labels buckets relative to today", () => {
    const today = new Date(2026, 10, 4, 18, 0, 0).getTime();
    const t = new Date(2026, 10, 4, 14, 32, 17).getTime() / 1000;
    expect(bucketLabel(t, "minute", today)).toBe("14:32");
    expect(bucketLabel(t, "hour", today)).toBe("14:00");
    expect(bucketLabel(t, "day", today)).toBe("Today");
    const yesterday = t - 24 * 3600;
    expect(bucketLabel(yesterday, "hour", today)).toMatch(/Nov 3 14:00/);
    expect(bucketLabel(yesterday, "day", today)).toMatch(/Nov 3/);
    expect(bucketLabel(t, "week", today)).toMatch(/^Week of Nov 2/);
  });
});

describe("resolveAuthorNames", () => {
  it("numbers unknown authors by first appearance, oldest first", () => {
    const rows = [
      change(0, "new"),
      change(-10, "mid"),
      change(-20, "old"),
      change(-30, "mid"),
    ];
    const r = resolveAuthorNames(rows, {}, () => null);
    expect(r.authorName("mid")).toBe("Anon 1");
    expect(r.authorName("old")).toBe("Anon 2");
    expect(r.authorName("new")).toBe("Anon 3");
  });

  it("keeps the numbering stable as newer changes arrive", () => {
    const older = [change(-20, "old"), change(-30, "mid")];
    const before = resolveAuthorNames(older, {}, () => null);
    const after = resolveAuthorNames(
      [change(0, "new"), ...older],
      {},
      () => null
    );
    expect(after.authorName("mid")).toBe(before.authorName("mid"));
    expect(after.authorName("old")).toBe(before.authorName("old"));
    expect(after.authorName("new")).toBe("Anon 3");
  });

  it("names attributed authors after their contact, numbering nameless ones", () => {
    const rows = [change(0, "a"), change(-10, "b"), change(-20, "c")];
    const r = resolveAuthorNames(
      rows,
      { a: CONTACT_M, b: "automerge:nameless" as AutomergeUrl },
      (url) => (url === CONTACT_M ? "Mimi" : null)
    );
    expect(r.authorKey("a")).toBe(CONTACT_M);
    expect(r.authorName(CONTACT_M)).toBe("Mimi");
    expect(r.authorName("c")).toBe("Anon 1");
    expect(r.authorName("automerge:nameless")).toBe("Anon 2");
    expect(r.authorName("never-seen")).toBe("Anon");
  });
});

describe("authorInitials", () => {
  it("abbreviates names and numbers anonymous authors", () => {
    expect(authorInitials("Mimi Reyburn")).toBe("MR");
    expect(authorInitials("mimi")).toBe("MI");
    expect(authorInitials("Anon 12")).toBe("A12");
    expect(authorInitials("  ")).toBe("?");
  });
});

describe("lullSpacing", () => {
  it("adds nothing for no pause and grows monotonically with it", () => {
    expect(lullSpacing(0)).toBe(0);
    expect(lullSpacing(-5)).toBe(0);
    const lulls = [60, 10 * 60, 3600, 6 * 3600, 86400, 3 * 86400];
    const gaps = lulls.map(lullSpacing);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
    }
    expect(lullSpacing(2 * 60)).toBeLessThanOrEqual(2);
    expect(lullSpacing(3600)).toBeGreaterThan(8);
    expect(lullSpacing(86400)).toBeGreaterThan(lullSpacing(3600) * 1.5);
  });

  it("caps so a long silence can't swallow the panel", () => {
    expect(lullSpacing(7 * 86400)).toBe(LULL_GAP_MAX);
    expect(lullSpacing(365 * 86400)).toBe(LULL_GAP_MAX);
  });
});

describe("day dividers", () => {
  const noon = new Date(2026, 10, 4, 12, 0, 0).getTime();
  it("tells calendar days apart in local time", () => {
    const t = noon / 1000;
    expect(sameDay(t, t - 11 * 3600)).toBe(true);
    expect(sameDay(t, t - 13 * 3600)).toBe(false);
    expect(sameDay(t + 11 * 3600 + 59 * 60, t + 12 * 3600)).toBe(false);
  });

  it("labels today, yesterday, then the dated weekday", () => {
    const t = noon / 1000;
    expect(dayLabel(t, noon)).toBe("Today");
    expect(dayLabel(t - 86400, noon)).toBe("Yesterday");
    expect(dayLabel(t - 2 * 86400, noon)).toBe("Mon 2 Nov");
    expect(dayLabel(t - 400 * 86400, noon)).toBe("Tue 30 Sep 2025");
  });
});

describe("whenPhrase", () => {
  const now = new Date(2026, 10, 4, 18, 0, 0).getTime();
  const t = new Date(2026, 10, 4, 14, 32, 0).getTime() / 1000;
  it("shows only the time today, names yesterday, dates the rest with the weekday", () => {
    expect(whenPhrase(t, now)).toBe("14:32");
    expect(whenPhrase(t - 86400, now)).toBe("Yesterday, 14:32");
    expect(whenPhrase(t - 7 * 86400, now)).toBe("Wed 28 Oct, 14:32");
    expect(whenPhrase(t - 400 * 86400, now)).toMatch(/^Tue 30 Sep 2025, \d\d:\d\d$/);
    expect(whenPhrase(t - 7 * 86400, now)).not.toMatch(/\b(at|on)\b/);
  });
  it("coarsens to the bucket in Time mode", () => {
    expect(whenPhrase(t, now, "hour")).toBe("14:00");
    expect(whenPhrase(t - 86400, now, "hour")).toBe("Yesterday, 14:00");
    expect(whenPhrase(t, now, "day")).toBe("Today");
    expect(whenPhrase(t - 86400, now, "day")).toBe("Yesterday");
    expect(whenPhrase(t - 7 * 86400, now, "day")).toBe("Wed 28 Oct");
    expect(whenPhrase(t, now, "week")).toMatch(/^Week of .*2/);
  });
});

describe("authorsPhrase", () => {
  const r: AuthorResolver = { authorKey: (a) => a, authorName: (k) => k };
  it("names up to two people and counts the rest", () => {
    expect(authorsPhrase(["Mimi"], r)).toBe("Mimi");
    expect(authorsPhrase(["Mimi", "Paul"], r)).toBe("Mimi, Paul");
    expect(authorsPhrase(["Mimi", "Paul", "Ann", "Bo"], r)).toBe("Mimi, Paul +2");
  });
});

describe("milestonesByGroup", () => {
  it("files each milestone under the group holding its change", () => {
    const rows = [change(0, "x"), change(-30, "x"), change(-3 * 3600, "y")];
    const groups = groupChanges(
      rows,
      { mode: "activity", resolution: "hour" },
      plain,
      docLabel
    );
    const ms = (id: string, hash: string) => ({
      id,
      name: id,
      createdAt: 0,
      draftUrl: null,
      head: { docUrl: DOC_A, hash, time: 0 },
      at: {},
    });
    const byGroup = milestonesByGroup(groups, [
      ms("a", "h-30-x"),
      ms("b", "h-10800-y"),
      ms("c", "not-in-history"),
    ]);
    expect(byGroup.get(groups[0].id)?.map((m) => m.id)).toEqual(["a"]);
    expect(byGroup.get(groups[1].id)?.map((m) => m.id)).toEqual(["b"]);
    expect([...byGroup.values()].flat()).toHaveLength(2);
  });
});
