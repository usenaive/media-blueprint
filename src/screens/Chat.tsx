import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError, apiSend } from "../api";
import { ChatPane } from "../chat/ChatPane";
import { Avatar, ago } from "../components/kit";

/** One chat session as `GET /api/chat` lists it: the platform's row, titled by its first message. */
export interface ChatSession {
  id: string;
  status: string;
  stop_reason: string | null;
  created_at?: string;
  title: string;
}

/** The rail and the Shell re-read the session list on this window event. */
export const SESSIONS_CHANGED = "chat:sessions";
const sessionsChanged = () => window.dispatchEvent(new Event(SESSIONS_CHANGED));

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
 * session arrived at from the rail is read back from its log. The transcript itself is the
 * `ChatPane`; this screen owns the header and the two sends.
 */
export function Chat() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<ChatSession | null>(null);
  // The header is the route's session or nothing: a rail switch must not show the last one while
  // the next loads, and a session just opened from `/chat` appears once its route does.
  const shown = session?.id === sessionId ? session : null;

  const send = async (text: string) => {
    if (sessionId === undefined) {
      const created = await apiSend<{ id?: string }>("POST", "/chat", { message: text });
      if (!created.id) throw new ApiError(502, "the platform did not open a session");
      setSession({ id: created.id, status: "running", stop_reason: null, created_at: new Date().toISOString(), title: text.split("\n")[0]!.slice(0, 60) });
      sessionsChanged();
      void navigate(`/chat/${created.id}`);
      return { sessionId: created.id, acceptedSeq: 0 };
    }
    const accepted = await apiSend<{ accepted_seq?: number }>("POST", `/chat/${sessionId}/messages`, { message: text });
    setSession((s) => (s ? { ...s, status: "running", stop_reason: null } : s));
    return { sessionId, acceptedSeq: accepted.accepted_seq ?? 0 };
  };

  return (
    <div className="flex h-full flex-col">
      {shown ? <SessionHead session={shown} /> : null}
      <ChatPane
        sessionId={sessionId ?? null}
        send={send}
        onSession={(s) => {
          setSession((prev) => ({ ...s, title: s.title ?? (prev?.id === s.id ? prev.title : "") }));
          if (shown?.status !== s.status) sessionsChanged();
        }}
        placeholder="Clip a video, produce a short, connect an account, schedule posts…"
      />
    </div>
  );
}
