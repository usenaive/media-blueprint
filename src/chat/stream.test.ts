/**
 * The reducer is the whole of "the chat shows what is happening": deltas grow one bubble and its
 * completion finishes it without a second copy, a tool's start and end pair into one step, a
 * render's job outlives the idle it leaves behind, and `phaseOf` picks one answer out of all of it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { duration, emptyStream, frameEvent, phaseLabel, phaseOf, readFrames, reduce, replay, type Stream, type WireEvent } from "./stream";

const T0 = Date.parse("2026-09-15T08:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
let seq = 0;
const ev = (type: string, data: Record<string, unknown> = {}, ms = 0): WireEvent => ({ id: `evt_${++seq}`, seq, type, data, created_at: at(ms) });
beforeEach(() => {
  seq = 0;
});

const texts = (s: Stream) => s.items.map((i) => (i.kind === "tool" ? `[${i.call.name}]` : i.kind === "note" ? `(${i.text})` : `${i.kind}:${i.text}`));

describe("reduce — messages", () => {
  it("builds one streaming bubble from the deltas and finishes it on the completion, once", () => {
    const s = replay([ev("session.running"), ev("message.delta", { content: "Cla" }), ev("message.delta", { content: "rifying." })]);
    expect(s.items).toEqual([{ kind: "assistant", id: "evt_2", at: T0, text: "Clarifying.", streaming: true }]);
    const done = reduce(s, ev("message.completed", { role: "assistant", content: "Clarifying." }));
    expect(done.items).toEqual([{ kind: "assistant", id: "evt_2", at: T0, text: "Clarifying.", streaming: false }]);
  });

  it("takes the completion's text over the streamed one, so a dropped delta never leaves a hole", () => {
    const s = replay([ev("message.delta", { content: "Three clips" }), ev("message.completed", { content: "Three clips are ready." })]);
    expect(texts(s)).toEqual(["assistant:Three clips are ready."]);
  });

  it("appends a completion that no bubble was streaming — an older harness sends no deltas, and no role", () => {
    const s = replay([ev("message.completed", { content: "Done." }), ev("message.completed", { role: "assistant", content: "Anything else?" })]);
    expect(texts(s)).toEqual(["assistant:Done.", "assistant:Anything else?"]);
    expect(s.items.every((i) => i.kind === "assistant" && !i.streaming)).toBe(true);
  });

  it("splits a bubble that streamed two messages of one turn at the first completion", () => {
    const s = replay([ev("message.delta", { content: "On it. " }), ev("message.delta", { content: "Started the job." }), ev("message.completed", { content: "On it. " })]);
    expect(s.items.map((i) => (i.kind === "assistant" ? [i.text, i.streaming] : null))).toEqual([["On it. ", false], ["Started the job.", true]]);
  });

  it("finishes the streaming bubble even when a tool row has landed after it", () => {
    const s = replay([
      ev("message.delta", { content: "Filing it." }),
      ev("tool.started", { tool_call_id: "tc_1", name: "channel.update_project", args: { id: "post_8a93" } }),
      ev("message.completed", { content: "Filing it." }),
    ]);
    expect(texts(s)).toEqual(["assistant:Filing it.", "[channel.update_project]"]);
  });

  it("keeps the caller's turn as a user item and drops an empty message", () => {
    const s = replay([ev("message.completed", { role: "user", content: "Clip the interview" }), ev("message.completed", { content: "" })]);
    expect(s.items).toEqual([{ kind: "user", id: "evt_1", at: T0, text: "Clip the interview" }]);
  });

  it("stamps the wall clock on an event with no created_at", () => {
    const before = Date.now();
    const s = reduce(emptyStream, { seq: 1, type: "message.completed", data: { content: "Hi" } });
    expect(s.items[0]!.at).toBeGreaterThanOrEqual(before);
    expect(s.items[0]!.id).toBe("evt_1");
  });
});

describe("reduce — tools", () => {
  it("pairs tool.started with its tool.completed by call id and measures the duration", () => {
    const s = replay([
      ev("tool.started", { tool_call_id: "tc_1", name: "channel.update_project", args: { id: "post_8a93", status: "rendering" } }),
      ev("tool.started", { tool_call_id: "tc_2", name: "generate_video", args: { model: "veo-3", prompt: "a long prompt" } }, 100),
      ev("tool.completed", { tool_call_id: "tc_1", name: "channel.update_project", output: "ok", is_error: false }, 400),
    ]);
    const [first, second] = s.items;
    expect(first?.kind === "tool" ? first.call : null).toEqual({
      id: "tc_1",
      name: "channel.update_project",
      args: { id: "post_8a93", status: "rendering" },
      output: "ok",
      ok: true,
      done: true,
      startedAt: T0,
      durationMs: 400,
    });
    expect(second?.kind === "tool" ? second.call.done : null).toBe(false);
    const failed = reduce(s, ev("tool.completed", { tool_call_id: "tc_2", output: { error: "quota" }, is_error: true }, 2000));
    const done = failed.items[1];
    const call = done?.kind === "tool" ? done.call : null;
    expect(call).toMatchObject({ done: true, ok: false, output: '{"error":"quota"}', durationMs: 1900 });
  });

  it("parks on tool.confirm as an approval note and stands down when the next turn begins", () => {
    const s = replay([ev("tool.confirm", { tool_call_id: "tc_9", name: "social.post", args: {}, kind: "tool" }), ev("session.idle", { stop_reason: "awaiting_approval" })]);
    expect(s.pendingApproval).toBe(true);
    expect(texts(s)).toEqual(["(Waiting for your approval of social.post — decide it in Approvals)"]);
    expect(reduce(s, ev("session.running")).pendingApproval).toBe(false);
  });
});

describe("reduce — media jobs", () => {
  it("tracks a job from queued to completed and writes a note at each step", () => {
    const queued = replay([ev("media.job.queued", { kind: "video", model: "veo-3", job_id: "med_1" }), ev("session.idle", { stop_reason: "end_turn" })]);
    expect(queued.jobs).toEqual([{ id: "med_1", kind: "video", model: "veo-3", startedAt: T0, fileIds: null, failed: false }]);
    const done = reduce(queued, ev("media.job.completed", { kind: "video", job_id: "med_1", file_ids: ["fil_a", "fil_b"] }, 60_000));
    expect(done.jobs[0]).toMatchObject({ fileIds: ["fil_a", "fil_b"], failed: false });
    expect(texts(done)).toEqual(["(Queued the video job)", "(The video job finished — fil_a, fil_b)"]);
  });

  it("marks a failed job and a job whose start was before this read", () => {
    const s = replay([ev("media.job.failed", { kind: "video", job_id: "med_2", code: "quota" })]);
    expect(s.jobs).toEqual([{ id: "med_2", kind: "video", startedAt: T0, fileIds: null, failed: true }]);
    expect(texts(s)).toEqual(["(The video job failed (quota))"]);
  });
});

describe("reduce — session and seq", () => {
  it("reads the status and stop reason off the lifecycle events and ignores usage and spans", () => {
    const s = replay([ev("session.running"), ev("session.usage", { consumed_micro_usd: 12 }), ev("span.model_request.start"), ev("session.idle", { stop_reason: "end_turn" })]);
    expect(s).toMatchObject({ status: "idle", stopReason: "end_turn", items: [], lastSeq: 4 });
    expect(reduce(s, ev("session.running"))).toMatchObject({ status: "running", stopReason: null });
  });

  it("ignores an event whose seq it has already applied, so a re-opened relay doubles nothing", () => {
    const first = ev("message.completed", { role: "user", content: "Hi" });
    const s = reduce(emptyStream, first);
    expect(reduce(s, first)).toBe(s);
    expect(reduce(s, { ...first, seq: first.seq - 1 })).toBe(s);
    expect(replay([first, first, first]).items).toHaveLength(1);
  });
});

describe("phaseOf", () => {
  let base: Stream;
  beforeEach(() => {
    base = replay([ev("message.completed", { role: "user", content: "Go" })]);
  });
  const withTool = (s: Stream) => reduce(s, ev("tool.started", { tool_call_id: "tc", name: "generate_video", args: {} }));
  const withBubble = (s: Stream) => reduce(s, ev("message.delta", { content: "Sta" }));
  const withJob = (s: Stream) => reduce(s, ev("media.job.queued", { kind: "video", job_id: "med" }));
  const status = (s: Stream, status: string, stopReason: string | null = null): Stream => ({ ...s, status, stopReason });

  it("answers idle, then sent, then rendering, then thinking, then writing, then a tool, then approval, then failure", () => {
    expect(phaseOf(status(base, "idle", "end_turn"), false)).toEqual({ kind: "idle" });
    expect(phaseOf(status(base, "idle", "end_turn"), true)).toEqual({ kind: "sent" });
    const rendering = status(withJob(base), "idle", "end_turn");
    expect(phaseOf(rendering, true)).toMatchObject({ kind: "rendering", job: { id: "med", fileIds: null } });
    expect(phaseOf(status(withJob(base), "running"), false)).toEqual({ kind: "thinking" });
    expect(phaseOf(status(withBubble(withJob(base)), "running"), false)).toEqual({ kind: "writing" });
    expect(phaseOf(status(withTool(withBubble(withJob(base))), "running"), false)).toEqual({ kind: "tool", name: "generate_video" });
    expect(phaseOf({ ...status(withTool(withBubble(base)), "idle", "awaiting_approval"), pendingApproval: true }, false)).toEqual({ kind: "approval" });
    expect(phaseOf({ ...status(withTool(base), "failed"), pendingApproval: true }, true)).toEqual({ kind: "failed", reason: "the session failed" });
    expect(phaseOf(status(withTool(base), "idle", "error"), false)).toEqual({ kind: "failed", reason: "the turn ended in an error" });
  });

  it("is not rendering once the job has its files or failed, and reads the latest unfinished tool", () => {
    const done = reduce(withJob(base), ev("media.job.completed", { kind: "video", job_id: "med", file_ids: ["fil_1"] }));
    expect(phaseOf(status(done, "idle", "end_turn"), false)).toEqual({ kind: "idle" });
    const failed = reduce(withJob(base), ev("media.job.failed", { kind: "video", job_id: "med" }));
    expect(phaseOf(status(failed, "idle", "end_turn"), false)).toEqual({ kind: "idle" });
    const two = reduce(withTool(base), ev("tool.started", { tool_call_id: "tc2", name: "clip_video", args: {} }));
    expect(phaseOf(status(two, "running"), false)).toEqual({ kind: "tool", name: "clip_video" });
    const finished = reduce(two, ev("tool.completed", { tool_call_id: "tc2", output: "" }));
    expect(phaseOf(status(finished, "running"), false)).toEqual({ kind: "tool", name: "generate_video" });
  });
});

describe("phaseLabel", () => {
  it("names each phase; the render's elapsed time is the UI's to add", () => {
    expect(phaseLabel({ kind: "idle" })).toBe("");
    expect(phaseLabel({ kind: "sent" })).toBe("Sent");
    expect(phaseLabel({ kind: "thinking" })).toBe("Thinking");
    expect(phaseLabel({ kind: "writing" })).toBe("Writing");
    expect(phaseLabel({ kind: "tool", name: "generate_video" })).toBe("Running generate_video");
    expect(phaseLabel({ kind: "rendering", job: { id: "med", kind: "video", startedAt: 0, fileIds: null, failed: false } })).toBe("Rendering video");
    expect(phaseLabel({ kind: "approval" })).toBe("Waiting for your approval");
    expect(phaseLabel({ kind: "failed", reason: "the session failed" })).toBe("Failed: the session failed");
  });
});

describe("duration", () => {
  it("reads tenths under ten seconds, seconds under a minute, then minutes and seconds", () => {
    expect(duration(400)).toBe("0.4s");
    expect(duration(42_000)).toBe("42s");
    expect(duration(252_000)).toBe("4m12s");
    expect(duration(130_000)).toBe("2m10s");
  });
});

describe("readFrames", () => {
  it("holds a half-arrived frame back until the rest of it lands", () => {
    const seen: [string, string][] = [];
    const rest = readFrames("event: a\ndata: 1\n\nevent: b\ndata: 2", (e, d) => seen.push([e, d]));
    expect(seen).toEqual([["a", "1"]]);
    expect(readFrames(`${rest}\n\n`, (e, d) => seen.push([e, d]))).toBe("");
    expect(seen).toEqual([["a", "1"], ["b", "2"]]);
  });
});

describe("frameEvent", () => {
  it("reads the event off the frame body, falls back to the frame's name and the next seq, and drops what is not JSON", () => {
    const full = frameEvent("message.delta", JSON.stringify({ id: "evt_7", seq: 7, type: "message.delta", data: { content: "x" }, created_at: at(0) }), 3);
    expect(full).toEqual({ id: "evt_7", seq: 7, type: "message.delta", data: { content: "x" }, created_at: at(0) });
    expect(frameEvent("session.idle", "{}", 12)).toEqual({ seq: 13, type: "session.idle" });
    expect(frameEvent("x", "not json", 0)).toBeNull();
  });
});
