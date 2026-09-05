import { useEffect, useState } from "react";
import { apiGet, messageOf } from "../api";
import { PageHeader, PlatformChip, fmt } from "../components/kit";
import { channelStats, type Post } from "../data";

/**
 * What the channel actually did, derived from the posts it actually published — no series, no
 * totals and no per-account row exists here that is not the sum of rows in the queue. Before the
 * first post goes out there is nothing to report, and the screen says exactly that.
 */
export function Analytics() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<Post[]>("/posts").then(setPosts, (err: unknown) => setError(messageOf(err)));
  }, []);

  const stats = channelStats(posts ?? []);
  const top = [...stats.posted].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 10);
  const max = Math.max(1, ...top.map((p) => p.views ?? 0));

  return (
    <div className="pane-in">
      <PageHeader
        title="Analytics"
        subtitle="Every post this channel has published, and what it did."
        actions={error ? <span className="chip chip-fail">{error}</span> : null}
      />

      {posts === null ? (
        <div className="absence">{error === null ? "Loading the channel's posts…" : "No numbers to show."}</div>
      ) : stats.posted.length === 0 ? (
        <div className="absence">
          Nothing published yet. Approve a post and publish it, and its views and likes appear here.
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            {[
              ["Views", fmt(stats.views)],
              ["Likes", fmt(stats.likes)],
              ["Posts published", String(stats.posted.length)],
            ].map(([label, value]) => (
              <div key={label} className="panel px-3 py-2.5">
                <div className="eyebrow">{label}</div>
                <div className="font-display text-h2 mt-1">{value}</div>
              </div>
            ))}
          </div>

          <div className="panel mb-6 p-4">
            <div className="eyebrow mb-3">Views per post</div>
            <div className="flex h-32 items-end gap-1.5">
              {top.map((p) => (
                <div key={p.id} className="flex h-full flex-1 flex-col justify-end gap-1" title={`${p.title}: ${fmt(p.views ?? 0)} views`}>
                  <div className="w-full rounded-t bg-ink/80" style={{ height: `${Math.max(2, Math.round(((p.views ?? 0) / max) * 88))}%` }} />
                  <span className="truncate font-mono text-[10px] text-ink-3">{p.postedAt ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="eyebrow mb-2">By account</div>
          <div className="list">
            {stats.byAccount.map((row) => (
              <div key={`${row.platform} ${row.account}`} className="flex items-center gap-3 px-3 py-2.5">
                <PlatformChip platform={row.platform} />
                <span className="font-medium">{row.account}</span>
                <span className="ml-auto font-mono text-sm text-ink-2">{fmt(row.views)} views</span>
                <span className="font-mono text-sm text-ink-3">{fmt(row.likes)} likes</span>
                <span className="font-mono text-sm text-ink-3">{row.posts} posts</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
