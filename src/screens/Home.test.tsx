// @vitest-environment jsdom
/**
 * The home screen's reading of the wire: which fire is next, how far day one has got, what the
 * queue holds, and what an empty context card says — each a sentence the operator acts on. Then
 * the screen itself: a note is a card with its author and a clamped body, a seat is a row with
 * its next fire as a relative time.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import type { Post, PostStatus } from "../data";
import { contextAbsence, dayOne, Home, nextFireOf, queueCounts, until, type HomeContext } from "./Home";

describe("nextFireOf", () => {
  it("picks the soonest coming fire of the agent's own timers, and none of another agent's", () => {
    const rows = [
      { agent_id: "agt_1", cron: "0 8 * * *", next_run_at: "2026-09-10T12:00:00Z" },
      { agent_id: "agt_1", cron: "0 9 * * 1", next_run_at: "2026-09-09T13:00:00Z" },
      { agent_id: "agt_2", cron: "0 7 * * *", next_run_at: "2026-09-09T11:00:00Z" },
      { agent_id: "agt_1", cron: "0 18 * * *", next_run_at: null },
    ];
    expect(nextFireOf(rows, "agt_1")).toBe("2026-09-09T13:00:00Z");
    expect(nextFireOf(rows, "agt_3")).toBeNull();
  });
});

describe("until", () => {
  const now = Date.parse("2026-09-15T12:00:00Z");
  it("reads a coming time as minutes, hours and days, and one already past as due", () => {
    expect(until("2026-09-15T12:20:00Z", now)).toBe("in 20m");
    expect(until("2026-09-15T15:30:00Z", now)).toBe("in 3h");
    expect(until("2026-09-19T12:00:00Z", now)).toBe("in 4d");
    expect(until("2026-09-15T11:00:00Z", now)).toBe("due now");
  });
});

describe("dayOne", () => {
  it("reads each intake line off the session the server read by id, or the report's own word", () => {
    const lines = [
      { name: "trend-scout", action: "created", id: "ses_1", session: { status: "idle", stop_reason: "end_turn", waiting: false } },
      { name: "scriptwriter", action: "created", id: "ses_2", session: { status: "idle", stop_reason: "awaiting_approval", waiting: true } },
      { name: "producer", action: "created", id: "ses_3", session: { status: "running", stop_reason: null, waiting: false } },
      { name: "channel-manager", action: "created", id: "ses_4", session: { status: "idle", stop_reason: "budget_exhausted", waiting: false } },
      // The server could not read this one just now: not "opened" — nobody has seen its state.
      { name: "analyst", action: "created", id: "ses_5", session: null },
      { name: "clipper", action: "deselected", session: null },
    ];
    expect(dayOne(lines)).toEqual([
      { name: "trend-scout", state: "finished", done: true, card: false },
      { name: "scriptwriter", state: "waiting for you", done: false, card: false },
      { name: "producer", state: "running", done: false, card: false },
      { name: "channel-manager", state: "budget_exhausted", done: false, card: false },
      { name: "analyst", state: "unknown", done: false, card: false },
      { name: "clipper", state: "deselected", done: false, card: false },
    ]);
  });

  /**
   * A CARD LINE SAYS ONLY THAT IT WAS SEEDED. `tasks` lines carry a `crd_`, not a `ses_`, so the
   * server reads no session for one — and printing `unknown` on every card of every install, or
   * `0/7 finished` forever, would be claiming a state this dashboard cannot see. The board holds
   * the progress; the line holds the seeding.
   */
  it("says only that a card was seeded, and never that it finished", () => {
    expect(
      dayOne([
        { name: "channel-plan", action: "created", id: "crd_1", session: null, card: true },
        { name: "first-render", action: "refused", session: null, card: true },
      ]),
    ).toEqual([
      { name: "channel-plan", state: "on the board", done: false, card: true },
      { name: "first-render", state: "refused", done: false, card: true },
    ]);
  });
});

describe("queueCounts", () => {
  it("counts every status, zeros included, in the order the queue prints them", () => {
    const post = (status: PostStatus): Post => ({ id: status, title: "", caption: "", platform: "youtube", status, kind: "produced" });
    expect(queueCounts([post("pending"), post("pending"), post("posted")])).toEqual([
      ["pending", 2],
      ["ready", 0],
      ["approved", 0],
      ["posted", 1],
      ["rejected", 0],
    ]);
  });
});

describe("contextAbsence", () => {
  it("tells a channel with no applied install apart from a dashboard with no key", () => {
    expect(contextAbsence(new ApiError(404, "this project has no applied install yet"))).toMatch(/setup questions/);
    expect(contextAbsence(new ApiError(503, "not configured — set NAIVE_API_KEY"))).toBe("not configured — set NAIVE_API_KEY");
  });
});

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const LONG = "Post one short each weekday at 18:00 in the channel's voice. ".repeat(8).trim();

const home: HomeContext = {
  context: {
    template: "faceless",
    answers: [
      { key: "niche", label: "Niche", value: "stoic philosophy" },
      { key: "platforms", label: "Platforms", value: ["youtube", "tiktok"] },
      { key: "audience", label: "Audience", value: LONG },
    ],
    updated_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  team: [{ name: "producer", id: "agt_1" }],
  day_one: [{ name: "producer", action: "created", id: "ses_1", session: { status: "idle", stop_reason: "end_turn", waiting: false } }],
};

const note: Post = { id: "post_plan", title: "Channel plan", caption: LONG, platform: "youtube", status: "pending", agent: "channel-manager", source: "channel plan", kind: "produced" };

const WIRE: Record<string, unknown> = {
  "/api/context": home,
  "/api/posts": [note],
  "/api/agents": { data: [{ id: "agt_1", name: "producer" }] },
  "/api/deployments": { data: [{ agent_id: "agt_1", cron: "0 18 * * *", next_run_at: new Date(Date.now() + 3.1 * 3_600_000).toISOString() }] },
};

describe("the Home screen", () => {
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

  it("files a note as a card with its author and a clamped body, and a seat as a row with its next fire", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(json(WIRE[url] ?? { data: [] }))));
    await act(async () => root.render(<MemoryRouter><Home /></MemoryRouter>));

    const titles = Array.from(host.querySelectorAll("section.panel h2.card-title")).map((n) => n.textContent);
    expect(titles).toEqual(["Channel setup", "Day one", "Approvals due", "Queue", "Channel plan"]);

    expect(Array.from(host.querySelectorAll(".dl dt")).map((n) => n.textContent)).toEqual(["Niche", "Platforms", "Audience"]);
    const answers = Array.from(host.querySelectorAll(".dl dd"));
    expect(answers[1]?.textContent).toBe("youtube, tiktok");
    // A long answer folds to two lines behind Read more rather than filling the card.
    const audience = answers[2]!.querySelector("p")!;
    expect(audience.className).toContain("line-clamp-2");
    expect(audience.textContent).toBe(LONG);
    expect(answers[2]!.querySelector("button")?.textContent).toBe("Read more");
    expect(host.textContent).toContain("Updated 3h ago");
    expect(host.textContent).toContain("1/1 finished");

    const queue = Array.from(host.querySelectorAll(".tile .tile-value")).map((n) => n.textContent);
    expect(queue).toEqual(["0", "0", "0", "0", "0", "0"]);

    const card = Array.from(host.querySelectorAll("section.panel")).find((s) => s.querySelector("h2")?.textContent === "Channel plan")!;
    expect(card.querySelector("header")?.textContent).toContain("channel-manager");
    expect(card.querySelector("header .chip")?.textContent).toBe("channel plan");
    const body = card.querySelector("p")!;
    expect(body.className).toContain("line-clamp-3");
    expect(body.textContent).toBe(LONG);
    expect(card.querySelector("details")).toBeNull();

    const row = host.querySelector(".list > div")!;
    expect(row.textContent).toContain("producer");
    expect(row.textContent).toContain("Video production");
    expect(row.querySelector(".chip")?.textContent).toBe("fires in 3h");
  });
});
