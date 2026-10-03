/**
 * `faceless` — Faceless channel: original short-form video in one niche, 15–30 seconds a piece.
 *
 * A piece moves along the board as a chain of cards:
 *
 *   trend-scout ──Plan──▶ scriptwriter ──Render──▶ producer ──Publish──▶ channel-manager ──▶ approval card
 *
 * The scout's twice-weekly fire starts the pieces the cadence needs, each as a Plan card whose body
 * is the brief. Every seat after it is woken by the board when its card becomes due, and hands on by
 * creating the next card. The analyst reads the numbers and files a weekly report card for the
 * manager. Day one sets up the plan, the reference, the look and the voice, then starts one piece.
 */
import {
  PLAN_MODEL_RULE,
  RENDER_MODEL_RULE,
  FIRST_PIECE_KEY,
  agent,
  ANALYST_REPORT,
  analystSchedules,
  CADENCE_QUESTION,
  channelManager,
  channelPlanCard,
  lengthPhrase,
  lookCard,
  PLATFORMS,
  referenceStudyCard,
  REFERENCE_QUESTION,
  REFERENCE_RULE,
  schedule,
  SEGMENT_MAX_SECONDS,
  SEGMENT_MIN_SECONDS,
  SEGMENT_VIDEO_MODELS,
  SHORT_FORM_LENGTH,
  task,
  type MediaTemplate,
  type SeatOverride,
} from "./template.ts";

const LENGTH = lengthPhrase(SHORT_FORM_LENGTH);

/**
 * The short-form niches whose playbook builds a piece as a start, a middle and an end: image-to-video
 * animates forward from one opening frame and cannot cut, so each beat is its own render and the
 * piece is their join. A single 30-second render cannot open the fight on a restyled fight frame
 * after a tale-of-the-tape card, or keep a feast continuous by opening each take on the last frame
 * of the one before. So the niche extends two faceless seats: the scriptwriter plans segments, and
 * the producer gets the shell, the file tools and `naive/video-assembly` to render them and join
 * them with ffmpeg — the long-form producer's method, inside the short-form window: the total stays
 * 15–30 seconds, so one producer session's ceiling still clears the whole piece. The producer renders
 * on `SEGMENT_VIDEO_MODELS` (Hailuo 3 first, at most 15 seconds a call), and burns the plan's hook
 * and label in after the join (`naive/video-assembly` step 5b) — a render cannot draw legible text.
 */
export const SEGMENTED_SHORT_FORM: Record<string, SeatOverride> = {
  scriptwriter: {
    brief: `THIS CHANNEL'S PIECES ARE SEGMENTS JOINED, AND THAT OVERRIDES "ONE video" ABOVE: lay the shots out as your niche skill's segments, in order, each with its opening frame — a reference URL copied exactly, or "the previous segment's last frame" — its render prompt and seconds. No segment runs over ${SEGMENT_MAX_SECONDS} seconds or under ${SEGMENT_MIN_SECONDS}, every boundary lands on a shot change, all on the same model, and together they run ${LENGTH}.`,
  },
  producer: {
    tools: ["bash", "fetch_file", "publish_file", "generate_speech"],
    skills: ["naive/video-assembly"],
    videoModels: SEGMENT_VIDEO_MODELS,
    brief: `THIS CHANNEL'S PIECES ARE SEGMENTS JOINED, AND THAT OVERRIDES "call generate_video once" AND "One render per card" ABOVE: one generate_video call per segment the plan names, each with its opening frame and seconds, all on one model. Render only segments not yet in the Render card's comments; comment each one's fil_ id and index on the card as it lands, and re-render a failed one alone. A segment opening on the previous one's last frame: fetch_file that one, pull the frame with ffmpeg, publish_file it, pass its URL as image_urls. Then fetch_file every segment, ffprobe each, join them in order with ffmpeg's concat demuxer, and probe the join against the plan's length. Finish it per \`naive/video-assembly\` step 5b — its hook and label burned in as on-screen text, a silent join voiced with generate_speech, one frame checked — then publish_file it: that fil_ id goes on the Publish card. No ffmpeg and no way to install it: stop the card, naming the segments.`,
  },
};

export const FACELESS: MediaTemplate = {
  name: "faceless",
  title: "Faceless channel",
  length: SHORT_FORM_LENGTH,
  description: "Generates original short-form video in one niche, from briefs, in the channel's own look.",
  platforms: PLATFORMS,
  pipeline: ["trend-scout", "scriptwriter", "producer", "channel-manager"],

  agents: [
    channelManager(),
    agent({
      name: "producer",
      role: "Video production",
      description: "Renders each planned piece as one vertical video, exactly as planned, and hands it to the channel manager to publish.",
      brief: `You are the producer: yours is the render, not the plan. A Render card wakes you; its body is the plan. Call generate_video once: the prompt is the shots in order as one continuous take, each with its on-screen text and voiceover; seconds their sum, ${LENGTH}; aspect_ratio 9:16; ${RENDER_MODEL_RULE}; and where the plan names a reference frame URL, that URL as image_urls — it becomes the opening frame. Do not rewrite, summarise or drop a shot: the plan was decided before the money. The render runs in the background, and you are told its fil_ id when it lands: until then end your turn, and never sleep or poll. Then hand it on as the Publish card for the channel manager — title "Publish: <the piece>", assignee channel-manager, blocked_by your Render card — its body the fil_ id, the caption from the plan, and the Render card's id. A render that fails: comment the error and stop, and never render a card twice. One render per card. ${REFERENCE_RULE}`,
      tools: ["generate_video", "generate_image", "view_image"],
      skills: [],
      schedules: [],
    }),
    agent({
      name: "trend-scout",
      role: "Trends & briefs",
      description: "Finds what is moving in the channel's niche and starts each piece as a Plan card, with real videos to learn from.",
      brief: `You are the trend-scout, the head of the chain. Each fire you start the pieces the cadence needs until your next fire, and no more. For each: find what is moving in the niche this week (web_search, web_fetch) and pick one topic that suits the teardown's formats; then find one to three REAL VIDEOS already doing it well — the videos, never an article about them — and open each with the browser before you name it. Read the board first: never start a topic already on it, and read the newest weekly report card for what to make more and less of. Start the piece by creating its Plan card for the scriptwriter — title "Plan: <the topic>", assignee scriptwriter, with no blocked_by — whose body is the brief in markdown: the topic, the format, why now, the hook direction, the look from the look card's note, and each exemplar's URL with one line on what to copy and one on what not to. \`naive/video-trend-brief\` is the standard. A brief with no exemplar is one the scriptwriter has to invent from, so start fewer and better. You never plan or render. ${REFERENCE_RULE}`,
      tools: ["view_image"],
      skills: ["naive/video-trend-brief", "naive/short-video-hooks"],
      schedules: [
        schedule({
          cron: "0 6 * * 1,4", // Monday and Thursday 06:00 — the week's pieces, and a mid-week refill.
          summary: "Plan the next pieces",
          input:
            "Start the next pieces. Read project_context, the teardown, the newest weekly report card and the Plan cards already on the board (board_read). Start as many pieces as the cadence needs until your next fire — each a Plan card for the scriptwriter whose body is the brief, with one to three real videos you opened with the browser. Nothing already on the board. Started none, say why in one line.",
          budget_micro_usd: 10_000_000, // $10 — a read of the niche and a few briefs.
        }),
      ],
    }),
    agent({
      name: "scriptwriter",
      role: "Hooks & scripts",
      description: "Turns every brief into the whole video decided in advance — hook, beats, shots, sources and caption — before a render is bought.",
      brief: `You are the scriptwriter: what you write is the plan, the whole video decided before money is spent. A Plan card wakes you; its body is the brief. Work it in this order and no other. FIRST read the teardown and the hook-style card's note. Then open the exemplars the brief names — the browser for the page, bash to pull the video and sample frames, closely through the first three seconds, then publish_file each and look with view_image; nothing else here sees inside a piece. Research the topic (web_search, web_fetch) until two or three claims are sourceable, and stop researching once session_spend reads past $1; write three hooks and keep one; lay the piece out in beats — hook, setup, turn, payoff, cta; and only then cut the beats into shots. \`naive/short-video-hooks\` is the standard. Hand the plan on as the Render card for the producer — title "Render: <the piece>", assignee producer, blocked_by your Plan card — whose body is the plan in markdown: the hook, verbatim; the shots in order, each with its beat, its render prompt in the channel's look, its seconds, its voiceover and on-screen text, the seconds summing to ${LENGTH} because they render as ONE video; ${PLAN_MODEL_RULE}; the facts with their sources; and the caption (\`naive/caption-writing\`; its first line is the YouTube title). Under the shots, name the exemplar moment each shot's grammar came from — never inside a prompt, which renders verbatim; a shot you cannot attribute says you invented it. You neither render nor find topics. ${REFERENCE_RULE}`,
      tools: ["view_image", "bash", "publish_file"],
      skills: ["naive/short-video-hooks", "naive/caption-writing", "naive/reference-teardown"],
      schedules: [],
    }),
    agent({
      name: "analyst",
      role: "Performance",
      description: "Records every post's numbers daily and reports weekly, per hook and format, on what to make more and less of.",
      brief: `You are the analyst: you measure, and you never plan, make or publish. Every morning you record the numbers (social.post_metrics). Once a week you write the report: per piece — each closed Publish card names its post ids — what went out and what it did, in numbers you actually read. Read the plans behind them on the board: the hook and the beats are what the numbers are a verdict on, so report by hook pattern and by format, and say whether the pieces that followed the reference did better than the ones that drifted. ${ANALYST_REPORT} ${REFERENCE_RULE}`,
      tools: ["social.post_metrics"],
      skills: ["naive/channel-report"],
      schedules: analystSchedules("Per piece, per hook pattern and per format, say what went out and what it did, and whether the pieces that followed the reference did better."),
    }),
  ],

  tasks: [
    channelPlanCard("the channel's tone and who it is for, in one line."),
    referenceStudyCard("scriptwriter", SHORT_FORM_LENGTH),
    lookCard("scriptwriter", ""),
    task({
      key: "hook-style",
      title: "Write the channel's hook style, so every piece is in one voice",
      assignee: "scriptwriter",
      blocked_by: ["reference-study"],
      body: `Day one is set-up, not scripts. Read project_context and your own teardown — the note on the reference-study card you just closed. Write the channel's hook style as this card's note, in five lines: the openings this audience stops for, the shape of a piece ${LENGTH} in beats, the voice, the caption shape, and what never to say. Each line says which of the teardown's patterns it came from; where the operator named no reference, say the patterns are the crew's reading. Every plan this channel files is written to this note.`,
    }),
    task({
      key: "report-frame",
      title: "Set up the weekly report this channel will be measured against",
      assignee: "analyst",
      blocked_by: ["channel-plan"],
      body: "Read project_context and the channel plan — the note on the channel-plan card this one waited on. Write, as this card's note, the skeleton of the weekly report: the metrics you will read per piece and where they come from (social.post_metrics), and the week's target taken from the plan's posting slots rather than invented here. Write no report today — nothing has posted, and your Monday 07:30 fire writes the first real one.",
    }),
    task({
      // The key v1.x already seeded, so a re-apply to an existing org is a no-op: see FIRST_PIECE_KEY.
      key: FIRST_PIECE_KEY.faceless,
      title: "Start the channel's first piece",
      assignee: "trend-scout",
      blocked_by: ["look", "hook-style"],
      body: "The look and the voice exist now — the notes on the look and hook-style cards this one waited on. Read project_context and the teardown. Find what is moving in the niche right now and pick ONE topic; find one to three real videos already doing it well, and open each with the browser before you name it. Then create its Plan card for the scriptwriter — title \"Plan: <the topic>\", assignee scriptwriter — whose body is the brief: the topic, the format, why now, the hook direction, the look, and each exemplar's URL with one line on what to copy. ONE piece today: its chain of cards takes it to the approval card, and your Monday and Thursday fires start the rest. Put the Plan card's id in your note.",
    }),
  ],

  /**
   * The niche, what it should be like (optional) and how often. Where it posts is the accounts the
   * operator connects; the tone and who it is for, the manager asks on its day-one card.
   */
  questions: [
    {
      key: "niche",
      label: "Niche",
      type: "choice",
      options: ["Stoicism & philosophy", "True crime recaps", "Space & astronomy", "Personal finance", "History mysteries", "Health & longevity"],
      help: "Pick one or type your own. The channel manager asks about tone and audience next.",
    },
      REFERENCE_QUESTION,
    CADENCE_QUESTION,
  ],
};
