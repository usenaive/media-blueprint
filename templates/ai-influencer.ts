/**
 * `ai-influencer` — one photoreal creator who posts short videos in a few chosen looks (ADR-1335).
 *
 * It is the faceless crew with the segmented short-form seats (`SEGMENTED_SHORT_FORM`), like the
 * generative niches, and one load-bearing difference: the face. Every image of the influencer is
 * rendered with their character and a look, and every video is animated from such a still, so the
 * person never changes. The character is a setup answer, not a niche: one engine id serves the four
 * prebuilt creators and a face trained from the operator's own photos.
 *
 * What it changes on the faceless crew:
 *   · the questions — who, their photos, the looks, what for (no niche, reference or cadence);
 *   · the producer — reads and trains characters (`create_character` held for the operator's yes),
 *     renders every segment from a still of the character, on the models measured to keep a face;
 *   · the scriptwriter — reads the character's persona and looks, and plans each segment's still;
 *   · the `look` day-one card — becomes "Meet the influencer" (same key, so the chain is unchanged);
 *   · the first-piece card — every piece is the influencer;
 *   · the cadence — not asked; the manager and the scout read it as daily.
 */
import { FACELESS, SEGMENTED_SHORT_FORM } from "./faceless.ts";
import {
  budgetOf,
  lengthPhrase,
  niche,
  SEGMENT_MAX_SECONDS,
  SEGMENT_MIN_SECONDS,
  SHORT_FORM_LENGTH,
  task,
  type Budget,
  type MediaTemplate,
  type SetupQuestion,
  type Task,
} from "./template.ts";

export const AI_INFLUENCER_SKILL = "channel-template-ai-influencer";

/**
 * The video models an influencer is animated on, first is the default. Both were measured animating a
 * photoreal character still (staging, 2026-10-17, `$E/probe/video.json`): Hailuo 3 held the face at a
 * first-frame SSIM of 0.854, Wan 3.0 image-to-video at 0.847, and both kept it through the clip.
 * Seedance 2.5 was not measured on a face still, so it is not offered here.
 */
export const AI_INFLUENCER_VIDEO_MODELS: readonly string[] = ["minimax/hailuo-3", "alibaba/wan-3.0/image-to-video"];

/** The four prebuilt creators: setup name, the slug their first-party pictures are filed under, their niche. */
export const PREBUILT_CREATORS = [
  { name: "Priya Raman", slug: "priya-raman", niche: "Founder · build in public", id: "chr_0yxd67hvgwsz9xg8mrbbc1q33r" },
  { name: "Maya Elusing", slug: "maya-elusing", niche: "Wellness · morning routines", id: "chr_25ptp43961zfpgg5a5jbz4d38z" },
  { name: "Hank Delgado", slug: "hank-delgado", niche: "Small business · bakery owner", id: "chr_kxynfvnew54p253d24zq1h1457" },
  { name: "Ava Lindqvist", slug: "ava-lindqvist", niche: "Fashion · fit checks", id: "chr_t6afyfc7ztb6a6jnj04sdj2x1t" },
] as const;

/**
 * Each creator's fixed platform id (vetta-mono `infra/seed-platform-characters.ts`, the same in every
 * environment). The card names the id, never the name: an org's own character of the same name would
 * win a lookup by name.
 */
const CREATOR_IDS = PREBUILT_CREATORS.map((one) => `${one.name} = ${one.id}`).join(", ");

/** The looks a trained face gets when the operator picked only "Their usual looks" (it has none of its own). */
export const DEFAULT_TRAINED_LOOKS: readonly string[] = ["Phone snap", "Realistic", "Everyday"];

/** Where the niche comes from: this template asks no niche question (ADR-1335). */
export const INFLUENCER_NICHE =
  "THE NICHE IS THE INFLUENCER'S: the picked creator's niche in naive/channel-template-ai-influencer §4, or, for a face the operator trained, what the purpose answer says they are for.";

/**
 * Said to every seat and card that opens other people's videos. The day-one study and the first-piece
 * scout both looped on pages the browser would not open (staging, round 1), and a scout asked to sign
 * up for a site; the influencer's own face never depends on a page, so a page that will not open is
 * worked around, never fought.
 */
export const INFLUENCER_PAGES =
  "A PAGE THAT WILL NOT OPEN IS SKIPPED: when the browser fails on a page twice, stop using the browser this card and work from web_search and web_fetch, saying so in your note. Never sign up or log in anywhere for this.";

export const UPLOAD_OWN = "Upload your own photos";
export const USUAL_LOOKS = "Their usual looks";

/**
 * The looks setup offers (eleven of the platform's sixteen, plus the character's own), each with its
 * first-party preview and our one-line description. The names are the platform's look names exactly:
 * the answer is passed as `generate_image{style}` word for word. vetta-mono `packages/core/src/schema/looks.test.ts`
 * pins this list against the catalogue: change both together.
 */
const LOOK_OPTIONS: readonly { name: string; slug: string; note: string }[] = [
  { name: "Phone snap", slug: "phone-snap", note: "Natural light, casual phone framing, soft HDR glow; looks real." },
  { name: "Realistic", slug: "realistic", note: "No filter, crisp true-to-life detail in skin, light and fabric." },
  { name: "Library", slug: "library", note: "Soft indoor light, cozy academia, books and warm wood." },
  { name: "Quiet luxury", slug: "quiet-luxury", note: "Understated expensive: neutral tones, fine fabrics, calm interiors." },
  { name: "Through the glass", slug: "through-the-glass", note: "Seen through a window or café pane; a quiet observed moment." },
  { name: "Japandi", slug: "japandi", note: "Warm minimalism: clean lines, natural light, pale wood." },
  { name: "Rainy day", slug: "rainy-day", note: "Moody sky, wet-pavement reflections, soft sweaters, slow and cinematic." },
  { name: "Selfcare", slug: "selfcare", note: "Candles, skincare and robes; glowing calm in muted tones." },
  { name: "Wide-angle outfit", slug: "wide-angle-outfit", note: "Waist-down wide-angle outfit shot, candid and playful." },
  { name: "Tokyo street style", slug: "tokyo-street-style", note: "Layered looks, sharp silhouettes and bold colour, street-snap energy." },
  { name: "90s editorial", slug: "90s-editorial", note: "Retro fashion-magazine image: film grain, soft blur, moody colour." },
];

/**
 * The four setup questions (the engine's cap). The pictures are paths on the dashboard itself
 * (`/setup/…`, vetta-mono `apps/web/public/setup/`), never a vendor's URL.
 */
export const AI_INFLUENCER_QUESTIONS: SetupQuestion[] = [
  {
    key: "character",
    label: "Who is your influencer?",
    type: "choice",
    multiple: false,
    other: false,
    options: [...PREBUILT_CREATORS.map((one) => one.name), UPLOAD_OWN],
    details: [
      ...PREBUILT_CREATORS.map((one) => ({ option: one.name, image: `/setup/characters/${one.slug}.jpg`, note: `${one.niche} · ready now` })),
      { option: UPLOAD_OWN, image: "/setup/characters/upload.svg", note: "Trains a new face · $3.25 · about 20 min" },
    ],
    help: "Prebuilt creators are already trained and can post today. Upload photos to train a face only you can use.",
  },
  {
    key: "photos",
    label: "Photos of your character",
    type: "media",
    optional: true,
    placeholder: "Or paste a link to a photo",
    help: "Only if you picked Upload your own photos. Up to 12 clear photos of one person (the crew asks in chat for more, 10 to 16 in all): face visible, different angles, light and outfits. Only photos of you, or of someone who agreed: approving the training confirms it, and photos of a public figure are refused.",
  },
  {
    key: "looks",
    label: "Pick the looks",
    type: "choice",
    multiple: true,
    other: false,
    options: [USUAL_LOOKS, ...LOOK_OPTIONS.map((one) => one.name)],
    details: [
      { option: USUAL_LOOKS, image: "/setup/looks/usual.jpg", note: "The creator's own style pack" },
      ...LOOK_OPTIONS.map((one) => ({ option: one.name, image: `/setup/looks/${one.slug}.jpg`, note: one.note })),
    ],
    help: "Your influencer is drawn in the looks you pick. You can see each creator's looks in the Characters tab.",
  },
  {
    key: "purpose",
    label: "What is your influencer for?",
    type: "text",
    placeholder: "Grow an audience of their own, or promote my product: example.com",
    help: "An audience of their own, or your product woven into what they post.",
  },
];

/** The setup asks no cadence; the two seats that read one are told it here. */
export const INFLUENCER_CADENCE =
  "THIS CHANNEL POSTS DAILY: its setup asks no cadence, so wherever this brief says the cadence answer, read daily, and never ask for one.";

/**
 * No render draws words. The faceless producer puts each shot's on-screen text in the prompt, and step 5b
 * burns the same words in after the join: on staging (round 2) every caption showed twice.
 */
export const NO_DRAWN_WORDS =
  "NO RENDER PROMPT HOLDS WORDS: not the on-screen text, a caption or a sign; words go on once, at step 5b.";

/** One outfit and one place per piece: on staging (round 2) each segment's new still changed both; now every later segment re-poses segment 1's still (`ONE_SET`). */
export const ONE_OUTFIT =
  "Name the piece's ONE look, outfit and setting once.";

/**
 * One set per piece (H1, vetta-mono ADR-1335): segment 1's still is rendered with the character and the
 * look; every later segment opens on an edit of THAT still (generate_image with character and
 * image_urls), which keeps its room, props and outfit and is still the character's, so it may open a
 * character video. On staging (round 3) a fresh still per segment turned the mug into a glass and moved
 * the wall; the 18 Oct probe kept room, props, outfit and face on every edit.
 */
export const ONE_SET =
  "Segment 1 opens on a still: generate_image with character and style (the plan's look), aspect_ratio 9:16, in the piece's one outfit and setting. Each later segment opens on that still re-posed: generate_image with character, image_urls [segment 1's still], only the new action and framing.";

/**
 * The producer's and the scriptwriter's override. It REPLACES the segmented one rather than following
 * it: the segmented seats open a segment on a reference URL or the previous one's last frame, and an
 * influencer's segment opens on a still of the character — the platform refuses a character video
 * from any other first frame. Each seat's own brief stays within the 360 words a person will read, so
 * the detail is the pinned skill's and the "Meet the influencer" card's.
 */
export const PRODUCER_INFLUENCER_BRIEF = `THIS CHANNEL'S PIECES ARE SEGMENTS OF ONE INFLUENCER, OVERRIDING "call generate_video once", "One render per card", "each with its on-screen text" AND THE REFERENCE FRAME ABOVE. ${ONE_SET} Then generate_video for every segment in one turn: character, its seconds, image_urls its still, one model — never a frame cut from a clip. ${NO_DRAWN_WORDS} Render only segments not yet in the card's comments, commenting each fil_ id and index; re-render a failed one alone. Join and finish per \`naive/video-assembly\` — the label a disclosure only, a call to action in the last segment only — then publish_file it for the Publish card.`;

const SCRIPTWRITER_INFLUENCER_BRIEF = `THIS CHANNEL'S PIECES ARE SEGMENTS OF ONE INFLUENCER, OVERRIDING "ONE video" ABOVE: get_character first (voice, wardrobe, looks). ${ONE_OUTFIT} Segments in order: one still of the set, re-posed for each later segment, never a URL or last frame, prompted with action, setting and framing only, never gender, age, face, hair, build or words; ${SEGMENT_MIN_SECONDS} to ${SEGMENT_MAX_SECONDS} seconds each, cut on shot changes, ${lengthPhrase(SHORT_FORM_LENGTH)} together.`;

/** The `look` card's replacement: same key, so the day-one chain and its re-apply guard are unchanged. */
const characterCard = (look: Task): Task =>
  task({
    key: look.key,
    title: "Meet the influencer",
    assignee: look.assignee!,
    // Waits on nothing: it needs only the setup answers, so the face is met even while the study runs.
    blocked_by: [],
    body: `Day one meets the influencer and renders their stills, not a video. Read project_context and naive/channel-template-ai-influencer. Resolve the influencer from setup: a creator's name is get_character{character:<its id>} (${CREATOR_IDS}), prebuilt and ready, no training. "${UPLOAD_OWN}": look at the photos answer with view_image; fewer than 10 usable photos of one clear face, ask_operator once for 10 to 16. Then create_character{name, image_urls, style_pack:<the picked looks without "${USUAL_LOOKS}"; if that was the only pick, ${DEFAULT_TRAINED_LOOKS.join(", ")}>, consent:{attested:true}} — it waits for the operator's yes, which is their confirmation that the person in the photos is them or agreed to it and is not a public figure, and costs $3.25 — and wait until get_character says ready. Refused as a public figure: say so on the card, ask_operator once for photos of themselves or of someone who agreed, and stop. Nothing wakes you when training ends, so while it trains (about 20 minutes) ask_operator to reply once the Characters tab shows it Ready — a question keeps this card yours; on the reply get_character again, and ask again if it is still training. Failed: comment its reason, ask_operator once for new photos, and stop. A creator's name and photos both answered: the creator wins, and your note says the photos were not used. Then render one 9:16 still per picked look, at most 4 ("${USUAL_LOOKS}" are the character's looks), with generate_image{character:<its chr_ id>, style:<the look>, aspect_ratio:"9:16"}, and look at each with view_image: a face that is not theirs is rendered again once. Attach the stills: your note starts with the chr_ id, then each look with its still's fil_ id. They are the channel's look sheet, and every plan names its look from it. Every later video starts from such a still: generate_video{character, image_urls:[the still]}.`,
  });

/**
 * DAY ONE (H5). Round 3 measured the first video 61 minutes after install and day one billed $12.05,
 * $7.17 of it model use; the reference study looped on the same frames for about 15 minutes and every
 * card behind it waited. So for an influencer the face, the persona and the hook style start the first
 * piece, and the study runs after it starts, on the analyst (idle on day one), capped by that seat's
 * per-task ceiling (`AI_INFLUENCER_BUDGETS`). The first piece is short (15–20 seconds, three segments,
 * one exemplar). Target, measured on staging: first finished video ≤ 30 minutes, day one ≤ $6 billed
 * for a prebuilt creator.
 */
export const DAY_ONE_PIECE =
  "TODAY'S PIECE IS DAY ONE'S, so keep it lean: it runs 15 to 20 seconds in three segments, and one exemplar is enough. Say both in the brief, and that the reference teardown is not filed yet: the piece is planned and rendered from the hook-style note and the exemplar, and nobody waits for the study.";

/** The study's own cap, said on its card; the analyst's per-task ceiling is the hard stop under it. */
export const STUDY_SPEND_MICRO_USD = 600_000;

/**
 * Each seat's ceilings on this template, the platform's hard stops (per task, per day). Sized to this
 * template's own render: Hailuo 3 bills 169,000 µUSD a second (845,000 for 5 s on staging), so a 30-second
 * piece is about $5.07 and the producer's $8 per task clears it with its stills and turns. The seats that
 * render nothing get $3 a task, which a looping session hits in minutes rather than an hour; the analyst
 * gets $1.50, the study's hard cap. A training ($3.25) is a price the operator approved, held past the
 * per-task ceiling, so the producer's day clears a training and a piece.
 */
export const AI_INFLUENCER_MICRO_USD_PER_SECOND = 169_000;
export const AI_INFLUENCER_BUDGETS: Readonly<Record<string, Budget>> = {
  producer: budgetOf(8_000_000, 16_000_000),
  scriptwriter: budgetOf(3_000_000, 9_000_000),
  "trend-scout": budgetOf(3_000_000, 9_000_000),
  "channel-manager": budgetOf(3_000_000, 9_000_000),
  analyst: budgetOf(1_500_000, 4_000_000),
};

/** The hook style, from the influencer: it waits on nothing, so the first piece never waits on the study. */
const HOOK_STYLE_BODY =
  "Day one is set-up, not scripts. Read project_context and naive/channel-template-ai-influencer: the picked creator's voice and hooks in §4, or for a face the operator trained, what the purpose answer says they are for. Write the channel's hook style as this card's note, in five lines: the openings this audience stops for, the shape of a piece in beats, the voice, the caption shape, and what never to say. Say it is drawn from the influencer's persona; the reference teardown comes later and refines it — do not wait for the reference-study card. Every plan this channel files is written to this note.";

/** The study, off the critical path and capped: no downloads, no frame sampling, two videos at most. */
const STUDY_BODY = `Run after the first piece has started — it never waits on you. Find two real short videos (15 to 30 seconds) that creators like this influencer post and that do well, and study them with the browser and web_fetch: how they open and their first three seconds, where they turn, how fast they cut, the shot grammar, the caption shape, what they never do. At most two videos and about eight page views in all; never open the same page twice; download nothing and sample no frames. Stop once session_spend reads past $${(STUDY_SPEND_MICRO_USD / 1_000_000).toFixed(2)} and file what you have. Write the teardown as this card's note, specific enough to plan from, with every video by URL and what you inferred marked apart from what you saw; say in its first line that these are the crew's picks. Write no hooks, scripts or briefs here.`;

/** What every piece is: said on the first-piece card, in words its seat (which renders nothing) can act on. */
const FIRST_PIECE_INFLUENCER =
  "This channel is one person, the influencer on the Meet the influencer card's note: every piece is them, in one of the looks on that note, written in their voice — never a stranger, and never a description of them in place of their character.";

/** The faceless day-one cards with the influencer's: the `look` card replaced, the first-piece card told who it is about. */
const withInfluencerCards = (template: MediaTemplate): MediaTemplate => ({
  ...template,
  tasks: template.tasks.map((card) => {
    if (card.key === "look") return characterCard(card);
    if (card.key === "reference-study") {
      return task({ key: card.key, title: card.title, assignee: "analyst", blocked_by: ["first-briefs"], body: `${INFLUENCER_NICHE} ${INFLUENCER_PAGES} ${STUDY_BODY}` });
    }
    if (card.key === "hook-style") return task({ key: card.key, title: card.title, assignee: card.assignee!, blocked_by: [], body: HOOK_STYLE_BODY });
    if (card.key === "first-briefs") return { ...card, body: (card.body ?? "").replace(/ How this card works\./, ` ${FIRST_PIECE_INFLUENCER} ${DAY_ONE_PIECE} ${INFLUENCER_NICHE} ${INFLUENCER_PAGES} How this card works.`) };
    return card;
  })
    // The study now waits on the first piece's card, and a blocker is declared before the card it blocks.
    .sort((a, b) => Number(a.key === "reference-study") - Number(b.key === "reference-study")),
});

const base = niche(FACELESS, {
  name: "ai-influencer",
  title: "AI Influencer",
  description:
    "AI Influencer is a template that builds an agent team that runs a photoreal AI influencer for you: a consistent creator who posts short videos in your chosen looks, every day.",
  skill: AI_INFLUENCER_SKILL,
  seats: {
    ...SEGMENTED_SHORT_FORM,
    producer: {
      ...SEGMENTED_SHORT_FORM.producer,
      tools: [...(SEGMENTED_SHORT_FORM.producer?.tools ?? []), "get_character", "list_characters"],
      brief: PRODUCER_INFLUENCER_BRIEF,
      videoModels: AI_INFLUENCER_VIDEO_MODELS,
    },
    scriptwriter: {
      ...SEGMENTED_SHORT_FORM.scriptwriter,
      tools: [...(SEGMENTED_SHORT_FORM.scriptwriter?.tools ?? []), "get_character"],
      brief: SCRIPTWRITER_INFLUENCER_BRIEF,
    },
    "channel-manager": { brief: INFLUENCER_CADENCE },
    "trend-scout": { brief: `${INFLUENCER_CADENCE} ${INFLUENCER_NICHE} ${INFLUENCER_PAGES}` },
  },
});

export const AI_INFLUENCER: MediaTemplate = withInfluencerCards({
  ...base,
  // Training a face is paid, so the producer asks first; every other seat keeps it denied by name.
  // The publisher's posts are labelled AI-generated (`social.post` config).
  // A video edit (`edit_video`, which follows `generate_video` unless named) can change the face, so
  // every seat denies it by name.
  agents: base.agents.map((seat) => ({
    ...seat,
    // Day one's hard stops (H5): each seat's ceiling, and every fire inside it.
    budget: AI_INFLUENCER_BUDGETS[seat.name] ?? seat.budget,
    schedules: (seat.schedules ?? []).map((fire) => ({
      ...fire,
      budget_micro_usd: Math.min(fire.budget_micro_usd, (AI_INFLUENCER_BUDGETS[seat.name] ?? seat.budget).max_task_micro_usd),
    })),
    tools: {
      ...seat.tools!,
      configs: {
        ...seat.tools!.configs,
        edit_video: { enabled: false, permission: "deny" as const },
        ...(seat.name === "producer" ? { create_character: { enabled: true, permission: "ask" as const } } : {}),
        // Every post is the influencer, so every post is labelled AI-generated: the network's own label
        // and an #AIgenerated caption line, added by the publish path (vetta-mono ADR-1335 (i)).
        ...(seat.tools!.configs["social.post"]?.enabled
          ? { "social.post": { ...seat.tools!.configs["social.post"], config: { ai_generated: true } } }
          : {}),
      },
    },
  })),
  questions: AI_INFLUENCER_QUESTIONS,
});
