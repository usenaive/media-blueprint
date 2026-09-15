import { ChevronRight, Clapperboard, RotateCcw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { apiGet, apiSend, messageOf } from "../api";
import { Card, Clamp, Facts, PageHeader, PlatformChip, SectionHead } from "../components/kit";
import { type VideoProject, type ProjectStatus } from "../data";
import { ACTIVE } from "../../templates";
import { RENDERER } from "../../templates/template";

type Scene = NonNullable<VideoProject["scenes"]>[number];
type ClipSource = NonNullable<VideoProject["sources"]>[number];

/** What `POST /api/projects/:id/render` answers: who was sent the plan, and the session it runs in. */
interface Sent {
  renderer: string;
  session: { id?: string };
}

const TABS: { key: ProjectStatus; label: string }[] = [
  { key: "planned", label: "Planned" },
  { key: "rendering", label: "In progress" },
  { key: "rendered", label: "Rendered" },
  { key: "dropped", label: "Dropped" },
];

const STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: "Planned — waiting for a render",
  rendering: "Rendering",
  rendered: "Rendered",
  dropped: "Dropped",
};

/** A sent plan is re-read this often, for this long, until its renderer has finished with it. */
export const POLL_EVERY = 5_000;
export const POLL_FOR = 10 * 60_000;

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  const cls =
    status === "rendered" ? "chip-credit" : status === "dropped" ? "chip-fail" : status === "planned" ? "chip-absent" : "chip-plain";
  return (
    <span className={`chip ${cls}`}>
      {status === "rendering" ? <span className="dot dot-run" aria-hidden /> : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

export const total = (project: VideoProject) => (project.scenes ?? []).reduce((sum, scene) => sum + scene.seconds, 0);

export const rangeOf = (source: ClipSource) =>
  source.from || source.to ? `${source.from ?? "start"} → ${source.to ?? "end"}` : "whole video";

/** A small labelled line under a scene's prompt: `VOICEOVER  Seneca told a rich friend…`. */
function Line({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="prop-label shrink-0">{label}</span>
      <span className="min-w-0 truncate text-ink-2">{text}</span>
    </div>
  );
}

export function Scenes({ scenes }: { scenes: Scene[] }) {
  return (
    <ol className="list">
      <li className="grid grid-cols-[1.5rem_3rem_minmax(0,1fr)] gap-x-3 px-3 py-1.5 text-xs text-ink-3">
        <span>#</span>
        <span className="text-right">sec</span>
        <span>Prompt</span>
      </li>
      {scenes.map((scene, i) => (
        <li key={i} className="grid grid-cols-[1.5rem_3rem_minmax(0,1fr)] items-start gap-x-3 px-3 py-2">
          <span className="font-mono text-xs text-ink-3">{i + 1}</span>
          <span className="text-right font-mono text-xs tabular-nums text-ink-2">{scene.seconds}s</span>
          <div className="min-w-0 space-y-1">
            <Clamp text={scene.prompt} lines={1} />
            {scene.voiceover ? <Line label="Voiceover" text={scene.voiceover} /> : null}
            {scene.text ? <Line label="On screen" text={scene.text} /> : null}
            {scene.model ? <Line label="Model" text={scene.model} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Sources({ sources }: { sources: ClipSource[] }) {
  return (
    <ul className="space-y-2">
      {sources.map((source, i) => (
        <li key={i} className="rounded-md border border-line px-3 py-2">
          <div className="flex items-center gap-2">
            <a href={source.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm text-accent underline underline-offset-2">
              {source.url}
            </a>
            <span className="chip chip-plain font-mono tabular-nums">{rangeOf(source)}</span>
          </div>
          <Clamp text={source.reason} lines={2} className="mt-1" />
        </li>
      ))}
    </ul>
  );
}

/** A labelled section of a card's body, counted when it is a list. */
export function Section({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <div>
      <div className="prop-label mb-1.5">
        {label}
        {count !== undefined ? <span className="ml-1.5 tabular-nums">{count}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * The plans: what each video is made from, before and after it is made. A generation plan is read
 * as its scenes — prompt, seconds, voiceover, on-screen text — under the model and look it names;
 * a clipping plan as its sources — URL, the moment, and why. The operator's moves here are Render —
 * the plan goes to its renderer (producer or clipper) in a session of its own, under the id it
 * keeps as a post — Drop, and Restore. Claiming and finishing are the renderer's, over MCP, and a
 * rendered plan is read on its post.
 */
export function Projects() {
  const [tab, setTab] = useState<ProjectStatus>("planned");
  const [projects, setProjects] = useState<VideoProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, Sent | "sending">>({});
  const load = () => apiGet<VideoProject[]>("/projects").then(setProjects, (err: unknown) => setError(messageOf(err)));
  useEffect(() => {
    void load();
  }, []);
  // A sent plan is its renderer's until it is rendered or dropped, so the list is re-read while
  // any plan is out with one — bounded, in case the renderer never finishes.
  const awaited = (projects ?? [])
    .filter((p) => (p.status === "planned" || p.status === "rendering") && sent[p.id] !== undefined && sent[p.id] !== "sending")
    .map((p) => p.id)
    .join(",");
  useEffect(() => {
    if (awaited === "") return;
    const timer = setInterval(() => void load(), POLL_EVERY);
    const stop = setTimeout(() => clearInterval(timer), POLL_FOR);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [awaited]);
  const rows = (projects ?? []).filter((p) => p.status === tab);
  const label = TABS.find((t) => t.key === tab)?.label ?? tab;

  const render = (id: string) => {
    setError(null);
    setSent((s) => ({ ...s, [id]: "sending" }));
    apiSend<Sent>("POST", `/projects/${id}/render`).then(
      (answer) => setSent((s) => ({ ...s, [id]: answer })),
      (err: unknown) => {
        setSent(({ [id]: _, ...rest }) => rest);
        setError(messageOf(err));
      },
    );
  };

  const move = (id: string, status: "dropped" | "planned") => {
    const before = projects;
    setError(null);
    setProjects((ps) => (ps ?? []).map((p) => (p.id === id ? { ...p, status } : p)));
    apiSend<VideoProject>("PATCH", `/projects/${id}`, { status }).then(
      (saved) => setProjects((ps) => (ps ?? []).map((p) => (p.id === saved.id ? saved : p))),
      (err: unknown) => {
        setProjects(before);
        setError(messageOf(err));
      },
    );
  };

  const facts = (p: VideoProject): [string, ReactNode][] => {
    const sources = p.sources ?? [];
    const [only] = sources;
    return [
      ["Platform", <PlatformChip platform={p.platform} account={p.account} />],
      ["Planned by", p.agent ?? "unnamed agent"],
      ...(p.kind === "generation"
        ? ([
            ["Model", p.model ?? "—"],
            ["Total seconds", <span className="tabular-nums">{total(p)}s</span>],
            ["Style template", p.styleTemplate ?? "—"],
          ] as [string, ReactNode][])
        : ([
            ["Sources", sources.length],
            ["Time range", sources.length === 1 && only ? <span className="tabular-nums">{rangeOf(only)}</span> : `${sources.length} moments`],
          ] as [string, ReactNode][])),
      ["Post", p.postId ? <Link to="/posts" className="underline decoration-line underline-offset-2">{p.postId}</Link> : <span className="text-ink-3">no post yet</span>],
    ];
  };

  const aside = (p: VideoProject) => {
    const out = sent[p.id];
    return (
      <div className="flex flex-col items-end gap-1.5">
        {p.status === "planned" ? (
          <div className="flex gap-1.5">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={out !== undefined}
              title={`Send this plan to the ${RENDERER[p.kind]} to render now`}
              onClick={() => render(p.id)}
            >
              <Clapperboard size={14} strokeWidth={1.75} /> {out === "sending" ? "Sending…" : "Render"}
            </button>
            <button type="button" className="btn btn-danger btn-sm" title="Drop this plan — it is never rendered" onClick={() => move(p.id, "dropped")}>
              <X size={14} strokeWidth={1.75} /> Drop
            </button>
          </div>
        ) : null}
        {p.status === "dropped" ? (
          <button type="button" className="btn btn-ghost btn-sm" title="Put this plan back for the crew to render" onClick={() => move(p.id, "planned")}>
            <RotateCcw size={14} strokeWidth={1.75} /> Restore
          </button>
        ) : null}
        {out !== undefined && out !== "sending" ? (
          <span className="text-xs text-ink-3">
            Sent to the {out.renderer}
            {out.session.id ? <> · <Link to="/agents" className="font-mono underline underline-offset-2">{out.session.id}</Link></> : null}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="pane-in">
      <PageHeader
        title="Projects"
        subtitle={ACTIVE.words.plansSubtitle}
        actions={error ? <span className="chip chip-fail">{error}</span> : null}
      />

      <div className="seg mb-4 w-fit" role="tablist">
        {TABS.map(({ key, label }) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className="seg-item" onClick={() => setTab(key)}>
            {label}
            <span className="ml-1.5 text-xs tabular-nums text-ink-3">{(projects ?? []).filter((p) => p.status === key).length}</span>
          </button>
        ))}
      </div>

      <SectionHead label={label} count={projects === null ? undefined : rows.length} />

      {projects === null && error !== null ? (
        <div className="absence">The plans could not be read, so nothing can be said about what is {tab}: {error}</div>
      ) : projects === null ? (
        <div className="absence">Loading the plans…</div>
      ) : rows.length === 0 ? (
        <div className="absence">
          Nothing {tab} right now.
          {projects.length === 0 ? ` ${ACTIVE.words.plansEmpty}` : ""}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <Card
              key={p.id}
              title={
                <Link to={`/studio/${p.id}`} className="hover:underline" title="Open this plan in the Studio: its video, and the session that made it">
                  {p.title}
                </Link>
              }
              meta={
                <>
                  <span className="chip chip-plain">{p.kind}</span>
                  <ProjectStatusChip status={p.status} />
                  <span className="font-mono text-xs text-ink-3" title="One id, from plan to post">{p.id}</span>
                </>
              }
              aside={aside(p)}
            >
              <div className="space-y-4">
                <Facts items={facts(p)} cols={3} />

                <Section label="Brief">
                  <Clamp text={p.brief} lines={2} />
                </Section>

                {p.kind === "generation" && p.scenes !== undefined && p.scenes.length > 0 ? (
                  <Section label="Scenes" count={p.scenes.length}>
                    <Scenes scenes={p.scenes} />
                  </Section>
                ) : null}

                {p.kind === "clipping" && p.sources !== undefined && p.sources.length > 0 ? (
                  <Section label="Sources" count={p.sources.length}>
                    <Sources sources={p.sources} />
                  </Section>
                ) : null}

                {p.caption ? (
                  <details className="group">
                    <summary className="prop-label flex cursor-pointer select-none items-center gap-1.5">
                      <ChevronRight size={14} strokeWidth={1.75} className="self-center transition-transform group-open:rotate-90" aria-hidden />
                      Caption
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{p.caption}</p>
                  </details>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
