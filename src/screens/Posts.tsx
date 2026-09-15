import { Check, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiGet, apiSend, messageOf } from "../api";
import { ConnectLine, PageHeader, PlatformChip, StatusChip, Thumb, fmt } from "../components/kit";
import { piecesOf, postedLabel, rowKind, type Post, type PostStatus } from "../data";
import { ACTIVE } from "../../templates";

const TABS: { key: PostStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "ready", label: "Ready" },
  { key: "approved", label: "Approved" },
  { key: "posted", label: "Posted" },
  { key: "rejected", label: "Rejected" },
];

/** What each kind a row can carry is called, in the running template's words; a row filed under
 * the other template keeps its own kind and is still listed, so the id is the fallback. */
const KIND_LABELS: Record<string, string> = Object.fromEntries(ACTIVE.kinds.map((kind) => [kind.id, kind.label]));

/** The post lifecycle: pending (agent proposed) → ready (person edited/ok'd
 * content) → approved (cleared to publish, awaiting slot) → posted / rejected. Only rendered pieces are listed. */
export function Posts() {
  const [tab, setTab] = useState<PostStatus>("pending");
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
              status,
              ...(status === "posted" ? { postedAt: new Date().toISOString(), views: 0, likes: 0 } : {}),
              ...(status === "rejected" ? { rejectedReason: "Rejected by you" } : {}),
            }
          : p,
      ),
    );
    const sent = status === "posted"
      ? apiSend<Post>("POST", `/posts/${id}/post-now`)
      : apiSend<Post>("PATCH", `/posts/${id}`, { status });
    sent.then(
      (saved) => setPosts((ps) => (ps ?? []).map((p) => (p.id === saved.id ? saved : p))),
      (err: unknown) => {
        setPosts(before);
        setError(messageOf(err));
      },
    );
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
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            In production {production.length} — briefs the crew is still scripting or rendering; they land here as videos
          </summary>
          <div className="divide-y divide-line border-t border-line">
            {production.map((p) => (
              <div key={p.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <span className="chip chip-plain">{p.stage}</span>
                    <span>filed by {p.agent ?? "an unnamed agent"}</span>
                    {p.source ? <span>from {p.source}</span> : null}
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
          The queue could not be read, so nothing can be said about what is {tab}: {error}
        </div>
      ) : posts === null ? (
        <div className="absence">Loading the queue…</div>
      ) : rows.length === 0 ? (
        <div className="absence">
          Nothing {tab} right now.
          {pieces.length === 0 ? ` ${ACTIVE.words.queueEmpty}` : ""}
        </div>
      ) : (
        <div className="list">
          {rows.map((p) => (
            <div key={p.id} className="flex items-start gap-3 px-4 py-3">
              <Thumb src={p.mediaUrl} duration={p.duration} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.title}</span>
                  <StatusChip status={p.status} />
                </div>
                <details className="mt-0.5 text-sm text-ink-2">
                  <summary className="cursor-pointer truncate">{p.caption}</summary>
                  <div className="mt-1 whitespace-pre-wrap">{p.caption}</div>
                </details>
                {/* Who filed it, what from, and where it is going — the three things an agent-filed
                    row was missing while the same row printed "by mcp · unassigned". A field the
                    agent did not fill in is named as missing rather than dressed as an answer. */}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <PlatformChip platform={p.platform} account={p.account} />
                  {p.account ? null : <span>no account chosen yet</span>}
                  <span>
                    {p.agent ? `filed by ${p.agent}` : "filed by an unnamed agent"} · {KIND_LABELS[p.kind] ?? p.kind}
                  </span>
                  {p.source ? <span className="truncate">from {p.source}</span> : null}
                  {p.scheduledFor ? <span>→ {p.scheduledFor}</span> : null}
                  {p.postedAt ? <span className="tabular-nums">{postedLabel(p)} · {fmt(p.views ?? 0)} views · {fmt(p.likes ?? 0)} likes</span> : null}
                </div>
                {p.rejectedReason ? <div className="mt-1 text-xs text-tone-fail">{p.rejectedReason}</div> : null}
              </div>
              {tab === "pending" || tab === "ready" ? (
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" className="btn btn-accent btn-sm" title="Approve for posting" onClick={() => move(p.id, "approved")}>
                    <Check size={14} strokeWidth={1.75} /> Approve
                  </button>
                  {/* Labelled, like Approve: the destructive half of a pair was an icon on its own,
                      which is the one button in the queue nobody should have to guess at. */}
                  <button type="button" className="btn btn-danger btn-sm" title="Reject this post — it moves to Rejected and is never published" onClick={() => move(p.id, "rejected")}>
                    <X size={14} strokeWidth={1.75} /> Reject
                  </button>
                </div>
              ) : null}
              {tab === "approved" ? (
                <button
                  type="button"
                  className="btn btn-accent btn-sm shrink-0"
                  title={`Publish now to ${p.platform}${p.account ? ` as ${p.account}` : ""}, video included`}
                  onClick={() => move(p.id, "posted")}
                >
                  <Send size={14} strokeWidth={1.75} /> Post now
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
