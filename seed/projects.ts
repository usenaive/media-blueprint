/**
 * The video project: the plan a video is made from, as its own row beside the post it becomes.
 *
 * A post is the finished piece — a caption and a video, waiting for the operator. A project is
 * everything decided BEFORE the paid step: for a generated piece the scenes, the prompts, the
 * model and the look; for a cut piece the source videos, the moments in them and why each one.
 * The planning seat writes the project; a different seat renders or cuts it; the render lands
 * on a post. Splitting the two is what lets the operator read the plan before ~$9.00 is spent on
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

/**
 * The five beats of a short, in the order they run (`naive/short-video-hooks`). A scene carries the
 * beat it is doing, so a plan can be READ as a story rather than counted as shots: a piece with no
 * `turn` and three `setup` scenes is three ways of saying the same thing, and that is visible here
 * without watching anything. Two beats may share a scene; one beat never spans two.
 */
export const SCENE_BEATS = ["hook", "setup", "turn", "payoff", "cta"] as const;
export type SceneBeat = (typeof SCENE_BEATS)[number];

/**
 * One shot of a generated piece, in order — and a shot is what it is, because nothing here joins
 * video. The scenes of a plan are compiled into ONE `generate_video` call whose prompt is the shots
 * in order (`server/mcp.ts` `scenesPrompt`), so `seconds` is a budget the model is asked to honour
 * rather than a cut the machine makes.
 */
export interface Scene {
  /** What the frame shows — the prompt handed to `generate_video`, written inside the style template's look. */
  prompt: string;
  /** Running time of the shot, in seconds. */
  seconds: number;
  /** Which beat of the script this shot is doing. */
  beat?: SceneBeat;
  /** The narration said over it. Text only: no narrator voices exist yet, so this is what a voice will read. */
  voiceover?: string;
  /** Text on the frame — the hook, on the first scene. */
  text?: string;
  /** A video model for this shot when it differs from the project's own. */
  model?: string;
}

/**
 * One checkable claim the script rests on, and where it came from.
 *
 * The planning seat holds `web_search` and `web_fetch` and was never told to use them, so a plan for
 * a history or space piece was written out of the model's memory and the operator had no way to
 * check it before paying for the render. A fact with no source is not a fact here: `source` is a URL
 * or the named work, and a claim the seat could not source belongs out of the script rather than in
 * it with a shrug.
 */
export interface Fact {
  claim: string;
  source: string;
}

/**
 * How the piece sounds. `generate_speech` is a built-in this crew has never held, so `voice` is a
 * direction for whoever or whatever reads the voiceover rather than a model setting — but writing it
 * down is what stops every piece on a channel sounding like a different narrator.
 */
export interface Sound {
  /** The music bed: genre, tempo, where it drops. */
  music?: string;
  /** Who the narration sounds like: person, pace, register. */
  voice?: string;
  /** Sound design moments worth naming, in scene order. */
  sfx?: string[];
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

/**
 * One session that worked on the plan, and what it did: `planned` wrote it (`create_project`),
 * `rendered` claimed or finished a render, `revised` was opened by the operator's revision. The
 * Studio talks to the latest of these — the session that made the video, not a fresh stranger.
 */
export interface ProjectSession {
  id: string;
  role: "planned" | "rendered" | "revised";
  at: string;
}

/** A render a revision replaced: the file, when it landed (the plan's `statusAt` while it was current), and the session that made it. */
export interface Render {
  mediaUrl: string;
  at: string;
  sessionId?: string;
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

  /*
   * WHAT A PLAN IS, BEYOND ITS SHOTS — every field below is additive and optional, so a plan
   * written before them still reads and still renders.
   *
   * Up to here a generation plan was a title, a paragraph of reasoning, a look, a model and a list
   * of shots. That is a shot list, and a shot list is what the crew filed: there was nowhere to put
   * a hook, a structure, a reason to keep watching, a checkable fact or a sound, so the planning
   * seat could not have filed them if it had wanted to. These are those places. The prompts that
   * fill them are in `templates/faceless.ts`; the tool that accepts them is `server/mcp.ts`.
   */

  /**
   * The first line of the piece, verbatim — what is said and what is on the frame at 0:00.
   *
   * It is its own field rather than a sentence inside `brief` because it is the one line that
   * decides whether the rest is watched, and because an operator reading the queue should be able
   * to judge a piece by it without opening the plan. It is also what the first scene's `text` says.
   */
  hook?: string;
  /** The hooks written and NOT kept, and why the kept one beat them — the seat's own working shown. */
  rejectedHooks?: string[];
  /** What holds the viewer past 0:03, and past 0:07. A piece with no answer here ends at 0:03. */
  retention?: string;
  /** The one action the close asks for. One, not three. */
  cta?: string;
  /** The claims the script rests on, each with where it came from. */
  facts?: Fact[];
  /** Music, voice and sound design. */
  sound?: Sound;
  /**
   * Which pattern of the channel's reference teardown this piece is an instance of — the sentence
   * that makes the customer's reference answer (`REFERENCE_QUESTION`) reach an individual render.
   * Absent on a channel whose operator named no reference, which is most of the point of asking it
   * optionally.
   */
  referencePattern?: string;
  /**
   * The stills this piece is rendered AGAINST — the PUBLIC image URLs the channel's reference
   * teardown named, in the operator's own words.
   *
   * Describing a reference in words and hoping the model reconstructs it is the lossy path; the
   * provider takes a reference image directly. This field is what lets a plan say "make it look
   * like THIS" rather than only "make it look cinematic and photoreal". Absent on a channel whose
   * operator gave a link and no stills, which is the common case.
   *
   * *** WHAT THE PLATFORM ACTUALLY CONSUMES TODAY, WHICH IS LESS THAN THIS FIELD SUGGESTS. ***
   * `generate_video` takes `image_urls`, and the adapter uses exactly `imageUrls[0]`, mapped to
   * `frame_images[{ frame_type: "first_frame" }]`. So of a list, ONE is used, and it conditions the
   * opening FRAME rather than the style across the piece — the model this channel renders with
   * publishes a reference-to-video endpoint taking up to 50 images, but nothing here reaches it.
   * The field stays plural because the plan is the durable record and a later render will take
   * more; the producer is told which one is load-bearing.
   *
   * They must be PUBLIC http(s) URLs. A `fil_` id is refused by `generate_video`, whose argument is
   * `z.string().url()` — the API can mint a signed link for a file, but no tool in this crew's
   * grant does. A `fil_` id is for LOOKING at with `view_image`; a URL is for rendering from. Two
   * different jobs, and conflating them is a render that fails validation after the plan is filed.
   */
  referenceFrames?: string[];
  /** The sessions bound to this plan, oldest first (`server/store.ts` `recordSession`). */
  sessions: ProjectSession[];
  /** Earlier renders, superseded by a revision; the current one is the post's `mediaUrl`. */
  renders?: Render[];
  /** Stamped when a scan of the renderer's sessions found none for this plan, so a plan from before plans remembered is scanned once. */
  backfilledAt?: string;
  /**
   * The operator's open revision: the one way a rendered plan renders again. Set by
   * `POST /api/studio/:id/revise`, cleared by the `rendered` write that lands the new video.
   * `sessionId` is the session that hears the note — null until the fresh session opened for it
   * is recorded. `replaces` is the render it supersedes, taken as the revision opens and pushed
   * onto `renders[]` when the new one lands.
   */
  revision?: { openedAt: string; sessionId: string | null; note: string; replaces?: Render };
}

const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

/** The `faceless` demo plans: what the scriptwriter wrote for the producer. */
export const FACELESS_PROJECT_SEEDS: VideoProject[] = [
  {
    id: "proj_a1f0", kind: "generation", status: "planned", statusAt: daysAgo(0), createdAt: daysAgo(0), sessions: [],
    title: "Seneca on the fear of losing everything", agent: "scriptwriter", platform: "youtube", account: "@dailystoic",
    brief: "Letter 18 — practise poverty on purpose. Money anxiety is the niche's top question this week; the hook flips it: rehearse the loss so it stops owning you.",
    styleTemplate: "Marble & ink", model: "bytedance/seedance-2.5",
    hook: "Rehearse losing it all.",
    rejectedHooks: ["The richest man in Rome slept on a straw mattress — too slow, the payoff is in the second clause."],
    retention: "The bare table at 0:05 asks a question the voiceover has not answered yet; the answer lands at 0:17.",
    cta: "Read Letter 18.",
    facts: [
      { claim: "Seneca advised Lucilius to spend a few days a month living as if poor", source: "Letters to Lucilius, 18" },
    ],
    sound: { music: "Low sustained drone, no drop", voice: "Unhurried, close-mic, no rise at the ends", sfx: ["Bowl set down on stone at 0:07"] },
    referencePattern: "cold open on the object, question held to the last line",
    scenes: [
      { prompt: "Slow push-in on a marble bust of Seneca, ink washes bleeding across the frame, candlelight", seconds: 5, beat: "hook", text: "Rehearse losing it all.", voiceover: "Seneca told a rich friend to live like a poor man a few days a month." },
      { prompt: "A bare table, one bowl, one cup, ink lines drawing themselves across a stone wall", seconds: 6, beat: "setup", voiceover: "Not to suffer. To find out the fear was bigger than the thing." },
      { prompt: "The bowl and cup in hard side light, the ink pulling back to leave clean stone", seconds: 6, beat: "turn", voiceover: "A few days of it, and the worst case stops being a place you have never been." },
      { prompt: "The bust again, wider, the ink settling into calm still water", seconds: 4, beat: "payoff", voiceover: "Is this what I was afraid of?" },
    ],
    caption: "Rehearse losing it all — Seneca's cheapest cure for money fear. #stoicism #seneca #discipline",
  },
  {
    id: "proj_b2e1", kind: "generation", status: "rendering", statusAt: daysAgo(0), createdAt: daysAgo(1), sessions: [],
    title: "Marcus Aurelius and the morning argument", agent: "scriptwriter", platform: "instagram", account: "@dailystoic",
    brief: "Meditations 5.1 — the emperor arguing with himself about getting out of bed. The 5am-club debate is trending; the ancient version is funnier and lands harder.",
    styleTemplate: "Ghibli dusk", model: "bytedance/seedance-2.5",
    hook: "He didn't want to get up either.",
    retention: "The excuse at 0:04 is the viewer's own; the answer is withheld until 0:12.",
    cta: "Meditations, book five, line one.",
    facts: [{ claim: "Meditations opens book five arguing with himself about leaving bed", source: "Meditations 5.1" }],
    sound: { music: "Warm piano, single figure", voice: "Conversational, a half-smile in it" },
    referencePattern: "cold open on the object, question held to the last line",
    scenes: [
      { prompt: "A soft dawn bedroom in a painted anime style, a figure under blankets, light creeping across the floor", seconds: 5, beat: "hook", text: "He didn't want to get up either.", voiceover: "The most powerful man alive wrote down his own excuses." },
      { prompt: "Close on a hand pulling the blanket back over a shoulder, dust in the light", seconds: 6, beat: "setup", voiceover: "It is warm. It is early. The work will still be there." },
      { prompt: "The same figure standing at a window, the city waking below, warm dusk-coloured light", seconds: 5, beat: "payoff", voiceover: "Then he answered them: you were made for this. Get up." },
    ],
    caption: "The 5am debate, settled 1,900 years ago. #stoicism #marcusaurelius",
  },
  {
    id: "proj_9f2a", kind: "generation", status: "rendered", statusAt: daysAgo(1), createdAt: daysAgo(2), sessions: [],
    renders: [{ mediaUrl: "fil_9f2a_v1", at: daysAgo(1.5) }],
    title: "3 stoic rules nobody follows", agent: "scriptwriter", platform: "youtube", account: "@dailystoic", postId: "post_9f2a",
    brief: "Three rules from the Enchiridion the niche quotes and does not keep. Rule two is the one that stings, so it goes in the middle.",
    styleTemplate: "Marble & ink", model: "bytedance/seedance-2.5",
    hook: "Three rules. You keep none.",
    retention: "Naming rule two and not the others at 0:05 is the open loop; the caption closes it.",
    cta: "Start with rule two.",
    facts: [{ claim: "The Enchiridion opens on what is and is not within our power", source: "Enchiridion, 1" }],
    sound: { music: "Single struck note per tablet", voice: "Flat, unimpressed" },
    referencePattern: "count-down list, one item withheld",
    scenes: [
      { prompt: "Three marble tablets in a row, ink numerals drawing themselves on each, hard side light", seconds: 5, beat: "hook", text: "Three rules. You keep none.", voiceover: "Epictetus left three rules. Almost nobody keeps them." },
      { prompt: "The middle tablet cracking, ink pouring from the crack across the frame", seconds: 6, beat: "turn", voiceover: "Rule two: some things are not up to you. Stop acting like they are." },
      { prompt: "Ink running off the frame, leaving one clean tablet standing", seconds: 3, beat: "payoff", voiceover: "Everything you are angry about this week is on the wrong side of it." },
      { prompt: "The tablets whole again, ink settling, candle guttering out", seconds: 4, beat: "cta", voiceover: "The first and third are in the caption. Start with two." },
    ],
    caption: "Rule two will sting. #stoicism #discipline",
  },
];

/** The `clipping` demo plans: the moments the scout picked for the clipper, with the reasoning. */
export const CLIPPING_PROJECT_SEEDS: VideoProject[] = [
  {
    id: "proj_c3d2", kind: "clipping", status: "planned", statusAt: daysAgo(0), createdAt: daysAgo(0), sessions: [],
    title: "The founder answer that ended the debate", agent: "scout", platform: "youtube", account: "@longformcuts",
    brief: "Episode 216, the hiring segment. One uninterrupted ninety-second answer with a clean hook in the first sentence and a hard stop — it stands alone without context.",
    sources: [
      { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", from: "41:12", to: "42:44", reason: "The whole answer is one take; the first line is the hook and the room goes quiet at the end." },
    ],
  },
  {
    id: "proj_d4c3", kind: "clipping", status: "dropped", statusAt: daysAgo(1), createdAt: daysAgo(2), sessions: [],
    title: "The cold open everyone quoted", agent: "scout", platform: "instagram", account: "@longformcuts",
    brief: "Episode 214's opening line. Quoted across the niche this week, so it travels — but the source is not one of our cleared reference channels yet.",
    sources: [
      { url: "https://www.youtube.com/watch?v=oHg5SJYRHA0", from: "0:00", to: "0:29", reason: "Already quoted everywhere; a cut would ride the moment." },
    ],
  },
];

/**
 * The `longform` demo plans: what the writer filed for the producer, and the one thing about them
 * that is not decoration.
 *
 * *** READ THE RUNNING SECONDS, NOT THE SHOT COUNT. *** A piece here is rendered as
 * `ceil(seconds / 60)` separate `generate_video` calls and joined with ffmpeg, because the tool
 * bounds `seconds` at 60 on the wire. Two segments are generated independently and never match
 * mid-shot, so a segment boundary that falls inside a continuous shot is a visible cut in the
 * finished file — which is why every plan below has a shot ENDING exactly on each 60-second mark,
 * and why the seams are called out in a comment beside the scenes rather than left to be counted.
 * A demo row that got this wrong would be a worked example of the one mistake this template's
 * whole writer brief exists to prevent.
 *
 * Same rules as the seeds above: plain data, `pnpm serve` only, never anyone's work. They carry no
 * `postId` because the queue rows this template shows are still Short Form's (`server/store.ts`),
 * and a plan pointing at a row that points back at a different plan is worse than one pointing at
 * nothing.
 */
export const LONGFORM_PROJECT_SEEDS: VideoProject[] = [
  {
    id: "proj_lf01", kind: "generation", status: "planned", statusAt: daysAgo(0), createdAt: daysAgo(0), sessions: [],
    title: "Seneca's last morning, minute by minute", agent: "writer", platform: "youtube", account: "@dailystoic",
    brief:
      "Tacitus reports the death of Seneca as a scene rather than a summary, and it runs long enough to hold two minutes. Shape taken from the exemplars in the brief: the cold open and the held question from exemplar A (youtu.be/EX-A), the midpoint restatement from exemplar B (youtu.be/EX-B). Shots 1-3 open it on A's grammar; shots 4-5 are A's turn; shots 6-9 take B's slower midpoint and its close.",
    styleTemplate: "Marble & ink", model: "bytedance/seedance-2.5",
    hook: "He had two hours' notice.",
    rejectedHooks: [
      "The most famous death in Roman literature — too general, names nothing and promises nothing.",
      "Nero sent a soldier at dawn — good, but it spends the turn in the first line and leaves the second minute with nothing to pay off.",
    ],
    retention:
      "The two hours are named at 0:08 and not accounted for until 1:04, so the clock itself is the open loop; at the halfway seam the question changes from what he did to whether it worked, which is the only reason a viewer is still here at 1:00.",
    cta: "Tacitus, Annals, book fifteen.",
    facts: [
      { claim: "Tacitus records that Seneca was ordered to take his own life after the Pisonian conspiracy", source: "Tacitus, Annals 15.60-64" },
      { claim: "Seneca's own letters describe rehearsing death as a daily practice", source: "Letters to Lucilius, 26" },
      { claim: "His wife Paulina attempted to die with him and was stopped on Nero's order", source: "Tacitus, Annals 15.63" },
    ],
    sound: { music: "Single sustained cello, no percussion, no drop", voice: "Unhurried, close-mic, no rise at the ends", sfx: ["Water moving at 0:52", "Door closing on the cut at 1:00"] },
    referencePattern: "cold open on the object, question held past the midpoint",
    // Segment 1 ends on shot 5 at exactly 60s; segment 2 runs shots 6-9 to 120s. Both seams are
    // shot changes, which is the rule the writer's brief states twice.
    scenes: [
      { prompt: "A marble bust in near darkness, one hard side light, ink bleeding down the frame", seconds: 8, beat: "hook", text: "He had two hours' notice.", voiceover: "A soldier arrived at dawn with an order and a deadline." },
      { prompt: "A wax tablet on a stone table, stylus set down, candle guttering", seconds: 14, beat: "setup", voiceover: "Seneca asked for time to write his will. The soldier refused him even that." },
      { prompt: "Ink washing across a wall of carved Latin, letters surfacing and drowning", seconds: 12, beat: "setup", voiceover: "So he turned to the people in the room and said the only thing he had left to leave them was the pattern of his own life." },
      { prompt: "Wide shot of a shuttered room, figures at the edges of the light, dust suspended", seconds: 12, beat: "setup", voiceover: "He had written about this exact morning for twenty years." },
      { prompt: "Close on a hand, steady, resting flat on stone, the ink pulling back off the frame", seconds: 14, beat: "turn", voiceover: "The question was never whether he could describe it. It was whether the description had done him any good." },
      { prompt: "A shallow bath of water in low light, steam rising, marble beyond it", seconds: 16, beat: "turn", voiceover: "It took most of the morning. His body was old and slow to let go, and the account of it is not dignified." },
      { prompt: "The bath still, the surface settling, light moving across it", seconds: 16, beat: "payoff", voiceover: "Tacitus records every unflattering minute — and records that Seneca kept dictating through all of them." },
      { prompt: "The wax tablet again, covered now, the stylus gone", seconds: 14, beat: "payoff", voiceover: "The rehearsal did not make it quick. It made it something he could still speak during." },
      { prompt: "The bust once more, wider, the ink settled into flat calm water", seconds: 14, beat: "cta", voiceover: "The whole scene is in Annals fifteen. Read it once and the Letters stop sounding like advice." },
    ],
    caption: "He had written about this exact morning for twenty years. Tacitus, Annals 15. #stoicism #seneca #history",
  },
  {
    id: "proj_lf02", kind: "generation", status: "rendered", statusAt: daysAgo(1), createdAt: daysAgo(3), sessions: [],
    renders: [{ mediaUrl: "fil_lf02_joined", at: daysAgo(1) }],
    title: "What Marcus Aurelius actually did all day", agent: "writer", platform: "youtube", account: "@dailystoic",
    brief:
      "The Meditations read as aphorisms because the days they came out of were never described. Three minutes is exactly enough to put the book back into the schedule that produced it. Grammar from exemplar C (youtu.be/EX-C): shots 1-4 are its cold open and slow build, shots 5-7 its midpoint gear change, shots 8-10 its close on the object it started with.",
    styleTemplate: "Paper cutout", model: "bytedance/seedance-2.5",
    hook: "Nobody writes that at their desk.",
    rejectedHooks: ["A day in the life of a Roman emperor — a format, not a hook; it promises a list and this is not one."],
    retention:
      "The first line claims the book was not written at a desk and refuses to say where until 1:40; the twenty-second mark lands on the war tent rather than another maxim, and the midpoint seam turns from what he did to what the doing cost.",
    cta: "Book two was written on campaign. Start there.",
    facts: [
      { claim: "Book two of the Meditations is headed as written among the Quadi on the river Gran", source: "Meditations 2, closing note" },
      { claim: "Marcus spent most of the last decade of his reign on the Danube frontier", source: "Cassius Dio, Roman History 72" },
      { claim: "The Meditations were private notes and carry no title given by their author", source: "Hadot, The Inner Citadel, ch. 1" },
    ],
    sound: { music: "Low strings under a single repeated woodwind figure", voice: "Plain, unhurried, no performance", sfx: ["Wind and canvas at 0:40", "Paper under a hand at 2:20"] },
    referencePattern: "cold open on the object, midpoint gear change, close on the opening image",
    // Three segments: shot 4 ends at 60s, shot 7 at 120s, shot 10 at 180s. Every seam is a cut.
    scenes: [
      { prompt: "Layered paper-craft scroll unrolling on a camp table, warm off-white palette, soft shadows", seconds: 9, beat: "hook", text: "Nobody writes that at their desk.", voiceover: "The most quoted book in self-improvement was not written in a study." },
      { prompt: "Paper-cut map of the Danube frontier, layered cardstock depth, a single lamp", seconds: 15, beat: "setup", voiceover: "For most of the last decade of his reign, Marcus Aurelius was on campaign in the north." },
      { prompt: "Cutout tents in rows under a paper sky, cold blue-grey tones", seconds: 18, beat: "setup", voiceover: "Plague in the legions, a frontier that would not hold, and a war that outlasted him." },
      { prompt: "Close on a layered paper hand holding a stylus over a wax tablet, lamp guttering", seconds: 18, beat: "setup", voiceover: "The notes we call the Meditations were written at the end of days like those, for nobody." },
      { prompt: "Canvas wall of a tent moving in wind, paper layers lifting, warm interior light", seconds: 20, beat: "turn", voiceover: "That is the fact that changes how the book reads. Every line telling you to get up and do the work was written by a man who had already done it too long." },
      { prompt: "Paper-cut figures at a distance across a river, flattened perspective, muted palette", seconds: 20, beat: "turn", voiceover: "He is not advising you. He is talking himself into one more morning." },
      { prompt: "A single cutout page, edges curling, text implied rather than legible", seconds: 20, beat: "payoff", voiceover: "It is why the repetitions are in there — the same three arguments, made again and again, because they kept wearing off." },
      { prompt: "The camp at dawn in paper layers, light coming up behind the tents", seconds: 18, beat: "payoff", voiceover: "Read as advice, that repetition is padding. Read as a private record, it is the whole evidence." },
      { prompt: "The scroll again, half rolled, the lamp out, cold morning light", seconds: 22, beat: "payoff", voiceover: "He never named it, never published it, and by every sign never intended anyone to see it." },
      { prompt: "The camp table empty, one page left on it, paper shadows long", seconds: 20, beat: "cta", voiceover: "Book two carries the note that it was written among the Quadi, on the river Gran. Start there, and read it as what it is." },
    ],
    caption: "It was never advice. It was a man talking himself into one more morning. #stoicism #marcusaurelius #meditations",
  },
];
