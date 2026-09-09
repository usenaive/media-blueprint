import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { ACTIVE } from "../../templates";
import { apiGet, ApiError, messageOf } from "../api";
import { PageHeader, STATUS_LABEL } from "../components/kit";
import type { Post, PostStatus } from "../data";
import { toRoster } from "./Agents";
import { parked, type WireSession } from "./Approvals";

/**
 * `GET /api/context`: the platform's `project_context` (`canonical-spec §31.8`), the `agt_` ids the
 * install left standing, and each intake line with its session read by id (`server/routes.ts`).
 */
export interface HomeContext {
  context: {
    template: string | null;
    answers: { key: string; label: string; value: string | string[] }[];
    updated_at: string;
  };
  team: { name: string; id: string }[];
  day_one: {
    name: string;
    action: string;
    id?: string;
    session: { status: string; stop_reason: string | null; waiting: boolean } | null;
  }[];
}

interface WireDeployment {
  agent_id: string;
  cron: string;
  next_run_at: string | null;
}

/** One platform list, as the server relays it; `has_more` set means the count below it is a floor. */
interface Listed<T> {
  data?: T[];
  has_more?: boolean;
}

/** The first coming fire of any timer this agent holds, or null when it holds none that will fire. */
export const nextFireOf = (rows: readonly WireDeployment[], agentId: string): string | null =>
  rows
    .filter((row) => row.agent_id === agentId && row.next_run_at !== null)
    .map((row) => row.next_run_at!)
    .sort()[0] ?? null;

/**
 * How far the crew's first day has got: one line per intake the apply opened, with its session's
 * state as the server read it by id. A session the server could not read just now is `unknown` —
 * not "opened", which would claim a state nobody has seen.
 */
export const dayOne = (lines: HomeContext["day_one"]) =>
  lines.map((line) => {
    const state =
      line.action !== "created" ? line.action
      : line.session === null ? "unknown"
      : line.session.waiting ? "waiting for you"
      : line.session.stop_reason === "end_turn" || line.session.status === "completed" ? "finished"
      : line.session.stop_reason ?? line.session.status;
    return { name: line.name, state, done: state === "finished" };
  });

/** The queue by status, in the order the labels are declared (the seed module is types-only here). */
export const queueCounts = (posts: readonly Post[]): [PostStatus, number][] =>
  (Object.keys(STATUS_LABEL) as PostStatus[]).map((status) => [status, posts.filter((post) => post.status === status).length]);

/** Why the context card is empty, in the operator's words: no key is one sentence, no install another. */
export const contextAbsence = (error: unknown): string =>
  error instanceof ApiError && error.status === 404
    ? "Not set up yet — the studio asks the channel's three questions when it installs the team."
    : messageOf(error);

const ROLES = new Map(ACTIVE.agents.map((agent) => [agent.name, agent.role ?? ""]));

/** One read, held on its own: null until it answers, the rows when it does, the sentence when it refuses. */
function useRead<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<T>(path).then(
      (value) => { if (live) setData(value); },
      (err: unknown) => { if (live) setError(messageOf(err)); },
    );
    return () => { live = false; };
  }, [path]);
  return { data, error };
}

/**
 * The channel at a glance: what the operator told the studio, how far day one has got, what is
 * waiting on them, who is on the crew and when each next fires, and what the queue holds. Every
 * number is read from the server and every read is held on its own: a read that fails leaves its
 * card saying why, not a zero, and every platform figure is cut to this install's team so another
 * project's agents, timers and parked sessions in the same org are not counted here.
 */
export function Home() {
  const [home, setHome] = useState<HomeContext | null>(null);
  const [absence, setAbsence] = useState<string | null>(null);
  const posts = useRead<Post[]>("/posts");
  const agents = useRead<Listed<Parameters<typeof toRoster>[0][number]>>("/agents");
  const timers = useRead<Listed<WireDeployment>>("/deployments");
  const approvals = useRead<Listed<WireSession>>("/sessions?stop_reason=awaiting_approval");
  const questions = useRead<Listed<WireSession>>("/sessions?stop_reason=awaiting_answer");

  useEffect(() => {
    apiGet<HomeContext>("/context").then(setHome, (err: unknown) => setAbsence(contextAbsence(err)));
  }, []);

  const ids = new Set((home?.team ?? []).map((agent) => agent.id));
  const names = new Map((home?.team ?? []).map((agent) => [agent.id, agent.name]));
  const crew = toRoster(agents.data?.data ?? []).filter((agent) => ids.has(agent.id));
  const parkedError = approvals.error ?? questions.error;
  const parkedLoaded = approvals.data !== null && questions.data !== null;
  const due = parked([...(approvals.data?.data ?? []), ...(questions.data?.data ?? [])].filter((s) => ids.has(s.agent_id)), names).length;
  const partial = approvals.data?.has_more === true || questions.data?.has_more === true;
  const progress = dayOne(home?.day_one ?? []);

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
            <div className="text-sm text-ink-3">{home === null ? "Nothing to show until the team is installed." : "This install opened no first sessions."}</div>
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
          <div className="font-display text-h2">{parkedError !== null ? "—" : parkedLoaded ? `${due}${partial ? "+" : ""}` : "…"}</div>
          <div className="text-[0.6875rem] text-ink-3">
            {parkedError ?? (!parkedLoaded ? "Reading the parked sessions…" : due === 0 ? "Nothing is waiting on you." : partial ? "The first hundred parked sessions; there are more." : "An agent is parked until you answer.")}
          </div>
        </NavLink>

        <section className="panel p-4">
          <div className="eyebrow mb-3">Queue</div>
          {posts.error !== null ? (
            <div className="text-sm text-ink-3">{posts.error}</div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {queueCounts(posts.data ?? []).map(([status, count]) => (
                <div key={status}>
                  <div className="font-display text-h2">{posts.data === null ? "…" : count}</div>
                  <div className="text-[0.6875rem] leading-tight text-ink-3">{STATUS_LABEL[status]}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="eyebrow mb-2">The agent team</div>
      {agents.error !== null ? (
        <div className="absence">{agents.error}</div>
      ) : agents.data === null || home === null ? (
        <div className="absence">{absence ?? "Reading the team…"}</div>
      ) : crew.length === 0 ? (
        <div className="absence">No agents yet — the studio installs the team.</div>
      ) : (
        <div className="list">
          {crew.map((agent) => {
            const fire = timers.data === null ? null : nextFireOf(timers.data.data ?? [], agent.id);
            return (
              <div key={agent.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="font-medium">{agent.name}</span>
                <span className="text-sm text-ink-2">{ROLES.get(agent.name) ?? ""}</span>
                <span className="ml-auto font-mono text-xs text-ink-3">
                  {timers.error !== null ? timers.error : timers.data === null ? "…" : fire === null ? "no timer armed" : `next fire ${new Date(fire).toLocaleString()}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
