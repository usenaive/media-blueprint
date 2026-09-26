/**
 * The channel's one mini app, "Channel", as data (the platform's mini apps, canonical-spec §50). It
 * stands where the old hosted dashboard stood. The platform owns every block, reads every number and
 * draws every mini app with one UI under Apps; this file only says which pages the app has and what
 * sits on each, in what order. Words only: a digit in a title is refused, because the window a
 * number covers is written by the platform from its binding.
 *
 *   · Posts — the accounts, the setup's line, what waits on you (each opens with its approval card),
 *     what is scheduled, what went out with its views, and what is in production on the board;
 *   · Schedule — the week (routines and scheduled posts), posts against the cadence, who is working;
 *   · Analytics — views with their change, posts against the cadence, spend and its line, views per
 *     post, the newest media.
 */
import type { MediaTemplate } from "./template.ts";

type Elements = Record<string, { type: string; props: Record<string, unknown>; children?: string[] }>;
const page = (children: string[], elements: Elements): { root: string; elements: Elements } => ({ root: "page", elements: { page: { type: "Page", props: {}, children }, ...elements } });
const section = (title: string, children: string[], more: { to?: string; hide_empty?: boolean } = {}) => ({ type: "Section", props: { title, ...more }, children });

/** The answers the setup line reads: what the channel is about, then how often it posts. */
export function leadKeys(template: MediaTemplate): string[] {
  const about = ["niche", "sources"].find((key) => template.questions.some((question) => question.key === key));
  return about ? [about, "cadence"] : ["cadence"];
}

const posts = (template: MediaTemplate) => ({
  slug: "posts",
  title: "Posts",
  spec: page(["accounts", "intro", "waiting", "scheduled", "posted", "production"], {
    accounts: { type: "Accounts", props: { accounts: { $source: "accounts" } } },
    intro: { type: "Answers", props: { answers: { $source: "answers", keys: leadKeys(template) } } },
    waiting: section("Waiting on you", ["pending"]),
    pending: { type: "Posts", props: { posts: { $source: "posts", status: "waiting", limit: 20 } } },
    scheduled: section("Scheduled", ["due"]),
    due: { type: "Posts", props: { posts: { $source: "posts", status: "scheduled", limit: 20 } } },
    posted: section("Posted", ["out"], { to: "/apps/channel?page=analytics" }),
    out: { type: "Posts", props: { posts: { $source: "posts", status: "posted", limit: 20 } } },
    production: section("In production", ["board"], { to: "/board" }),
    board: { type: "Roadmap", props: { board: { $source: "roadmap", per_group: 3 } } },
  }),
});

const schedule = {
  slug: "schedule",
  title: "Schedule",
  spec: page(["week", "plan", "now"], {
    week: section("This week", ["days"]),
    days: { type: "Schedule", props: { week: { $source: "schedule" } } },
    plan: section("Posting plan", ["posted"]),
    posted: { type: "Progress", props: { label: "Posts this week", progress: { $source: "posts_this_week" } } },
    now: section("Now", ["agents"], { hide_empty: true }),
    agents: { type: "Activity", props: { agents: { $source: "agents_activity" } } },
  }),
};

const analytics = {
  slug: "analytics",
  title: "Analytics",
  spec: page(["numbers", "money", "per", "media"], {
    numbers: { type: "Grid", props: { columns: 3 }, children: ["views", "posted", "spent"] },
    views: { type: "Metric", props: { label: "Views", value: { $source: "views_total", days: 7 }, delta: { $source: "views_change" } } },
    posted: { type: "Progress", props: { label: "Posts this week", progress: { $source: "posts_this_week" } } },
    spent: { type: "Metric", props: { label: "Spent", value: { $source: "spend_total", days: 7 } } },
    money: section("Spend", ["line"]),
    line: { type: "LineChart", props: { series: { $source: "spend_by_day", days: 14 } } },
    per: section("Views per post", ["bars"]),
    bars: { type: "BarList", props: { bars: { $source: "post_views", limit: 12 } } },
    media: section("Latest media", ["tiles"]),
    tiles: { type: "Media", props: { files: { $source: "newest_media", count: 6 } } },
  }),
};

/** The channel's mini app: one, with three pages, in the order the segmented control draws them. */
export const channelFor = (template: MediaTemplate) => ({ slug: "channel", name: "Channel", icon: "play", pages: [posts(template), schedule, analytics] });
