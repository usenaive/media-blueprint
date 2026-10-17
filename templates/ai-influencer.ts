/**
 * `ai-influencer` — one photoreal creator who posts short videos in a few chosen looks (ADR-1281).
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
  lengthPhrase,
  niche,
  SEGMENT_MAX_SECONDS,
  SEGMENT_MIN_SECONDS,
  SHORT_FORM_LENGTH,
  task,
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
  { name: "Priya Raman", slug: "priya-raman", niche: "Founder · build in public" },
  { name: "Maya Elusing", slug: "maya-elusing", niche: "Wellness · morning routines" },
  { name: "Hank Delgado", slug: "hank-delgado", niche: "Small business · bakery owner" },
  { name: "Ava Lindqvist", slug: "ava-lindqvist", niche: "Fashion · fit checks" },
] as const;

export const UPLOAD_OWN = "Upload your own photos";
export const USUAL_LOOKS = "Their usual looks";

/**
 * The looks setup offers (eleven of the platform's seventeen, plus the character's own), each with its
 * first-party preview and our one-line description. The names are the platform's look names exactly:
 * the answer is passed as `generate_image{style}` word for word.
 */
const LOOK_OPTIONS: readonly { name: string; slug: string; note: string }[] = [
  { name: "Phone snap", slug: "phone-snap", note: "Natural light, casual phone framing, soft HDR glow; looks real." },
  { name: "Realistic", slug: "realistic", note: "No filter, crisp true-to-life detail in skin, light and fabric." },
  { name: "Library", slug: "library", note: "Soft indoor light, cozy academia, books and warm wood." },
  { name: "Quiet luxury", slug: "quiet-luxury", note: "Understated expensive: neutral tones, fine fabrics, calm interiors." },
  { name: "Through the glass", slug: "through-the-glass", note: "Seen through a fogged window or café pane; a quiet observed moment." },
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
    help: "Only if you picked Upload your own photos. 10 to 12 clear photos of one person: face visible, different angles, light and outfits. Only photos of you, or of someone who agreed.",
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
 * The producer's and the scriptwriter's override. It REPLACES the segmented one rather than following
 * it: the segmented seats open a segment on a reference URL or the previous one's last frame, and an
 * influencer's segment opens on a still of the character — the platform refuses a character video
 * from any other first frame. Each seat's own brief stays within the 360 words a person will read, so
 * the detail is the pinned skill's and the "Meet the influencer" card's.
 */
export const PRODUCER_INFLUENCER_BRIEF = `THIS CHANNEL'S PIECES ARE SEGMENTS OF ONE INFLUENCER, AND THAT OVERRIDES "call generate_video once", "One render per card" AND THE REFERENCE FRAME ABOVE. Per segment the plan names: its opening still is generate_image with character and style (the plan's look), aspect_ratio 9:16, or the look-sheet still the plan names; then generate_video with character, its seconds and image_urls that still, all on one model — never a frame cut from a clip. Render only segments not yet in the Render card's comments; comment each one's fil_ id and index as it lands, and re-render a failed one alone. Then fetch_file every segment, ffprobe each, join them in order with ffmpeg's concat demuxer, and probe the join against the plan's length. Finish it per \`naive/video-assembly\` step 5b — hook and label burned in as on-screen text, a silent join voiced with generate_speech, one frame checked — then publish_file it: that fil_ id goes on the Publish card. No ffmpeg: stop the card, naming the segments.`;

const SCRIPTWRITER_INFLUENCER_BRIEF = `THIS CHANNEL'S PIECES ARE SEGMENTS OF ONE INFLUENCER, AND THAT OVERRIDES "ONE video" ABOVE: get_character first, for their voice, wardrobe and looks. Lay out segments in order, each opening on a new still of them in one look — never a URL or a last frame — with its prompt (what they do, never their face) and seconds: ${SEGMENT_MIN_SECONDS} to ${SEGMENT_MAX_SECONDS} each, cut on shot changes, one model, ${lengthPhrase(SHORT_FORM_LENGTH)} together.`;

/** The `look` card's replacement: same key, so the day-one chain and its re-apply guard are unchanged. */
const characterCard = (look: Task): Task =>
  task({
    key: look.key,
    title: "Meet the influencer",
    assignee: look.assignee!,
    blocked_by: look.blocked_by,
    body: `Day one meets the influencer and renders their stills, not a video. Read project_context and naive/channel-template-ai-influencer. Resolve the influencer from setup: a creator's name is get_character{character:<that name>}, prebuilt and ready, no training. "${UPLOAD_OWN}": look at the photos answer with view_image; fewer than 10 usable photos of one clear face, ask_operator once for 10 to 16. Then create_character{name, image_urls, style_pack:<the picked looks>} — it waits for the operator's yes and costs $3.25 — and wait until get_character says ready. THIS CARD'S ONE EXCEPTION TO CLOSING IT: while it trains, comment so and end your turn with the card open; you are woken again, and you check again. Failed: comment its reason, ask_operator once for new photos, and stop. A creator's name and photos both answered: the creator wins, and your note says the photos were not used. Then render one 9:16 still per picked look, at most 4 ("${USUAL_LOOKS}" are the character's looks), with generate_image{character:<its chr_ id>, style:<the look>, aspect_ratio:"9:16"}, and look at each with view_image: a face that is not theirs is rendered again once. Attach the stills: your note starts with the chr_ id, then each look with its still's fil_ id. They are the channel's look sheet, and every plan names its look from it. Every later video starts from such a still: generate_video{character, image_urls:[the still]}.`,
  });

/** What every piece is: said on the first-piece card, in words its seat (which renders nothing) can act on. */
const FIRST_PIECE_INFLUENCER =
  "This channel is one person, the influencer on the Meet the influencer card's note: every piece is them, in one of the looks on that note, written in their voice — never a stranger, and never a description of them in place of their character.";

/** The faceless day-one cards with the influencer's: the `look` card replaced, the first-piece card told who it is about. */
const withInfluencerCards = (template: MediaTemplate): MediaTemplate => ({
  ...template,
  tasks: template.tasks.map((card) => {
    if (card.key === "look") return characterCard(card);
    if (card.key === "first-briefs") return { ...card, body: (card.body ?? "").replace(/ How this card works\./, ` ${FIRST_PIECE_INFLUENCER} How this card works.`) };
    return card;
  }),
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
    "trend-scout": { brief: INFLUENCER_CADENCE },
  },
});

export const AI_INFLUENCER: MediaTemplate = withInfluencerCards({
  ...base,
  // Training a face is paid, so the producer asks first; every other seat keeps it denied by name.
  agents: base.agents.map((seat) =>
    seat.name !== "producer"
      ? seat
      : { ...seat, tools: { ...seat.tools!, configs: { ...seat.tools!.configs, create_character: { enabled: true, permission: "ask" as const } } } },
  ),
  questions: AI_INFLUENCER_QUESTIONS,
});
