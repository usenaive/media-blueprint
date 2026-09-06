import { ArrowUp, Plus } from "lucide-react";
import { useState } from "react";
import { apiSend, messageOf, replyText } from "../api";

interface Turn {
  you: boolean;
  text: string;
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
 */
export function streamReplies(sessionId: string, append: (text: string) => void): () => void {
  const control = new AbortController();
  void (async () => {
    let idle = false;
    // Bounded, unlike `EventSource`'s own reconnect: a relay that keeps ending without ever saying
    // `session.idle` must not be re-opened forever behind a screen nobody is watching.
    for (let attempt = 0; attempt < 20 && !idle && !control.signal.aborted; attempt++) {
      let res: Response;
      try {
        res = await fetch(`/api/chat/${sessionId}/stream`, {
          headers: { accept: "text/event-stream" },
          signal: control.signal,
        });
      } catch {
        return;
      }
      if (!res.ok || res.body === null) return;
      const reader = res.body.getReader();
      const decode = new TextDecoder();
      let buffer = "";
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        buffer = readFrames(buffer + decode.decode(next.value, { stream: true }), (event, data) => {
          if (event === "session.idle") idle = true;
          if (event === "message.completed") {
            const text = replyText(data);
            if (text !== null) append(text);
          }
        });
      }
    }
  })();
  return () => control.abort();
}

/**
 * The chat is the channel's front door: clipping, producing (single and multi-video), connecting
 * accounts and managing posts all happen as tool calls in one conversation with the
 * channel-manager agent. Nothing is pre-written here — an empty transcript is what a new channel
 * has.
 */
export function Chat() {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setTurns((m) => [...m, { you: true, text }]);
    setDraft("");
    setError(null);
    apiSend<{ id?: string }>("POST", "/chat", { message: text }).then(
      (session) => {
        if (session.id) streamReplies(session.id, (reply) => setTurns((m) => [...m, { you: false, text: reply }]));
      },
      (err: unknown) => setError(messageOf(err)),
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="pane-in flex-1">
        {turns.length === 0 && error === null ? (
          <div className="absence">
            Brief the channel-manager: a source video to clip, a series to produce, a week of posts to plan.
          </div>
        ) : null}
        <div className="flex flex-col gap-4">
          {turns.map((turn, i) => (
            <div key={i} className={turn.you ? "self-end" : undefined}>
              <div className={turn.you ? "bubble bubble-you max-w-md" : "bubble bubble-agent max-w-lg"}>{turn.text}</div>
            </div>
          ))}
          {error ? <div className="text-sm text-tone-fail">{error}</div> : null}
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
                className={`flex size-8 items-center justify-center rounded-full border border-line ${draft ? "bg-action text-on-action" : "bg-surface-sunken text-ink-3"}`}
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
