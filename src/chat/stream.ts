/**
 * One session's event log, reduced to what a transcript draws. TEMPORARY: the `chat` unit owns the
 * real file; this one satisfies the same contract so the Studio can be built against it.
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

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => (typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value));

export function reduce(stream: Stream, event: WireEvent): Stream {
  if (event.seq <= stream.lastSeq) return stream;
  const d = event.data ?? {};
  const at = event.created_at ? Date.parse(event.created_at) : Date.now();
  const id = event.id ?? `evt_${event.seq}`;
  const next: Stream = { ...stream, lastSeq: event.seq };
  const push = (item: Item): Stream => ({ ...next, items: [...next.items, item] });
  const last = next.items.at(-1);
  switch (event.type) {
    case "session.running":
      return { ...next, status: "running", stopReason: null, pendingApproval: false };
    case "session.idle":
      return { ...next, status: "idle", stopReason: str(d.stop_reason) };
    case "message.delta": {
      const chunk = str(d.content) ?? "";
      if (last?.kind === "assistant" && last.streaming) {
        return { ...next, items: [...next.items.slice(0, -1), { ...last, text: last.text + chunk }] };
      }
      return push({ kind: "assistant", id, at, text: chunk, streaming: true });
    }
    case "message.completed": {
      const content = str(d.content);
      if (content === null || content === "") return next;
      if (d.role === "user") return push({ kind: "user", id, at, text: content });
      if (last?.kind === "assistant" && last.streaming) {
        return { ...next, items: [...next.items.slice(0, -1), { ...last, text: content, streaming: false }] };
      }
      return push({ kind: "assistant", id, at, text: content, streaming: false });
    }
    case "tool.started":
      return push({
        kind: "tool",
        id,
        at,
        call: { id: str(d.tool_call_id) ?? id, name: str(d.name) ?? "tool", args: record(d.args), output: "", ok: true, done: false, startedAt: at, durationMs: 0 },
      });
    case "tool.completed": {
      const callId = str(d.tool_call_id);
      const open = next.items.findIndex((item) => item.kind === "tool" && item.call.id === callId && !item.call.done);
      const finish = (call: ToolCall): ToolCall => ({ ...call, done: true, output: text(d.output), ok: d.is_error !== true, durationMs: Math.max(0, at - call.startedAt) });
      if (open === -1) {
        return push({ kind: "tool", id, at, call: finish({ id: callId ?? id, name: str(d.name) ?? "tool", args: record(d.args), output: "", ok: true, done: false, startedAt: at, durationMs: 0 }) });
      }
      const item = next.items[open] as Extract<Item, { kind: "tool" }>;
      return { ...next, items: next.items.map((one, i) => (i === open ? { ...item, call: finish(item.call) } : one)) };
    }
    case "tool.confirm":
      return { ...push({ kind: "note", id, at, text: `Waiting for your approval of ${str(d.name) ?? "a tool"} — decide it in Approvals` }), pendingApproval: true };
    case "media.job.queued": {
      const kind = str(d.kind) ?? "media";
      const model = str(d.model) ?? undefined;
      const job: MediaJob = { id: str(d.job_id) ?? id, kind, model, startedAt: at, fileIds: null, failed: false };
      return { ...push({ kind: "note", id, at, text: `Started a ${kind} render${model ? ` on ${model}` : ""} — it lands here when it is done` }), jobs: [...next.jobs, job] };
    }
    case "media.job.completed": {
      const jobId = str(d.job_id);
      const files = Array.isArray(d.file_ids) ? d.file_ids.filter((f): f is string => typeof f === "string") : [];
      const jobs = next.jobs.some((job) => job.id === jobId)
        ? next.jobs.map((job) => (job.id === jobId ? { ...job, fileIds: files } : job))
        : [...next.jobs, { id: jobId ?? id, kind: str(d.kind) ?? "media", startedAt: at, fileIds: files, failed: false }];
      return { ...push({ kind: "note", id, at, text: `The ${str(d.kind) ?? "media"} is ready: ${files.join(", ")}` }), jobs };
    }
    case "media.job.failed": {
      const jobId = str(d.job_id);
      const code = str(d.code);
      return {
        ...push({ kind: "note", id, at, text: `The ${str(d.kind) ?? "media"} render failed${code ? ` (${code})` : ""}` }),
        jobs: next.jobs.map((job) => (job.id === jobId ? { ...job, failed: true } : job)),
      };
    }
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

export function phaseOf(stream: Stream, sent: boolean): Phase {
  const running = stream.status === "running" || stream.status === "queued";
  if (stream.status === "failed" || stream.stopReason === "error") return { kind: "failed", reason: stream.stopReason ?? stream.status ?? "unknown" };
  if (stream.pendingApproval && !running) return { kind: "approval" };
  const last = stream.items.at(-1);
  if (running && last?.kind === "tool" && !last.call.done) return { kind: "tool", name: last.call.name };
  if (last?.kind === "assistant" && last.streaming) return { kind: "writing" };
  if (running) return { kind: "thinking" };
  const job = stream.jobs.find((one) => one.fileIds === null && !one.failed);
  if (job) return { kind: "rendering", job };
  if (sent) return { kind: "sent" };
  return { kind: "idle" };
}

export function phaseLabel(phase: Phase): string {
  switch (phase.kind) {
    case "thinking": return "Thinking";
    case "writing": return "Writing";
    case "tool": return `Running ${phase.name}`;
    case "rendering": return `Rendering ${phase.job.kind}`;
    case "approval": return "Waiting for your approval";
    case "failed": return `Failed: ${phase.reason}`;
    case "sent": return "Sent";
    case "idle": return "";
  }
}
