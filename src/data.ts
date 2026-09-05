/**
 * The dashboard's own types and the one catalogue it genuinely ships: the style templates.
 *
 * There are no rows here any more. Posts, accounts and agents come from the server
 * (`src/api.ts`), because a compiled-in row is a fabricated row: it survives a reload the real
 * data does not, and it hides the fact that a route is dead. `src/no-seed.test.ts` keeps it that
 * way — `seed/posts.ts` may only be imported here as a type.
 */

import { STYLE_TEMPLATE_SEEDS, type StyleTemplateSeed } from "../seed/style-templates";
import type { Post, PostPlatform, PostStatus } from "../seed/posts";

export type { Post, PostPlatform, PostStatus };

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
