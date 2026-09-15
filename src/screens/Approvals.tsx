import { Check, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { apiGet, apiSend, messageOf } from "../api";
import { Avatar, Card, Clamp, MediaPreview, PageHeader, SectionHead, ago } from "../components/kit";

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
 *
 * The same screen answers a QUESTION. `ask_operator` (canonical-spec §7) parks the turn
 * `awaiting_answer` with a `kind: "question"` action carrying the agent's prompt and fields; it is
 * answered on `POST /v1/sessions/{id}/answers`, never decided on the confirmation route — a
 * `{ decision }` at a question is a 400. It is how an agent asks for a tool, a model or an account
 * it was not offered, so a dashboard that could not answer it left the agent asking the void.
 */

/** One field of a question, as the agent wrote it (`canonical-spec §7.1`). */
export type QuestionField = { key: string; label: string; help?: string } & (
  | { type: "text"; placeholder?: string }
  | { type: "choice"; options: string[]; multiple?: boolean; other?: boolean }
);

export interface Question {
  prompt: string;
  fields: QuestionField[];
}

/** The operator's answers, by field key; a multi-choice field is a list. */
export type Answers = Record<string, string | string[]>;

/** The fields of a session this screen reads (`canonical-spec §5`); the wire carries more. */
export interface WireSession {
  id: string;
  agent_id: string;
  status: string;
  stop_reason: string | null;
  pending_actions?: {
    kind?: "tool" | "question";
    tool_call_id: string;
    name: string;
    args?: Record<string, unknown>;
    question?: Question;
  }[];
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
  /** Set only for a question: the card answers it instead of approving it. */
  question?: Question;
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
        ...(action.kind === "question" && action.question ? { question: action.question } : {}),
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

/**
 * One argument, as a person reads it: a label, its value in prose, and any media it points at.
 * A nested object (or a list of them, numbered when there is more than one) also carries its own
 * `rows`, so it is drawn as labelled rows rather than as the flattened prose in `text`; a list of
 * scalars carries them as `list`.
 */
export interface ArgRow {
  key: string;
  label: string;
  text: string;
  media: string[];
  rows?: ArgRow[];
  list?: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(asText).join(", ");
  if (isRecord(value)) {
    return Object.entries(value)
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
    const row: ArgRow = { key, label: label(key), text: media.length > 0 ? "" : asText(value), media };
    if (isRecord(value)) row.rows = argRows(value);
    else if (Array.isArray(value) && value.length > 0 && media.length === 0) {
      if (value.every(isRecord)) {
        row.rows = value.length === 1
          ? argRows(value[0] as Record<string, unknown>)
          : value.map((inner, i) => ({ key: `${key}.${i}`, label: `${row.label} ${i + 1}`, text: asText(inner), media: [], rows: argRows(inner) }));
      } else if (value.every((inner) => !isRecord(inner) && !Array.isArray(inner))) {
        row.list = value.map(asText);
      }
    }
    return row;
  });
}

/** How the header says what the agent wants, in one short phrase. */
export const wants = (item: Pick<Parked, "tool" | "question">): string =>
  item.question ? "asks you a question"
  : item.tool === "request_tools" ? "asks to be granted tools"
  : item.tool === "social.post" ? "asks to post"
  : "wants to run";

/** The one argument that is prose about the call rather than part of it. */
const REASON = "reason";

/**
 * One card's key. `tool_call_id` is derived from the tool name and its arguments (§7.1), so two
 * sessions holding the same call share it; the session id keeps their cards apart.
 */
export const keyOf = (item: Pick<Parked, "sessionId" | "toolCallId">): string => `${item.sessionId}:${item.toolCallId}`;

/**
 * The answers as they will be sent: free text trimmed, a blank entry dropped, a listed option kept
 * exactly as the agent wrote it (the platform checks a closed choice against the option string).
 */
export const trimmed = (fields: readonly QuestionField[], answers: Answers): Answers => {
  const clean = (field: QuestionField | undefined, value: string) =>
    field?.type === "choice" && field.options.includes(value) ? value : value.trim();
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => {
      const field = fields.find((one) => one.key === key);
      return [key, Array.isArray(value) ? value.map((one) => clean(field, one)).filter((one) => one !== "") : clean(field, value)];
    }),
  );
};

/** The labels of every field still unanswered; the platform refuses a partial answer (§7.2). */
export const unanswered = (fields: readonly QuestionField[], answers: Answers): string[] =>
  fields.filter((field) => (answers[field.key] ?? "").length === 0).map((field) => field.label);

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
  const [answers, setAnswers] = useState<Record<string, Answers>>({});
  const [busy, setBusy] = useState<readonly string[]>([]);
  const begin = (key: string) => setBusy((was) => [...was, key]);
  const finish = (key: string) => setBusy((was) => was.filter((one) => one !== key));
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
    const key = keyOf(item);
    const reason = (reasons[key] ?? "").trim();
    begin(key);
    apiSend<WireSession>("POST", `/sessions/${item.sessionId}/tool_confirmations`, {
      tool_call_id: item.toolCallId,
      decision,
      ...(reason === "" ? {} : { reason }),
    }).then(
      () => {
        finish(key);
        setDecided((was) => ({
          ...was,
          [key]: {
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
        finish(key);
        setDecided((was) => ({
          ...was,
          [key]: { ok: false, text: `Nothing was decided — ${messageOf(err)}` },
        }));
      },
    );
  };

  /** Sends the answers to a question. A partial or blank answer is refused here, not by the platform. */
  const answer = (item: Parked, question: Question) => {
    const key = keyOf(item);
    const given = trimmed(question.fields, answers[key] ?? {});
    const missing = unanswered(question.fields, given);
    if (missing.length > 0) {
      setDecided((was) => ({ ...was, [key]: { ok: false, text: `Nothing was sent — still unanswered: ${missing.join(", ")}.` } }));
      return;
    }
    begin(key);
    apiSend<WireSession>("POST", `/sessions/${item.sessionId}/answers`, { tool_call_id: item.toolCallId, answers: given }).then(
      () => {
        finish(key);
        setDecided((was) => ({ ...was, [key]: { ok: true, text: `Answered. ${item.agent} picks up with your answer.` } }));
      },
      (err: unknown) => {
        finish(key);
        setDecided((was) => ({ ...was, [key]: { ok: false, text: `Nothing was sent — ${messageOf(err)}` } }));
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
          Nothing is waiting on you.
          {/* Said here as well as over a list, because "nobody is waiting" is a claim about
              everything that was read, and this read was one page. */}
          {partial ? <div className="mt-1 text-xs text-ink-3">Read from this channel&apos;s 100 most recent sessions.</div> : null}
        </div>
      ) : (
        <>
          <SectionHead
            label="Waiting on you"
            count={rows.length}
            aside={partial ? <span className="text-xs text-ink-3">Read from this channel&apos;s 100 most recent sessions.</span> : null}
          />
          <div className="space-y-3">
            {rows.map((item) => {
              const key = keyOf(item);
              const outcome = decided[key];
              const status = (
                <span className={`chip ${outcome === undefined ? "chip-absent" : outcome.ok ? "chip-plain" : "chip-fail"}`}>
                  {outcome === undefined ? "Waiting for you" : outcome.ok ? "Answered" : "Not answered"}
                </span>
              );
              const head = {
                title: (
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={item.agent} size="sm" />
                    {item.agent}
                    <span className="font-normal text-ink-2">{wants(item)}</span>
                  </span>
                ),
                meta: (
                  <>
                    <span className="chip chip-plain font-mono">{item.tool}</span>
                    {status}
                    {item.since ? <span>{ago(item.since)}</span> : null}
                  </>
                ),
                aside: <span className="font-mono text-xs text-ink-3">{item.sessionId}</span>,
              };
              if (item.question) {
                const question = item.question;
                const given = answers[key] ?? {};
                return (
                  <Card key={key} {...head}>
                    <Section label="Question">
                      <Clamp text={question.prompt} lines={3} />
                    </Section>
                    {outcome?.ok ? (
                      <Outcome outcome={outcome} />
                    ) : (
                      <>
                        <Section label="Your answer">
                          <div className="grid gap-3 sm:grid-cols-2">
                            {question.fields.map((field) => (
                              <AnswerField
                                key={field.key}
                                id={`${key}:${field.key}`}
                                field={field}
                                value={given[field.key] ?? ""}
                                onChange={(value) => setAnswers((was) => ({ ...was, [key]: { ...(was[key] ?? {}), [field.key]: value } }))}
                              />
                            ))}
                          </div>
                        </Section>
                        {outcome ? <Outcome outcome={outcome} /> : null}
                        <Footer
                          help="Your answer goes back to the agent and it carries on. Granting a tool or account it asked for is a separate step; this session keeps the tools it started with."
                        >
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy.includes(key)} onClick={() => answer(item, question)}>
                            <Check size={14} strokeWidth={1.75} /> Answer
                          </button>
                        </Footer>
                      </>
                    )}
                  </Card>
                );
              }
              const args = argRows(item.args);
              const reason = args.find((row) => row.key === REASON && row.text !== "");
              const rest = args.filter((row) => row !== reason);
              return (
                <Card key={key} {...head}>
                  <Section label="Arguments">
                    {rest.length === 0 ? (
                      <p className="text-sm text-ink-3">This call takes no arguments.</p>
                    ) : (
                      <Args rows={rest} />
                    )}
                  </Section>
                  {reason ? (
                    <Section label="Reason">
                      <Clamp text={reason.text} lines={2} />
                    </Section>
                  ) : null}
                  {outcome ? (
                    <Outcome outcome={outcome} />
                  ) : (
                    <Footer
                      help="Approve lets this one call run, exactly as written above. Reject refuses this call only — the agent is told and carries on without it."
                      aside={
                        <input
                          className="input min-w-48 flex-1"
                          placeholder="Reason (optional) — sent to the agent with your decision"
                          value={reasons[key] ?? ""}
                          onChange={(e) => setReasons((was) => ({ ...was, [key]: e.target.value }))}
                        />
                      }
                    >
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy.includes(key)} onClick={() => decide(item, "allow")}>
                        <Check size={14} strokeWidth={1.75} /> Approve
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" disabled={busy.includes(key)} onClick={() => decide(item, "deny")}>
                        <X size={14} strokeWidth={1.75} /> Reject
                      </button>
                    </Footer>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** A labelled section of a card's body. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="py-2 first:pt-0">
      <div className="prop-label mb-1.5">{label}</div>
      {children}
    </section>
  );
}

/** The card's last row: its buttons, whatever sits beside them, and the sentence that says what they do. */
function Footer({ help, aside, children }: { help: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <footer className="mt-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {aside}
      </div>
      <p className="mt-2 text-xs text-ink-3">{help}</p>
    </footer>
  );
}

/** What the server said about a decision, in the card's last row. */
function Outcome({ outcome }: { outcome: Decided }) {
  return (
    <footer className="mt-2 flex items-start gap-2 border-t border-line pt-3">
      {outcome.ok ? null : <span className="chip chip-fail shrink-0">Not sent</span>}
      <p className="text-sm text-ink-2">{outcome.text}</p>
    </footer>
  );
}

/** A string past a couple of lines is clamped; the operator opens it if they need the rest. */
const LONG = 160;

/** The arguments as labelled rows; a nested object is its own set of rows under its label. */
function Args({ rows }: { rows: readonly ArgRow[] }) {
  return (
    <dl className="dl">
      {rows.map((row) => {
        // A player is taller than its label; the label sits at its top edge, not its baseline.
        const top = row.media.length > 0 ? "self-start" : undefined;
        return (
          <div key={row.key} className="contents">
            <dt className={top}>{row.label}</dt>
            <dd className={top}>
              {row.media.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {row.media.map((src) => (
                    <div key={src} className="w-64">
                      <MediaPreview src={src} label={`${row.label} of this call`} />
                    </div>
                  ))}
                </div>
              ) : row.rows ? (
                <Args rows={row.rows} />
              ) : row.list ? (
                <div className="flex flex-wrap gap-1.5">
                  {row.list.map((one, i) => <span key={`${i}:${one}`} className="chip chip-plain">{one}</span>)}
                </div>
              ) : row.text.length > LONG || row.text.includes("\n") ? (
                <Clamp text={row.text} lines={2} />
              ) : (
                <span className="whitespace-pre-wrap">{row.text}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * One field of a question. `text` is an input; `choice` is the options as buttons (the words are
 * the value — §7.1) plus, when the agent left `other` on (the default), a free-text escape, because
 * the agent wrote the options and is the one who does not know the answer.
 */
function AnswerField({ id, field, value, onChange }: {
  id: string;
  field: QuestionField;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const chosen = Array.isArray(value) ? value : value === "" ? [] : [value];
  const pick = (option: string) => {
    if (field.type !== "choice") return;
    if (!field.multiple) return onChange(chosen[0] === option ? "" : option);
    onChange(chosen.includes(option) ? chosen.filter((c) => c !== option) : [...chosen, option]);
  };
  const other = field.type === "choice" ? chosen.find((c) => !field.options.includes(c)) ?? "" : "";
  return (
    <div className="min-w-0">
      <label className="prop-label block" htmlFor={id}>{field.label}</label>
      {field.help ? <p className="mt-0.5 text-xs text-ink-3">{field.help}</p> : null}
      {field.type === "text" ? (
        <input id={id} className="input mt-1.5 w-full" placeholder={field.placeholder ?? ""}
          value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {field.options.map((option) => (
            <button key={option} type="button" className={`chip ${chosen.includes(option) ? "chip-chosen" : "chip-plain"}`}
              aria-pressed={chosen.includes(option)} onClick={() => pick(option)}>{option}</button>
          ))}
          {field.other !== false ? (
            <input id={id} className="input w-auto min-w-40 flex-1" placeholder="Something else…" value={other}
              onChange={(event) => {
                const listed = chosen.filter((c) => field.options.includes(c));
                const text = event.target.value;
                onChange(field.multiple ? (text === "" ? listed : [...listed, text]) : text);
              }} />
          ) : null}
        </div>
      )}
    </div>
  );
}
