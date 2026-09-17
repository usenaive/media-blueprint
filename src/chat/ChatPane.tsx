import { ArrowUp, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError, apiGet, messageOf, refusal } from "../api";
import { Clamp, clock } from "../components/kit";
import {
  APPROVALS_TAIL,
  duration,
  emptyStream,
  frameEvent,
  phaseLabel,
  phaseOf,
  readFrames,
  reduce,
  type Item,
  type Phase,
  type Stream,
  type ToolCall,
  type WireEvent,
} from "./stream";

/** The row `GET /api/chat/:id` answers with; the screen's header reads it through `onSession`. */
export interface SessionRow {
  id: string;
  status: string;
  stop_reason: string | null;
  created_at?: string;
  title?: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const RUNNING = new Set(["queued", "running"]);
export const REOPEN_MS = 5000;
const STALL_LIMIT = 20;
const SUMMARY_KEYS = ["id", "status", "model", "title"];

/** A turn past this many lines is folded to them; the operator opens the rest. Sized to `Clamp`'s
 * own measure of "long", so a folded turn always carries its `Read more`. Both sides fold: the
 * day-one intake arrives as a message of yours and is the longest thing in most transcripts. */
const FOLD_LINES = 6;
export const isWall = (text: string): boolean => text.length > FOLD_LINES * 110 || text.split("\n").length > FOLD_LINES;

const OPERATOR = "\n\nOperator: ";

/**
 * A turn the server framed for a seat (`/revise` prefixes the plan, the finishing write and what
 * not to do): the frame, and the operator's own words after it. Null for a turn typed as it reads.
 */
export function framed(text: string): { frame: string; text: string } | null {
  const i = text.lastIndexOf(OPERATOR);
  if (i < 0 || !text.startsWith("Revision of ")) return null;
  return { frame: text.slice(0, i), text: text.slice(i + OPERATOR.length) };
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      done();
    });
  });

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Follows one session's relay from `afterSeq` (exclusive) and hands every event over, in order.
 *
 * Read with `fetch`, not `EventSource`: the relay is one of the `/api/*` routes and every one of
 * them carries the operator's cookie, which `EventSource` has no way to send — an unauthenticated
 * relay was how anyone could read the events of a session this dashboard never created.
 *
 * Ends at `session.idle` unless `keepOpen()` says the session is expected to wake again (a render
 * is still out), in which case it is re-opened after a pause for as long as that holds — a render
 * takes minutes, and the woken session streams in only if the relay is open by then — and not
 * while the tab is hidden: nobody is watching, and the next look re-opens it. A relay that ends
 * without an idle is re-opened from the last `seq` seen, bounded. `onIdle` fires at each idle.
 */
export function followStream(
  sessionId: string,
  afterSeq: number,
  onEvent: (event: WireEvent) => void,
  keepOpen: () => boolean = () => false,
  onIdle?: () => void,
): () => void {
  const control = new AbortController();
  let last = afterSeq;
  /** The pause between re-opens, held while the tab is hidden; false once the session is no longer expected to wake. */
  const rest = async (): Promise<boolean> => {
    do {
      if (control.signal.aborted || !keepOpen()) return false;
      await pause(REOPEN_MS, control.signal);
    } while (hidden());
    return !control.signal.aborted && keepOpen();
  };
  void (async () => {
    let stalls = 0;
    while (!control.signal.aborted) {
      let idle = false;
      let terminal = false;
      try {
        const res = await fetch(`/api/chat/${sessionId}/stream${last > 0 ? `?after_seq=${last}` : ""}`, {
          headers: { accept: "text/event-stream" },
          signal: control.signal,
        });
        if (!res.ok || res.body === null) break;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer = readFrames(buffer + decoder.decode(value, { stream: true }), (name, raw) => {
            const event = frameEvent(name, raw, last);
            if (event === null) return;
            last = Math.max(last, event.seq);
            if (event.type === "session.idle") idle = true;
            if (event.type.startsWith("session.") && TERMINAL.has(event.type.slice("session.".length))) terminal = true;
            onEvent(event);
          });
        }
      } catch {
        break;
      }
      if (terminal || control.signal.aborted) break;
      if (idle) {
        onIdle?.();
        stalls = 0;
        if (!(await rest())) break;
      } else {
        stalls += 1;
        if (stalls >= STALL_LIMIT) break;
        await pause(Math.min(250 * stalls, REOPEN_MS), control.signal);
      }
    }
  })();
  return () => control.abort();
}

/**
 * Reads the transcript `GET /api/chat/:id/events` streams — the store's log, a frame per event, in
 * order — handing each over as it lands, so a long session is on screen from its first page rather
 * than after its last. Resolves with the last `seq` read, which is where the live relay picks up.
 * Rejects on a refusal or on the `error` frame the server ends a cut-short log with.
 */
export async function readLog(sessionId: string, onEvent: (event: WireEvent) => void, signal: AbortSignal): Promise<number> {
  const res = await fetch(`/api/chat/${sessionId}/events`, { headers: { accept: "text/event-stream" }, signal });
  if (!res.ok) throw new ApiError(res.status, refusal(await res.json().catch(() => null)));
  if (res.body === null) return 0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let last = 0;
  let failed: ApiError | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer = readFrames(buffer + decoder.decode(value, { stream: true }), (name, raw) => {
      if (name === "error") {
        failed = new ApiError(502, "the transcript was cut short — reload to read it whole");
        return;
      }
      const event = frameEvent(name, raw, last);
      if (event === null) return;
      last = Math.max(last, event.seq);
      onEvent(event);
    });
  }
  if (failed !== null) throw failed;
  return last;
}

export function argsSummary(args: Record<string, unknown>): string {
  return SUMMARY_KEYS.filter((k) => ["string", "number", "boolean"].includes(typeof args[k]))
    .map((k) => {
      const v = String(args[k]);
      return `${k} ${v.length > 48 ? `${v.slice(0, 47)}…` : v}`;
    })
    .join(" · ");
}

export function placeholderFor(phase: Phase, fallback: string): string {
  if (phase.kind === "approval") return "Answer in Approvals, or say something else…";
  if (phase.kind === "sent" || phase.kind === "thinking" || phase.kind === "writing" || phase.kind === "tool") {
    return "Send to queue after this turn…";
  }
  return fallback;
}

function Step({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const head = call.done ? `Ran ${call.name} · ${duration(call.durationMs)}` : `Running ${call.name}…`;
  const summary = argsSummary(call.args);
  return (
    <div className="step" data-tool={call.name} data-state={call.done ? (call.ok ? "ok" : "fail") : "running"}>
      <span className={`dot ${call.done ? (call.ok ? "dot-ok" : "dot-fail") : "dot-run step-dot-run"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="step-head">
          <span className="font-mono text-ink-2">{head}</span>
          {call.done && call.output !== "" ? (
            <button type="button" className="ml-auto text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide output" : "Show output"}
            </button>
          ) : null}
        </div>
        {summary !== "" ? <div className="step-args">{summary}</div> : null}
        {open ? <pre className="step-out">{call.output}</pre> : null}
      </div>
    </div>
  );
}

function Note({ text }: { text: string }) {
  const i = text.indexOf(APPROVALS_TAIL);
  return (
    <div className="note">
      {i < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, i)}
          <Link to="/approvals">{APPROVALS_TAIL}</Link>
          {text.slice(i + APPROVALS_TAIL.length)}
        </>
      )}
    </div>
  );
}

function Bubble({ item }: { item: Extract<Item, { kind: "user" | "assistant" }> }) {
  const you = item.kind === "user";
  const streaming = !you && item.streaming;
  const split = you ? framed(item.text) : null;
  const text = split === null ? item.text : split.text;
  return (
    <div className={you ? "flex flex-col items-end self-end" : undefined}>
      <div
        className={`whitespace-pre-line text-sm leading-relaxed ${you ? "bubble bubble-you max-w-md" : "bubble bubble-agent max-w-2xl"}`}
        data-streaming={streaming || undefined}
      >
        {streaming ? (
          <>
            {item.text}
            <span className="caret" aria-hidden />
          </>
        ) : isWall(text) ? (
          <Clamp text={text} lines={FOLD_LINES} className={you ? "[&>button]:text-on-accent [&>p]:text-on-accent" : "[&>p]:text-ink"} />
        ) : (
          text
        )}
      </div>
      {split !== null ? <Frame text={split.frame} /> : null}
    </div>
  );
}

/** The server's frame around an operator's note, folded: the words are the turn, the frame is how the seat was told. */
function Frame({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 max-w-md text-xs text-ink-3">
      <button type="button" className="block w-full text-right hover:text-ink hover:underline" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide the frame" : "Sent with the plan's frame"}
      </button>
      {open ? <p className="mt-1 whitespace-pre-line rounded-md border border-line bg-surface-sunken px-3 py-2 text-left leading-relaxed">{text}</p> : null}
    </div>
  );
}

/** Consecutive tool steps share one rail; everything else stands alone. */
function blocks(items: readonly Item[]): ReactNode[] {
  const out: ReactNode[] = [];
  let rail: ToolCall[] = [];
  const flush = () => {
    const head = rail[0];
    if (head === undefined) return;
    out.push(
      <div key={`rail-${head.id}`} className="steps">
        {rail.map((call) => (
          <Step key={call.id} call={call} />
        ))}
      </div>,
    );
    rail = [];
  };
  for (const item of items) {
    if (item.kind === "tool") {
      rail.push(item.call);
      continue;
    }
    flush();
    out.push(item.kind === "note" ? <Note key={item.id} text={item.text} /> : <Bubble key={item.id} item={item} />);
  }
  flush();
  return out;
}

export function ChatPane({
  sessionId,
  send,
  onSession,
  onEvent,
  keepOpen = false,
  placeholder = "Message channel-manager…",
  empty = "Brief the channel-manager: a source video to clip, a series to produce, a week of posts to plan.",
  under = (
    <>
      <span className="font-mono">channel-manager</span> · can clip, produce, post &amp; reply on your connected accounts — approving and publishing stay with you
    </>
  ),
  confirm,
  className = "",
}: {
  sessionId: string | null;
  send: (text: string) => Promise<{ sessionId: string; acceptedSeq: number }>;
  onSession?: (session: SessionRow) => void;
  onEvent?: (event: WireEvent) => void;
  keepOpen?: boolean;
  placeholder?: string;
  /** The absence shown while there is no session yet — who hears the first message. */
  empty?: string;
  /** The line under the composer — the seat and what stays with the operator. `null` draws no strip. */
  under?: ReactNode;
  /**
   * WHEN THE NOTE COSTS MONEY. Set, Enter no longer sends: it arms the spend, and `action` — a
   * button that names the price — is the second, deliberate press that sends it. Unset (Chat, and a
   * note that renders nothing), Enter sends as it always has.
   */
  confirm?: { note: ReactNode; action: string };
  className?: string;
}) {
  const [stream, setStream] = useState<Stream>(emptyStream);
  const [local, setLocal] = useState<Item[]>([]);
  const [draft, setDraft] = useState("");
  /** Only with `confirm`: the note is typed and priced, waiting for the press that spends. */
  const [armed, setArmed] = useState(false);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const opened = useRef<{ id: string; afterSeq: number } | null>(null);
  const stop = useRef<() => void>(() => {});
  const props = useRef({ keepOpen, onSession, onEvent });
  props.current = { keepOpen, onSession, onEvent };
  const end = useRef<HTMLDivElement>(null);

  const refresh = (id: string) =>
    apiGet<SessionRow>(`/chat/${id}`).then(
      (s) => {
        setStream((st) => ({ ...st, status: s.status, stopReason: s.stop_reason }));
        props.current.onSession?.(s);
      },
      () => {},
    );

  const follow = (id: string, afterSeq: number) => {
    stop.current();
    stop.current = followStream(
      id,
      afterSeq,
      (event) => {
        setStream((s) => reduce(s, event));
        setSent(false);
        if (event.type === "message.completed" && event.data?.role === "user") {
          const echo = event.data.content;
          const said = typeof echo === "string" ? (framed(echo)?.text ?? echo) : echo;
          setLocal((l) => {
            const i = l.findIndex((t) => t.kind === "user" && t.text === said);
            return i < 0 ? l : [...l.slice(0, i), ...l.slice(i + 1)];
          });
        }
        props.current.onEvent?.(event);
      },
      () => props.current.keepOpen,
      () => void refresh(id),
    );
  };

  useEffect(() => {
    let live = true;
    const control = new AbortController();
    setError(null);
    if (sessionId === null) {
      setStream(emptyStream);
      setLocal([]);
      setLoading(false);
    } else if (opened.current?.id === sessionId) {
      const { afterSeq } = opened.current;
      opened.current = null;
      setStream({ ...emptyStream, status: "running" });
      follow(sessionId, afterSeq);
    } else {
      setLoading(true);
      setStream(emptyStream);
      setLocal([]);
      setSent(false);
      const onLogged = (event: WireEvent) => {
        if (!live) return;
        setStream((s) => reduce(s, event));
        setLoading(false);
      };
      Promise.all([apiGet<SessionRow>(`/chat/${sessionId}`), readLog(sessionId, onLogged, control.signal)]).then(
        ([s, lastSeq]) => {
          if (!live) return;
          setStream((st) => ({ ...st, status: s.status, stopReason: s.stop_reason, pendingApproval: s.stop_reason === "awaiting_approval" }));
          setLoading(false);
          props.current.onSession?.(s);
          if (RUNNING.has(s.status) || (props.current.keepOpen && !TERMINAL.has(s.status))) follow(sessionId, lastSeq);
        },
        (err: unknown) => {
          if (!live) return;
          setError(messageOf(err));
          setLoading(false);
        },
      );
    }
    return () => {
      live = false;
      control.abort();
      stop.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const phase = phaseOf(stream, sent);
  useEffect(() => {
    if (phase.kind !== "rendering") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  const items = [...stream.items, ...local];
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [items.length, phase.kind]);

  const deliver = () => {
    const text = draft.trim();
    if (text === "") return;
    setArmed(false);
    const turn: Item = { kind: "user", id: `local_${Date.now()}`, at: Date.now(), text };
    setLocal((l) => [...l, turn]);
    setDraft("");
    setError(null);
    setSent(true);
    send(text).then(
      ({ sessionId: id, acceptedSeq }) => {
        if (id !== sessionId) {
          opened.current = { id, afterSeq: acceptedSeq };
          return;
        }
        setStream((s) => ({ ...s, stopReason: null }));
        follow(id, acceptedSeq);
      },
      (err: unknown) => {
        setLocal((l) => l.filter((t) => t !== turn));
        setDraft((d) => (d === "" ? text : d));
        setError(messageOf(err));
        setSent(false);
      },
    );
  };

  /**
   * The Enter key and the send disc. With a `confirm` they arm the spend and nothing leaves: the
   * priced button is the only press that sends, so no habit of the hands buys a render.
   */
  const submit = () => {
    if (draft.trim() === "") return;
    if (confirm !== undefined) {
      setArmed(true);
      return;
    }
    deliver();
  };

  const thinking = phase.kind === "thinking" || phase.kind === "sent";
  const label = phaseLabel(phase);

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="pane-in">
          {loading ? <div className="absence">Reading the conversation…</div> : null}
          {!loading && items.length === 0 && error === null && !thinking ? (
            <div className="absence">
              {sessionId === null ? empty : "Nothing has been said in this session yet."}
            </div>
          ) : null}
          <div className="flex flex-col gap-4">
            {blocks(items)}
            {thinking ? (
              <div className="thinking" role="status" aria-label="Thinking">
                <span />
                <span />
                <span />
              </div>
            ) : null}
            {error !== null ? (
              <div>
                <span className="chip chip-fail">{error}</span>
              </div>
            ) : null}
          </div>
          <div ref={end} />
        </div>
      </div>

      <div className="composer-dock shrink-0">
        <div className="composer-stack">
          {label !== "" ? (
            <div className="chat-status" role="status" data-phase={phase.kind}>
              {phase.kind === "failed" ? (
                <span className="chip chip-fail">{label}</span>
              ) : (
                <>
                  <span className="dot dot-run" aria-hidden />
                  <span>{phase.kind === "rendering" ? `${label} · ${clock(now - phase.job.startedAt)}` : label}</span>
                </>
              )}
            </div>
          ) : null}
          {confirm !== undefined && armed ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-2" role="status">
              <span className="min-w-0 flex-1">{confirm.note}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={deliver}>
                {confirm.action}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArmed(false)}>
                Cancel
              </button>
            </div>
          ) : null}
          <div className="composer">
            <textarea
              className="w-full resize-none bg-transparent px-4 pt-3 outline-none placeholder:text-ink-3"
              rows={1}
              placeholder={placeholderFor(phase, placeholder)}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                // Another word typed is another note: what was priced is not what would be sent.
                setArmed(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1.5">
              <button type="button" className="ghost-disc" title="Attach source video">
                <Plus size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className={`flex size-8 items-center justify-center rounded-full border border-line ${draft ? "bg-accent text-on-accent" : "bg-surface-sunken text-ink-3"}`}
                aria-label="Send"
                onClick={submit}
              >
                <ArrowUp size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
          {under !== null ? <div className="composer-under">{under}</div> : null}
        </div>
      </div>
    </div>
  );
}
