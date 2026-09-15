/**
 * The transcript and composer of one session, over `/api/chat/:id`. TEMPORARY: the `chat` unit
 * owns the real pane; this one keeps to the same props so the Studio renders against it.
 */
import { ArrowUp, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiGet, messageOf } from "../api";
import { readFrames } from "../screens/Chat";
import { emptyStream, phaseLabel, phaseOf, reduce, replay, type Item, type Stream, type WireEvent } from "./stream";

interface Session {
  id: string;
  status: string;
  stop_reason: string | null;
}

const parseEvent = (raw: string): WireEvent | null => {
  try {
    const event = JSON.parse(raw) as Partial<WireEvent>;
    return typeof event.seq === "number" && typeof event.type === "string" ? (event as WireEvent) : null;
  } catch {
    return null;
  }
};

const seconds = (ms: number) => `${Math.max(1, Math.round(ms / 1000))}s`;

function ToolRow({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const { call } = item;
  return (
    <details className="group rounded-md border border-line px-3 py-1.5 text-xs">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-ink-2">
        <ChevronRight size={12} strokeWidth={1.75} className="transition-transform group-open:rotate-90" aria-hidden />
        {call.done ? (call.ok ? "Ran" : "Failed") : "Running"} <span className="font-mono">{call.name}</span>
        {call.done ? <span className="text-ink-3">· {seconds(call.durationMs)}</span> : <span className="dot dot-run" aria-hidden />}
      </summary>
      <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-3">{JSON.stringify(call.args, null, 1)}</pre>
      {call.output ? <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-2">{call.output}</pre> : null}
    </details>
  );
}

export function ChatPane({
  sessionId,
  send,
  onSession,
  onEvent,
  keepOpen = false,
  placeholder = "Say what to change…",
  className = "",
}: {
  sessionId: string | null;
  send: (text: string) => Promise<{ sessionId: string; acceptedSeq: number }>;
  onSession?: (session: Session) => void;
  onEvent?: (event: WireEvent) => void;
  keepOpen?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [stream, setStream] = useState<Stream>(emptyStream);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ id: string; text: string }[]>([]);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<() => void>(() => {});
  const keep = useRef(keepOpen);
  keep.current = keepOpen;
  const hear = useRef(onEvent);
  hear.current = onEvent;

  const follow = (id: string, afterSeq: number) => {
    stop.current();
    const control = new AbortController();
    stop.current = () => control.abort();
    void (async () => {
      let last = afterSeq;
      for (let attempt = 0; attempt < 20 && !control.signal.aborted; attempt++) {
        let idle = false;
        let res: Response;
        try {
          res = await fetch(`/api/chat/${id}/stream${last > 0 ? `?after_seq=${last}` : ""}`, { headers: { accept: "text/event-stream" }, signal: control.signal });
        } catch {
          break;
        }
        if (!res.ok || res.body === null) break;
        const reader = res.body.getReader();
        const decode = new TextDecoder();
        let buffer = "";
        for (let next = await reader.read(); !next.done; next = await reader.read()) {
          buffer = readFrames(buffer + decode.decode(next.value, { stream: true }), (_name, data) => {
            const event = parseEvent(data);
            if (event === null) return;
            last = Math.max(last, event.seq);
            if (event.type === "session.idle") idle = true;
            setSent(false);
            setStream((s) => reduce(s, event));
            hear.current?.(event);
          });
        }
        if (idle && !keep.current) break;
        if (idle) await new Promise((wake) => setTimeout(wake, 1500));
      }
    })();
  };

  useEffect(() => {
    setStream(emptyStream);
    setError(null);
    if (sessionId === null) return;
    let live = true;
    setLoading(true);
    Promise.all([apiGet<Session>(`/chat/${sessionId}`), apiGet<{ data: WireEvent[] }>(`/chat/${sessionId}/events`)]).then(
      ([session, log]) => {
        if (!live) return;
        onSession?.(session);
        const replayed = replay(log.data);
        setStream({ ...replayed, status: session.status, stopReason: session.stop_reason });
        setLoading(false);
        if (session.status === "running" || session.status === "queued" || keep.current) follow(sessionId, replayed.lastSeq);
      },
      (err: unknown) => {
        if (!live) return;
        setError(messageOf(err));
        setLoading(false);
      },
    );
    return () => {
      live = false;
      stop.current();
    };
  }, [sessionId]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    const turn = { id: `you_${Date.now()}`, text };
    setPending((p) => [...p, turn]);
    setDraft("");
    setError(null);
    setSent(true);
    send(text).then(
      ({ sessionId: opened, acceptedSeq }) => {
        setStream((s) => ({ ...s, status: "running", stopReason: null }));
        if (opened === sessionId) follow(opened, acceptedSeq);
      },
      (err: unknown) => {
        setPending((p) => p.filter((t) => t !== turn));
        setDraft((d) => (d === "" ? text : d));
        setSent(false);
        setError(messageOf(err));
      },
    );
  };

  const said = new Set(stream.items.filter((item) => item.kind === "user").map((item) => item.text));
  const phase = phaseOf(stream, sent);
  const label = phaseLabel(phase);

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loading ? <div className="absence">Reading the conversation…</div> : null}
        {!loading && sessionId === null && pending.length === 0 ? <div className="absence">Nothing has been said yet.</div> : null}
        <div className="flex flex-col gap-3">
          {stream.items.map((item) => {
            if (item.kind === "user") return <div key={item.id} className="bubble bubble-you max-w-md self-end whitespace-pre-line text-sm leading-relaxed">{item.text}</div>;
            if (item.kind === "assistant") {
              return (
                <div key={item.id} className="bubble bubble-agent max-w-2xl whitespace-pre-line text-sm leading-relaxed">
                  {item.text}
                  {item.streaming ? <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent align-text-bottom" aria-hidden /> : null}
                </div>
              );
            }
            if (item.kind === "tool") return <ToolRow key={item.id} item={item} />;
            return <div key={item.id} className="text-xs italic text-ink-3">{item.text}</div>;
          })}
          {pending.filter((turn) => !said.has(turn.text)).map((turn) => (
            <div key={turn.id} className="bubble bubble-you max-w-md self-end whitespace-pre-line text-sm leading-relaxed">{turn.text}</div>
          ))}
          {label !== "" ? (
            <div className={`flex items-center gap-2 text-xs ${phase.kind === "failed" ? "text-fail" : "text-ink-3"}`}>
              {phase.kind === "thinking" || phase.kind === "writing" || phase.kind === "tool" || phase.kind === "rendering" ? <span className="dot dot-run animate-pulse" aria-hidden /> : null}
              {label}
            </div>
          ) : null}
          {error ? <div><span className="chip chip-fail">{error}</span></div> : null}
        </div>
      </div>
      <div className="composer-dock">
        <div className="composer-stack">
          <div className="composer">
            <textarea
              className="w-full resize-none bg-transparent px-4 pt-3 outline-none placeholder:text-ink-3"
              rows={1}
              placeholder={label === "" ? placeholder : `${label}…`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="flex items-center justify-end px-2.5 pb-2.5 pt-1.5">
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
        </div>
      </div>
    </div>
  );
}
