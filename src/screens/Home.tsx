import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { ACTIVE } from "../../templates";
import { apiGet, ApiError, messageOf } from "../api";
import { PageHeader, STATUS_LABEL } from "../components/kit";
import type { ChannelAgent, Post, PostStatus } from "../data";
import { toRoster } from "./Agents";
import { parked, type WireSession } from "./Approvals";

/** `GET /api/context`: the platform's `project_context` (`canonical-spec §31.8`) plus the install's intake lines. */
export interface HomeContext {
  context: {
    template: string | null;
    answers: { key: string; label: string; value: string | string[] }[];
    updated_at: string;
  };
  day_one: { name: string; action: string; id?: string }[];
}

interface WireDeployment {
  agent_id: string;
  cron: string;
  next_run_at: string | null;
}

/** The first coming fire of any timer this agent holds, or null when it holds none that will fire. */
export const nextFireOf = (rows: readonly WireDeployment[], agentId: string): string | null =>
  rows
    .filter((row) => row.agent_id === agentId && row.next_run_at !== null)
    .map((row) => row.next_run_at!)
    .sort()[0] ?? null;

/** How far the crew's first day has got: one line per intake the apply opened, with its session's state. */
export const dayOne = (lines: HomeContext["day_one"], sessions: readonly WireSession[]) =>
  lines.map((line) => {
    const session = line.id === undefined ? undefined : sessions.find((one) => one.id === line.id);
    const state =
      line.action !== "created" ? line.action
      : session === undefined ? "opened"
      : session.status === "completed" ? "finished"
      : (session.pending_actions?.length ?? 0) > 0 ? "waiting for you"
      : session.status;
    return { name: line.name, state, done: state === "finished" };
  });

/** The queue by status, in the order the labels are declared (the seed module is types-only here). */
export const queueCounts = (posts: readonly Post[]): [PostStatus, number][] =>
  (Object.keys(STATUS_LABEL) as PostStatus[]).map((status) => [status, posts.filter((post) => post.status === status).length]);

/** Why the context card is empty, in the operator's words: no key is one sentence, no install another. */
export const contextAbsence = (error: unknown): string =>
  error instanceof ApiError && error.status === 404
    ? "Not set up yet — the studio asks the channel's three questions when it installs the crew."
    : messageOf(error);

const ROLES = new Map(ACTIVE.agents.map((agent) => [agent.name, agent.role ?? ""]));

/**
 * The channel at a glance: what the operator told the studio, how far day one has got, what is
 * waiting on them, who is on the crew and when each next fires, and what the queue holds. Every
 * number is read from the server; a read that fails leaves its card saying why, not a zero.
 */
export function Home() {
  const [home, setHome] = useState<HomeContext | null>(null);
  const [absence, setAbsence] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [agents, setAgents] = useState<ChannelAgent[]>([]);
  const [timers, setTimers] = useState<WireDeployment[]>([]);
  const [sessions, setSessions] = useState<WireSession[]>([]);

  useEffect(() => {
    apiGet<HomeContext>("/context").then(setHome, (err: unknown) => setAbsence(contextAbsence(err)));
    apiGet<Post[]>("/posts").then(setPosts, () => {});
    apiGet<{ data?: Parameters<typeof toRoster>[0] }>("/agents").then((page) => setAgents(toRoster(page.data ?? [])), () => {});
    apiGet<{ data?: WireDeployment[] }>("/deployments").then((page) => setTimers(page.data ?? []), () => {});
    apiGet<{ data?: WireSession[] }>("/sessions").then((page) => setSessions(page.data ?? []), () => {});
  }, []);

  const due = parked(sessions, new Map(agents.map((a) => [a.id, a.name]))).length;
  const progress = dayOne(home?.day_one ?? [], sessions);

  return (
    <div className="pane-in">
      <PageHeader title="Home" subtitle={ACTIVE.description} />

      <div className="mb-6 grid grid-cols-2 gap-3">
        <section className="panel p-4">
          <div className="eyebrow mb-3">Channel setup</div>
          {home === null ? (
            <div className="text-sm text-ink-3">{absence ?? "Reading the channel's setup…"}</div>
          ) : (
            <dl className="space-y-2">
              {home.context.answers.map((answer) => (
                <div key={answer.key}>
                  <dt className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-3">{answer.label}</dt>
                  <dd className="text-sm text-ink">{Array.isArray(answer.value) ? answer.value.join(", ") : answer.value}</dd>
                </div>
              ))}
              <div className="pt-1 text-[0.6875rem] text-ink-3">
                Updated {new Date(home.context.updated_at).toLocaleString()} · edit in the studio
              </div>
            </dl>
          )}
        </section>

        <section className="panel p-4">
          <div className="eyebrow mb-3">
            Day one
            {progress.length > 0 ? <span className="rail-count ml-2">{progress.filter((row) => row.done).length}/{progress.length}</span> : null}
          </div>
          {progress.length === 0 ? (
            <div className="text-sm text-ink-3">{home === null ? "Nothing to show until the crew is installed." : "This install opened no first sessions."}</div>
          ) : (
            <ul className="space-y-1.5">
              {progress.map((row) => (
                <li key={row.name} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{row.name}</span>
                  <span className={`ml-auto chip ${row.done ? "chip-credit" : "chip-plain"}`}>{row.state}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <NavLink to="/approvals" className="panel block p-4">
          <div className="eyebrow mb-1">Approvals due</div>
          <div className="font-display text-h2">{due}</div>
          <div className="text-[0.6875rem] text-ink-3">{due === 0 ? "Nothing is waiting on you." : "An agent is parked until you answer."}</div>
        </NavLink>

        <section className="panel p-4">
          <div className="eyebrow mb-3">Queue</div>
          <div className="grid grid-cols-5 gap-2">
            {queueCounts(posts).map(([status, count]) => (
              <div key={status}>
                <div className="font-display text-h2">{count}</div>
                <div className="text-[0.6875rem] leading-tight text-ink-3">{STATUS_LABEL[status]}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="eyebrow mb-2">Crew</div>
      {agents.length === 0 ? (
        <div className="absence">No agents yet — the studio installs the crew.</div>
      ) : (
        <div className="list">
          {agents.map((agent) => {
            const fire = nextFireOf(timers, agent.id);
            return (
              <div key={agent.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="font-medium">{agent.name}</span>
                <span className="text-sm text-ink-2">{ROLES.get(agent.name) ?? ""}</span>
                <span className="ml-auto font-mono text-xs text-ink-3">
                  {fire === null ? "no timer armed" : `next fire ${new Date(fire).toLocaleString()}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
