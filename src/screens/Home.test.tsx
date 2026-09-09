/**
 * The home screen's reading of the wire: which fire is next, how far day one has got, what the
 * queue holds, and what an empty context card says — each a sentence the operator acts on.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import type { Post, PostStatus } from "../data";
import type { WireSession } from "./Approvals";
import { contextAbsence, dayOne, nextFireOf, queueCounts } from "./Home";

const session = (id: string, status: string, pending = 0): WireSession => ({
  id,
  agent_id: "agt_1",
  status,
  stop_reason: null,
  pending_actions: Array.from({ length: pending }, (_, i) => ({ tool_call_id: `tc_${i}`, name: "social.post" })),
});

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
  it("reads each intake line against its session: finished, waiting for you, or the report's own word", () => {
    const lines = [
      { name: "trend-scout", action: "created", id: "ses_1" },
      { name: "scriptwriter", action: "created", id: "ses_2" },
      { name: "producer", action: "created", id: "ses_3" },
      { name: "analyst", action: "created" },
      { name: "clipper", action: "deselected" },
    ];
    const sessions = [session("ses_1", "completed"), session("ses_2", "idle", 1), session("ses_3", "running")];
    expect(dayOne(lines, sessions)).toEqual([
      { name: "trend-scout", state: "finished", done: true },
      { name: "scriptwriter", state: "waiting for you", done: false },
      { name: "producer", state: "running", done: false },
      { name: "analyst", state: "opened", done: false },
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
