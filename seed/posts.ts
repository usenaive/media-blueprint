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
 * The targets a post can name, and the reason there are only three of them.
 *
 * Kept as a literal, not imported: a blueprint is cloned standalone and depends on no workspace
 * package at runtime. It is a SUBSET of what the platform's social API accepts, chosen for what
 * this blueprint actually makes.
 *
 * *** EVERY POST THIS CHANNEL FILES IS A VIDEO. *** The producer renders 1080x1920 and the clipper
 * cuts one; there is no other product, and there is no link, thread or article anywhere in this
 * repo. So the honest set is the networks that take a vertical video — which is exactly the
 * platform's own video-capable enum (`SOCIAL_MEDIA_PLATFORMS`, `packages/core/src/schema/social.ts`).
 *
 * The list this replaces was close to backwards: it admitted `bluesky`, `facebook`, `linkedin`,
 * `mastodon`, `threads` and `x` — six networks that accept the caption and drop the video, so a
 * "published" post shipped a line of text and left the render behind — and it excluded `youtube`
 * and `instagram`, two of the three that take the work. A customer connecting YouTube, which is
 * the first thing anyone installing a Shorts channel does, could not file a post for it, could not
 * default to it and could not retarget a row at it from anywhere in the dashboard.
 *
 * Narrowing is safe by construction: `postNow` already checks a row's platform against this list
 * and refuses with "retarget the post first", so a document written before the narrowing is
 * refused with a sentence and a remedy rather than a 400 from upstream. Widening it again — a
 * channel that one day posts something other than a video — is this one line.
 */
export const POST_PLATFORMS = ["instagram", "tiktok", "youtube"] as const;
export type PostPlatform = (typeof POST_PLATFORMS)[number];

/**
 * The targets that publish media and refuse text — which, now that the list above is the video
 * networks, is all of them. A brief is a row with no video yet, so an approved brief is a row the
 * platform would refuse: it is refused here instead, in a sentence naming what is missing, rather
 * than at the button. Kept as its own name because it answers a different question ("would this
 * publish without media?") and a future non-video target would make the two lists differ again.
 */
export const POST_MEDIA_PLATFORMS: readonly PostPlatform[] = POST_PLATFORMS;

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
 * and the other is refused before it spends anything. A row carrying neither a stage nor a finished
 * video is a note — a plan, a report, a style choice — and belongs to no pipeline; one carrying the
 * video but no stage was filed before this field existed and reads at `rendered` (`postStage`,
 * below, which is how every stage is read). The seat that moves a row forward also names
 * it to the next seat (`send_to_agent`, `wait: false`), so the stage is what the timers reconcile against, not
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

/**
 * THE STAGE A ROW READS AT, WHICH IS NOT ALWAYS THE STAGE IT WAS WRITTEN WITH.
 *
 * `stage` arrives with the handoff chain, so every row filed before it — the demo queue below, and
 * on a live channel everything already in the queue the morning this ships — carries none. Both
 * fallback crons now find their work by stage and every claim compares against one, so a stageless
 * row matched no filter and no `expected_stage`: it was not "at no stage", it was invisible, and
 * nothing in the pipeline would ever have picked it up again.
 *
 * So a row with no stage of its own is read from what it carries. The finished video is the
 * evidence, and it reaches a row two ways: `mediaUrl`, which is what the producer attaches when it
 * moves a piece to `rendered`, and `duration` — a running time only a piece that exists can have —
 * which is what the demo rows carry instead, having been written before either field did. Either
 * one reads as `rendered`.
 *
 * NOTHING DERIVES `brief`, `scripting` OR `scripted`, and that is the deliberate half. No field on
 * a `Post` records a script: `caption` holds the brief's topic before the scriptwriter and the
 * publishable caption after it, and from here the two are the same string. Reading a stageless row
 * as `scripted` would hand the producer's next fire every note the crew has ever filed — a plan, a
 * report, a style choice, all of them a caption and no media — and the render is the paid step
 * (~$3.32, `ONE_RENDER_MICRO_USD`). A row with nothing attached therefore stays exactly what it has
 * always been: a note, at no stage, in no pipeline.
 *
 * Read a stage through this and never off the field, so that what `list_posts` shows a seat and
 * what `expected_stage` lets it claim can never be two different answers about the same row.
 */
export const postStage = (post: Pick<Post, "stage" | "mediaUrl" | "duration">): PostStage | undefined =>
  post.stage ?? (post.mediaUrl === undefined && post.duration === undefined ? undefined : "rendered");

/** The `faceless` demo queue: original video the producer made, in one niche. */
export const FACELESS_SEEDS: Post[] = [
  { id: "post_9f2a", title: "3 stoic rules nobody follows", caption: "Rule two will sting. #stoicism #discipline", platform: "youtube", account: "@dailystoic", status: "pending", agent: "producer", kind: "produced", duration: "0:41" },
  { id: "post_8e1b", title: "Marcus Aurelius on mornings", caption: "The 5am debate, settled 1,900 years ago.", platform: "instagram", account: "@dailystoic", status: "pending", agent: "producer", kind: "produced", duration: "0:58" },
  { id: "post_7d3c", title: "Why comfort is a trap", caption: "Seneca said it better than any podcast.", platform: "tiktok", account: "@dailystoic", status: "ready", agent: "producer", kind: "produced", duration: "0:36" },
  { id: "post_6c4d", title: "Dichotomy of control, animated", caption: "Part 1 of 3 — the only flowchart you need.", platform: "youtube", account: "@dailystoic", status: "ready", agent: "producer", kind: "multi", duration: "0:52" },
  { id: "post_5b5e", title: "Epictetus was a slave first", caption: "The origin story they skip.", platform: "youtube", account: "@dailystoic", status: "approved", agent: "producer", kind: "produced", duration: "1:04", scheduledFor: "Tomorrow 09:00" },
  { id: "post_4a6f", title: "Amor fati in 40 seconds", caption: "Love what happens. All of it.", platform: "youtube", account: "@dailystoic", status: "approved", agent: "producer", kind: "produced", duration: "0:40", scheduledFor: "Fri 18:30" },
  { id: "post_3970", title: "The obstacle is the way", caption: "Ryan Holiday's favourite line, sourced.", platform: "youtube", account: "@dailystoic", status: "posted", agent: "producer", kind: "multi", duration: "0:44", postedAt: "2d ago", views: 48_211, likes: 5_804 },
  { id: "post_2881", title: "Memento mori, gently", caption: "A calmer take on the skull emoji.", platform: "instagram", account: "@dailystoic", status: "posted", agent: "producer", kind: "produced", duration: "0:49", postedAt: "4d ago", views: 21_930, likes: 2_112 },
  { id: "post_1792", title: "Cold showers are not stoicism", caption: "Hot take, ancient sources.", platform: "tiktok", account: "@dailystoic", status: "rejected", agent: "producer", kind: "produced", duration: "0:38", rejectedReason: "Caption reads as engagement bait — soften the first line." },
];

/** The `clipping` demo queue: cuts the clipper took out of the channel's source videos. */
export const CLIPPING_SEEDS: Post[] = [
  { id: "post_c1a4", title: "The 90-second answer that ended the debate", caption: "He had one shot and took it. #podcast", platform: "youtube", account: "@longformcuts", status: "pending", agent: "clipper", kind: "clip", duration: "0:47" },
  { id: "post_c2b5", title: "\"Say that again, slowly\"", caption: "The pause is the whole clip.", platform: "instagram", account: "@longformcuts", status: "pending", agent: "clipper", kind: "clip", duration: "0:33" },
  { id: "post_c3c6", title: "The question nobody asks a founder", caption: "Cut from episode 214.", platform: "tiktok", account: "@longformcuts", status: "ready", agent: "clipper", kind: "clip", duration: "0:52" },
  { id: "post_c4d7", title: "Two minutes that explain the whole book", caption: "Timestamps in the replies.", platform: "youtube", account: "@longformcuts", status: "approved", agent: "clipper", kind: "clip", duration: "1:12", scheduledFor: "Tomorrow 09:00" },
  { id: "post_c5e8", title: "He changed his mind live on air", caption: "Rare. Worth 40 seconds.", platform: "youtube", account: "@longformcuts", status: "posted", agent: "clipper", kind: "clip", duration: "0:40", postedAt: "2d ago", views: 31_402, likes: 3_118 },
  { id: "post_c6f9", title: "The cold open everyone quoted", caption: "First thing said, best thing said.", platform: "instagram", account: "@longformcuts", status: "rejected", agent: "clipper", kind: "clip", duration: "0:29", rejectedReason: "We do not have clearance for this source yet." },
];
