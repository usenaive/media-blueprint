/**
 * The channel's one mini app, "Media manager", as data (the platform's mini apps, canonical-spec §50).
 * It stands where the old hosted dashboard stood. The platform owns every block, reads every number and
 * draws every mini app with one UI under Apps — the head carries the channel's networks and says when
 * one is not connected — so this file only says which pages the app has and what sits on each, in
 * what order. Words only: a digit in a title is refused, because the window a number covers is
 * written by the platform from its binding.
 *
 *   · Posts — the queue, in the order you act on it: what waits on you (each opens with its approval
 *     card), what goes out next, what went out with its views. The first two are not drawn while empty;
 *   · Analytics — views with their change, posts against the cadence, spend, then views per post once
 *     a post has been counted;
 *   · Media — every picture and clip the crew made: the platform's gallery, with its filters, sort
 *     and viewer.
 *
 * What the old dashboard had and this leaves out, and why, is ADR-0993's table.
 */

type Elements = Record<string, { type: string; props: Record<string, unknown>; children?: string[] }>;
const page = (children: string[], elements: Elements): { root: string; elements: Elements } => ({ root: "page", elements: { page: { type: "Page", props: {}, children }, ...elements } });
const section = (title: string, children: string[], more: { hide_empty?: boolean } = {}) => ({ type: "Section", props: { title, ...more }, children });
const posts = (status: "waiting" | "scheduled" | "posted") => ({ type: "Posts", props: { posts: { $source: "posts", status, limit: 20 } } });

const queue = {
  slug: "posts",
  title: "Posts",
  spec: page(["waiting", "scheduled", "posted"], {
    waiting: section("Waiting on you", ["pending"], { hide_empty: true }),
    pending: posts("waiting"),
    scheduled: section("Scheduled", ["due"], { hide_empty: true }),
    due: posts("scheduled"),
    posted: section("Posted", ["out"]),
    out: posts("posted"),
  }),
};

const analytics = {
  slug: "analytics",
  title: "Analytics",
  spec: page(["numbers", "per"], {
    numbers: { type: "Grid", props: { columns: 3 }, children: ["views", "cadence", "spent"] },
    views: { type: "Metric", props: { label: "Views", value: { $source: "views_total", days: 7 }, delta: { $source: "views_change" } } },
    cadence: { type: "Progress", props: { label: "Posts this week", progress: { $source: "posts_this_week" } } },
    spent: { type: "Metric", props: { label: "Spent", value: { $source: "spend_total", days: 7 } } },
    per: section("Views per post", ["bars"], { hide_empty: true }),
    bars: { type: "BarList", props: { bars: { $source: "post_views", limit: 12 } } },
  }),
};

const media = {
  slug: "media",
  title: "Media",
  spec: page(["library"], { library: { type: "MediaLibrary", props: {} } }),
};

/** The channel's mini app: one, with three pages, in the order the segmented control draws them. The same for every template. */
export const MEDIA_MANAGER = { slug: "media-manager", name: "Media manager", icon: "play", pages: [queue, analytics, media] };
