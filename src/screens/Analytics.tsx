import { useEffect, useState, type CSSProperties } from "react";
import { apiGet, messageOf } from "../api";
import { Card, fmt, PageHeader, PlatformChip } from "../components/kit";
import {
  channelStats,
  dailySeries,
  METRIC_LABEL,
  METRICS,
  postedDate,
  postedLabel,
  withinDays,
  type DayPoint,
  type Metric,
  type Post,
} from "../data";

/** The ranges the header offers; `null` is every post the channel ever published. */
const RANGES: readonly { days: number | null; label: string }[] = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: null, label: "All time" },
];

/** The chart's window for a range: the range itself, or the last 90 days when every post is in. */
const chartDays = (days: number | null): number => days ?? 90;

const PLATFORM_LABEL: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };
const platformLabel = (platform: string): string => PLATFORM_LABEL[platform] ?? platform;

/**
 * Analytics: what this channel published and what it did, over a range and on one platform or
 * all of them. Three tiles carry the totals; the one pressed drives the line underneath; the
 * table at the foot is every published row in the range with its own numbers.
 */
export function Analytics() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>("all");
  const [range, setRange] = useState<number | null>(30);
  const [metric, setMetric] = useState<Metric>("views");

  useEffect(() => {
    apiGet<Post[]>("/posts").then(setPosts, (err: unknown) => setError(messageOf(err)));
  }, []);

  const everything = channelStats(posts ?? []);
  const platforms = [...new Set(everything.posted.map((p) => p.platform))].sort();
  const onPlatform = platform === "all" ? everything.posted : everything.posted.filter((p) => p.platform === platform);
  const scoped = withinDays(onPlatform, range);
  /**
   * The published rows this dashboard cannot place on a day. `postedAt` is ISO 8601 and has not
   * always been: a row published before the store stamped one carries a phrase (`"just now"`),
   * which no finite range can contain and the chart cannot plot (`postedDate`). They are why a
   * channel with real published history can have an empty window, and an empty window of tiles
   * reading zero would report that history as nothing. The screen says which it is instead.
   */
  const undated = onPlatform.filter((p) => postedDate(p) === null);
  const stats = channelStats(scoped);
  const series = dailySeries(stats.posted, metric, chartDays(range));
  const rows = [...stats.posted].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));

  const totals: Record<Metric, number> = { views: stats.views, likes: stats.likes, posts: stats.posted.length };

  return (
    <div className="pane-in">
      <PageHeader
        title="Analytics"
        subtitle="Track the performance of your published content."
        actions={
          <div className="flex items-center gap-2">
            {error ? <span className="chip chip-fail">{error}</span> : null}
            <select className="filter" aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="all">All platforms</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {platformLabel(p)}
                </option>
              ))}
            </select>
            <select
              className="filter"
              aria-label="Range"
              value={range === null ? "all" : String(range)}
              onChange={(e) => setRange(e.target.value === "all" ? null : Number(e.target.value))}
            >
              {RANGES.map((r) => (
                <option key={r.label} value={r.days === null ? "all" : String(r.days)}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {posts === null ? (
        <div className="absence">{error === null ? "Loading the channel's posts…" : "No numbers to show."}</div>
      ) : everything.posted.length === 0 ? (
        <div className="absence">Nothing published yet. Approve a post and publish it, and its views and likes appear here.</div>
      ) : scoped.length === 0 && undated.length > 0 ? (
        <div className="absence">
          Nothing datable was published in this range, and {undated.length} published{" "}
          {undated.length === 1 ? "row carries" : "rows carry"} no readable publish date — filed before the store stamped
          one, so no range can hold {undated.length === 1 ? "it" : "them"}. Their numbers are under All time.
          <button type="button" className="btn btn-ghost btn-sm ml-2" onClick={() => setRange(null)}>
            Show all time
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <Card>
            <div className="grid grid-cols-3 gap-3" role="group" aria-label="Metric">
              {METRICS.map((m) => (
                <button key={m} type="button" className="tile equip" aria-pressed={metric === m} onClick={() => setMetric(m)}>
                  <span className="prop-label">{METRIC_LABEL[m]}</span>
                  <span className="tile-value">{m === "posts" ? String(totals[m]) : fmt(totals[m])}</span>
                  <span className="text-xs text-ink-3">{RANGES.find((r) => r.days === range)?.label.toLowerCase()}</span>
                </button>
              ))}
            </div>
            <LineChart points={series} label={METRIC_LABEL[metric]} />
          </Card>

          <Card title="Posts" aside={<span className="chip chip-plain tabular-nums">{rows.length}</span>}>
            {rows.length === 0 ? (
              <div className="absence">Nothing published in this range.</div>
            ) : (
              <div className="tbl" style={{ "--cols": "6.5rem minmax(0, 1fr) 9rem 5rem 5rem" } as CSSProperties}>
                <div className="tbl-head">Publish date</div>
                <div className="tbl-head">Post</div>
                <div className="tbl-head">Platform</div>
                <div className="tbl-head tbl-num">Views</div>
                <div className="tbl-head tbl-num">Likes</div>
                {rows.map((p) => (
                  <PostRow key={p.id} post={p} />
                ))}
              </div>
            )}
          </Card>

          {stats.byAccount.length > 1 ? (
            <Card title="By account" aside={<span className="chip chip-plain tabular-nums">{stats.byAccount.length}</span>}>
              <div className="tbl" style={{ "--cols": "9rem minmax(0, 1fr) 5rem 5rem 5rem" } as CSSProperties}>
                <div className="tbl-head">Platform</div>
                <div className="tbl-head">Account</div>
                <div className="tbl-head tbl-num">Posts</div>
                <div className="tbl-head tbl-num">Views</div>
                <div className="tbl-head tbl-num">Likes</div>
                {stats.byAccount.map((row) => (
                  <div key={`${row.platform} ${row.account}`} className="contents">
                    <div className="tbl-row">
                      <PlatformChip platform={row.platform} />
                    </div>
                    <div className="tbl-row truncate font-medium">{row.account}</div>
                    <div className="tbl-row tbl-num">{row.posts}</div>
                    <div className="tbl-row tbl-num">{fmt(row.views)}</div>
                    <div className="tbl-row tbl-num text-ink-2">{fmt(row.likes)}</div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PostRow({ post }: { post: Post }) {
  return (
    <div className="contents">
      <div className="tbl-row text-ink-2">{postedLabel(post)}</div>
      <div className="tbl-row min-w-0">
        <div className="truncate font-medium">{post.title}</div>
        <div className="truncate text-xs text-ink-3">{post.caption}</div>
      </div>
      <div className="tbl-row">
        <PlatformChip platform={post.platform} account={post.account} />
      </div>
      <div className="tbl-row tbl-num">{fmt(post.views ?? 0)}</div>
      <div className="tbl-row tbl-num text-ink-2">{fmt(post.likes ?? 0)}</div>
    </div>
  );
}

/** The y-axis ticks for a series: a rounded top, and quarter steps down to zero. */
export function yTicks(max: number): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * magnitude).find((s) => max / s <= 4) ?? magnitude * 10;
  const top = Math.ceil(max / step) * step;
  return [0, 1, 2, 3, 4].map((i) => (top * i) / 4);
}

/** The x-axis labels: at most six dates across the window, always including the first and last day. */
export function xTicks(points: readonly DayPoint[]): number[] {
  if (points.length <= 6) return points.map((_, i) => i);
  const step = (points.length - 1) / 5;
  return [0, 1, 2, 3, 4, 5].map((i) => Math.round(i * step));
}

const dayLabel = (day: string): string => {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/**
 * One line, no library: the day series drawn into a fixed viewBox, the y ticks on the left and up
 * to six dates along the foot. Flat at zero is a true reading — a row's views are counted the day
 * it shipped, and a week nothing shipped is a week at zero.
 */
function LineChart({ points, label }: { points: DayPoint[]; label: string }) {
  const W = 800;
  const H = 220;
  const pad = { top: 12, right: 28, bottom: 28, left: 48 };
  const max = Math.max(0, ...points.map((p) => p.value));
  const ticks = yTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => pad.left + (i / Math.max(1, points.length - 1)) * (W - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - v / top) * (H - pad.top - pad.bottom);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  return (
    <figure className="mt-4">
      <figcaption className="sr-only">
        {label} per day, {points.length} days
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${label} per day`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.left - 10} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--ink-3)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {xTicks(points).map((i) => {
          const point = points[i];
          return point === undefined ? null : (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
              {dayLabel(point.day)}
            </text>
          );
        })}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) =>
          p.value > 0 ? <circle key={p.day} cx={x(i)} cy={y(p.value)} r={3.5} fill="var(--surface)" stroke="var(--accent)" strokeWidth={2} /> : null,
        )}
      </svg>
    </figure>
  );
}
