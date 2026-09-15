/**
 * The dashboard's own types and the one catalogue it genuinely ships: the style templates.
 *
 * There are no rows here any more. Posts, accounts and agents come from the server
 * (`src/api.ts`), because a compiled-in row is a fabricated row: it survives a reload the real
 * data does not, and it hides the fact that a route is dead. `src/no-seed.test.ts` keeps it that
 * way — `seed/posts.ts` and `seed/projects.ts` may only be imported here as types.
 */

import { STYLE_TEMPLATE_SEEDS, type StyleTemplateSeed } from "../seed/style-templates";
import type { Post, PostPlatform, PostStatus } from "../seed/posts";
import type { ProjectStatus, VideoProject } from "../seed/projects";

export type { Post, PostPlatform, PostStatus, ProjectStatus, VideoProject };

/** What a queue row is: a rendered piece, a brief still in production, or a seat's note. */
export type RowKind = "piece" | "production" | "note";
export const rowKind = (post: Post): RowKind => {
  const rendered = post.mediaUrl !== undefined || post.duration !== undefined || post.stage === "rendered";
  if (rendered || post.status === "approved" || post.status === "posted" || post.status === "rejected") return "piece";
  return post.stage === undefined ? "note" : "production";
};
export const piecesOf = (posts: readonly Post[]) => posts.filter((p) => rowKind(p) === "piece");

export interface Account {
  id: string;
  handle: string;
  /** Whatever the org connected — the portal offers more networks than a post can target. */
  platform: string;
  state: "connected" | "expired";
}

export interface StyleTemplate {
  id: string;
  name: string;
  prompt: string;
  usedBy: string[];
  image: string;
  trend?: string;
}

/** Reference images bundled by Vite; keyed by the seed's blueprint-root-relative path. */
const STYLE_IMAGES = import.meta.glob<string>("./assets/styles/*.jpg", { eager: true, import: "default" });

const USED_BY: Record<string, string[]> = {
  "Marble & ink": ["producer"],
  "Ghibli dusk": ["producer"],
  "Photoreal cinematic": ["producer"],
  "Paper cutout": ["clipper"],
};

/** Resolves seed rows (blueprint-root image paths) into displayable templates. */
export const toStyleTemplates = (seeds: readonly StyleTemplateSeed[]): StyleTemplate[] =>
  seeds.map((seed, i) => ({
    id: `sty_0${i + 1}`,
    name: seed.name,
    prompt: seed.prompt,
    trend: seed.trend,
    image: STYLE_IMAGES[seed.image.replace(/^src\//, "./")] ?? "",
    usedBy: USED_BY[seed.name] ?? [],
  }));

/**
 * The shipped preset catalogue — the one thing in this file that is legitimately compiled in. A
 * style template is the blueprint's own product, offered to the producer agent from the first
 * turn; it is not a row pretending to be the operator's work. The server ships the same list, so
 * the screen prefers the store's copy and falls back to this only before it has answered.
 */
export const STYLE_TEMPLATES: StyleTemplate[] = toStyleTemplates(STYLE_TEMPLATE_SEEDS);

export interface ChannelAgent {
  id: string;
  name: string;
  role: string;
  tools: string[];
  /** The model this agent runs on, as the platform names it. */
  model: string;
  /**
   * What it is allowed to spend, in micro-USD, and over what period. An agent screen that shows
   * four grey fields and no budget is telling the operator nothing about the one thing that runs
   * out — the roster carries these on every row and the screen simply never read them.
   */
  capMicroUsd: number;
  taskMicroUsd: number;
  period: string;
}

export interface AccountTotals {
  account: string;
  platform: string;
  posts: number;
  views: number;
  likes: number;
}

export interface ChannelStats {
  posted: Post[];
  views: number;
  likes: number;
  byAccount: AccountTotals[];
}

/**
 * Analytics, derived from the queue's own posted rows.
 *
 * This screen used to draw a fourteen-day series and two headline totals out of a constant table
 * compiled into the bundle: the numbers never moved, never matched the posts underneath them, and
 * were the same on every deployment of this blueprint. The only channel numbers the dashboard
 * actually holds are the ones on the posts it published, so those are what it reports — and when
 * nothing is published, it says so instead of inventing a good week.
 */
export function channelStats(posts: readonly Post[]): ChannelStats {
  const posted = posts.filter((p) => p.status === "posted");
  const totals = new Map<string, AccountTotals>();
  for (const post of posted) {
    // A published post with no account named is still a published post; it groups under a row that
    // says exactly that rather than under the word `undefined`.
    const account = post.account ?? "No account named";
    const key = `${post.platform} ${account}`;
    const row = totals.get(key) ?? { account, platform: post.platform, posts: 0, views: 0, likes: 0 };
    row.posts += 1;
    row.views += post.views ?? 0;
    row.likes += post.likes ?? 0;
    totals.set(key, row);
  }
  return {
    posted,
    views: posted.reduce((sum, p) => sum + (p.views ?? 0), 0),
    likes: posted.reduce((sum, p) => sum + (p.likes ?? 0), 0),
    byAccount: [...totals.values()].sort((a, b) => b.views - a.views),
  };
}

/** The numbers a posted row carries; each is a tile on Analytics and a line on its chart. */
export type Metric = "views" | "likes" | "posts";
export const METRICS: readonly Metric[] = ["views", "likes", "posts"];
export const METRIC_LABEL: Record<Metric, string> = { views: "Views", likes: "Likes", posts: "Posts published" };

/**
 * When a row was published, as a date — or nothing. The store stamps `postedAt` as ISO 8601; a
 * row written before it did carries a phrase (`"2d ago"`), which is printed as it stands and
 * cannot be placed on a day, so it is left off the chart rather than guessed onto one.
 */
export const postedDate = (post: Pick<Post, "postedAt">): Date | null => {
  if (post.postedAt === undefined) return null;
  const at = new Date(post.postedAt);
  return Number.isNaN(at.getTime()) ? null : at;
};

/** The date a post row prints: a short calendar date for a stamp, the phrase itself for anything else. */
export const postedLabel = (post: Pick<Post, "postedAt">, now = new Date()): string => {
  const at = postedDate(post);
  if (at === null) return post.postedAt ?? "—";
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
};

export interface DayPoint {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  value: number;
}

const dayKey = (at: Date): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

/**
 * One point per calendar day over the last `days`, ending today: the metric summed over the
 * rows published that day. Views and likes sit on the day the post shipped, because the row
 * holds one number per post and no history of it; a day nothing shipped is a zero, so the line
 * shows the gap rather than skipping it.
 */
export function dailySeries(posted: readonly Post[], metric: Metric, days: number, now = new Date()): DayPoint[] {
  const byDay = new Map<string, number>();
  for (const post of posted) {
    const at = postedDate(post);
    if (at === null) continue;
    const key = dayKey(at);
    byDay.set(key, (byDay.get(key) ?? 0) + (metric === "posts" ? 1 : (post[metric] ?? 0)));
  }
  const points: DayPoint[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const key = dayKey(at);
    points.push({ day: key, value: byDay.get(key) ?? 0 });
  }
  return points;
}

/**
 * The rows published within the last `days`. A row with no readable date belongs to "All time"
 * only: it cannot be shown to fall inside a window, and the chart could not place it either.
 */
export const withinDays = (posted: readonly Post[], days: number | null, now = new Date()): Post[] => {
  if (days === null) return [...posted];
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  return posted.filter((p) => {
    const at = postedDate(p);
    return at !== null && at.getTime() >= since;
  });
};
