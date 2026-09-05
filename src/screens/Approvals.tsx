import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiGet, apiSend, messageOf } from "../api";
import { MediaPreview, PageHeader } from "../components/kit";

/**
 * THE SCREEN THE AGENTS HAVE BEEN WAITING ON.
 *
 * `social.post` is granted `ask` to every agent of every template, which is the whole promise of
 * this blueprint: an agent may compose a publish, and only a person may let it happen. The platform
 * implements that promise exactly — the turn parks, `stop_reason` becomes `awaiting_approval`, and
 * the blocked call sits in `session.pending_actions` as `{ tool_call_id, name, args }` until
 * `POST /v1/sessions/{id}/tool_confirmations` decides it.
 *
 * None of it reached the operator. The dashboard proxied sessions in one direction only (open one,
 * stream its replies), so a parked agent was silence: nothing in the rail, nothing on a screen, and
 * the only way to release the call was a terminal with the org key in it. This screen adds no
 * mechanism — it surfaces the one that was already running.
 *
 * The arguments ARE the thing being approved, so they are rendered rather than dumped, and a media
 * URL among them is played here: approving a publish you cannot watch is the same failure the queue
 * had.
 */

/** The fields of a session this screen reads (`canonical-spec §5`); the wire carries more. */
export interface WireSession {
  id: string;
  agent_id: string;
  status: string;
  stop_reason: string | null;
  pending_actions?: { tool_call_id: string; name: string; args?: Record<string, unknown> }[];
  created_at?: string;
}

/** One blocked call, with the session it belongs to and the agent that made it. */
export interface Parked {
  sessionId: string;
  agent: string;
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  since: string | undefined;
}

/**
 * Every call waiting on a person, oldest first — the one that has been blocked longest is the one
 * costing the most. A session is listed because it holds a pending action, not because of its
 * `status`: a parked session is `idle` with `stop_reason: "awaiting_approval"`, so keying off
 * `status` alone would list every finished session in the org.
 */
export function parked(sessions: readonly WireSession[], names: Map<string, string>): Parked[] {
  return sessions
    .flatMap((session) =>
      (session.pending_actions ?? []).map((action) => ({
        sessionId: session.id,
        agent: names.get(session.agent_id) ?? session.agent_id,
        toolCallId: action.tool_call_id,
        tool: action.name,
        args: action.args ?? {},
        since: session.created_at,
      })),
    )
    .sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
}

/** `media_urls` → `Media urls`; the agent's own key, made readable and never renamed away. */
const label = (key: string): string => {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const isUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\/\S+$/i.test(value);

/** One argument, as a person reads it: a label, its value in prose, and any media it points at. */
export interface ArgRow {
  key: string;
  label: string;
  text: string;
  media: string[];
}

const asText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(asText).join(", ");
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${label(key)}: ${asText(inner)}`)
      .join("\n");
  }
  return String(value);
};

/**
 * The proposed call's arguments, rendered rather than dumped. A pretty-printed JSON blob is the
 * one thing this surface may not be: the operator is being asked to approve *these values*, and
 * quoting them in the agent's own key names — with the URLs pulled out so they can be watched — is
 * what makes the decision a decision.
 */
export function argRows(args: Record<string, unknown>): ArgRow[] {
  return Object.entries(args).map(([key, value]) => {
    const media = (Array.isArray(value) ? value : [value]).filter(isUrl);
    return { key, label: label(key), text: media.length > 0 ? "" : asText(value), media };
  });
}

/** What the server confirmed about one decision. Never written before its reply lands. */
interface Decided {
  ok: boolean;
  text: string;
}

export function Approvals() {
  const [sessions, setSessions] = useState<WireSession[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, Decided>>({});

  const load = () =>
    apiGet<{ data?: WireSession[]; has_more?: boolean }>("/sessions").then(
      (page) => {
        setSessions(page.data ?? []);
        setPartial(page.has_more === true);
        setError(null);
      },
      // The list is dropped, not emptied: an empty inbox over a failed read is the lie this screen
      // exists not to tell — it would say "nobody is waiting on you" when nobody knows.
      (err: unknown) => {
        setSessions(null);
        setError(messageOf(err));
      },
    );

  useEffect(() => {
    void load();
    apiGet<{ data?: { id: string; name: string }[] }>("/agents").then(
      (page) => setNames(new Map((page.data ?? []).map((agent) => [agent.id, agent.name]))),
      // The roster is a nicety here: without it a row names the agent by its id, which still
      // identifies it. A failed roster must not blank the queue.
      () => {},
    );
  }, []);

  /**
   * Sends one decision and reports only what came back. A 202 is the platform accepting the
   * decision — not the tool having run — so the sentence says exactly that.
   */
  const decide = (item: Parked, decision: "allow" | "deny") => {
    const reason = (reasons[item.toolCallId] ?? "").trim();
    setBusy(item.toolCallId);
    apiSend<WireSession>("POST", `/sessions/${item.sessionId}/tool_confirmations`, {
      tool_call_id: item.toolCallId,
      decision,
      ...(reason === "" ? {} : { reason }),
    }).then(
      () => {
        setBusy(null);
        setDecided((was) => ({
          ...was,
          [item.toolCallId]: {
            ok: true,
            text:
              decision === "allow"
                ? `Approved. ${item.agent} may now run ${item.tool} with these arguments, and the session picks up from there.`
                : `Rejected. ${item.agent} will not run ${item.tool}${reason === "" ? "" : ", and was given your reason"}; the session continues without it.`,
          },
        }));
        // The list is deliberately NOT reloaded here. Re-reading would drop this card the instant
        // it was decided — taking the sentence saying what happened with it — which is the same
        // silence this screen was built to end. The decided row stays, saying what it did.
      },
      (err: unknown) => {
        setBusy(null);
        setDecided((was) => ({
          ...was,
          [item.toolCallId]: { ok: false, text: `Nothing was decided — ${messageOf(err)}` },
        }));
      },
    );
  };

  const rows = parked(sessions ?? [], names);

  return (
    <div className="pane-in">
      <PageHeader
        title="Approvals"
        subtitle="Every agent that has stopped to ask you something, and the exact call it wants to make."
        actions={error ? <span className="chip chip-fail">{error}</span> : null}
      />

      {sessions === null && error !== null ? (
        <div className="absence">
          The channel&apos;s sessions could not be read, so nothing can be said about what is waiting:{" "}
          {error}
        </div>
      ) : sessions === null ? (
        <div className="absence">Looking for agents waiting on you…</div>
      ) : rows.length === 0 ? (
        <div className="absence">
          No agent is waiting on you — nothing has stopped to ask for approval
          {/* Said here as well as over a list, because "nobody is waiting" is a claim about
              everything that was read, and this read was one page. */}
          {partial ? " in this channel's 100 most recent sessions" : ""}.
        </div>
      ) : (
        <div className="space-y-3">
          {partial ? (
            <p className="text-xs text-ink-3">Read from this channel&apos;s 100 most recent sessions.</p>
          ) : null}
          {rows.map((item) => {
            const answer = decided[item.toolCallId];
            const args = argRows(item.args);
            return (
              <section key={item.toolCallId} className="panel p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.agent}</span>
                  <span className="text-sm text-ink-2">wants to run</span>
                  <span className="chip chip-plain font-mono">{item.tool}</span>
                  <span className={`chip ${answer === undefined ? "chip-absent" : answer.ok ? "chip-plain" : "chip-fail"}`}>
                    {answer === undefined ? "Waiting for you" : answer.ok ? "Answered" : "Not answered"}
                  </span>
                  <span className="ml-auto font-mono text-[0.6875rem] text-ink-3">{item.sessionId}</span>
                </div>

                <div className="mt-3 space-y-2">
                  {args.length === 0 ? (
                    <p className="text-sm text-ink-2">This call takes no arguments.</p>
                  ) : (
                    args.map((row) => (
                      <div key={row.key}>
                        <div className="eyebrow">{row.label}</div>
                        {row.media.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {row.media.map((src) => (
                              <div key={src} className="w-64">
                                <MediaPreview src={src} label={`${row.label} of this call`} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-0.5 text-sm whitespace-pre-wrap">{row.text}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {answer ? (
                  <p className={`mt-3 text-sm ${answer.ok ? "text-ink-2" : "text-tone-fail"}`}>{answer.text}</p>
                ) : (
                  <>
                    <input
                      className="input mt-3 w-full"
                      placeholder="Reason (optional) — sent to the agent with your decision"
                      value={reasons[item.toolCallId] ?? ""}
                      onChange={(e) =>
                        setReasons((was) => ({ ...was, [item.toolCallId]: e.target.value }))
                      }
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy === item.toolCallId}
                        onClick={() => decide(item, "allow")}
                      >
                        <Check size={14} strokeWidth={1.75} /> Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busy === item.toolCallId}
                        onClick={() => decide(item, "deny")}
                      >
                        <X size={14} strokeWidth={1.75} /> Reject
                      </button>
                      <span className="text-xs text-ink-3">
                        Approve lets this one call run, exactly as written above. Reject refuses this
                        call only — the agent is told and carries on without it.
                      </span>
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
