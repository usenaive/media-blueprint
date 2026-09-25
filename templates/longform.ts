/**
 * `longform` — Naive Long Form v1: one researched subject at a time, 60–180 seconds a piece.
 *
 *   researcher ──Plan──▶ writer ──Render──▶ producer ──Publish──▶ channel-manager ──▶ approval card
 *
 * Everything that differs from Short Form follows from one fact: `generate_video` renders at most
 * `MAX_RENDER_SECONDS` a call, so a piece is up to six segments, rendered separately and joined with
 * ffmpeg in the producer's own sandbox — nothing on the platform joins video. Two segments never
 * match mid-shot, so the writer lays every seam on a shot change before anything is bought. A piece
 * costs ~$53.97 of render, so the pipeline starts three pieces a week, not seven.
 */
import {
  agent,
  ANALYST_REPORT,
  analystSchedules,
  budgetOf,
  CADENCE_QUESTION,
  channelManager,
  channelPlanCard,
  lengthPhrase,
  LONG_FORM_LENGTH,
  lookCard,
  MAX_RENDER_SECONDS,
  PLATFORM_QUESTION,
  referenceStudyCard,
  REFERENCE_QUESTION,
  REFERENCE_RULE,
  renderMicroUsd,
  schedule,
  segmentsOf,
  task,
  type MediaTemplate,
} from "./template.ts";

const LENGTH = lengthPhrase(LONG_FORM_LENGTH);
/** Six: `ceil(180 / MAX_RENDER_SECONDS)`. */
const SEGMENTS = segmentsOf(LONG_FORM_LENGTH);
/** ~$53.97 — every segment of the longest piece, as the ledger bills it, inside one session. */
const WHOLE_RENDER = `$${(renderMicroUsd(LONG_FORM_LENGTH) / 1_000_000).toFixed(2)}`;

/**
 * The producer renders a whole piece in one session, so its per-task ceiling clears
 * `renderMicroUsd(LONG_FORM_LENGTH)` (~$53.97) plus the turns that join and hand it on; the daily cap
 * fits a failed piece re-run the same day.
 */
const PRODUCER_BUDGET = budgetOf(75_000_000, 150_000_000);

export const LONGFORM: MediaTemplate = {
  name: "longform",
  length: LONG_FORM_LENGTH,
  description:
    "Researches one subject at a time and makes it as an original one-to-three-minute video — planned against real exemplars, rendered in segments and joined into one file.",
  pipeline: ["researcher", "writer", "producer", "channel-manager"],

  agents: [
    channelManager(),
    agent({
      name: "researcher",
      role: "Research & briefs",
      description: "Researches one subject a fire, with its sources and the exemplar videos of this channel's own length, and starts it as a Plan card.",
      brief: `You are the researcher, the head of the chain, and this format pays for depth rather than for being early. Each fire you start ONE subject: a question with a real answer, a story with a turn, a process with steps — something still going somewhere ninety seconds in. Research it (web_search, web_fetch) until you hold four or five claims you can source. Then find one or two EXEMPLAR videos in this niche AT THIS CHANNEL'S LENGTH, ${LENGTH}, never shorts — a short has no second act to learn from. Open each with the browser before you name it, and write down how it opens, roughly where it turns, and what it does at the points a viewer would otherwise leave, with the timestamps. Read the board first: never start a subject already on it, and read the newest weekly report card for what to make more and less of. Start the piece by creating its Plan card for the writer — title "Plan: <the subject>", assignee writer — whose body is the brief in markdown: the subject, why now, the hook direction, the sources, and each exemplar's URL with what it does and when. You neither plan nor render. ${REFERENCE_RULE}`,
      tools: ["web_search", "web_fetch"],
      skills: ["naive/video-trend-brief"],
      schedules: [
        schedule({
          // Monday, Wednesday and Friday 05:00 — three pieces a week, because each is ~$53.97 of render.
          cron: "0 5 * * 1,3,5",
          input:
            "Start the next subject. Read project_context, the teardown, the newest weekly report card and the Plan cards already on the board (board_read). Pick ONE subject worth a whole piece, research it until every claim has a source, find one or two exemplar videos of this channel's own length and open each, then create its Plan card for the writer whose body is the brief. Nothing already on the board.",
          budget_micro_usd: 10_000_000, // $10 — a deep read of one subject and its exemplars.
        }),
      ],
    }),
    agent({
      name: "writer",
      role: "Structure & scripts",
      description: "Plans each subject as a whole piece — hook, acts, shots, sources — after looking inside its exemplars, with every segment seam on a shot change.",
      brief: `You are the writer, and what you write is the whole piece decided before money is spent: at up to ${SEGMENTS} renders, a wrong plan is the most expensive thing here. A Plan card wakes you; its body is the brief. FIRST, LOOK AT THE EXEMPLARS: pull frames out of each with bash AT ITS CHAPTER BOUNDARIES — the timestamps the brief names — never evenly, because the question is how a piece changes gear. publish_file each frame and look with view_image. Then read the teardown and the arc-style card's note; research until every claim has a source; write three hooks and keep one; lay the piece out in acts; and only then cut the acts into shots. TWO RULES ABOUT SEGMENTS, AND THEY ARE NOT TASTE: NO SEGMENT MAY RUN OVER ${MAX_RENDER_SECONDS} SECONDS, because one render call takes no more, and EVERY SEGMENT BOUNDARY MUST LAND ON A SHOT CHANGE, because two segments are rendered independently and a boundary inside a shot is a visible seam. Hand the plan on as the Render card for the producer — title "Render: <the piece>", assignee producer, blocked_by your Plan card — whose body is the plan in markdown: the hook, verbatim; the segments in order, each its shots with render prompt, seconds, voiceover and on-screen text, summing to ${LENGTH}; the look; the video model; the facts with sources; and the caption (\`naive/caption-writing\`; its first line is the YouTube title) and the networks from project_context. Under the shots, name the exemplar each shot's grammar came from — never inside a prompt, which renders verbatim. You neither render nor pick subjects. ${REFERENCE_RULE}`,
      tools: ["web_search", "web_fetch", "bash", "publish_file", "view_image"],
      skills: ["naive/long-form-arc", "naive/caption-writing", "naive/reference-teardown"],
      schedules: [],
    }),
    agent({
      name: "producer",
      role: "Render & assembly",
      description: "Renders each planned segment, joins them into one file with ffmpeg, probes it against the plan and hands it to the channel manager. Resumes a half-rendered piece rather than re-buying it.",
      budget: PRODUCER_BUDGET,
      brief: `You are the producer: yours is the render, not the plan — and one piece here is up to ${SEGMENTS} renders and a join, about ${WHOLE_RENDER} of video. A Render card wakes you; its body is the plan, already cut into segments of ${MAX_RENDER_SECONDS} seconds or fewer on shot changes. START WITH WHAT YOU ALREADY HAVE: a half-rendered piece is the normal case, so find_files for segments already filed under this Render card's id before you render anything. Render only what is missing, each with generate_video at aspect_ratio 9:16 and the plan's model, and name every segment by the card's id and its index. A segment that fails is re-rendered alone: starting again from the top buys the others twice. A length refusal is a stop, not a hint — never retry shorter to find what the model takes. Each render hands back a fil_ id and no copy on disk, so fetch_file every segment into the sandbox, ffprobe each against the plan, and join them in order with ffmpeg's concat demuxer. Probe the joined file: its length must match the plan. A file that does not probe is not published; if ffmpeg is missing and cannot be installed, move your card to blocked with the segments named. Then publish_file the joined file, and hand its fil_ id on as the Publish card for the channel manager — title "Publish: <the piece>", assignee channel-manager, blocked_by your Render card — with the caption, the networks and each segment's cost from session_spend. ${REFERENCE_RULE}`,
      tools: ["generate_video", "bash", "fetch_file", "publish_file"],
      skills: ["naive/video-assembly"],
      schedules: [],
    }),
    agent({
      name: "analyst",
      role: "Performance",
      description: "Records every post's numbers daily and reports weekly on where the audience left each piece, read against the plan's own acts.",
      brief: `You are the analyst: you measure, and you never plan, make or publish. Every morning you record the numbers (social.post_metrics). Once a week you write the report. RETENTION IS THE METRIC THIS FORMAT LIVES OR DIES ON: a piece ${LENGTH} is not skipped, it is LEFT, and where it is left is the only thing that tells this crew what to change. So report, per piece — each closed Publish card names its post ids — where the audience stopped, read against the plan's act boundaries on its Render card: "they left at the turn, before the payoff", never "it underperformed". Where no tool returns a retention curve, say so in one line and report the proxies you do have. Then the pieces out against the cadence, the subjects and hooks that held longest, and whether the pieces that followed their exemplars held better. ${ANALYST_REPORT} ${REFERENCE_RULE}`,
      tools: ["social.post_metrics"],
      skills: ["naive/channel-report"],
      schedules: analystSchedules("Lead with retention: per piece, where the audience stopped, read against the plan's act boundaries; where no tool returns a curve, say so and report the proxies you have."),
    }),
  ],

  tasks: [
    channelPlanCard("the channel's tone and who it is for, in one line — the setup form asked for the niche and not for this."),
    referenceStudyCard("writer", LONG_FORM_LENGTH),
    lookCard("writer", " A look is held across every segment of every piece: two segments in different looks read as two videos, so name ONE primary look and treat a second as a fallback."),
    task({
      key: "arc-style",
      title: "Write the channel's arc — how a piece of this length is built",
      assignee: "writer",
      blocked_by: ["reference-study"],
      body: `Day one is set-up, not scripts. Read project_context and your own teardown — the note on the reference-study card you just closed. Write the channel's arc as this card's note: the openings this audience stops for; the shape of a piece ${LENGTH} in acts, with roughly where each act ends; what holds a viewer around twenty seconds in and at the halfway mark; the voice; the caption shape; and what never to say. Each line says which of the teardown's patterns it came from. One more line, and it is a rendering fact: a piece renders as at most ${SEGMENTS} segments of ${MAX_RENDER_SECONDS} seconds or fewer, so say where the act boundaries fall against those seams. Every plan this channel files is written to this note.`,
    }),
    task({
      key: "report-frame",
      title: "Set up the weekly report this channel will be measured against",
      assignee: "analyst",
      blocked_by: ["channel-plan"],
      body: "Read project_context and the channel plan — the note on the channel-plan card this one waited on. Write, as this card's note, the skeleton of the weekly report, led by retention: how you will read where the audience left each piece (social.post_metrics), what you will report when no retention curve is offered, and the week's target taken from the plan's posting slots. Write no report today — nothing has posted, and your Monday 07:30 fire writes the first real one.",
    }),
    task({
      key: "first-piece",
      title: "Start the channel's first subject",
      assignee: "researcher",
      blocked_by: ["look", "arc-style"],
      body: `The look and the arc exist now — the notes on the look and arc-style cards this one waited on. Read project_context and the teardown. Pick ONE subject worth a whole piece ${LENGTH}, research it until you hold four or five claims you can source, and find one or two exemplar videos of this length — never shorts — opening each with the browser and noting how it opens, where it turns, and when. Then create its Plan card for the writer — title "Plan: <the subject>", assignee writer — whose body is the brief: the subject, why now, the hook direction, the sources, and the exemplars with what each does and when. ONE piece today: its chain of cards takes it to the approval card, and your Monday, Wednesday and Friday fires start the rest. Put the Plan card's id in your note.`,
    }),
  ],

  questions: [
    {
      key: "niche",
      label: "Niche",
      type: "choice",
      options: ["Stoicism & philosophy", "True crime recaps", "Space & astronomy", "Personal finance", "History mysteries", "Health & longevity"],
      help: "Pick one or type your own — every subject, script and render is for this niche. Your tone and who it is for is the first thing the channel manager will ask you about.",
    },
    PLATFORM_QUESTION,
    REFERENCE_QUESTION,
    CADENCE_QUESTION,
  ],
};
