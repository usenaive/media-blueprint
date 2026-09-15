// @vitest-environment jsdom
/**
 * Analytics reads a range out of rows it has to be able to date, and draws its own axes. Both are
 * tested here: the axes because they are arithmetic nobody can eyeball off a chart, and the range
 * because a window this screen cannot fill must never be reported as a channel that published
 * nothing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics, xTicks, yTicks } from "./Analytics";
import type { Post } from "../data";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const post = (over: Partial<Post> & Pick<Post, "id" | "status">): Post => ({
  title: "t", caption: "c", platform: "youtube", account: "@a", agent: "producer", kind: "produced", duration: "0:30",
  ...over,
});

/** Mounts the screen over one `/api/posts` answer and lets the fetch settle. */
async function mount(posts: Post[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(posts)));
  await act(async () => root.render(<Analytics />));
}

/** The button whose label reads `text`, as an operator would find it. */
const button = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

describe("a published row this screen cannot date", () => {
  /**
   * The store stamped `postedAt: "just now"` until it stamped an ISO date, and nothing migrated
   * the rows written before that. A phrase falls outside every finite range, and the default range
   * is thirty days — so a channel with a real published history opened Analytics and read three
   * tiles of zero, which is the one thing this screen must never say about a channel that posted.
   */
  const legacy = [
    post({ id: "post_1", status: "posted", postedAt: "just now", views: 48_211, likes: 5_804 }),
    post({ id: "post_2", status: "posted", postedAt: "just now", views: 21_930, likes: 2_112 }),
  ];

  it("is said to be undatable rather than reported as zero", async () => {
    await mount(legacy);
    expect(host.querySelectorAll(".tile")).toHaveLength(0);
    expect(host.textContent).toContain("no readable publish date");
    expect(host.textContent).not.toContain("Nothing published yet");
  });

  it("is reachable from the line that names it, over All time", async () => {
    await mount(legacy);
    await act(async () => button("Show all time")?.click());
    const tiles = [...host.querySelectorAll(".tile-value")].map((t) => t.textContent);
    expect(tiles).toEqual(["70k", "7.9k", "2"]);
  });

  it("does not stand in the way of a range that has rows of its own", async () => {
    await mount([...legacy, post({ id: "post_3", status: "posted", postedAt: new Date().toISOString(), views: 900, likes: 30 })]);
    expect([...host.querySelectorAll(".tile-value")].map((t) => t.textContent)).toEqual(["900", "30", "1"]);
  });
});

describe("yTicks", () => {
  it("rounds the top up to a readable step and quarters it", () => {
    expect(yTicks(48_211)).toEqual([0, 15_000, 30_000, 45_000, 60_000]);
    expect(yTicks(1_000)).toEqual([0, 250, 500, 750, 1_000]);
    expect(yTicks(4)).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives an empty series an axis rather than a division by zero", () => {
    expect(yTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(yTicks(-1)).toEqual([0, 1, 2, 3, 4]);
  });

  it("never draws a top below the tallest point", () => {
    for (const max of [1, 3, 7, 26, 99, 101, 2_500, 9_999, 123_456]) {
      expect(yTicks(max)[4]).toBeGreaterThanOrEqual(max);
    }
  });
});

describe("xTicks", () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => ({ day: `d${i}`, value: 0 }));

  it("labels every day of a short window", () => {
    expect(xTicks(days(6))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(xTicks(days(1))).toEqual([0]);
    expect(xTicks([])).toEqual([]);
  });

  it("spreads six labels over a long one, first and last day included", () => {
    expect(xTicks(days(7))).toEqual([0, 1, 2, 4, 5, 6]);
    for (const n of [30, 90, 365]) {
      const ticks = xTicks(days(n));
      expect(ticks).toHaveLength(6);
      expect(ticks[0]).toBe(0);
      expect(ticks[5]).toBe(n - 1);
      expect(new Set(ticks).size).toBe(6);
    }
  });
});
