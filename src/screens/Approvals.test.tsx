/**
 * The approval surface's two decisions: which calls are waiting, and how the arguments a person is
 * being asked to approve are put in front of them.
 */
import { describe, expect, it } from "vitest";
import { argRows, parked, type WireSession } from "./Approvals";

const session = (over: Partial<WireSession> & Pick<WireSession, "id">): WireSession => ({
  agent_id: "agt_1",
  status: "idle",
  stop_reason: null,
  pending_actions: [],
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const call = { tool_call_id: "call_1", name: "social.post", args: { content: "hello" } };

describe("parked", () => {
  it("lists a session because it holds a blocked call, not because of its status", () => {
    // A parked session is `idle` with `stop_reason: "awaiting_approval"` — keying off `status`
    // alone would list every finished session in the channel and miss nothing that matters.
    const rows = parked(
      [
        session({ id: "ses_1", status: "idle", stop_reason: "end_turn" }),
        session({ id: "ses_2", status: "idle", stop_reason: "awaiting_approval", pending_actions: [call] }),
        session({ id: "ses_3", status: "running" }),
      ],
      new Map([["agt_1", "producer"]]),
    );
    expect(rows).toEqual([
      {
        sessionId: "ses_2",
        agent: "producer",
        toolCallId: "call_1",
        tool: "social.post",
        args: { content: "hello" },
        since: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("names an agent the roster did not answer for by its id, and puts the oldest wait first", () => {
    const rows = parked(
      [
        session({ id: "ses_new", created_at: "2026-02-02T00:00:00.000Z", pending_actions: [call] }),
        session({
          id: "ses_old",
          created_at: "2026-01-01T00:00:00.000Z",
          pending_actions: [{ ...call, tool_call_id: "call_0" }],
        }),
      ],
      new Map(),
    );
    expect(rows.map((row) => row.sessionId)).toEqual(["ses_old", "ses_new"]);
    expect(rows[0]!.agent).toBe("agt_1");
  });

  it("carries every blocked call of one session, not just the first", () => {
    const rows = parked(
      [session({ id: "ses_1", pending_actions: [call, { ...call, tool_call_id: "call_2", name: "youtube.upload_video" }] })],
      new Map(),
    );
    expect(rows.map((row) => row.tool)).toEqual(["social.post", "youtube.upload_video"]);
  });
});

describe("argRows", () => {
  it("renders the arguments as prose under the agent's own key names", () => {
    expect(argRows({ content: "Rule two will sting.", platforms: ["x", "threads"] })).toEqual([
      { key: "content", label: "Content", text: "Rule two will sting.", media: [] },
      { key: "platforms", label: "Platforms", text: "x, threads", media: [] },
    ]);
  });

  it("pulls media URLs out so the thing being approved can be watched", () => {
    // The one argument that cannot be read as text: approving a publish whose video you have never
    // seen is the failure this whole surface exists to end.
    const rows = argRows({ media_urls: ["https://cdn.example/a.mp4"], url: "https://x.example/p.png" });
    expect(rows[0]).toEqual({ key: "media_urls", label: "Media urls", text: "", media: ["https://cdn.example/a.mp4"] });
    expect(rows[1]!.media).toEqual(["https://x.example/p.png"]);
  });

  it("flattens a nested object into labelled lines rather than a JSON dump", () => {
    expect(argRows({ options: { schedule_at: "tomorrow", retries: 2 } })[0]!.text).toBe(
      "Schedule at: tomorrow\nRetries: 2",
    );
  });

  it("has nothing to show for a call that takes no arguments", () => {
    expect(argRows({})).toEqual([]);
  });
});
