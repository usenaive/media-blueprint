import { ArrowLeft, Check, ChevronRight, Film, Megaphone, PanelRightClose, PanelRightOpen, ScrollText, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ApiError, apiGet, apiSend, messageOf } from "../api";
import { ChatPane } from "../chat/ChatPane";
import type { WireEvent } from "../chat/stream";
import { Clamp, Facts, MediaPreview, PlatformChip, StatusChip, ago, clock } from "../components/kit";
import type { Post, VideoProject } from "../data";
import { sessionState } from "./Chat";
import { ProjectStatusChip, Scenes, Section, Sources, rangeOf, total } from "./Projects";
import { RENDERER } from "../../templates/template";

export interface StudioSession {
  id: string;
  status: string;
  stop_reason: string | null;
  created_at?: string;
}

/** What `GET /api/studio/:id` answers: the plan, the post it lands on, and the session bound to it. */
export interface StudioData {
  project: VideoProject | null;
  post: Post | null;
  session: StudioSession | null;
}

/** What `POST /api/studio/:id/revise` answers. */
interface Revised {
  session: string;
  acceptedSeq: number;
  opened: boolean;
}

/** A rendering project is re-read this often; its renderer files the video over MCP, not through this screen. */
export const POLL_EVERY = 4_000;

type Tab = "video" | "plan" | "post";
const TABS: { key: Tab; label: string; Icon: typeof Film }[] = [
  { key: "video", label: "Video", Icon: Film },
  { key: "plan", label: "Plan", Icon: ScrollText },
  { key: "post", label: "Post", Icon: Megaphone },
];

const KIND_LABEL = { generation: "Generated", clipping: "Clip" } as const;

/** `2:10` of rendering so far, from when the status changed — the same clock as the pane's status line. */
export const elapsed = (sinceIso: string, now: number = Date.now()): string => clock(now - new Date(sinceIso).getTime());

/** Every cut of this project, oldest first: `renders[]` are the earlier ones, the post's file is the current one. */
export const versionsOf = (project: VideoProject, post: Post | null): { mediaUrl: string; at: string; current: boolean }[] => [
  ...(project.renders ?? []).map((r) => ({ mediaUrl: r.mediaUrl, at: r.at, current: false })),
  ...(post?.mediaUrl !== undefined ? [{ mediaUrl: post.mediaUrl, at: project.statusAt, current: true }] : []),
];

/** A vertical video, centred and no taller than the drawer allows. */
function Portrait({ src, label }: { src: string; label: string }) {
  return (
    <div className="mx-auto w-full max-w-[calc(60vh*9/16)]">
      <MediaPreview src={src} label={label} />
    </div>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function VideoTab({ project, post, drafts, playing, setPlaying }: { project: VideoProject; post: Post | null; drafts: string[]; playing: string | null; setPlaying: (url: string) => void }) {
  const versions = versionsOf(project, post);
  const rendering = project.status === "rendering";
  const now = useNow(rendering);
  const shown = playing ?? versions.at(-1)?.mediaUrl ?? null;
  return (
    <div className="space-y-4">
      {project.revision ? (
        <blockquote className="border-l-2 border-accent pl-3 text-sm text-ink-2">
          <span className="prop-label mr-1.5">Revising</span>
          {project.revision.note}
        </blockquote>
      ) : null}
      {drafts.length > 0 ? (
        <div className="panel px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="card-title">New cut — not filed yet</span>
            <span className="chip chip-absent">draft</span>
          </div>
          <div className="space-y-3">
            {drafts.map((id) => (
              <div key={id}>
                <Portrait src={id} label="A cut the renderer has made but not filed on the plan yet" />
                <div className="mt-1 text-center font-mono text-xs text-ink-3">{id}</div>
              </div>
            ))}
          </div>
        </div>
      ) : rendering ? (
        <div className="absence flex items-center justify-center gap-2">
          <span className="dot dot-run animate-pulse" aria-hidden />
          Rendering… <span className="font-mono tabular-nums text-ink-3">{elapsed(project.statusAt, now)}</span>
        </div>
      ) : null}
      {shown !== null ? (
        <Portrait src={shown} label={project.title} />
      ) : !rendering ? (
        <div className="absence">No video yet — this plan has not been rendered.</div>
      ) : null}
      {versions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Versions">
          {versions.map((v, i) => (
            <button
              key={v.mediaUrl}
              type="button"
              role="tab"
              aria-selected={v.mediaUrl === shown}
              className={`chip ${v.mediaUrl === shown ? "chip-chosen" : "chip-plain"} equip cursor-pointer`}
              title={v.mediaUrl}
              onClick={() => setPlaying(v.mediaUrl)}
            >
              v{i + 1} · {ago(v.at)}
              {v.current ? " (current)" : ""}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlanTab({ project }: { project: VideoProject }) {
  const sources = project.sources ?? [];
  const [only] = sources;
  const facts: [string, ReactNode][] = [
    ["Planned by", project.agent ?? "unnamed agent"],
    ...(project.kind === "generation"
      ? ([
          ["Model", project.model ?? "—"],
          ["Total seconds", <span className="tabular-nums">{total(project)}s</span>],
          ["Style template", project.styleTemplate ?? "—"],
        ] as [string, ReactNode][])
      : ([
          ["Sources", sources.length],
          ["Time range", sources.length === 1 && only ? <span className="tabular-nums">{rangeOf(only)}</span> : `${sources.length} moments`],
        ] as [string, ReactNode][])),
  ];
  return (
    <div className="space-y-4">
      <Facts items={facts} cols={2} />
      <Section label="Brief">
        <Clamp text={project.brief} lines={3} />
      </Section>
      {project.kind === "generation" && project.scenes !== undefined && project.scenes.length > 0 ? (
        <Section label="Scenes" count={project.scenes.length}>
          <Scenes scenes={project.scenes} />
        </Section>
      ) : null}
      {project.kind === "clipping" && sources.length > 0 ? (
        <Section label="Sources" count={sources.length}>
          <Sources sources={sources} />
        </Section>
      ) : null}
      {project.caption ? (
        <details className="group">
          <summary className="prop-label flex cursor-pointer select-none items-center gap-1.5">
            <ChevronRight size={14} strokeWidth={1.75} className="transition-transform group-open:rotate-90" aria-hidden />
            Caption
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{project.caption}</p>
        </details>
      ) : null}
    </div>
  );
}

/**
 * The post the video lands on, with the two calls it may still need from a person. Approving and
 * publishing are the operator's: there is no publish button here, and no agent moves a row.
 */
function PostTab({ post, onChange }: { post: Post; onChange: (saved: Post) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const move = (status: "approved" | "rejected") => {
    setError(null);
    setBusy(true);
    apiSend<Post>("PATCH", `/posts/${post.id}`, { status }).then(
      (saved) => {
        setBusy(false);
        onChange(saved);
      },
      (err: unknown) => {
        setBusy(false);
        setError(messageOf(err));
      },
    );
  };
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium text-ink">{post.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusChip status={post.status} />
          {post.stage ? <span className="chip chip-plain">{post.stage}</span> : null}
          <PlatformChip platform={post.platform} account={post.account} />
          <span className="font-mono text-xs text-ink-3">{post.id}</span>
        </div>
      </div>
      <Section label="Caption">
        <Clamp text={post.caption} lines={3} />
      </Section>
      <Facts
        cols={2}
        items={[
          ["Account", post.account ?? <span className="chip chip-absent">none chosen</span>],
          ["Filed by", post.agent ?? <span className="chip chip-absent">unnamed agent</span>],
        ]}
      />
      {post.rejectedReason ? (
        <Section label="Rejected because">
          <Clamp text={post.rejectedReason} lines={2} />
        </Section>
      ) : null}
      {post.status === "pending" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn btn-accent btn-sm" disabled={busy} title="Approve for posting" onClick={() => move("approved")}>
            <Check size={14} strokeWidth={1.75} /> Approve
          </button>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} title="Reject this post — it moves to Rejected and is never published" onClick={() => move("rejected")}>
            <X size={14} strokeWidth={1.75} /> Reject
          </button>
          {error ? <span className="chip chip-fail">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Studio: the conversation with the session that made a video on the left, the video itself on
 * the right, so a revision is a message and the new cut lands where the old one was. Reads
 * `GET /api/studio/:id` — a plan's id or its post's — and sends every message through
 * `POST /api/studio/:id/revise`, which decides which session hears it and refuses what an
 * approved post forbids. The video's status, not the session's, says when a render is done.
 */
export function Studio() {
  const { id = "" } = useParams();
  const [data, setData] = useState<StudioData | null>(null);
  const [error, setError] = useState<{ status: number; text: string } | null>(null);
  const [session, setSession] = useState<StudioSession | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("video");
  const [folded, setFolded] = useState(false);
  const [chatPct, setChatPct] = useState(45);
  const [dragging, setDragging] = useState(false);
  const main = useRef<HTMLDivElement>(null);

  const load = () =>
    apiGet<StudioData>(`/studio/${id}`).then(
      (answer) => {
        setData(answer);
        setError(null);
        setSession((s) => (answer.session === null || (s !== null && s.id === answer.session.id) ? s : answer.session));
        setSessionId((current) => current ?? answer.session?.id ?? null);
      },
      (err: unknown) => setError({ status: err instanceof ApiError ? err.status : 0, text: messageOf(err) }),
    );

  useEffect(() => {
    setData(null);
    setError(null);
    setSession(null);
    setSessionId(null);
    setDrafts([]);
    setPlaying(null);
    void load();
  }, [id]);

  const project = data?.project ?? null;
  const post = data?.post ?? null;
  const rendering = project?.status === "rendering";
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void load(), POLL_EVERY);
    return () => clearInterval(timer);
  }, [rendering, id]);

  const planless = data !== null && data.project === null;
  useEffect(() => {
    if (planless) setTab("post");
  }, [planless]);

  const send = (text: string) =>
    apiSend<Revised>("POST", `/studio/${id}/revise`, { message: text }).then((answer) => {
      setSessionId(answer.session);
      setSession({ id: answer.session, status: "running", stop_reason: null, ...(answer.opened ? { created_at: new Date().toISOString() } : {}) });
      void load();
      return { sessionId: answer.session, acceptedSeq: answer.acceptedSeq };
    });

  const onEvent = (event: WireEvent) => {
    if (event.type === "tool.completed" && event.data?.name === "channel.update_project") void load();
    if (event.type === "media.job.completed") {
      const files = Array.isArray(event.data?.file_ids) ? event.data.file_ids.filter((f): f is string => typeof f === "string") : [];
      setDrafts((d) => [...d, ...files.filter((f) => !d.includes(f))]);
    }
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPct = chatPct;
    const width = main.current?.getBoundingClientRect().width ?? 1;
    setDragging(true);
    const move = (ev: MouseEvent) => setChatPct(Math.min(70, Math.max(25, startPct + ((ev.clientX - startX) / width) * 100)));
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const pick = (next: Tab) => {
    setTab(next);
    setFolded(false);
  };

  if (error !== null && data === null) {
    return (
      <div className="pane-in">
        <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft size={14} strokeWidth={1.75} /> Projects
        </Link>
        <div className="absence">
          <div className="mb-2">
            {error.status === 404 ? (
              <>No plan or post has the id <span className="font-mono text-xs">{id}</span>. It may have been dropped, or the link is stale.</>
            ) : (
              "The studio could not be read."
            )}
          </div>
          <span className="chip chip-fail">{error.text}</span>
        </div>
      </div>
    );
  }

  // A file the plan already carries is no longer a draft.
  const filed = project === null ? [] : versionsOf(project, post).map((v) => v.mediaUrl);
  const unfiled = drafts.filter((f) => !filed.includes(f));
  const tabs = project === null ? TABS.filter((t) => t.key === "post") : TABS;
  const state = session === null ? null : sessionState(session);
  const title = project?.title ?? post?.title ?? id;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
        <Link to="/projects" className="equip inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink" title="Back to Projects">
          <ArrowLeft size={14} strokeWidth={1.75} /> Projects
        </Link>
        <span className="h-4 w-px bg-line" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{data === null ? "Reading the studio…" : title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            {project ? <span className="chip chip-plain">{KIND_LABEL[project.kind]}</span> : null}
            {project ? <ProjectStatusChip status={project.status} /> : null}
            {post ? <PlatformChip platform={post.platform} account={post.account} /> : project ? <PlatformChip platform={project.platform} account={project.account} /> : null}
            {state && session ? (
              <>
                <span className={`chip ${state.chip}`}>
                  <span className={`dot ${state.dot}`} aria-hidden /> {state.label}
                </span>
                <span className="font-mono text-xs text-ink-3">{session.id}</span>
              </>
            ) : data !== null ? (
              <span className="chip chip-absent">No session yet</span>
            ) : null}
          </div>
        </div>
        {post ? (
          <Link to="/posts" className="btn btn-ghost btn-sm shrink-0" title={`Open ${post.id} in the queue`}>
            Open post
          </Link>
        ) : null}
      </header>

      <div ref={main} className="flex min-h-0 flex-1">
        <section className="flex min-h-0 flex-col" style={{ width: folded ? "100%" : `${chatPct}%`, flex: folded ? 1 : "none" }}>
          {project === null && post !== null ? (
            <div className="border-b border-line px-6 py-2 text-xs text-ink-3">This post has no plan behind it — the channel-manager hears you here.</div>
          ) : null}
          <ChatPane
            className="min-h-0 flex-1"
            sessionId={sessionId}
            send={send}
            onSession={setSession}
            onEvent={onEvent}
            keepOpen={rendering}
            placeholder={project ? "Say what to change about this video…" : "Say what to change about this post…"}
            empty={
              project
                ? `No session is bound to this plan yet — your first note opens one with the ${RENDERER[project.kind]}.`
                : "Nothing has been said about this post yet — the channel-manager hears your first note."
            }
            under={
              project ? (
                <>
                  <span className="font-mono">{RENDERER[project.kind]}</span> · renders this plan again on your note — approving and publishing stay with you
                </>
              ) : undefined
            }
          />
        </section>

        {!folded ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the chat"
            data-dragging={dragging}
            className={`relative w-px shrink-0 cursor-col-resize before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[''] hover:bg-accent ${dragging ? "bg-accent" : "bg-line"}`}
            onMouseDown={startDrag}
          />
        ) : null}

        <aside className={`flex min-h-0 shrink-0 flex-col ${folded ? "w-11 border-l border-line" : "min-w-0 flex-1"}`}>
          <div className={`flex shrink-0 items-center border-b border-line ${folded ? "flex-col gap-1 py-2" : "gap-1 px-3"}`}>
            <button
              type="button"
              onClick={() => setFolded((f) => !f)}
              aria-label={folded ? "Expand the drawer" : "Fold the drawer"}
              className="equip grid size-8 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
            >
              {folded ? <PanelRightOpen size={16} strokeWidth={1.75} /> : <PanelRightClose size={16} strokeWidth={1.75} />}
            </button>
            {folded ? (
              <div className="mt-1 flex flex-col gap-1">
                {tabs.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    title={label}
                    aria-label={label}
                    onClick={() => pick(key)}
                    className={`grid size-8 place-items-center rounded-md hover:bg-hover ${key === tab ? "bg-sunken text-ink" : "text-ink-3"}`}
                  >
                    <Icon size={14} strokeWidth={1.75} />
                  </button>
                ))}
              </div>
            ) : (
              <nav className="flex gap-4 pl-1" aria-label="Drawer" role="tablist">
                {tabs.map(({ key, label, Icon }) => (
                  <button key={key} type="button" role="tab" aria-selected={key === tab} className="utab flex items-center gap-1.5" onClick={() => pick(key)}>
                    <Icon size={14} strokeWidth={1.75} />
                    {label}
                  </button>
                ))}
              </nav>
            )}
          </div>
          {!folded ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {data === null ? (
                <div className="absence">Reading the studio…</div>
              ) : tab === "video" && project ? (
                <VideoTab project={project} post={post} drafts={unfiled} playing={playing} setPlaying={setPlaying} />
              ) : tab === "plan" && project ? (
                <PlanTab project={project} />
              ) : post ? (
                <PostTab post={post} onChange={(saved) => setData((d) => (d === null ? d : { ...d, post: saved }))} />
              ) : (
                <div className="absence">No post yet — the render lands on one.</div>
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
