/**
 * The session's event stream, reduced to what the chat draws.
 *
 * One pure reducer runs on both reads of a session: the log is replayed through it when a session
 * is opened, and the relay's live frames are folded into the same shape after. `seq` is monotonic
 * and gap-free (§8), so an event already applied is ignored and a re-opened relay picking up at
 * `after_seq=<last seen>` can never double a bubble.
 *
 * Below the transcript sits ONE decision — `phaseOf` — which is what the status line, the thinking
 * dots and the composer placeholder all read. A render is asynchronous: `generate_video` returns
 * at once and the session goes idle while the job runs, so "idle" is not "done"; the job's own
 * lifecycle events say when the video is.
 */

export interface WireEvent {
  id?: string;
  seq: number;
  type: string;
  data?: Record<string, unknown>;
  created_at?: string;
}

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  output: string;
  ok: boolean;
  done: boolean;
  startedAt: number;
  durationMs: number;
};

export type Item =
  | { kind: "user"; id: string; at: number; text: string }
  | { kind: "assistant"; id: string; at: number; text: string; streaming: boolean }
  | { kind: "tool"; id: string; at: number; call: ToolCall }
  | { kind: "note"; id: string; at: number; text: string };

export interface MediaJob {
  id: string;
  kind: string;
  model?: string;
  startedAt: number;
  fileIds: string[] | null;
  failed: boolean;
}

export interface Stream {
  items: Item[];
  lastSeq: number;
  status: string | null;
  stopReason: string | null;
  jobs: MediaJob[];
  pendingApproval: boolean;
}

export const emptyStream: Stream = { items: [], lastSeq: 0, status: null, stopReason: null, jobs: [], pendingApproval: false };

/** The sentence a parked approval reads as; the pane links its last word to `/approvals`. */
export const APPROVALS_TAIL = " — decide it in Approvals";

const SESSION_STATUSES = new Set(["queued", "running", "idle", "completed", "failed", "cancelled"]);

const str = (data: Record<string, unknown>, key: string): string => (typeof data[key] === "string" ? (data[key] as string) : "");

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** A tool's output as prose: the harness hands a string, an older one the JSON it came from. */
const textOf = (value: unknown): string =>
  value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);

function appendDelta(items: Item[], id: string, at: number, text: string): Item[] {
  const last = items[items.length - 1];
  // Only a bubble still being built takes more deltas; a finished one is a previous message.
  if (last?.kind === "assistant" && last.streaming) return [...items.slice(0, -1), { ...last, text: last.text + text }];
  return [...items, { kind: "assistant", id, at, text, streaming: true }];
}

/**
 * Finish the bubble the deltas were building, wherever it now sits — a tool row may have landed
 * after it. The completion is the whole answer, so it replaces what streamed; when the bubble
 * holds MORE than the completion, the turn said two things and this is the first: the rest stays
 * streaming for the completion that owns it. No streaming bubble → null, and the caller appends.
 */
function finishStreamed(items: Item[], id: string, text: string): Item[] | null {
  let at = items.length - 1;
  while (at >= 0 && !(items[at]!.kind === "assistant" && (items[at] as { streaming: boolean }).streaming)) at -= 1;
  const bubble = items[at];
  if (bubble === undefined || bubble.kind !== "assistant") return null;
  const finished: Item = { ...bubble, text, streaming: false };
  if (bubble.text.length > text.length && bubble.text.startsWith(text)) {
    return [...items.slice(0, at), finished, { ...bubble, id, text: bubble.text.slice(text.length) }, ...items.slice(at + 1)];
  }
  return [...items.slice(0, at), finished, ...items.slice(at + 1)];
}

function reduceJobs(jobs: MediaJob[], event: WireEvent, data: Record<string, unknown>, at: number): MediaJob[] {
  const id = str(data, "job_id");
  const kind = str(data, "kind") || "media";
  if (event.type === "media.job.queued") {
    if (jobs.some((j) => j.id === id)) return jobs;
    return [...jobs, { id, kind, ...(str(data, "model") === "" ? {} : { model: str(data, "model") }), startedAt: at, fileIds: null, failed: false }];
  }
  const done = event.type === "media.job.completed" ? { fileIds: strings(data["file_ids"]) } : { failed: true };
  // A job whose start was before the tail this read began at is still a job that ended.
  if (!jobs.some((j) => j.id === id)) return [...jobs, { id, kind, startedAt: at, fileIds: null, failed: false, ...done }];
  return jobs.map((j) => (j.id === id ? { ...j, ...done } : j));
}

function noteOf(type: string, data: Record<string, unknown>): string | null {
  const kind = str(data, "kind") || "media";
  switch (type) {
    case "media.job.queued":
      return `Queued the ${kind} job`;
    case "media.job.completed": {
      const ids = strings(data["file_ids"]);
      return `The ${kind} job finished${ids.length === 0 ? "" : ` — ${ids.join(", ")}`}`;
    }
    case "media.job.failed":
      return `The ${kind} job failed${str(data, "code") === "" ? "" : ` (${str(data, "code")})`}`;
    case "tool.confirm":
      return `Waiting for your approval of ${str(data, "name") || "a tool call"}${APPROVALS_TAIL}`;
    default:
      return null;
  }
}

export function reduce(stream: Stream, event: WireEvent): Stream {
  if (event.seq <= stream.lastSeq) return stream;
  const data = event.data ?? {};
  const id = event.id ?? `evt_${event.seq}`;
  const parsed = event.created_at === undefined ? Number.NaN : Date.parse(event.created_at);
  const at = Number.isFinite(parsed) ? parsed : Date.now();
  const next: Stream = { ...stream, lastSeq: event.seq };

  if (event.type.startsWith("session.")) {
    const status = event.type.slice("session.".length);
    if (!SESSION_STATUSES.has(status)) return next;
    next.status = status;
    if (status === "idle") {
      next.stopReason = str(data, "stop_reason") || null;
      if (next.stopReason === "awaiting_approval") next.pendingApproval = true;
    } else {
      next.stopReason = null;
      // A new turn is the park ending: the operator's decision is folded into it.
      if (status === "running") next.pendingApproval = false;
    }
    return next;
  }

  switch (event.type) {
    case "message.delta": {
      const text = str(data, "content");
      return text === "" ? next : { ...next, items: appendDelta(stream.items, id, at, text) };
    }
    case "message.completed": {
      const text = str(data, "content");
      if (str(data, "role") === "user") return text === "" ? next : { ...next, items: [...stream.items, { kind: "user", id, at, text }] };
      if (text === "") return next;
      return { ...next, items: finishStreamed(stream.items, id, text) ?? [...stream.items, { kind: "assistant", id, at, text, streaming: false }] };
    }
    case "tool.started": {
      const args = data["args"];
      const call: ToolCall = {
        id: str(data, "tool_call_id"),
        name: str(data, "name"),
        args: typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
        output: "",
        ok: true,
        done: false,
        startedAt: at,
        durationMs: 0,
      };
      return { ...next, items: [...stream.items, { kind: "tool", id, at, call }] };
    }
    case "tool.completed": {
      const callId = str(data, "tool_call_id");
      return {
        ...next,
        items: stream.items.map((item) =>
          item.kind === "tool" && item.call.id === callId && !item.call.done
            ? { ...item, call: { ...item.call, output: textOf(data["output"]), ok: data["is_error"] !== true, done: true, durationMs: Math.max(0, at - item.call.startedAt) } }
            : item,
        ),
      };
    }
    case "tool.confirm":
      return { ...next, pendingApproval: true, items: [...stream.items, { kind: "note", id, at, text: noteOf(event.type, data)! }] };
    case "media.job.queued":
    case "media.job.completed":
    case "media.job.failed":
      return { ...next, jobs: reduceJobs(stream.jobs, event, data, at), items: [...stream.items, { kind: "note", id, at, text: noteOf(event.type, data)! }] };
    default:
      return next;
  }
}

export function replay(events: readonly WireEvent[]): Stream {
  return events.reduce(reduce, emptyStream);
}

export type Phase =
  | { kind: "idle" }
  | { kind: "sent" }
  | { kind: "thinking" }
  | { kind: "writing" }
  | { kind: "tool"; name: string }
  | { kind: "rendering"; job: MediaJob }
  | { kind: "approval" }
  | { kind: "failed"; reason: string };

const isRunning = (status: string | null) => status === "running" || status === "queued";

/**
 * What the session is doing right now, as one answer. The order is the priority: a failure
 * outranks everything, then a parked approval (nothing moves until the operator decides), then
 * the turn's own activity, then a render in flight while the session sleeps, then a send the
 * platform has not answered yet.
 */
export function phaseOf(stream: Stream, sent: boolean): Phase {
  if (stream.status === "failed") return { kind: "failed", reason: "the session failed" };
  if (stream.stopReason === "error") return { kind: "failed", reason: "the turn ended in an error" };
  if (stream.pendingApproval) return { kind: "approval" };
  const running = [...stream.items].reverse().find((item) => item.kind === "tool" && !item.call.done);
  if (running?.kind === "tool") return { kind: "tool", name: running.call.name };
  if (stream.items.some((item) => item.kind === "assistant" && item.streaming)) return { kind: "writing" };
  if (isRunning(stream.status)) return { kind: "thinking" };
  const job = stream.jobs.find((j) => j.fileIds === null && !j.failed);
  if (job !== undefined) return { kind: "rendering", job };
  if (sent) return { kind: "sent" };
  return { kind: "idle" };
}

/** The status line's words; a `rendering` label takes its elapsed time from the UI's own clock. */
export function phaseLabel(phase: Phase): string {
  switch (phase.kind) {
    case "idle":
      return "";
    case "sent":
      return "Sent";
    case "thinking":
      return "Thinking";
    case "writing":
      return "Writing";
    case "tool":
      return `Running ${phase.name}`;
    case "rendering":
      return `Rendering ${phase.job.kind}`;
    case "approval":
      return "Waiting for your approval";
    case "failed":
      return `Failed: ${phase.reason}`;
  }
}

/** "4m12s" / "0.4s" — how long a step took, or a render has been going. */
export function duration(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Splits an event-stream buffer into whole `event:`/`data:` frames, returning the leftover.
 * Exported because this is the only part of the reader worth asserting without a socket.
 */
export function readFrames(buffer: string, onFrame: (event: string, data: string) => void): string {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const lines = part.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (data !== "") onFrame(event, data);
  }
  return rest;
}

/**
 * One relay frame as the event it carries. The wire is `event: <type>` + `data: <the whole event>`,
 * so the type is read off the body and the frame name is the fallback; a frame with no `seq` (a
 * relay that only names the event) is taken as the next one, so it is applied rather than dropped.
 */
export function frameEvent(name: string, raw: string, lastSeq: number): WireEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const event = typeof body === "object" && body !== null ? (body as Partial<WireEvent> & { data?: unknown }) : {};
  const data = typeof event.data === "object" && event.data !== null && !Array.isArray(event.data) ? (event.data as Record<string, unknown>) : undefined;
  return {
    ...(typeof event.id === "string" ? { id: event.id } : {}),
    seq: typeof event.seq === "number" ? event.seq : lastSeq + 1,
    type: typeof event.type === "string" && event.type !== "" ? event.type : name,
    ...(data === undefined ? {} : { data }),
    ...(typeof event.created_at === "string" ? { created_at: event.created_at } : {}),
  };
}
