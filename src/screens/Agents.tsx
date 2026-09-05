import { useEffect, useState } from "react";
import type { StyleTemplateSeed } from "../../seed/style-templates";
import { apiGet, messageOf } from "../api";
import { PageHeader, usd } from "../components/kit";
import { STYLE_TEMPLATES, toStyleTemplates, type ChannelAgent } from "../data";
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

/** A session as the roster reads it: when it ran, how it ended, and what it cost. */
export type Run = WireSession & { consumed_micro_usd?: number };

/** The agent's own sessions, newest first. */
export const historyOf = (runs: readonly Run[], agentId: string): Run[] =>
  runs
    .filter((run) => run.agent_id === agentId)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

/** One line of an agent's history: when it ran, how it ended, and what it spent. */
export function runLine(session: Run): string {
  const when = session.created_at ? new Date(session.created_at).toLocaleString() : "at an unrecorded time";
  const how = session.stop_reason === null || session.stop_reason === undefined
    ? session.status
    : (STOP_WORDS[session.stop_reason] ?? session.stop_reason);
  return `${when} · ${how} · ${usd(session.consumed_micro_usd ?? 0)} spent`;
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
    // the rows render either way and the history line says which of the two it is.
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

      <div className="panel mb-8 p-3">
        <div className="eyebrow">Template</div>
        <p className="mt-1 text-sm">
          <span className="font-mono font-medium">{ACTIVE.name}</span> on the media blueprint — {ACTIVE.description}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
          The blueprint is the machine — these screens, the queue, the approval flow — and it is shared by every
          template it carries. Switching template is an edit of <span className="font-mono">templates/index.ts</span>{" "}
          plus <span className="font-mono">naive up</span> on this same clone: the new template&apos;s agents are
          created, an agent only the old one declared is reported and left running, and your posts, accounts and this
          app keep their URL and their rows.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ACTIVE.kinds.map((kind) => (
            <span key={kind.id} className="chip chip-plain font-mono">{kind.label}</span>
          ))}
        </div>
      </div>

      {agents === null ? (
        <div className="absence mb-8">{error === null ? "Loading the roster…" : "No roster to show."}</div>
      ) : agents.length === 0 ? (
        <div className="absence mb-8">No agents in this organization yet — run `naive up` to provision them.</div>
      ) : (
        <div className="list mb-8">
          {agents.map((a) => {
            const history = runs === null ? [] : historyOf(runs, a.id);
            return (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{a.name}</span>
                    <span className="font-mono text-xs text-ink-3">{a.id}</span>
                  </div>
                  {a.role ? <div className="mt-0.5 text-sm text-ink-2">{a.role}</div> : null}
                  {/* What it runs on and what it may spend — read off the same roster row that was
                      already on the wire, and never shown. */}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    {a.model ? <span className="font-mono">{a.model}</span> : null}
                    {a.capMicroUsd > 0 ? (
                      <span className="font-mono">
                        {usd(a.capMicroUsd)}/{a.period} · {usd(a.taskMicroUsd)} a task
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {a.tools.map((t) => (
                      <span key={t} className="chip chip-plain font-mono">{t}</span>
                    ))}
                  </div>
                  {/* Its last runs, with how each one ended. `waiting for your approval` here is the
                      same parked session the Approvals screen can release. */}
                  <div className="mt-1.5 text-xs text-ink-3">
                    {runs === null ? (
                      "Its runs could not be read, so nothing is claimed about what it has done."
                    ) : history.length === 0 ? (
                      "No sessions yet — it has not been asked for anything."
                    ) : (
                      <ul>
                        {history.slice(0, 3).map((run) => (
                          <li key={run.id}>{runLine(run)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="eyebrow">Style templates</div>
          <p className="mt-1 text-sm text-ink-2">A reference image plus a prompt — the look every produced video keeps.</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {templates.map((s) => (
          <div key={s.id} className="panel overflow-hidden">
            <img src={s.image} alt={`Reference image for ${s.name}`} className="aspect-video w-full border-b border-line object-cover" />
            <div className="p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.name}</span>
                <span className="font-mono text-xs text-ink-3">{s.id}</span>
              </div>
              {s.trend ? <div className="mt-1 text-[0.6875rem] text-ink-3">{s.trend}</div> : null}
              <p className="mt-1 line-clamp-3 text-xs text-ink-2">{s.prompt}</p>
              <div className="mt-2 text-xs text-ink-3">
                {s.usedBy.length > 0 ? <>used by <span className="font-mono">{s.usedBy.join(", ")}</span></> : "not in use"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
