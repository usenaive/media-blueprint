/**
 * The home screen's reading of the wire: which fire is next, how far day one has got, what the
 * queue holds, and what an empty context card says — each a sentence the operator acts on.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import type { Post, PostStatus } from "../data";
import { contextAbsence, dayOne, nextFireOf, queueCounts } from "./Home";

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
      { name: "trend-scout", state: "finished", done: true },
      { name: "scriptwriter", state: "waiting for you", done: false },
      { name: "producer", state: "running", done: false },
      { name: "channel-manager", state: "budget_exhausted", done: false },
      { name: "analyst", state: "unknown", done: false },
      { name: "clipper", state: "deselected", done: false },
    ]);
  });
});

describe("queueCounts", () => {
  it("counts every status, zeros included, in the order the queue prints them", () => {
    const post = (status: PostStatus): Post => ({ id: status, title: "", caption: "", platform: "x", status, kind: "produced" });
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
    expect(contextAbsence(new ApiError(404, "this project has no applied install yet"))).toMatch(/three questions/);
    expect(contextAbsence(new ApiError(503, "not configured — set NAIVE_API_KEY"))).toBe("not configured — set NAIVE_API_KEY");
  });
});
