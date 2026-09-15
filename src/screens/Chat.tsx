import { ArrowUp, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { apiGet, apiSend, messageOf, replyText } from "../api";
import { Avatar, Clamp, ago } from "../components/kit";

export interface Turn {
  you: boolean;
  text: string;
}

/** One chat session as `GET /api/chat` lists it: the platform's row, titled by its first message. */
export interface ChatSession {
  id: string;
  status: string;
  stop_reason: string | null;
  created_at?: string;
  title: string;
}

/** One event of a session's log (`GET /api/chat/:id/events`); only `message.completed` is read. */
export interface WireEvent {
  seq: number;
  type: string;
  data?: { role?: string; content?: unknown };
}

/** The rail and the Shell re-read the session list on this window event. */
export const SESSIONS_CHANGED = "chat:sessions";
const sessionsChanged = () => window.dispatchEvent(new Event(SESSIONS_CHANGED));

/** A reply past this many lines is folded to them; the operator opens the rest. Sized to `Clamp`'s
 * own measure of "long", so a folded reply always carries its `Read more`. */
const FOLD_LINES = 6;
export const isWall = (text: string): boolean => text.length > FOLD_LINES * 110 || text.split("\n").length > FOLD_LINES;

/**
 * The transcript, reduced from the log: the stream carries both sides (canonical-spec §8), the
 * caller's turn as `message.completed` with `role: "user"` and the agent's reply as the same type
 * with no role (or `assistant`, as the harness stamps it).
 */
export function turnsFrom(events: readonly WireEvent[]): Turn[] {
  const turns: Turn[] = [];
  for (const event of events) {
    if (event.type !== "message.completed" || typeof event.data?.content !== "string" || event.data.content === "") continue;
    turns.push({ you: event.data.role === "user", text: event.data.content });
  }
  return turns;
}

/**
 * What a session is doing, as one word and one colour — the rail's dot and the header's chip read
 * the same answer. `status` says whether a turn is open; `stop_reason` says why the last one
 * yielded, and only the three that wait on a person are warnings (§5).
 */
export function sessionState(s: Pick<ChatSession, "status" | "stop_reason">): { label: string; dot: string; chip: string } {
  if (s.status === "running" || s.status === "queued") return { label: "Running", dot: "dot-run", chip: "chip-credit" };
  if (s.status === "failed" || s.stop_reason === "error") return { label: "Failed", dot: "dot-fail", chip: "chip-fail" };
  if (s.stop_reason === "awaiting_approval") return { label: "Awaiting approval", dot: "dot-warn", chip: "chip-absent" };
  if (s.stop_reason === "awaiting_answer") return { label: "Awaiting answer", dot: "dot-warn", chip: "chip-absent" };
  if (s.stop_reason === "awaiting_input") return { label: "Awaiting input", dot: "dot-warn", chip: "chip-absent" };
  if (s.status === "completed") return { label: "Done", dot: "dot-idle", chip: "chip-plain" };
  if (s.status === "cancelled") return { label: "Cancelled", dot: "dot-idle", chip: "chip-plain" };
  return { label: "Idle", dot: "dot-idle", chip: "chip-plain" };
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
 * Streams one session's replies into the transcript until it goes idle.
 *
 * Read with `fetch`, not `EventSource`: the relay is one of the `/api/*` routes and every one of
 * them now carries the operator's bearer, which `EventSource` has no way to send — an unauthenticated
 * relay was how anyone could read the events of a session this dashboard never created. The loop
 * re-opens while the session is still running, which is what `EventSource` used to do for free when
 * the deployed function hits its duration ceiling mid-session.
 *
 * Every frame is decoded by `replyText`, which is where this screen used to lose the whole
 * conversation: it only appended frames with no `role`, and the harness that runs these sessions
 * stamps `role: "assistant"` on every one of them, so the transcript stayed empty no matter what
 * the agent said. The stream also carries the caller's own message back; that one is skipped
 * because the composer already put it on screen.
 *
 * `afterSeq` is where to pick the log up (exclusive, §8): a resumed session starts past the
 * transcript it already holds, a follow-up past its `accepted_seq`. Each re-open continues from
 * the last `seq` seen, so a relay that ends mid-session does not replay what is already on screen.
 * `onEnd` fires once the loop is over, idle or given up.
 */
export function streamReplies(sessionId: string, append: (text: string) => void, afterSeq = 0, onEnd?: () => void): () => void {
  const control = new AbortController();
  let last = afterSeq;
  void (async () => {
    let idle = false;
    // Bounded, unlike `EventSource`'s own reconnect: a relay that keeps ending without ever saying
    // `session.idle` must not be re-opened forever behind a screen nobody is watching.
    for (let attempt = 0; attempt < 20 && !idle && !control.signal.aborted; attempt++) {
      let res: Response;
      try {
        res = await fetch(`/api/chat/${sessionId}/stream${last > 0 ? `?after_seq=${last}` : ""}`, {
          headers: { accept: "text/event-stream" },
          signal: control.signal,
        });
      } catch {
        break;
      }
      if (!res.ok || res.body === null) break;
      const reader = res.body.getReader();
      const decode = new TextDecoder();
      let buffer = "";
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        buffer = readFrames(buffer + decode.decode(next.value, { stream: true }), (event, data) => {
          last = Math.max(last, seqOf(data));
          if (event === "session.idle") idle = true;
          if (event === "message.completed") {
            const text = replyText(data);
            if (text !== null) append(text);
          }
        });
      }
    }
    if (!control.signal.aborted) onEnd?.();
  })();
  return () => control.abort();
}

function seqOf(data: string): number {
  try {
    const seq = (JSON.parse(data) as { seq?: unknown }).seq;
    return typeof seq === "number" ? seq : 0;
  } catch {
    return 0;
  }
}

function SessionHead({ session }: { session: ChatSession }) {
  const state = sessionState(session);
  return (
    <header className="flex items-center gap-3 border-b border-line bg-surface px-6 py-3">
      <Avatar name="channel-manager" size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{session.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
          <span className={`chip ${state.chip}`}>{state.label}</span>
          {session.created_at ? <span>{ago(session.created_at)}</span> : null}
        </div>
      </div>
      <span className="font-mono text-xs text-ink-3">{session.id}</span>
    </header>
  );
}

/**
 * The chat is the channel's front door: clipping, producing (single and multi-video), connecting
 * accounts and managing posts all happen as tool calls in one conversation with the
 * channel-manager agent. Nothing is pre-written here — an empty transcript is what a new channel
 * has.
 *
 * `/chat` is the empty composer; the first send opens the session and moves to `/chat/:id`. One
 * route serves both (`chat/:sessionId?`), so the turn just sent survives the move and only a
 * session arrived at from the rail is read back from its log.
 */
export function Chat() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  const stop = useRef<() => void>(() => {});

  const reply = (text: string) => setTurns((m) => [...m, { you: false, text }]);
  const refresh = (id: string) =>
    apiGet<ChatSession>(`/chat/${id}`).then(setSession, () => {});
  const follow = (id: string, afterSeq: number) => {
    stop.current();
    stop.current = streamReplies(id, reply, afterSeq, () => {
      void refresh(id);
      sessionsChanged();
    });
  };

  useEffect(() => {
    setError(null);
    let live = true;
    if (sessionId === undefined) {
      setSession(null);
      setTurns([]);
    } else if (opened.current === sessionId) {
      opened.current = null;
      follow(sessionId, 0);
    } else {
      setLoading(true);
      setTurns([]);
      Promise.all([apiGet<ChatSession>(`/chat/${sessionId}`), apiGet<{ data: WireEvent[] }>(`/chat/${sessionId}/events`)]).then(
        ([s, log]) => {
          if (!live) return;
          setSession(s);
          setTurns(turnsFrom(log.data));
          setLoading(false);
          if (s.status === "running" || s.status === "queued") follow(sessionId, log.data.at(-1)?.seq ?? 0);
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
      stop.current();
    };
  }, [sessionId]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setTurns((m) => [...m, { you: true, text }]);
    setDraft("");
    setError(null);
    if (sessionId === undefined) {
      apiSend<{ id?: string }>("POST", "/chat", { message: text }).then(
        (created) => {
          if (!created.id) return;
          opened.current = created.id;
          setSession({ id: created.id, status: "running", stop_reason: null, created_at: new Date().toISOString(), title: text.split("\n")[0]!.slice(0, 60) });
          sessionsChanged();
          void navigate(`/chat/${created.id}`);
        },
        (err: unknown) => setError(messageOf(err)),
      );
      return;
    }
    apiSend<{ accepted_seq?: number }>("POST", `/chat/${sessionId}/messages`, { message: text }).then(
      (accepted) => {
        setSession((s) => (s ? { ...s, status: "running", stop_reason: null } : s));
        follow(sessionId, accepted.accepted_seq ?? 0);
      },
      (err: unknown) => setError(messageOf(err)),
    );
  };

  return (
    <div className="flex h-full flex-col">
      {session ? <SessionHead session={session} /> : null}
      <div className="pane-in flex-1">
        {loading ? <div className="absence">Reading the conversation…</div> : null}
        {!loading && turns.length === 0 && error === null ? (
          <div className="absence">
            {session
              ? "Nothing has been said in this session yet."
              : "Brief the channel-manager: a source video to clip, a series to produce, a week of posts to plan."}
          </div>
        ) : null}
        <div className="flex flex-col gap-4">
          {turns.map((turn, i) => (
            <div key={i} className={turn.you ? "self-end" : undefined}>
              <div className={`whitespace-pre-line text-sm leading-relaxed ${turn.you ? "bubble bubble-you max-w-md" : "bubble bubble-agent max-w-2xl"}`}>
                {!turn.you && isWall(turn.text) ? <Clamp text={turn.text} lines={FOLD_LINES} className="[&>p]:text-ink" /> : turn.text}
              </div>
            </div>
          ))}
          {error ? (
            <div>
              <span className="chip chip-fail">{error}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="composer-dock">
        <div className="composer-stack">
          <div className="composer">
            <textarea
              className="w-full resize-none bg-transparent px-4 pt-3 outline-none placeholder:text-ink-3"
              rows={1}
              placeholder="Clip a video, produce a short, connect an account, schedule posts…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
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
                onClick={send}
              >
                <ArrowUp size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div className="composer-under">
            <span className="font-mono">channel-manager</span> · can clip, produce, post &amp; reply on your connected accounts
          </div>
        </div>
      </div>
    </div>
  );
}
