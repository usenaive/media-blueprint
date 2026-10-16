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

/** The durable source of character, world and story continuity for every generated short. */
export const CONTINUITY_RULE =
  "The approved character-bible card is this channel's continuity contract. Read its latest complete note before choosing, planning or rendering a piece. Creator wording copied there from project_context or a pinned channel-template skill outranks an inference from a reference; observed evidence outranks an invented detail. Never silently revise the bible from a new exemplar or one generated result. A new character is one-off unless the operator explicitly promotes it.";

/**
 * Every generated short now follows the same scene pipeline below. The niche override only changes
 * the video-model preference: these playbooks were measured on Hailuo 3 first, with Seedance 2.5 as
 * the fallback. Their own skill still decides the genre-specific scene grammar.
 */
export const SEGMENTED_SHORT_FORM: Record<string, SeatOverride> = {
  scriptwriter: {
    brief: "Use the pinned channel-template skill's scene grammar without weakening the character bible, source provenance or scene contract above.",
  },
  producer: {
    videoModels: SEGMENT_VIDEO_MODELS,
    brief: "Use the pinned channel-template skill's scene grammar while following the same image-to-video and editing pipeline above. All scenes use the same video model.",
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
      description: "Makes each planned scene as an image, animates it into video, edits the scenes into one finished vertical piece, and hands it to the channel manager.",
      brief: `You are the producer: yours is script -> images -> video -> editing, never a new plan. A Render card wakes you; its body must hold the approved-bible citation, source provenance, continuity contract, story logic, and ordered scenes. PREFLIGHT BEFORE SPEND: read the approved character-bible note and refuse with STOPPED if the plan lacks one of those sections, names an undefined canonical character, changes an invariant, omits the exact reusable character/style block from an applicable image or video prompt, runs outside ${LENGTH}, or has a scene whose opening state does not follow the preceding scene's outgoing state and named transition. Do not repair the script yourself.

Work resumably from the Render card's comments. For each scene: (1) without an accepted image, call generate_image with exactly its image_prompt, aspect_ratio 9:16 and the plan's image references. From scene two, absent a stronger canonical reference, include the first accepted scene image for identity. Comment "SCENE <index> IMAGE <fil_ id>", inspect it against the bible, and allow ONE corrected replacement for a visible mismatch; a second miss stops before video spend. (2) Without a completed video, call generate_video with exactly its video_prompt, seconds, aspect_ratio 9:16 and image_file_ids containing that scene's accepted image; ${RENDER_MODEL_RULE}. Keep exact dialogue in the prompt for the character performance. The render runs in the background: end your turn, and never sleep or poll. On completion comment "SCENE <index> VIDEO <fil_ id>". Never regenerate a completed scene; comment a failure and stop.

After all videos exist, fetch_file and ffprobe each, then transcribe_audio each and compare it with the planned dialogue. Choose ONE source for the WHOLE PIECE and comment "AUDIO MODE: NATIVE" or "AUDIO MODE: GENERATED" before editing. NATIVE requires intelligible dialogue from the right speaker in every scene; preserve render audio and DO NOT call generate_speech. Otherwise choose GENERATED: generate every planned line, using a voice only when project_context supplied its supported id, and REMOVE all original audio before replacement. Never use amix for source and generated speech, leave source dialogue under replacement speech, or mix modes within a piece. If speech generation fails, stop; do not substitute an undeclared local or system voice.

Follow \`naive/video-assembly\`: normalize streams, burn in on-screen text, join with ffmpeg, and probe the finished 9:16 file against ${LENGTH}. Listen at every dialogue moment and confirm exactly one intelligible voice; inspect one frame per scene. Doubled voice, failed probe, wrong duration, missing scene or continuity mismatch means STOPPED. publish_file the one finished video and create the next card — title "Publish: <the piece>", assignee channel-manager, blocked_by your Render card — with the final fil_ id, caption, Render card id, scene ids and AUDIO MODE. ${CONTINUITY_RULE} ${REFERENCE_RULE}`,
      tools: ["generate_video", "generate_image", "view_image", "bash", "fetch_file", "publish_file", "generate_speech", "transcribe_audio"],
      skills: ["naive/video-assembly"],
      schedules: [],
    }),
    agent({
      name: "trend-scout",
      role: "Trends & briefs",
      description: "Finds what is moving in the channel's niche and starts each piece as a Plan card, with real videos to learn from.",
      brief: `You are the trend-scout, the head of the chain. Each fire you start the pieces the cadence needs until your next fire, and no more. Read the approved character-bible card first; if it is absent or not approved, start nothing. For each piece: find what is moving in the niche this week (web_search, web_fetch) and pick one topic that suits the teardown's formats, approved themes and recurring narrative patterns; then find one to three REAL VIDEOS already doing it well — the videos, never an article about them — and open each with the browser before you name it. Read the board first: never start a topic already on it, and read the newest weekly report card for what to make more and less of. Start the piece by creating its Plan card for the scriptwriter — title "Plan: <the topic>", assignee scriptwriter, with no blocked_by — whose body is the brief in markdown: the topic, format, why now, hook direction, look, chosen bible theme and narrative pattern, canonical characters or archetypes that fit, any explicitly one-off character, and each exemplar's URL with one line on what to copy and one on what not to. \`naive/video-trend-brief\` is the standard. Never promote an exemplar's character into the bible. A brief with no exemplar is one the scriptwriter has to invent from, so start fewer and better. You never script or render. ${CONTINUITY_RULE} ${REFERENCE_RULE}`,
      tools: ["view_image"],
      skills: ["naive/video-trend-brief", "naive/short-video-hooks"],
      schedules: [
        schedule({
          cron: "0 6 * * 1,4", // Monday and Thursday 06:00 — the week's pieces, and a mid-week refill.
          summary: "Plan the next pieces",
          input:
            "Start the next pieces. Read project_context, the approved character bible, the teardown, the newest weekly report card and the Plan cards already on the board (board_read). If the bible is absent or unapproved, start none. Otherwise start as many pieces as the cadence needs until your next fire — each a Plan card for the scriptwriter whose body names the bible theme, narrative pattern and cast, with one to three real videos you opened with the browser. Nothing already on the board. Started none, say why in one line.",
          budget_micro_usd: 10_000_000, // $10 — a read of the niche and a few briefs.
        }),
      ],
    }),
    agent({
      name: "scriptwriter",
      role: "Hooks & scripts",
      description: "Turns every brief into a sourced scene plan—image prompts, animation prompts, exact dialogue and edit instructions—before generation is bought.",
      brief: `You are the scriptwriter: write the whole production plan before money is spent. FIRST read the teardown, approved character bible and hook-style note; without an approved bible, stop. Then open the exemplars the brief names: use the browser, pull the video with bash, sample the first three seconds densely and later scene changes, publish_file the frames and inspect them with view_image. Research until two or three claims are sourceable and stop researching once session_spend reads past $1. Write three hooks and keep one. Build one causal spine: BECAUSE problem, protagonist WANTS outcome, BUT meets obstacle, THEREFORE acts, SO payoff follows. Every beat changes that story; delete side premises. Lay it out as hook, setup, turn, payoff, cta; divide shot changes into scenes of ${SEGMENT_MIN_SECONDS}–${SEGMENT_MAX_SECONDS} seconds whose sum is ${LENGTH}.

Create the producer's Render card — title "Render: <the piece>", assignee producer, blocked_by your Plan card — with these required sections. SOURCE PROVENANCE: quote relevant creator wording from project_context or the pinned channel-template skill verbatim, cite the approved bible card, and give exemplar URLs plus timestamps; label every other choice inferred or invented. CONTINUITY CONTRACT: theme, narrative pattern, character IDs, one-offs, world/location, exact invariant character/style prompt blocks, allowed variations, negative constraints, canonical references, and one continuity seed when useful. STORY LOGIC: the BECAUSE/BUT/THEREFORE/SO spine, protagonist's want, necessary viewer knowledge, and a transition ledger showing each scene's outgoing action, information or emotion causes the next opening state. No unexplained location, prop, character, knowledge, goal or elapsed time. Perform a cold-viewer check without the brief: who wants what, why, what changed, and how does the ending follow? Rewrite until all answers are explicit on screen or in natural dialogue.

SCENES IN ORDER: for each, id, beat, seconds, character IDs, location/props, exact dialogue or voiceover with speaker and voice direction, on-screen text, transition, incoming state, outgoing state, image references, an image_prompt and a video_prompt. Name a speech voice id only when project_context supplied that supported voice. The image_prompt combines the creator's relevant words, canonical character/style/world blocks, composition, lighting and negative constraints; it describes one strong opening frame that visibly matches the incoming state. The video_prompt says to begin from that generated image and combines the same canonical blocks with action, expression, camera movement, ambience and the exact dialogue; it must reach the outgoing state that motivates the next scene and forbid identity, wardrobe, palette and setting drift. Prompts contain no provenance commentary because they render verbatim. EDIT PLAN: scene order, speech placement, ambience, text timing and transitions that preserve the causal chain. Then include ${PLAN_MODEL_RULE}; sourced facts; and the caption (\`naive/caption-writing\`, first line the YouTube title). Under each scene, outside its prompts, name the exact reference moment whose grammar it follows; otherwise say invented. You neither generate nor find topics. ${CONTINUITY_RULE} ${REFERENCE_RULE}`,
      tools: ["view_image", "bash", "publish_file", "transcribe_audio"],
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
      key: "character-bible",
      title: "Extract the character, world and story bible, then get the operator's approval",
      assignee: "scriptwriter",
      blocked_by: ["reference-study"],
      body: `Day one is set-up, not a script. Read project_context, the completed reference teardown and every pinned channel-template skill. Preserve the creator's relevant wording verbatim and label it CREATOR DIRECTIVE; never rewrite it as though the creator said your interpretation. Re-open the named reference videos and inspect evidence throughout each one: sample the opening densely, every major scene change and story turn, recurring character appearances and the ending; extract audio and use transcribe_audio only where dialogue or voice is part of the format. publish_file representative frames and inspect them with view_image.

Write a complete draft in a comment with: CHARACTER MODE (recurring cast, recurring archetype, or none); CONTENT THEMES; NARRATIVE PATTERNS; CANONICAL CAST (stable id, role, physical invariants, wardrobe/material/palette, personality, expressions/movement, voice, relationships, exact reusable prompt block); ONE-OFF CHARACTER RULE; WORLD (locations, props, period and environment); VISUAL LANGUAGE; DIALOGUE/VOICE; MUST NOT CHANGE; ALLOWED VARIATION; NEGATIVE CONSTRAINTS; and REFERENCES. Every observed claim cites URL and timestamp and says observed; every synthesis says inferred with confidence. A trait seen once is optional, not canon. Conflicts are listed, not guessed. Copy usable creator-provided still URLs exactly; record representative fil_ frame ids as evidence. If the references do not repeat a cast, define an archetype or none instead of inventing a named character.

Then ask the operator once with ask_operator to approve the draft or state corrections. Wait for the answer. Apply stated corrections without overriding them, and close this card only with a final note beginning "APPROVED CHARACTER BIBLE" followed by the entire approved bible; if approved unchanged, copy the entire draft there. Every future piece reads that final note. Generate nothing on this card.`,
    }),
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
      blocked_by: ["look", "hook-style", "character-bible"],
      body: "The look, voice and approved character bible exist now — the notes on the cards this one waited on. Read project_context and the teardown. Find what is moving in the niche right now and pick ONE topic within the bible's approved themes and narrative patterns; choose its canonical cast or explicitly one-off characters; find one to three real videos already doing it well, and open each with the browser before you name it. Then create its Plan card for the scriptwriter — title \"Plan: <the topic>\", assignee scriptwriter — whose body is the brief: the topic, format, why now, hook direction, look, bible theme, narrative pattern, cast, and each exemplar's URL with one line on what to copy. ONE piece today: its chain of cards takes it to the approval card, and your Monday and Thursday fires start the rest. Put the Plan card's id in your note.",
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
