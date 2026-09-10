/**
 * The post queue's types and the demo rows of each template — the single source shared by the
 * local demo store (`server/store.ts`, `pnpm serve`) and the server's routes. Plain data only;
 * nothing here touches the DOM or node.
 *
 * The demo rows live here rather than beside the rest of a template's data in `templates/`,
 * because the screens import a template and nothing in `src/**` may value-import this file
 * (`src/no-seed.test.ts`): the seeds reach a screen only over HTTP, from a local `pnpm serve`,
 * never compiled into the deployed bundle. A deployment starts empty either way
 * (`server/store.ts`), so these are a demo fixture and never anyone's work.
 */

/**
 * The lifecycle, as data: pending (an agent proposed it) → ready (the operator edited it) →
 * approved (cleared to publish) → posted / rejected. A literal and not just a type, because
 * `PATCH /api/posts/:id` has to refuse a status no screen would ever send — it accepted any
 * string, so one typo persisted a row in a state nothing lists and no tab shows.
 */
export const POST_STATUSES = ["pending", "ready", "approved", "posted", "rejected"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * The targets a post can name — deliberately exactly the set the platform's social API accepts for
 * a published post. Vertical-video-only networks are not in it: offering one would mean a "Post
 * now" that is refused upstream, so the dashboard never names a destination it cannot reach.
 * Kept as a literal, not imported: a blueprint is cloned standalone and depends on no workspace
 * package at runtime. When the platform's enum grows, this list is the one place to grow with it.
 */
export const POST_PLATFORMS = ["bluesky", "facebook", "linkedin", "mastodon", "threads", "x"] as const;
export type PostPlatform = (typeof POST_PLATFORMS)[number];

/**
 * Every kind of post any template of this blueprint files: `faceless` produces and files
 * `produced` / `multi`, `clipping` cuts and files `clip`. Which of them a channel actually uses is
 * the template's (`templates/`), so a row written by one template still reads under another.
 */
export const POST_KINDS = ["clip", "produced", "multi"] as const;
export type PostKind = (typeof POST_KINDS)[number];

/**
 * Where a piece in the making stands, as data the next seat can filter on: brief (a topic, no
 * script) → scripting → scripted (hook, script and caption written into the row) → rendering →
 * rendered (media attached). The two `-ing` stages are claims: a seat moves a row onto one with
 * `expected_stage` set to the stage before it, atomically under the store's row lock, so a handoff
 * session and the cron that overlaps it cannot both script or render the same row — one claim wins
 * and the other is refused before it spends anything. A row with no stage is a note — a plan, a
 * report, a style choice — and belongs to no pipeline. The seat that moves a row forward also names
 * it to the next seat (`trigger_agent`), so the stage is what the timers reconcile against, not
 * what the day depends on.
 */
export const POST_STAGES = ["brief", "scripting", "scripted", "rendering", "rendered"] as const;
export type PostStage = (typeof POST_STAGES)[number];

export interface Post {
  id: string;
  title: string;
  caption: string;
  /** Where the finished clip/video lives, when an agent filed one over MCP. Published with the post. */
  mediaUrl?: string;
  platform: PostPlatform;
  /**
   * The connected account this post is for, when one was named. Optional because an agent files
   * work before a destination is settled, and the row used to be written `"unassigned"` — a word
   * the screen printed as though it were a handle. Absent now means the screen says so.
   */
  account?: string;
  status: PostStatus;
  /** Which agent filed it. Absent when the caller did not say — never a stand-in name. */
  agent?: string;
  /** What it was made from: the brief, the source video, the style template. */
  source?: string;
  kind: PostKind;
  /** How far along a piece is; absent on a row that is not a piece. */
  stage?: PostStage;
  /** When `stage` last changed (ISO 8601), so a claim a dead session left behind can be aged out. */
  stageAt?: string;
  /** The finished piece's running time, when it is known. */
  duration?: string;
  scheduledFor?: string;
  postedAt?: string;
  rejectedReason?: string;
  views?: number;
  likes?: number;
}

/** The `faceless` demo queue: original video the producer made, in one niche. */
export const FACELESS_SEEDS: Post[] = [
  { id: "post_9f2a", title: "3 stoic rules nobody follows", caption: "Rule two will sting. #stoicism #discipline", platform: "x", account: "@dailystoic", status: "pending", agent: "producer", kind: "produced", duration: "0:41" },
  { id: "post_8e1b", title: "Marcus Aurelius on mornings", caption: "The 5am debate, settled 1,900 years ago.", platform: "threads", account: "@dailystoic", status: "pending", agent: "producer", kind: "produced", duration: "0:58" },
  { id: "post_7d3c", title: "Why comfort is a trap", caption: "Seneca said it better than any podcast.", platform: "bluesky", account: "@dailystoic.bsky.social", status: "ready", agent: "producer", kind: "produced", duration: "0:36" },
  { id: "post_6c4d", title: "Dichotomy of control, animated", caption: "Part 1 of 3 — the only flowchart you need.", platform: "x", account: "@dailystoic", status: "ready", agent: "producer", kind: "multi", duration: "0:52" },
  { id: "post_5b5e", title: "Epictetus was a slave first", caption: "The origin story they skip.", platform: "linkedin", account: "Stoic Daily", status: "approved", agent: "producer", kind: "produced", duration: "1:04", scheduledFor: "Tomorrow 09:00" },
  { id: "post_4a6f", title: "Amor fati in 40 seconds", caption: "Love what happens. All of it.", platform: "x", account: "@dailystoic", status: "approved", agent: "producer", kind: "produced", duration: "0:40", scheduledFor: "Fri 18:30" },
  { id: "post_3970", title: "The obstacle is the way", caption: "Ryan Holiday's favourite line, sourced.", platform: "x", account: "@dailystoic", status: "posted", agent: "producer", kind: "multi", duration: "0:44", postedAt: "2d ago", views: 48_211, likes: 5_804 },
  { id: "post_2881", title: "Memento mori, gently", caption: "A calmer take on the skull emoji.", platform: "threads", account: "@dailystoic", status: "posted", agent: "producer", kind: "produced", duration: "0:49", postedAt: "4d ago", views: 21_930, likes: 2_112 },
  { id: "post_1792", title: "Cold showers are not stoicism", caption: "Hot take, ancient sources.", platform: "bluesky", account: "@dailystoic.bsky.social", status: "rejected", agent: "producer", kind: "produced", duration: "0:38", rejectedReason: "Caption reads as engagement bait — soften the first line." },
];

/** The `clipping` demo queue: cuts the clipper took out of the channel's source videos. */
export const CLIPPING_SEEDS: Post[] = [
  { id: "post_c1a4", title: "The 90-second answer that ended the debate", caption: "He had one shot and took it. #podcast", platform: "x", account: "@longformcuts", status: "pending", agent: "clipper", kind: "clip", duration: "0:47" },
  { id: "post_c2b5", title: "\"Say that again, slowly\"", caption: "The pause is the whole clip.", platform: "threads", account: "@longformcuts", status: "pending", agent: "clipper", kind: "clip", duration: "0:33" },
  { id: "post_c3c6", title: "The question nobody asks a founder", caption: "Cut from episode 214.", platform: "bluesky", account: "@longformcuts.bsky.social", status: "ready", agent: "clipper", kind: "clip", duration: "0:52" },
  { id: "post_c4d7", title: "Two minutes that explain the whole book", caption: "Timestamps in the replies.", platform: "linkedin", account: "Longform Cuts", status: "approved", agent: "clipper", kind: "clip", duration: "1:12", scheduledFor: "Tomorrow 09:00" },
  { id: "post_c5e8", title: "He changed his mind live on air", caption: "Rare. Worth 40 seconds.", platform: "x", account: "@longformcuts", status: "posted", agent: "clipper", kind: "clip", duration: "0:40", postedAt: "2d ago", views: 31_402, likes: 3_118 },
  { id: "post_c6f9", title: "The cold open everyone quoted", caption: "First thing said, best thing said.", platform: "threads", account: "@longformcuts", status: "rejected", agent: "clipper", kind: "clip", duration: "0:29", rejectedReason: "We do not have clearance for this source yet." },
];
