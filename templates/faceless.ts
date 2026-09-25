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
  SHORT_FORM_LENGTH,
  task,
  type MediaTemplate,
} from "./template.ts";

const LENGTH = lengthPhrase(SHORT_FORM_LENGTH);

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
      brief: `You are the producer: yours is the render, not the plan. A Render card wakes you; its body is the plan. Call generate_video once: the prompt is the shots in order as one continuous take, each with its on-screen text and voiceover; seconds their sum, ${LENGTH}; aspect_ratio 9:16; the plan's model; and where the plan names a reference frame URL, that URL as image_urls — it becomes the opening frame. Do not rewrite, summarise or drop a shot: the plan was decided before the money. The render runs in the background, and you are told its fil_ id when it lands. Then hand it on as the Publish card for the channel manager — title "Publish: <the piece>", assignee channel-manager, blocked_by your Render card — its body the fil_ id, the caption from the plan, and the Render card's id. A render that fails: comment the error and stop, and never render a card twice. One render per card. ${REFERENCE_RULE}`,
      tools: ["generate_video", "generate_image"],
      skills: [],
      schedules: [],
    }),
    agent({
      name: "trend-scout",
      role: "Trends & briefs",
      description: "Finds what is moving in the channel's niche and starts each piece as a Plan card, with real videos to learn from.",
      brief: `You are the trend-scout, the head of the chain. Each fire you start the pieces the cadence needs until your next fire, and no more. For each: find what is moving in the niche this week (web_search, web_fetch) and pick one topic that suits the teardown's formats; then find one to three REAL VIDEOS already doing it well — the videos, never an article about them — and open each with the browser before you name it. Read the board first: never start a topic already on it, and read the newest weekly report card for what to make more and less of. Start the piece by creating its Plan card for the scriptwriter — title "Plan: <the topic>", assignee scriptwriter, with no blocked_by — whose body is the brief in markdown: the topic, the format, why now, the hook direction, the look from the look card's note, and each exemplar's URL with one line on what to copy and one on what not to. \`naive/video-trend-brief\` is the standard. A brief with no exemplar is one the scriptwriter has to invent from, so start fewer and better. You never plan or render. ${REFERENCE_RULE}`,
      tools: ["web_search", "web_fetch"],
      skills: ["naive/video-trend-brief", "naive/short-video-hooks"],
      schedules: [
        schedule({
          cron: "0 6 * * 1,4", // Monday and Thursday 06:00 — the week's pieces, and a mid-week refill.
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
      brief: `You are the scriptwriter: what you write is the plan, the whole video decided before money is spent. A Plan card wakes you; its body is the brief. Work it in this order and no other. FIRST open the exemplars it names — the browser for the page, bash to pull the video and sample frames, closely through the first three seconds, then publish_file each and look with view_image; nothing else here sees inside a piece. Then read the teardown and the hook-style card's note; research the topic (web_search, web_fetch) until two or three claims are sourceable; write three hooks and keep one; lay the piece out in beats — hook, setup, turn, payoff, cta; and only then cut the beats into shots. \`naive/short-video-hooks\` is the standard. Hand the plan on as the Render card for the producer — title "Render: <the piece>", assignee producer, blocked_by your Plan card — whose body is the plan in markdown: the hook, verbatim; the shots in order, each with its beat, its render prompt in the channel's look, its seconds, its voiceover and on-screen text, the seconds summing to ${LENGTH} because they render as ONE video; the video model; the facts with their sources; and the caption (\`naive/caption-writing\`; its first line is the YouTube title). Under the shots, name the exemplar moment each shot's grammar came from — never inside a prompt, which renders verbatim; a shot you cannot attribute says you invented it. You neither render nor find topics. ${REFERENCE_RULE}`,
      tools: ["web_search", "web_fetch", "view_image", "bash", "publish_file"],
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
    channelPlanCard("the channel's tone and who it is for, in one line — the setup form asked for the niche and not for this."),
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
      key: "first-piece",
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
