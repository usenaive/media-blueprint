/**
 * The channel's pages, as data (the platform's views, canonical-spec §50). The platform owns every
 * block and reads every number; this file only says which pages a channel has and what sits on
 * each, in what order. Words only: a digit in a title is refused, because the window a number
 * covers is written by the platform from its binding.
 *
 *   · home — the setup line, the accounts, what waits on you, what the crew is doing, the week,
 *     how the channel is doing, the newest media and the roadmap;
 *   · posts — waiting on you, scheduled, posted;
 *   · performance — views, posts against the cadence, views per post, spend.
 */
import type { MediaTemplate } from "./template.ts";

type Elements = Record<string, { type: string; props: Record<string, unknown>; children?: string[] }>;
const page = (children: string[], elements: Elements): { root: string; elements: Elements } => ({ root: "page", elements: { page: { type: "Page", props: {}, children }, ...elements } });
const section = (title: string, children: string[], more: { to?: string; hide_empty?: boolean } = {}) => ({ type: "Section", props: { title, ...more }, children });

/** The answers the home's first line reads: what the channel is about, then how often it posts. */
function leadKeys(template: MediaTemplate): string[] {
  const about = ["niche", "sources"].find((key) => template.questions.some((question) => question.key === key));
  return about ? [about, "cadence"] : ["cadence"];
}

const home = (template: MediaTemplate) => ({
  slug: "home",
  title: "Home",
  mark: "home",
  spec: page(["setup", "intro", "accounts", "waiting", "now", "week", "performance", "media", "roadmap"], {
    setup: { type: "Setup", props: {} },
    intro: { type: "Answers", props: { answers: { $source: "answers", keys: leadKeys(template) } } },
    accounts: { type: "Accounts", props: { accounts: { $source: "accounts" } } },
    waiting: section("Waiting on you", ["needs"], { hide_empty: true }),
    needs: { type: "Needs", props: { needs: { $source: "needs" } } },
    now: section("Now", ["agents"], { hide_empty: true }),
    agents: { type: "Activity", props: { agents: { $source: "agents_activity" } } },
    week: section("This week", ["schedule"]),
    schedule: { type: "Schedule", props: { week: { $source: "schedule" } } },
    performance: section("Performance", ["numbers", "bars"], { to: "/views/performance" }),
    numbers: { type: "Grid", props: { columns: 3 }, children: ["views", "posted", "spend"] },
    views: { type: "Metric", props: { label: "Views", value: { $source: "views_total", days: 7 }, delta: { $source: "views_change" } } },
    posted: { type: "Progress", props: { label: "Posts this week", progress: { $source: "posts_this_week" } } },
    spend: { type: "Stack", props: {}, children: ["spent", "line"] },
    spent: { type: "Metric", props: { label: "Spend", value: { $source: "spend_total", days: 14 } } },
    line: { type: "LineChart", props: { series: { $source: "spend_by_day", days: 14 } } },
    bars: { type: "BarList", props: { label: "Latest posts", bars: { $source: "post_views", limit: 5 } } },
    media: section("Latest media", ["tiles"], { to: "/media" }),
    tiles: { type: "Media", props: { files: { $source: "newest_media", count: 6 } } },
    roadmap: section("Roadmap", ["board"], { to: "/board" }),
    board: { type: "Roadmap", props: { board: { $source: "roadmap", per_group: 3 } } },
  }),
});

const posts = {
  slug: "posts",
  title: "Posts",
  mark: "list",
  spec: page(["waiting", "scheduled", "posted"], {
    waiting: section("Waiting on you", ["pending"], { hide_empty: true }),
    pending: { type: "Posts", props: { posts: { $source: "posts", status: "waiting", limit: 50 } } },
    scheduled: section("Scheduled", ["due"], { hide_empty: true }),
    due: { type: "Posts", props: { posts: { $source: "posts", status: "scheduled", limit: 50 } } },
    posted: section("Posted", ["out"]),
    out: { type: "Posts", props: { posts: { $source: "posts", status: "posted", limit: 30 } } },
  }),
};

const performance = {
  slug: "performance",
  title: "Performance",
  mark: "chart",
  spec: page(["numbers", "posts", "money"], {
    numbers: { type: "Grid", props: { columns: 3 }, children: ["week", "month", "posted"] },
    week: { type: "Metric", props: { label: "Views", value: { $source: "views_total", days: 7 }, delta: { $source: "views_change" } } },
    month: { type: "Metric", props: { label: "Views", value: { $source: "views_total", days: 30 }, delta: { $source: "views_change" } } },
    posted: { type: "Progress", props: { label: "Posts this week", progress: { $source: "posts_this_week" } } },
    posts: section("Views per post", ["bars"]),
    bars: { type: "BarList", props: { bars: { $source: "post_views", limit: 12 } } },
    money: section("Spend", ["spent", "line"]),
    spent: { type: "Metric", props: { label: "Spent", value: { $source: "spend_total", days: 30 } } },
    line: { type: "LineChart", props: { series: { $source: "spend_by_day", days: 30 } } },
  }),
};

/** A channel's views, in the rail's order. */
export const viewsFor = (template: MediaTemplate) => [home(template), posts, performance];
