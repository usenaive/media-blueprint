/**
 * The channel's one mini app, "Media manager", as data (the platform's mini apps, canonical-spec §50).
 * It stands where the old hosted dashboard stood. The platform owns every block, reads every number and
 * draws every mini app with one UI under Apps — the head carries the channel's networks and says when
 * one is not connected — so this file only says what sits on the app's one page, in what order, and
 * what its one panel holds. Words only: a digit in a title is refused, because the window a number
 * covers is written by the platform from its binding.
 *
 *   · The page — the numbers first: views with their change, posts against the cadence, spend. Then
 *     ONE list of posts: what waits on you (marked, each opening with its approval card), what goes
 *     out next, what went out with its views, newest first (ADR-1010, ADR-1012);
 *   · Media, a panel — every picture and clip the crew made: the platform's gallery, with its
 *     filters, sort and viewer, opened from the head beside the page (ADR-1011).
 *
 * What the old dashboard had and this leaves out, and why, is ADR-0993's table.
 */

type Elements = Record<string, { type: string; props: Record<string, unknown>; children?: string[] }>;
const page = (children: string[], elements: Elements): { root: string; elements: Elements } => ({ root: "page", elements: { page: { type: "Page", props: {}, children }, ...elements } });

const overview = {
  slug: "overview",
  title: "Overview",
  spec: page(["numbers", "posts"], {
    numbers: { type: "Grid", props: { columns: 3 }, children: ["views", "cadence", "spent"] },
    views: { type: "Metric", props: { label: "Views", value: { $source: "views_total", days: 7 }, delta: { $source: "views_change" } } },
    cadence: { type: "Progress", props: { label: "Posts this week", progress: { $source: "posts_this_week" } } },
    spent: { type: "Metric", props: { label: "Spent", value: { $source: "spend_total", days: 7 } } },
    posts: { type: "Section", props: { title: "Posts" }, children: ["queue"] },
    queue: { type: "Posts", props: { posts: { $source: "posts", status: ["waiting", "scheduled", "posted"], limit: 50 } } },
  }),
};

const media = {
  slug: "media",
  title: "Media",
  spec: page(["library"], { library: { type: "MediaLibrary", props: {} } }),
};

/** The channel's mini app: one page, and the gallery as a panel beside it. The same for every template. */
export const MEDIA_MANAGER = { slug: "media-manager", name: "Media manager", icon: "play", pages: [overview], panels: [media] };
