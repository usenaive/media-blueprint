/**
 * The channel's one mini app, "Media manager", as data (the platform's mini apps, canonical-spec §50).
 * It stands where the old hosted dashboard stood. The platform owns every block, reads every number and
 * draws every mini app with one UI under Apps — the head carries the channel's networks and says when
 * one is not connected — so this file only says what sits on the app's one page, and in what order.
 * Words only: a digit in a title is refused, because the window a number covers is written by the
 * platform from its binding. One page, top to bottom (ADR-1023):
 *
 *   · the numbers, one height: views with their change, posts against the cadence, spend;
 *   · Waiting on you — only while something does: rows, each opening with its approval card;
 *   · Scheduled — only while something is: one sideways row of cards, each with its time;
 *   · Posted — a picture grid, newest first, each tile with its views; Results and Open ↗ on it.
 *
 * Every post opens in the platform's post drawer. The gallery of everything the crew made is the
 * chat panel's Media tab; the app no longer carries it (ADR-1022).
 *
 * What the old dashboard had and this leaves out, and why, is ADR-0993's table.
 */

import type { DefineInput } from "@usenaive-sdk/blueprints";

/** The engine's own mini-app shape: from 0.9.0 it types every block, so a wrong prop is a compile error. */
export type MiniApp = NonNullable<DefineInput["mini_apps"]>[number];
type Elements = MiniApp["pages"][number]["spec"]["elements"];
const page = (children: string[], elements: Elements): { root: string; elements: Elements } => ({ root: "page", elements: { page: { type: "Page", props: {}, children }, ...elements } });

const overview = {
  slug: "overview",
  title: "Overview",
  spec: page(["numbers", "waiting", "scheduled", "posted"], {
    numbers: { type: "Grid", props: { columns: 3 }, children: ["views", "cadence", "spent"] },
    views: { type: "Metric", props: { label: "Views", value: { $source: "views_total", days: 7 }, delta: { $source: "views_change" } } },
    cadence: { type: "Progress", props: { label: "Posts this week", progress: { $source: "posts_this_week" } } },
    spent: { type: "Metric", props: { label: "Spent", value: { $source: "spend_total", days: 7 } } },
    waiting: { type: "Section", props: { title: "Waiting on you", hide_empty: true }, children: ["asks"] },
    asks: { type: "Posts", props: { posts: { $source: "posts", status: "waiting", limit: 50 } } },
    scheduled: { type: "Section", props: { title: "Scheduled", hide_empty: true }, children: ["next"] },
    next: { type: "Posts", props: { layout: "row", posts: { $source: "posts", status: "scheduled", limit: 50 } } },
    posted: { type: "Section", props: { title: "Posted" }, children: ["out"] },
    out: { type: "Posts", props: { layout: "grid", posts: { $source: "posts", status: "posted", limit: 50 } } },
  }),
};

/** The channel's mini app: one page. The same for every template. */
export const MEDIA_MANAGER = { slug: "media-manager", name: "Media manager", icon: "play", pages: [overview] } satisfies MiniApp;
