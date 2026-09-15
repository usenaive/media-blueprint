import { RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { apiGet, apiSend, messageOf } from "../api";
import { PageHeader, PlatformChip } from "../components/kit";
import { type VideoProject, type ProjectStatus } from "../data";
import { ACTIVE } from "../../templates";

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

function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  const cls =
    status === "rendered" ? "chip-credit" : status === "dropped" ? "chip-fail" : status === "planned" ? "chip-absent" : "chip-plain";
  return <span className={`chip ${cls}`}>{STATUS_LABEL[status]}</span>;
}

const total = (project: VideoProject) => (project.scenes ?? []).reduce((sum, scene) => sum + scene.seconds, 0);

/**
 * The plans: what each video is made from, before and after it is made. A generation plan is read
 * as its scenes — prompt, seconds, voiceover, on-screen text — under the model and look it names;
 * a clipping plan as its sources — URL, the moment, and why. The operator's two moves here are
 * Drop and Restore: a plan is stopped while it is still a plan, before a render is spent on it.
 * Claiming and finishing are the crew's, over MCP, and a rendered plan is read on its post.
 */
export function Projects() {
  const [tab, setTab] = useState<ProjectStatus>("planned");
  const [projects, setProjects] = useState<VideoProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<VideoProject[]>("/projects").then(setProjects, (err: unknown) => setError(messageOf(err)));
  }, []);
  const rows = (projects ?? []).filter((p) => p.status === tab);

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
        <div className="list">
          {rows.map((p) => (
            <div key={p.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.title}</span>
                  <span className="chip chip-plain">{p.kind}</span>
                  <ProjectStatusChip status={p.status} />
                </div>
                <div className="mt-0.5 whitespace-pre-wrap text-sm text-ink-2">{p.brief}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <PlatformChip platform={p.platform} account={p.account} />
                  <span>{p.agent ? `planned by ${p.agent}` : "planned by an unnamed agent"}</span>
                  {p.kind === "generation" ? (
                    <span>
                      {p.scenes?.length ?? 0} scenes · {total(p)}s{p.model ? ` · ${p.model}` : ""}{p.styleTemplate ? ` · ${p.styleTemplate}` : ""}
                    </span>
                  ) : (
                    <span>{p.sources?.length ?? 0} {p.sources?.length === 1 ? "source" : "sources"}</span>
                  )}
                  {p.postId ? <Link to="/posts" className="underline decoration-line underline-offset-2">post {p.postId}</Link> : <span>no post yet</span>}
                </div>

                {p.kind === "generation" && p.scenes !== undefined && p.scenes.length > 0 ? (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-ink-2">Scenes</summary>
                    <ol className="mt-1 divide-y divide-line rounded-md border border-line">
                      {p.scenes.map((scene, i) => (
                        <li key={i} className="grid gap-1 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs text-ink-3">
                            <span className="font-medium text-ink-2">Scene {i + 1}</span>
                            <span className="tabular-nums">{scene.seconds}s</span>
                            {scene.model ? <span>{scene.model}</span> : null}
                          </div>
                          <div className="text-ink-2">{scene.prompt}</div>
                          {scene.text ? <div className="text-xs"><span className="text-ink-3">On screen:</span> {scene.text}</div> : null}
                          {scene.voiceover ? <div className="text-xs"><span className="text-ink-3">Voiceover:</span> {scene.voiceover}</div> : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}

                {p.kind === "clipping" && p.sources !== undefined && p.sources.length > 0 ? (
                  <details className="mt-2 text-sm" open={tab === "planned"}>
                    <summary className="cursor-pointer text-ink-2">Sources</summary>
                    <ul className="mt-1 divide-y divide-line rounded-md border border-line">
                      {p.sources.map((source, i) => (
                        <li key={i} className="grid gap-1 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <a href={source.url} target="_blank" rel="noreferrer" className="truncate text-[var(--accent)] underline underline-offset-2">{source.url}</a>
                            {source.from || source.to ? <span className="tabular-nums text-ink-3">{source.from ?? "start"} → {source.to ?? "end"}</span> : null}
                          </div>
                          <div className="text-ink-2">{source.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {p.caption ? (
                  <details className="mt-1 text-sm text-ink-2">
                    <summary className="cursor-pointer truncate">Caption: {p.caption}</summary>
                    <div className="mt-1 whitespace-pre-wrap">{p.caption}</div>
                  </details>
                ) : null}
              </div>
              {tab === "planned" ? (
                <button type="button" className="btn btn-danger btn-sm shrink-0" title="Drop this plan — it is never rendered" onClick={() => move(p.id, "dropped")}>
                  <X size={14} strokeWidth={1.75} /> Drop
                </button>
              ) : null}
              {tab === "dropped" ? (
                <button type="button" className="btn btn-ghost btn-sm shrink-0" title="Put this plan back for the crew to render" onClick={() => move(p.id, "planned")}>
                  <RotateCcw size={14} strokeWidth={1.75} /> Restore
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
