import { describe, expect, it } from "vitest";
import { channelStats, dailySeries, piecesOf, postedLabel, rowKind, withinDays, type Post } from "./data";

const post = (over: Partial<Post> & Pick<Post, "id" | "status">): Post => ({
  title: "t", caption: "c", platform: "youtube", account: "@a", agent: "clipper", kind: "clip", duration: "0:30",
  ...over,
});

describe("channelStats", () => {
  it("reports only what was actually published", () => {
    // Analytics used to be a fourteen-day constant table compiled into the bundle: the same
    // headline numbers on every deployment of this blueprint, matching nothing underneath them.
    const stats = channelStats([
      post({ id: "1", status: "posted", views: 1_000, likes: 100 }),
      post({ id: "2", status: "posted", views: 500, likes: 50, account: "@b" }),
      post({ id: "3", status: "posted", views: 250, likes: 25 }),
      post({ id: "4", status: "approved", views: 9_999, likes: 9_999 }),
      post({ id: "5", status: "pending" }),
    ]);

    expect(stats.posted.map((p) => p.id)).toEqual(["1", "2", "3"]);
    expect(stats.views).toBe(1_750);
    expect(stats.likes).toBe(175);
    expect(stats.byAccount).toEqual([
      { account: "@a", platform: "youtube", posts: 2, views: 1_250, likes: 125 },
      { account: "@b", platform: "youtube", posts: 1, views: 500, likes: 50 },
    ]);
  });

  it("is empty when nothing has been posted, rather than inventing a good week", () => {
    expect(channelStats([post({ id: "1", status: "pending" })])).toEqual({ posted: [], views: 0, likes: 0, byAccount: [] });
    expect(channelStats([])).toEqual({ posted: [], views: 0, likes: 0, byAccount: [] });
  });

  it("groups a published post that names no account under a row that says so", () => {
    // `account` is optional now, because an agent files work before a destination is settled. The
    // key used to interpolate the missing value, so the row read `undefined` at the operator.
    const stats = channelStats([post({ id: "1", status: "posted", views: 10, account: undefined })]);
    expect(stats.byAccount).toEqual([{ account: "No account named", platform: "youtube", posts: 1, views: 10, likes: 0 }]);
  });

  it("counts a posted row that has no numbers yet as zero, not as absent", () => {
    const stats = channelStats([post({ id: "1", status: "posted" })]);
    expect(stats.posted).toHaveLength(1);
    expect(stats).toMatchObject({ views: 0, likes: 0 });
  });
});

describe("rowKind", () => {
  it("keeps rendered rows as pieces", () => {
    expect(rowKind(post({ id: "media", status: "pending", mediaUrl: "https://cdn.test/video.mp4", duration: undefined }))).toBe("piece");
    expect(rowKind(post({ id: "approved", status: "approved", duration: undefined }))).toBe("piece");
    expect(rowKind(post({ id: "posted", status: "posted", duration: undefined }))).toBe("piece");
    expect(rowKind(post({ id: "rejected", status: "rejected", duration: undefined }))).toBe("piece");
    expect(rowKind(post({ id: "rendered", status: "pending", stage: "rendered", duration: undefined }))).toBe("piece");
  });

  it("keeps staged pending rows in production", () => {
    for (const [id, stage] of [
      ["brief", "brief"],
      ["scripted", "scripted"],
      ["rendering", "rendering"],
    ] as const) {
      expect(rowKind(post({ id, status: "pending", stage, duration: undefined }))).toBe("production");
    }
  });

  it("treats a pending stageless row as a note and duration alone as a piece", () => {
    expect(rowKind(post({ id: "note", status: "pending", duration: undefined }))).toBe("note");
    expect(rowKind(post({ id: "duration", status: "pending" }))).toBe("piece");
  });

  it("filters only pieces", () => {
    const rows = [
      post({ id: "piece", status: "pending" }),
      post({ id: "production", status: "pending", stage: "rendering", duration: undefined }),
      post({ id: "note", status: "pending", duration: undefined }),
    ];
    expect(piecesOf(rows).map((row) => row.id)).toEqual(["piece"]);
  });
});

/**
 * The dated half of the queue. `postedAt` is ISO 8601 and has not always been: the store stamped
 * the literal `"just now"` until it stamped a date, and nothing migrated the rows already written.
 * A phrase is not a day, so every one of these reads it as no day at all — which is why Analytics
 * has to say so rather than report the empty window's zero (`src/screens/Analytics.test.tsx`).
 */
const NOW = new Date(2026, 8, 15, 12, 0, 0);
const daysBack = (days: number): string => new Date(2026, 8, 15 - days, 12, 0, 0).toISOString();
const posted = (id: string, over: Partial<Post> = {}): Post => post({ id, status: "posted", ...over });

describe("postedLabel", () => {
  it("prints a stamp as a short date and a phrase as itself", () => {
    const at = new Date(2026, 8, 14, 9, 0, 0);
    expect(postedLabel(posted("iso", { postedAt: at.toISOString() }), NOW)).toBe(
      at.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    expect(postedLabel(posted("phrase", { postedAt: "just now" }), NOW)).toBe("just now");
    expect(postedLabel(posted("none"), NOW)).toBe("—");
  });

  it("carries the year only when the row was not published this one", () => {
    const at = new Date(2024, 10, 3, 9, 0, 0);
    expect(postedLabel(posted("old", { postedAt: at.toISOString() }), NOW)).toBe(
      at.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    );
  });
});

describe("withinDays", () => {
  it("counts today as the first of the days and cuts at local midnight", () => {
    const rows = [posted("in", { postedAt: daysBack(29) }), posted("out", { postedAt: daysBack(30) })];
    expect(withinDays(rows, 30, NOW).map((p) => p.id)).toEqual(["in"]);
  });

  it("leaves a row it cannot date out of every finite range and keeps it in All time", () => {
    // The whole of the legacy-row bug in one assertion: a channel whose published rows all carry
    // `"just now"` has an empty 30-day window and a full All time, so a range cannot be read as
    // "this channel published nothing".
    const rows = [posted("phrase", { postedAt: "just now" }), posted("unstamped"), posted("dated", { postedAt: daysBack(1) })];
    expect(withinDays(rows, 30, NOW).map((p) => p.id)).toEqual(["dated"]);
    expect(withinDays(rows, null, NOW).map((p) => p.id)).toEqual(["phrase", "unstamped", "dated"]);
  });
});

describe("dailySeries", () => {
  it("draws one point per day, ending today, with a zero for a day nothing shipped", () => {
    const series = dailySeries([posted("a", { postedAt: daysBack(2), views: 300 })], "views", 4, NOW);
    expect(series).toEqual([
      { day: "2026-09-12", value: 0 },
      { day: "2026-09-13", value: 300 },
      { day: "2026-09-14", value: 0 },
      { day: "2026-09-15", value: 0 },
    ]);
  });

  it("sums the day's rows, counts posts as rows, and skips a row it cannot date", () => {
    const rows = [
      posted("a", { postedAt: daysBack(1), views: 300, likes: 10 }),
      posted("b", { postedAt: daysBack(1), views: 200 }),
      posted("legacy", { postedAt: "just now", views: 9_999 }),
    ];
    expect(dailySeries(rows, "views", 2, NOW).map((p) => p.value)).toEqual([500, 0]);
    expect(dailySeries(rows, "likes", 2, NOW).map((p) => p.value)).toEqual([10, 0]);
    expect(dailySeries(rows, "posts", 2, NOW).map((p) => p.value)).toEqual([2, 0]);
  });

  it("buckets a row on its own local day, not on UTC's", () => {
    // A row published at half past eleven at night belongs to that evening on the operator's
    // calendar; keying off the ISO string would move it a day in half the world's timezones.
    const late = new Date(2026, 8, 14, 23, 30, 0);
    expect(dailySeries([posted("late", { postedAt: late.toISOString() })], "posts", 2, NOW)).toEqual([
      { day: "2026-09-14", value: 1 },
      { day: "2026-09-15", value: 0 },
    ]);
  });
});
