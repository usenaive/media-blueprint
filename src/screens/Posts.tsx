import { Check, Clapperboard, Send, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { apiGet, apiSend, messageOf } from "../api";
import { Avatar, Card, Clamp, ConnectLine, Facts, PageHeader, PlatformChip, StatusChip, Thumb, fmt } from "../components/kit";
import { piecesOf, postedLabel, rowKind, type Post, type PostStatus } from "../data";
import { ACTIVE } from "../../templates";

const TABS: { key: PostStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "ready", label: "Ready" },
  { key: "approved", label: "Approved" },
  { key: "posted", label: "Posted" },
  { key: "rejected", label: "Rejected" },
];

/** The tab `/posts?tab=` asks for; the queue opens on Pending when it names none. */
export const tabAsked = (asked: string | null): PostStatus => TABS.find((t) => t.key === asked)?.key ?? "pending";

/** The operator's move on a post, as every surface sends it: a rejection names its reason. */
export const moveBody = (status: PostStatus): { status: PostStatus; rejectedReason?: string } =>
  status === "rejected" ? { status, rejectedReason: "Rejected by you" } : { status };

/** What each kind a row can carry is called, in the running template's words; a row filed under
 * the other template keeps its own kind and is still listed, so the id is the fallback. */
const KIND_LABELS: Record<string, string> = Object.fromEntries(ACTIVE.kinds.map((kind) => [kind.id, kind.label]));

/** A field the agent did not fill in is named as missing rather than dressed as an answer. */
const Missing = ({ text }: { text: string }) => <span className="chip chip-absent">{text}</span>;

/** The facts a queue row carries, in the order the card prints them; a fact the row lacks is left out. */
export const postFacts = (post: Post): [string, ReactNode][] => {
  const facts: [string, ReactNode][] = [
    ["Filed by", post.agent ?? <Missing text="unnamed agent" />],
    ["Kind", KIND_LABELS[post.kind] ?? post.kind],
    ["Account", post.account ?? <Missing text="none chosen" />],
    ["Plan", post.projectId ? <Link to="/projects" className="font-mono text-xs text-accent hover:underline">plan {post.projectId}</Link> : <Missing text="no plan" />],
  ];
  if (post.source) facts.push(["Source", post.source]);
  if (post.scheduledFor) facts.push(["Scheduled", post.scheduledFor]);
  if (post.postedAt) facts.push(["Posted", postedLabel(post)], ["Views", fmt(post.views ?? 0)], ["Likes", fmt(post.likes ?? 0)]);
  return facts;
};

/** The post lifecycle: pending (agent proposed) → ready (person edited/ok'd
 * content) → approved (cleared to publish, awaiting slot) → posted / rejected. Only rendered pieces are listed. */
export function Posts() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<PostStatus>(() => tabAsked(params.get("tab")));
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<Post[]>("/posts").then(setPosts, (err: unknown) => setError(messageOf(err)));
  }, []);
  const pieces = piecesOf(posts ?? []);
  const rows = pieces.filter((p) => p.status === tab);
  const production = (posts ?? []).filter((p) => rowKind(p) === "production");

  /**
   * Moves a post and keeps the screen truthful about what the server did. "Post now" publishes for
   * real — caption, title and the finished video — so a refusal (an account that cannot be posted
   * to, an upstream that declined) has to come back to the operator rather than leaving a row that
   * says "Posted" until the next reload disagrees.
   */
  const move = (id: string, status: PostStatus) => {
    const before = posts;
    setError(null);
    setPosts((ps) =>
      (ps ?? []).map((p) =>
        p.id === id
          ? {
              ...p,
              ...moveBody(status),
              ...(status === "posted" ? { postedAt: new Date().toISOString(), views: 0, likes: 0 } : {}),
            }
          : p,
      ),
    );
    const sent = status === "posted"
      ? apiSend<Post>("POST", `/posts/${id}/post-now`)
      : apiSend<Post>("PATCH", `/posts/${id}`, moveBody(status));
    sent.then(
      (saved) => setPosts((ps) => (ps ?? []).map((p) => (p.id === saved.id ? saved : p))),
      (err: unknown) => {
        setPosts(before);
        setError(messageOf(err));
      },
    );
  };

  /** The one or two calls a row in this tab still needs from a person — and the way to its video; none once it is posted or rejected. */
  const actionsFor = (p: Post): ReactNode => {
    const studio = (
      <Link to={`/studio/${p.projectId ?? p.id}`} className="btn btn-ghost btn-sm" title="Open this post and its video in the Studio">
        <Clapperboard size={14} strokeWidth={1.75} /> Open in Studio
      </Link>
    );
    if (tab === "pending" || tab === "ready") {
      return (
        <>
          {studio}
          <button type="button" className="btn btn-accent btn-sm" title="Approve for posting" onClick={() => move(p.id, "approved")}>
            <Check size={14} strokeWidth={1.75} /> Approve
          </button>
          {/* Labelled, like Approve: the destructive half of a pair was an icon on its own,
              which is the one button in the queue nobody should have to guess at. */}
          <button type="button" className="btn btn-danger btn-sm" title="Reject this post — it moves to Rejected and is never published" onClick={() => move(p.id, "rejected")}>
            <X size={14} strokeWidth={1.75} /> Reject
          </button>
        </>
      );
    }
    if (tab === "approved") {
      return (
        <>
          {studio}
          <button
            type="button"
            className="btn btn-accent btn-sm"
            title={`Publish now to ${p.platform}${p.account ? ` as ${p.account}` : ""}, video included`}
            onClick={() => move(p.id, "posted")}
          >
            <Send size={14} strokeWidth={1.75} /> Post now
          </button>
        </>
      );
    }
    return studio;
  };

  return (
    <div className="pane-in">
      <PageHeader
        title="Posts"
        subtitle={ACTIVE.words.queueSubtitle}
        actions={error ? <span className="chip chip-fail">{error}</span> : null}
      />

      {/* The queue is aimed at the networks the customer picked. This says which, and whether each can be reached. */}
      <ConnectLine />

      <div className="seg mb-4 w-fit" role="tablist">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className="seg-item"
            onClick={() => setTab(key)}
          >
            {label}
            <span className="ml-1.5 text-xs tabular-nums text-ink-3">{pieces.filter((p) => p.status === key).length}</span>
          </button>
        ))}
      </div>

      {production.length > 0 ? (
        <details className="panel mb-4">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3">
            <span className="card-title">In production</span>
            <span className="chip chip-plain tabular-nums">{production.length}</span>
            <span className="text-xs text-ink-3">briefs the crew is still scripting or rendering; they land here as videos</span>
          </summary>
          <div className="divide-y divide-line border-t border-line">
            {production.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={p.agent ?? "?"} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                    <span className="chip chip-plain">{p.stage}</span>
                    <span>{p.agent ?? "an unnamed agent"}</span>
                    {p.source ? <span className="chip chip-plain">{p.source}</span> : null}
                    {p.projectId ? <Link to="/projects" className="font-mono text-accent hover:underline">plan {p.projectId}</Link> : null}
                  </div>
                </div>
                {/* The one call a brief still needs from a person. The producer renders what is filed
                    here on its own schedule, so a brief that is off-brand or legally risky has to be
                    stoppable while it is still a brief. There is deliberately no Approve: a brief is
                    not a piece to clear, and approving one stranded the row. */}
                <button
                  type="button"
                  className="btn btn-danger btn-sm shrink-0"
                  title="Reject this brief — it moves to Rejected and is never rendered"
                  onClick={() => move(p.id, "rejected")}
                >
                  <X size={14} strokeWidth={1.75} /> Reject
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {posts === null && error !== null ? (
        <div className="absence">
          <div className="mb-2">The queue could not be read, so nothing can be said about what is {tab}.</div>
          <span className="chip chip-fail">{error}</span>
        </div>
      ) : posts === null ? (
        <div className="absence">Loading the queue…</div>
      ) : rows.length === 0 ? (
        <div className="absence">
          Nothing {tab} right now.
          {pieces.length === 0 ? ` ${ACTIVE.words.queueEmpty}` : ""}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <Card
              key={p.id}
              title={
                <Link to={`/studio/${p.projectId ?? p.id}`} className="hover:underline" title="Open this post and its video in the Studio">
                  {p.title}
                </Link>
              }
              meta={
                <>
                  <StatusChip status={p.status} />
                  <PlatformChip platform={p.platform} account={p.account} />
                  <span className="font-mono text-xs text-ink-3">{p.id}</span>
                </>
              }
              aside={actionsFor(p)}
            >
              <div className="flex items-start gap-4">
                <Thumb src={p.mediaUrl} duration={p.duration} />
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <div className="prop-label mb-1">Caption</div>
                    <Clamp text={p.caption} lines={2} />
                  </div>
                  <Facts items={postFacts(p)} cols={4} />
                  {p.rejectedReason ? (
                    <div>
                      <div className="prop-label mb-1 text-fail">Rejected because</div>
                      <Clamp text={p.rejectedReason} lines={2} />
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
