import { useEffect, useState } from "react";
import type { StyleTemplateSeed } from "../../seed/style-templates";
import { apiGet, messageOf } from "../api";
import { ago, Avatar, Card, Clamp, Facts, PageHeader, SectionHead, usd } from "../components/kit";
import { STYLE_TEMPLATES, toStyleTemplates, type ChannelAgent, type StyleTemplate } from "../data";
import { ACTIVE } from "../../templates";
import type { WireSession } from "./Approvals";

interface WireAgent {
  id: string;
  name: string;
  description?: string | null;
  model?: string;
  budget?: { cap_micro_usd?: number; max_task_micro_usd?: number; period?: string };
  tools?: { configs?: Record<string, { enabled?: boolean; permission?: string }> };
}

/**
 * The org's own agents, in the roster's shape — names, briefs, what each one may call, and what it
 * runs on and may spend. A tool the toolset marks `ask` is carried as such: "may publish, with your
 * approval" is a different sentence from "may publish", and the roster used to print both the same.
 */
export const toRoster = (rows: readonly WireAgent[]): ChannelAgent[] =>
  rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.description ?? "",
    tools: Object.entries(row.tools?.configs ?? {})
      .filter(([, config]) => config.enabled !== false && config.permission !== "deny")
      .map(([name, config]) => (config.permission === "ask" ? `${name} (asks you)` : name)),
    model: row.model ?? "",
    capMicroUsd: row.budget?.cap_micro_usd ?? 0,
    taskMicroUsd: row.budget?.max_task_micro_usd ?? 0,
    period: row.budget?.period ?? "",
  }));

const ASKS = / \(asks you\)$/;

/** Whether a roster tool stops for the operator before it runs. */
export const asksYou = (tool: string): boolean => ASKS.test(tool);

/** How a session ended, in the operator's words rather than the wire's (`canonical-spec §5`). */
const STOP_WORDS: Record<string, string> = {
  end_turn: "finished",
  awaiting_input: "waiting for a reply",
  awaiting_approval: "waiting for your approval",
  budget_paused: "paused — out of budget",
  interrupted: "interrupted",
  error: "stopped on an error",
  max_iterations: "hit its step limit",
  context_exhausted: "produced nothing",
  awaiting_delegation: "waiting on another agent",
};

export type Tone = "ok" | "wait" | "fail" | "run";

/** The tone a stop reason takes: done, parked on someone, or stopped short. */
const STOP_TONES: Record<string, Tone> = {
  end_turn: "ok",
  awaiting_input: "wait",
  awaiting_approval: "wait",
  awaiting_delegation: "wait",
  budget_paused: "fail",
  interrupted: "fail",
  error: "fail",
  max_iterations: "fail",
  context_exhausted: "fail",
};

/** A session as the roster reads it: when it ran, how it ended, and what it cost. */
export type Run = WireSession & { consumed_micro_usd?: number };

/** The agent's own sessions, newest first. */
export const historyOf = (runs: readonly Run[], agentId: string): Run[] =>
  runs
    .filter((run) => run.agent_id === agentId)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

/** How a run ended — the word and its tone. A run still going carries its status as the word. */
export function outcomeOf(session: Run): { word: string; tone: Tone } {
  if (session.stop_reason === null || session.stop_reason === undefined) return { word: session.status, tone: "run" };
  return { word: STOP_WORDS[session.stop_reason] ?? session.stop_reason, tone: STOP_TONES[session.stop_reason] ?? "run" };
}

/** One line of an agent's history: when it ran, how it ended, and what it spent. */
export function runLine(session: Run): string {
  const when = session.created_at ? new Date(session.created_at).toLocaleString() : "at an unrecorded time";
  return `${when} · ${outcomeOf(session).word} · ${usd(session.consumed_micro_usd ?? 0)} spent`;
}

const CHIP_TONE: Record<Tone, string> = { ok: "chip-credit", wait: "chip-absent", fail: "chip-fail", run: "chip-plain" };
const DOT_TONE: Record<Tone, string> = { ok: "dot-ok", wait: "dot-warn", fail: "dot-fail", run: "dot-run" };

/** The agent's standing, read off its newest run; a roster without history says so instead. */
function LastRunChip({ runs, history }: { runs: Run[] | null; history: Run[] }) {
  if (runs === null) return <span className="chip chip-absent">runs unread</span>;
  const last = history[0];
  if (last === undefined) return <span className="chip chip-absent">no runs yet</span>;
  const { word, tone } = outcomeOf(last);
  return <span className={`chip ${CHIP_TONE[tone]}`}>{word}</span>;
}

function AgentCard({ agent, runs }: { agent: ChannelAgent; runs: Run[] | null }) {
  const history = runs === null ? [] : historyOf(runs, agent.id);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Avatar name={agent.name} size="sm" />
          <span className="font-mono">{agent.name}</span>
        </span>
      }
      meta={<span className="font-mono">{agent.id}</span>}
      aside={<LastRunChip runs={runs} history={history} />}
    >
      <div className="space-y-3">
        {agent.role ? <Clamp text={agent.role} lines={2} /> : null}
        <Facts
          cols={4}
          items={[
            ["Model", agent.model ? <span className="font-mono text-xs">{agent.model}</span> : "—"],
            [agent.period ? `Budget/${agent.period}` : "Budget", agent.capMicroUsd > 0 ? <span className="font-mono">{usd(agent.capMicroUsd)}</span> : "—"],
            ["Per task", agent.taskMicroUsd > 0 ? <span className="font-mono">{usd(agent.taskMicroUsd)}</span> : "—"],
            ["Tools", agent.tools.length],
          ]}
        />
        {agent.tools.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-ink-2">Tools ({agent.tools.length})</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {agent.tools.map((tool) => (
                <span key={tool} className={`chip ${asksYou(tool) ? "chip-absent" : "chip-plain"} font-mono`}>{tool}</span>
              ))}
            </div>
          </details>
        ) : null}
        <div>
          <div className="prop-label">Last runs</div>
          {runs === null ? (
            <div className="mt-1 text-xs text-ink-3">Its runs could not be read.</div>
          ) : history.length === 0 ? (
            <div className="mt-1 text-xs text-ink-3">No sessions yet.</div>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {history.slice(0, 3).map((run) => {
                const { word, tone } = outcomeOf(run);
                return (
                  <li key={run.id} className="flex items-center gap-2 text-xs">
                    <span className={`dot ${DOT_TONE[tone]}`} aria-hidden />
                    <span className="w-14 shrink-0 text-ink-3">{ago(run.created_at) || "—"}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{word}</span>
                    <span className="font-mono text-ink-3">{usd(run.consumed_micro_usd ?? 0)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function StyleCard({ style }: { style: StyleTemplate }) {
  return (
    <section className="panel overflow-hidden">
      <img src={style.image} alt={`Reference image for ${style.name}`} className="aspect-video w-full border-b border-line object-cover" />
      <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="card-title truncate">{style.name}</h2>
          <div className="mt-1 font-mono text-xs text-ink-3">{style.id}</div>
        </div>
      </header>
      <div className="space-y-3 px-4 py-3">
        {style.trend ? (
          <div>
            <div className="prop-label">Trend</div>
            <div className="mt-0.5 text-xs text-ink-2">{style.trend}</div>
          </div>
        ) : null}
        <div>
          <div className="prop-label">Prompt</div>
          <Clamp text={style.prompt} lines={2} className="mt-0.5" />
        </div>
        <div>
          <div className="prop-label">Used by</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {style.usedBy.length > 0 ? (
              style.usedBy.map((name) => (
                <span key={name} className="chip chip-plain font-mono">{name}</span>
              ))
            ) : (
              <span className="chip chip-absent">not in use</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The channel's agents and their style templates (reference image + prompt).
 * A style template is what makes produced videos look like one channel. */
export function Agents() {
  const [agents, setAgents] = useState<ChannelAgent[] | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [templates, setTemplates] = useState(STYLE_TEMPLATES);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ data?: WireAgent[] }>("/agents").then(
      (page) => setAgents(toRoster(page.data ?? [])),
      (err: unknown) => setError(messageOf(err)),
    );
    // History is a separate read and a separate failure: a roster without it is still a roster, so
    // the cards render either way and the run chip says which of the two it is.
    apiGet<{ data?: Run[] }>("/sessions").then((page) => setRuns(page.data ?? []), () => setRuns(null));
    // The catalogue the deployment actually holds; the bundled one stands in until it answers.
    apiGet<StyleTemplateSeed[]>("/templates").then((seeds) => setTemplates(toStyleTemplates(seeds)), () => {});
  }, []);

  return (
    <div className="pane-in">
      <PageHeader
        title="Channel settings"
        subtitle="The template this channel runs, the team it declares, and the look they produce in."
        actions={error ? <span className="chip chip-fail">{error}</span> : null}
      />

      <Card title="Template" aside={<span className="chip chip-plain font-mono">{ACTIVE.name}</span>} className="mb-8">
        <Facts
          cols={4}
          items={[
            ["Template", <span className="font-mono">{ACTIVE.name}</span>],
            ["Description", <Clamp text={ACTIVE.description} lines={1} />],
            [
              "Kinds",
              <span className="flex flex-wrap gap-1.5">
                {ACTIVE.kinds.map((kind) => (
                  <span key={kind.id} className="chip chip-plain font-mono">{kind.label}</span>
                ))}
              </span>,
            ],
            ["Agents", ACTIVE.agents.length],
          ]}
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-ink-2">How to switch template</summary>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
            The blueprint is the machine — these screens, the queue, the approval flow — and it is shared by every
            template it carries. Switching template is an edit of <span className="font-mono">templates/index.ts</span>{" "}
            plus <span className="font-mono">naive up</span> on this same clone: the new template&apos;s agents are
            created, an agent only the old one declared is reported and left running, and your posts, accounts and this
            app keep their URL and their rows.
          </p>
        </details>
      </Card>

      <SectionHead label="Agents" count={agents?.length} />
      {agents === null ? (
        <div className="absence mb-8">{error === null ? "Loading the roster…" : "No roster to show."}</div>
      ) : agents.length === 0 ? (
        <div className="absence mb-8">No agents in this organization yet — run `naive up` to provision them.</div>
      ) : (
        <div className="mb-8 grid grid-cols-2 gap-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} runs={runs} />
          ))}
        </div>
      )}

      <SectionHead
        label="Style templates"
        count={templates.length}
        aside={<span className="text-xs text-ink-3">A reference image plus a prompt — the look every produced video keeps.</span>}
      />
      <div className="grid grid-cols-3 gap-3">
        {templates.map((style) => (
          <StyleCard key={style.id} style={style} />
        ))}
      </div>
    </div>
  );
}
