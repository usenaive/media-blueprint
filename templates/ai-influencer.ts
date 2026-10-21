/**
 * `ai-influencer` — one photoreal creator who posts short videos in a few chosen looks (ADR-1360).
 *
 * It is the faceless crew with the segmented short-form seats (`SEGMENTED_SHORT_FORM`), like the
 * generative niches, on the same scene pipeline (script -> images -> video -> edit, a character bible
 * on day one), and one load-bearing difference: the face. Every image of the influencer is
 * rendered with their character and a look, and every video is animated from such a still, so the
 * person never changes. The character is a setup answer, not a niche: one engine id serves the four
 * prebuilt creators and a face trained from the operator's own photos.
 *
 * What it changes on the faceless crew:
 *   · the questions — who, their photos, the looks, what for (no niche, reference or cadence);
 *   · the producer — reads and trains characters (`create_character` held for the operator's yes); its
 *     scene step is replaced: every scene's image is a still of the character, every video animates
 *     one, on the models measured to keep a face;
 *   · the scriptwriter — reads the character's persona and looks, and plans each scene's still;
 *   · the `look` day-one card — becomes "Meet the influencer" (same key, so the chain is unchanged);
 *   · the `character-bible` day-one card — the influencer's bible, from the persona, not from a study;
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

/** Where the niche comes from: this template asks no niche question (ADR-1360). */
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
 * No render draws words. On staging (round 2) a shot's on-screen text went into the clip's prompt and
 * step 5b burned the same words in after the join, so every caption showed twice; a quoted line drew
 * itself the same way (round 3). The scene pipeline keeps dialogue in the video prompt, so for an
 * influencer the line stays in the plan and is voiced in the edit.
 */
export const NO_DRAWN_WORDS =
  "NO RENDER PROMPT HOLDS WORDS: not a spoken line, the on-screen text, a caption or a sign; lines are voiced and words burned in once, in the edit.";

/**
 * One outfit and one place per piece: on staging (round 2) each segment's new still changed both; now every later scene re-poses scene 1's still (`ONE_SET`).
 * Fix r2 (H1): a later segment's prompt named "a kitchen nook" and the edit moved there from segment 1's bedroom, so later
 * scenes name no place at all (the platform also checks the edit's place against scene 1's still, ADR-1360 (jj)).
 */
export const ONE_OUTFIT =
  "Name the piece's ONE look, outfit and setting once, in scene 1's image_prompt.";

/**
 * One set per piece (H1, vetta-mono ADR-1360): scene 1's image is rendered with the character and the
 * look; every later scene opens on an edit of THAT still (generate_image with character and
 * image_urls), which keeps its room, props and outfit and is still the character's, so it may open a
 * character video. On staging (round 3) a fresh still per segment turned the mug into a glass and moved
 * the wall; the 18 Oct probe kept room, props, outfit and face on every edit.
 */
export const ONE_SET =
  "Scene 1's image: generate_image with character (the chr_ id on the Meet the influencer note) and style (the plan's look), aspect_ratio 9:16, exactly its image_prompt, in the piece's one outfit and setting. Each later scene's image is that still re-posed: generate_image with character, image_urls [scene 1's accepted image], exactly its image_prompt — only the new action and framing.";

/**
 * The scene pipeline (media-blueprint #55) opens a scene on a generated image, a pinned skill's shipped
 * frame or the previous take's last frame, and keeps each line in the video prompt. An influencer's
 * scene opens only on a still of the character — the platform refuses a character video from any
 * other first frame — and a quoted line draws itself into the clip. So the producer's scene step is
 * REPLACED, not appended to (`SCENE_STEP` is the base text it stands in for; `replaceSpan` throws
 * if the base ever stops carrying it, so a base rewrite cannot leave both in one brief), and the
 * scriptwriter's opening-frame and video-prompt rules are replaced the same way. The rest of the
 * pipeline — preflight, the bible, AUDIO MODE, the edit, VERIFY — is the base's, word for word.
 */
export const PRODUCER_SCENE_STEP = `Work resumably from the Render card's comments. EVERY SCENE IS THE INFLUENCER, so none opens on a shipped frame or a last frame. For each scene: (1) a scene without an accepted image gets one. ${ONE_SET} Comment "SCENE <index> IMAGE <fil_ id>", inspect it against the bible, and allow ONE corrected replacement for a visible mismatch; a second miss stops before video spend. (2) Once every scene has its image, call generate_video for each in one turn, with character, exactly its video_prompt and seconds, and image_urls: ["<fil_ id>"] holding that scene's accepted image — never a frame cut from a clip. ${NO_DRAWN_WORDS} They render in the background: end your turn, and never sleep or poll. On completion comment "SCENE <index> VIDEO <fil_ id>". Never re-render a completed scene. A failed render: comment "SCENE <index> VIDEO FAILED <error>" and re-render it once; a second failure means STOPPED. On screen, the label is a disclosure only and a call to action sits in the last scene only.`;

/** The base producer's scene step, from its first words to the paragraph after it. */
const SCENE_STEP = { from: "Work resumably from the Render card's comments.", to: "\n\nAfter all videos exist" };

/**
 * The base seats' legacy path, for a card planned before the bible existed. An influencer's bible is a
 * day-one card the first piece waits on, and the scout starts nothing without one, so no influencer
 * plan is ever written without it: both seats drop the path (a card that somehow lacks the sections is
 * refused by the producer's preflight before any spend).
 */
const PRODUCER_LEGACY = { from: "A card with no CONTINUITY CONTRACT or STORY LOGIC section", to: "must hold source provenance" };
const SCRIPTWRITER_LEGACY = { from: "With no bible note yet, write the plan as before", to: "State one THEME/PROMISE" };

/** The scriptwriter's opening-frame rule and its video-prompt carry list, each replaced whole. */
const OPENING_FRAME_RULE = { from: "The image_prompt makes one opening frame", to: " The video_prompt begins there" };
export const SCRIPTWRITER_IMAGE_RULE = `The image_prompt makes one opening frame of the influencer matching the incoming state. ${ONE_OUTFIT} Each later scene's image_prompt re-poses that still: action and framing only, no new place; never a shipped frame, URL or last frame.`;
const VIDEO_CARRIES = { from: "carries canonical blocks, action, expression, camera, ambience and exact dialogue,", to: " and reaches the outgoing state" };
export const SCRIPTWRITER_VIDEO_CARRIES = "carries one gentle action, expression, camera, ambience and who is speaking — never the line itself —";

/** Replace `[from, to)` in a composed system, or throw: the base text it stands in for has moved. */
export const replaceSpan = (system: string, span: { from: string; to: string }, replacement: string, seat: string): string => {
  const at = system.indexOf(span.from);
  const end = at < 0 ? -1 : system.indexOf(span.to, at);
  if (at < 0 || end < 0 || system.indexOf(span.from, at + 1) >= 0) throw new Error(`ai-influencer ${seat}: the base brief no longer carries "${span.from}"`);
  return `${system.slice(0, at)}${replacement}${system.slice(end)}`;
};

/** The producer's own line, after the base pipeline: the tools that read the face. */
export const PRODUCER_INFLUENCER_BRIEF = `Every image and video of this channel is the influencer, by the character id on the Meet the influencer note, and every scene of a piece uses one video model.`;

const SCRIPTWRITER_INFLUENCER_BRIEF = `EVERY SCENE IS THE ONE INFLUENCER: get_character first (voice, wardrobe, looks). No image_prompt or video_prompt says gender, age, face, hair, build or any words: the character carries who they are, and lines are voiced in the edit. ${SEGMENT_MIN_SECONDS} to ${SEGMENT_MAX_SECONDS} seconds a scene, ${lengthPhrase(SHORT_FORM_LENGTH)} together.`;

/** The `look` card's replacement: same key, so the day-one chain and its re-apply guard are unchanged. */
const characterCard = (look: Task): Task =>
  task({
    key: look.key,
    title: "Meet the influencer",
    assignee: look.assignee!,
    // Waits on nothing: it needs only the setup answers, so the face is met even while the study runs.
    blocked_by: [],
    body: `Day one meets the influencer and renders their stills, not a video. Read project_context and naive/channel-template-ai-influencer. Resolve the influencer from setup: a creator's name is get_character{character:<its id>} (${CREATOR_IDS}), prebuilt and ready, no training. "${UPLOAD_OWN}": look at the photos answer with view_image; fewer than 10 usable photos of one clear face, ask_operator once for 10 to 16. Then create_character{name, image_urls, style_pack:<the picked looks without "${USUAL_LOOKS}"; if that was the only pick, ${DEFAULT_TRAINED_LOOKS.join(", ")}>, consent:{attested:true}} — it waits for the operator's yes, which is their confirmation that the person in the photos is them or agreed to it and is not a public figure, and costs $3.25 — and wait until get_character says ready. Refused as a public figure: say so on the card, ask_operator once for photos of themselves or of someone who agreed, and stop. Nothing wakes you when training ends, so while it trains (about 20 minutes) ask_operator to reply once the Characters tab shows it Ready — a question keeps this card yours; on the reply get_character again, and ask again if it is still training. Failed: comment its reason, ask_operator once for new photos, and stop. Refused as "paused on the platform's side": nothing was charged and a retry fails the same way, so never call create_character again or ask for another approval; say so on the card and stop. A creator's name and photos both answered: the creator wins, and your note says the photos were not used. Then render one 9:16 still per picked look, at most 4 ("${USUAL_LOOKS}" are the character's looks), with generate_image{character:<its chr_ id>, style:<the look>, aspect_ratio:"9:16"}, and look at each with view_image: a face that is not theirs is rendered again once. Attach the stills: your note starts with the chr_ id, then each look with its still's fil_ id. They are the channel's look sheet, and every plan names its look from it. Every later video starts from such a still: generate_video{character, image_urls:[the still]}.`,
  });

/**
 * DAY ONE (H5). Round 3 measured the first video 61 minutes after install and day one billed $12.05,
 * $7.17 of it model use; the reference study looped on the same frames for about 15 minutes and every
 * card behind it waited. So for an influencer the face, the persona and the hook style start the first
 * piece, and the study runs after it starts, on the analyst (idle on day one), capped by that seat's
 * per-task ceiling (`AI_INFLUENCER_BUDGETS`). The first piece is short (15–20 seconds, three segments,
 * one exemplar). r3 verify: the scout still browsed 14-20 pages and the scriptwriter 13 — 10 to 14
 * of the ~20 minutes before the producer started — so day one's piece now uses no web at all (fix r1).
 * r3 verify 2: Hank's plan gave each 5-second segment a 9-11 second line, and his producer spent five
 * minutes stretching them to fit (31 min to the first video), so the line length is said here (fix r2).
 * Target, measured on staging: first finished video ≤ 30 minutes, day one ≤ $6 billed for a prebuilt
 * creator.
 */
export const DAY_ONE_PIECE =
  "TODAY'S PIECE IS DAY ONE'S, AND THIS OVERRIDES FINDING A TOPIC AND EXEMPLARS ABOVE: no web_search, browser or web_fetch for it. Take the topic from the influencer's persona and the hook-style note, one of their everyday moments, and file the Plan card at once. It runs 15 seconds in three 5-second scenes, and each scene's voiceover is one line of at most 12 words, so it fits its 5 seconds as spoken. Say in the brief that it is planned from the hook-style note and the persona with no exemplar, that the reference teardown is not filed yet and nobody waits for the study, and that today the scriptwriter does no research, browsing, download or frame sampling: it writes the plan from the brief and the hook-style note.";

/** The study's own cap, said on its card; the analyst's per-task ceiling is the hard stop under it. */
export const STUDY_SPEND_MICRO_USD = 400_000;

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
  analyst: budgetOf(1_000_000, 4_000_000),
};

/** The hook style, from the influencer: it waits on nothing, so the first piece never waits on the study. */
const HOOK_STYLE_BODY =
  "Day one is set-up, not scripts. Read project_context and naive/channel-template-ai-influencer: the picked creator's voice and hooks in §4, or for a face the operator trained, what the purpose answer says they are for. Write the channel's hook style as this card's note, in five lines: the openings this audience stops for, the shape of a piece in beats, the voice, the caption shape, and what never to say. Say it is drawn from the influencer's persona; the reference teardown comes later and refines it — do not wait for the reference-study card. Every plan this channel files is written to this note.";

/** The study, off the critical path and capped: no downloads, no frame sampling, two videos at most. */
const STUDY_BODY = `Run after the first piece has started — it never waits on you. Find two real short videos (15 to 30 seconds) that creators like this influencer post and that do well, and study them with the browser and web_fetch: how they open and their first three seconds, where they turn, how fast they cut, the shot grammar, the caption shape, what they never do. At most two videos and about eight page views in all; never open the same page twice; download nothing and sample no frames. Stop once session_spend reads past $${(STUDY_SPEND_MICRO_USD / 1_000_000).toFixed(2)} and file what you have. Write the teardown as this card's note, specific enough to plan from, with every video by URL and what you inferred marked apart from what you saw; say in its first line that these are the crew's picks. Write no hooks, scripts or briefs here.`;

/**
 * The influencer's character bible (the scene pipeline's day-one card, same key). The base card studies
 * the reference videos for a recurring cast; here the cast is fixed by setup — one person, whose face is
 * the character — so the bible is drawn from the persona, the purpose answer and the picked looks, waits
 * on nothing, and opens no page: the first piece waits on it, and the study runs after the first piece.
 * Its close-then-ask order is the base card's, so an unanswered question never parks the channel.
 */
const BIBLE_BODY = `Day one is set-up, not a script: this is the influencer's character bible, and the first piece waits on it. Read project_context and, with read_skill, naive/channel-template-ai-influencer and every other skill pinned to you. Resolve the influencer as the Meet the influencer card does: a creator's name is its fixed id (${CREATOR_IDS}) — get_character it for voice, wardrobe and looks; "${UPLOAD_OWN}" is the face that card trains, described by the purpose answer. Copy the purpose answer verbatim, labelled CREATOR DIRECTIVE. Open no page and sample no video: the reference study runs after the first piece.

Write a complete draft with: CHARACTER MODE (recurring cast: the influencer alone); CONTENT THEMES and NARRATIVE PATTERNS from the persona and purpose; CANONICAL CAST (the influencer: chr_ id, or "the face the Meet the influencer card trains", role, wardrobe and palette in each picked look, personality, expressions and movement, voice, and a reusable prompt block of action, setting and framing only — never gender, age, face, hair or build, which the character carries); ONE-OFF CHARACTER RULE (nobody else is a named character); WORLD (their everyday places and props); VISUAL LANGUAGE (the picked looks); DIALOGUE/VOICE; MUST NOT CHANGE (the face comes from the character; one look, outfit and setting per piece); ALLOWED VARIATION; NEGATIVE CONSTRAINTS (no words drawn into a render, no text-only render of them); and REFERENCES. Mark what you inferred.

Close this card with the complete bible as its note, beginning "DRAFT CHARACTER BIBLE": the first piece works from the draft, so never hold it open for an answer. THEN, once it is closed and not before, ask the operator once with ask_operator to approve the draft or state corrections. When they answer, apply stated corrections without overriding them and comment on this card "APPROVED CHARACTER BIBLE" followed by the entire approved bible; approved unchanged, copy the entire draft. That comment replaces the draft for every later piece. Generate nothing on this card.`;

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
    if (card.key === "character-bible") return task({ key: card.key, title: "Write the influencer's character bible, then get the operator's approval", assignee: card.assignee!, blocked_by: [], body: BIBLE_BODY });
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
    // Replaces the segmented seats' "pinned skills' scene grammar" line: an influencer's scene grammar
    // is the character still (below), never a shipped frame or a last frame.
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
  // A video edit (`edit_video`, which follows `generate_video` unless named) can change the face, so
  // every seat denies it by name.
  agents: base.agents.map((seat) => ({
    ...seat,
    // The scene steps an influencer replaces (see `PRODUCER_SCENE_STEP`), in place, so no brief holds both.
    system:
      seat.name === "producer"
        ? replaceSpan(replaceSpan(seat.system!, PRODUCER_LEGACY, "Every Render card ", seat.name), SCENE_STEP, PRODUCER_SCENE_STEP, seat.name)
        : seat.name === "scriptwriter"
          ? [
              [SCRIPTWRITER_LEGACY, ""],
              [OPENING_FRAME_RULE, SCRIPTWRITER_IMAGE_RULE],
              [VIDEO_CARRIES, SCRIPTWRITER_VIDEO_CARRIES],
            ].reduce((system, [span, text]) => replaceSpan(system, span as typeof SCENE_STEP, text as string, seat.name), seat.system!)
          : seat.system,
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
      },
    },
  })),
  questions: AI_INFLUENCER_QUESTIONS,
});
