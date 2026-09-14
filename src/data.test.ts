import { describe, expect, it } from "vitest";
import { channelStats, piecesOf, rowKind, type Post } from "./data";

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
