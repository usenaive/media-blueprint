/**
 * The video project: the plan a video is made from, as its own row beside the post it becomes.
 *
 * A post is the finished piece — a caption and a video, waiting for the operator. A project is
 * everything decided BEFORE the paid step: for a generated piece the scenes, the prompts, the
 * model and the look; for a cut piece the source videos, the moments in them and why each one.
 * The planning seat writes the project; a different seat renders or cuts it; the render lands
 * on a post. Splitting the two is what lets the operator read the plan before ~$3.32 is spent on
 * it, and what lets a render be redone from the same plan rather than from a caption.
 *
 * Same rules as `seed/posts.ts`: plain data, shared by the store and the routes, demo rows for
 * `pnpm serve` only (`src/no-seed.test.ts` keeps them out of the bundle).
 */
import type { PostPlatform } from "./posts.ts";

/** `generation` renders from a scene plan (`generate_video`); `clipping` cuts from a source (`clip_video`). */
export const PROJECT_KINDS = ["generation", "clipping"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/**
 * planned (the plan is written, nobody has spent on it) → rendering (one session has claimed it,
 * with `expected_status` planned, atomically under the store's lock) → rendered (the video is on a
 * post). `dropped` is the operator's or the manager's: a plan that will not be made. `rendering`
 * is a claim the same way a post's `-ing` stages are, so a handoff and the cron that overlaps it
 * cannot both render one plan; `rendered` is final, because the render it records was paid for.
 */
export const PROJECT_STATUSES = ["planned", "rendering", "rendered", "dropped"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** One shot of a generated piece, in order. */
export interface Scene {
  /** What the frame shows — the prompt handed to `generate_video`, written inside the style template's look. */
  prompt: string;
  /** Running time of the shot, in seconds. */
  seconds: number;
  /** The narration said over it. Text only: no narrator voices exist yet, so this is what a voice will read. */
  voiceover?: string;
  /** Text on the frame — the hook, on the first scene. */
  text?: string;
  /** A video model for this shot when it differs from the project's own. */
  model?: string;
}

/** One source video a cut piece is taken from, and the moment in it. */
export interface ClipSource {
  /** The source video, by URL — a YouTube URL from one of the reference channels the context names. */
  url: string;
  /** Where the moment starts and ends in the source, `mm:ss` or `h:mm:ss`. */
  from?: string;
  to?: string;
  /** Why this one: the one idea in it and why it lands for this audience. */
  reason: string;
}

export interface VideoProject {
  id: string;
  kind: ProjectKind;
  status: ProjectStatus;
  /** When `status` last changed (ISO 8601), so a claim a dead session left behind can be aged out. */
  statusAt: string;
  createdAt: string;
  title: string;
  /** The plan's reasoning: the idea, why now, the hook direction — what the render is for. */
  brief: string;
  platform: PostPlatform;
  /** The connected account the piece is for, when one was named. */
  account?: string;
  /** Which agent planned it. */
  agent?: string;
  /** The queue row this plan belongs to: the brief it was written from, and the row the render lands on. */
  postId?: string;
  /** Generation: the style template by name (`list_style_templates`) and the video model the scenes render in. */
  styleTemplate?: string;
  model?: string;
  scenes?: Scene[];
  /** Clipping: the source videos and the moments to cut. */
  sources?: ClipSource[];
  /** The publishable caption the planner drafted; it goes on the post when the render lands. */
  caption?: string;
}

const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

/** The `faceless` demo plans: what the scriptwriter wrote for the producer. */
export const FACELESS_PROJECT_SEEDS: VideoProject[] = [
  {
    id: "proj_a1f0", kind: "generation", status: "planned", statusAt: daysAgo(0), createdAt: daysAgo(0),
    title: "Seneca on the fear of losing everything", agent: "scriptwriter", platform: "youtube", account: "@dailystoic",
    brief: "Letter 18 — practise poverty on purpose. Money anxiety is the niche's top question this week; the hook flips it: rehearse the loss so it stops owning you.",
    styleTemplate: "Marble & ink", model: "alibaba/wan-3.0",
    scenes: [
      { prompt: "Slow push-in on a marble bust of Seneca, ink washes bleeding across the frame, candlelight", seconds: 4, text: "Rehearse losing it all.", voiceover: "Seneca told a rich friend to live like a poor man a few days a month." },
      { prompt: "A bare table, one bowl, one cup, ink lines drawing themselves across a stone wall", seconds: 5, voiceover: "Not to suffer. To find out the fear was bigger than the thing." },
      { prompt: "The bust again, wider, the ink settling into calm still water", seconds: 4, voiceover: "Is this what I was afraid of? Letter eighteen. Read it." },
    ],
    caption: "Rehearse losing it all — Seneca's cheapest cure for money fear. #stoicism #seneca #discipline",
  },
  {
    id: "proj_b2e1", kind: "generation", status: "rendering", statusAt: daysAgo(0), createdAt: daysAgo(1),
    title: "Marcus Aurelius and the morning argument", agent: "scriptwriter", platform: "instagram", account: "@dailystoic",
    brief: "Meditations 5.1 — the emperor arguing with himself about getting out of bed. The 5am-club debate is trending; the ancient version is funnier and lands harder.",
    styleTemplate: "Ghibli dusk", model: "alibaba/wan-3.0",
    scenes: [
      { prompt: "A soft dawn bedroom in a painted anime style, a figure under blankets, light creeping across the floor", seconds: 5, text: "He didn't want to get up either.", voiceover: "The most powerful man alive wrote down his own excuses." },
      { prompt: "The same figure standing at a window, the city waking below, warm dusk-coloured light", seconds: 5, voiceover: "Then answered them: you were made for this. Get up." },
    ],
    caption: "The 5am debate, settled 1,900 years ago. #stoicism #marcusaurelius",
  },
  {
    id: "proj_e5b2", kind: "generation", status: "rendered", statusAt: daysAgo(1), createdAt: daysAgo(2),
    title: "3 stoic rules nobody follows", agent: "scriptwriter", platform: "youtube", account: "@dailystoic", postId: "post_9f2a",
    brief: "Three rules from the Enchiridion the niche quotes and does not keep. Rule two is the one that stings, so it goes in the middle.",
    styleTemplate: "Marble & ink", model: "alibaba/wan-3.0",
    scenes: [
      { prompt: "Three marble tablets in a row, ink numerals drawing themselves on each, hard side light", seconds: 4, text: "Three rules. You keep none.", voiceover: "Epictetus left three rules. Almost nobody keeps them." },
      { prompt: "The middle tablet cracking, ink pouring from the crack across the frame", seconds: 5, voiceover: "Rule two: some things are not up to you. Stop acting like they are." },
      { prompt: "The tablets whole again, ink settling, candle guttering out", seconds: 4, voiceover: "The first and third are in the caption. Start with two." },
    ],
    caption: "Rule two will sting. #stoicism #discipline",
  },
];

/** The `clipping` demo plans: the moments the scout picked for the clipper, with the reasoning. */
export const CLIPPING_PROJECT_SEEDS: VideoProject[] = [
  {
    id: "proj_c3d2", kind: "clipping", status: "planned", statusAt: daysAgo(0), createdAt: daysAgo(0),
    title: "The founder answer that ended the debate", agent: "scout", platform: "youtube", account: "@longformcuts",
    brief: "Episode 216, the hiring segment. One uninterrupted ninety-second answer with a clean hook in the first sentence and a hard stop — it stands alone without context.",
    sources: [
      { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", from: "41:12", to: "42:44", reason: "The whole answer is one take; the first line is the hook and the room goes quiet at the end." },
    ],
  },
  {
    id: "proj_d4c3", kind: "clipping", status: "dropped", statusAt: daysAgo(1), createdAt: daysAgo(2),
    title: "The cold open everyone quoted", agent: "scout", platform: "instagram", account: "@longformcuts",
    brief: "Episode 214's opening line. Quoted across the niche this week, so it travels — but the source is not one of our cleared reference channels yet.",
    sources: [
      { url: "https://www.youtube.com/watch?v=oHg5SJYRHA0", from: "0:00", to: "0:29", reason: "Already quoted everywhere; a cut would ride the moment." },
    ],
  },
];
