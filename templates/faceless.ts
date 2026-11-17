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
  channelManager,
  channelPlanCard,
  lengthPhrase,
  DEFAULT_VIDEO_MICRO_USD_PER_SECOND,
  lookCard,
  PLATFORMS,
  PUBLISHER,
  referenceStudyCard,
  REFERENCE_RULE,
  schedule,
  SEGMENT_MAX_SECONDS,
  SEGMENT_MIN_SECONDS,
  SHORT_FORM_LENGTH,
  task,
  type MediaTemplate,
  type Task,
  type SeatOverride,
} from "./template.ts";

const LENGTH = lengthPhrase(SHORT_FORM_LENGTH);

/** The durable source of character, world and story continuity for every generated short. */
export const CONTINUITY_RULE =
  "The character-bible card is this channel's continuity contract. Before choosing, planning or rendering a piece, read its newest APPROVED CHARACTER BIBLE comment, else its DRAFT CHARACTER BIBLE note, and say which you used; an approval replaces the draft for every later piece. Creator wording copied there from project_context or a pinned skill outranks an inference from a reference; observed evidence outranks an invented detail. Never silently revise the bible from a new exemplar or one generated result. A new character is one-off unless the operator explicitly promotes it.";

/**
 * Every generated short follows the same scene pipeline below, on the same video models
 * (`VIDEO_MODELS`). The niche override only points each seat at its pinned skill, which decides the
 * genre-specific scene grammar.
 */
export const SEGMENTED_SHORT_FORM: Record<string, SeatOverride> = {
  scriptwriter: {
    brief: "Use your pinned skills' scene grammar (the channel template's, or the one built from this channel's reference videos) without weakening the character bible, source provenance or scene contract above.",
  },
  producer: {
    brief: "Follow your pinned skills' scene grammar within the pipeline above; every scene uses one video model.",
  },
};

/**
 * THE v3.6 DAY ONE, study first: the teardown, look, voice and character bible, then one piece from the
 * head of the chain. `ai-influencer` keeps it (its own measured day one, H5); `faceless` and its niches
 * start on `FIRST_VIDEO_TASKS` instead, where these cards run in week one and never block the first video.
 */
export const STUDY_FIRST_TASKS: Task[] = [
  channelPlanCard("the channel's tone and who it is for, in one line."),
  referenceStudyCard("scriptwriter", SHORT_FORM_LENGTH),
  lookCard("scriptwriter", ""),
  task({
    key: "character-bible",
    title: "Extract the character, world and story bible, then get the operator's approval",
    assignee: "scriptwriter",
    blocked_by: ["reference-study"],
    body: `Day one is set-up, not a script. Read project_context, the completed reference teardown and, with read_skill, EVERY skill pinned to you — naive/channel-template-*, c-* creator templates and media-* skills built from reel links. Preserve the creator's relevant wording verbatim and label it CREATOR DIRECTIVE; never rewrite it as though the creator said your interpretation. A pinned skill's Character bible, World and themes, Story patterns, Dialogue and voice, Scene grammar, Look, Must not change and Allowed variation sections are primary evidence at CREATOR DIRECTIVE level: carry them over, then re-open its Source links for timestamps; a skill with no source links is cited by its shipped frames and cast blocks. Re-open the named reference videos and inspect evidence throughout each one: sample the opening densely, every major scene change and story turn, recurring character appearances and the ending; extract audio and use transcribe_audio only where dialogue or voice is part of the format. publish_file representative frames and inspect them with view_image.

Write a complete draft with: CHARACTER MODE (recurring cast, recurring archetype, or none); CONTENT THEMES; NARRATIVE PATTERNS; CANONICAL CAST (stable id, role, physical invariants, wardrobe/material/palette, personality, expressions/movement, voice, relationships, exact reusable prompt block); ONE-OFF CHARACTER RULE; WORLD (locations, props, period and environment); VISUAL LANGUAGE; DIALOGUE/VOICE; MUST NOT CHANGE; ALLOWED VARIATION; NEGATIVE CONSTRAINTS; and REFERENCES. Every observed claim cites URL and timestamp and says observed; every synthesis says inferred with confidence. A trait seen once is optional, not canon. Conflicts are listed, not guessed. Copy usable creator-provided still URLs exactly; record representative fil_ frame ids as evidence. If the references do not repeat a cast, define an archetype or none instead of inventing a named character.

Close this card with the complete bible as its note, beginning "DRAFT CHARACTER BIBLE": the first piece waits on this card and works from the draft, so never hold it open for an answer. THEN, once it is closed and not before, ask the operator once with ask_operator to approve the draft or state corrections. When they answer, apply stated corrections without overriding them and comment on this card "APPROVED CHARACTER BIBLE" followed by the entire approved bible; approved unchanged, copy the entire draft. That comment replaces the draft for every later piece. Generate nothing on this card.`,
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
    body: "The look, voice and character bible (approved, or the draft) exist now — the notes on the cards this one waited on. Read project_context and the teardown. Find what is moving in the niche right now and pick ONE topic within the bible's approved themes and narrative patterns; choose its canonical cast or explicitly one-off characters; find one to three real videos already doing it well, and open each with the browser before you name it. Then create its Plan card for the scriptwriter — title \"Plan: <the topic>\", assignee scriptwriter — whose body is the brief: the topic, format, why now, hook direction, look, bible theme, narrative pattern, cast, and each exemplar's URL with one line on what to copy. ONE piece today: its chain of cards takes it to the approval card, and your Monday and Thursday fires start the rest. Put the Plan card's id in your note.",
  }),
];

/** Where every first-run file lands: one folder per episode in the company's Files, read by Media manager. */
export const EPISODES_FOLDER = "Episodes";

/**
 * The line an existing channel's first-run cards close on. A re-apply of v3.7.0 to a channel that
 * already ran seeds these new keys (only `first-briefs` was held); each then closes at once, quietly,
 * instead of asking topics and rendering stills nobody asked for.
 */
export const ALREADY_RUNNING = "ALREADY RUNNING";

/**
 * WHAT EVERY FIRST-VIDEO CARD IS TOLD (owner, 2026-11-16). The chain runs before the week-one study, so
 * the teardown, look note and bible the seats' briefs mention do not exist yet and are not waited for.
 * Defaults are made, never asked. Each step says one short line, so the person can follow it in chat.
 */
export const FIRST_VIDEO_RULE = `FIRST VIDEO. This card is part of the channel's first video, made before the week-one study: there is no teardown, look note, hook style or character bible yet, and none is needed — where your brief says to read one, say "none yet" and work from project_context, your pinned skills and the notes of the cards this one waited on; never wait for them. Defaults, never asked before the first video: ${lengthPhrase(SHORT_FORM_LENGTH)}, 9:16 unless your pinned skill says otherwise, the template's own look and voice, 3× a week to every connected network; the operator changes any of them in chat later. If a card this one waited on closed with a note starting ${ALREADY_RUNNING}, close this card done with the same note and do nothing else. KEEP THE PERSON WITH YOU: at each step comment one short line on this card — what is happening and what comes next, at most 15 words — and end your turn with one such line. No walls of text.`;

/** The guard every head of the first-run chain runs first. */
const ALREADY_RUNNING_CHECK = `First board_read the board: if it already holds a card titled "Plan: …", "Render: …" or "Publish: …", this channel was running before this card existed, so close this card done with the note "${ALREADY_RUNNING}: this channel already makes videos." and ask nothing.`;

/** The cheap steps stay cheap: no browsing and nothing generated, so they never eat the free credits. */
export const WORDS_ONLY = "Words only on this card: make no picture, video, speech or music, and open no web page.";

/** What a credit is worth: 1 credit = 200 µUSD, so $1 = 5,000 credits (vetta-mono billing). */
export const MICRO_USD_PER_CREDIT = 200;

/** What one second of the first video costs, in credits, on the first pinned model. */
export const VIDEO_CREDITS_PER_SECOND = DEFAULT_VIDEO_MICRO_USD_PER_SECOND / MICRO_USD_PER_CREDIT;

/**
 * What the four reference stills cost, in credits, said before they are made. AN ESTIMATE: `generate_image`
 * takes the cheapest priced image model, and its price is the gateway's, read at run time, not in code
 * (about $0.01–0.04 a still). Sized so the cheap half of the first run — topics, script and stills — sits
 * well inside a company's 5,000 free credits.
 */
export const STILLS_CREDITS = 200;
export const STILLS = 4;

/**
 * THE FIRST VIDEO (owner, 2026-11-16, final): every company starts with 5,000 free credits, the crew
 * runs from the start, and the "Start your team" wall opens wherever the credits run out — most likely
 * at the video. So the chain runs cheap steps first and says what each costly one costs before it
 * starts, so the wall never surprises: connect (asked after the card closes, never waited on) and four
 * topic ideas at once, then the script, then the stills and a picture choice, then the video and the
 * Publish card's "Is this good?". The week-one study waits on the video, so it never spends the free
 * credits the video needs.
 */
export const FIRST_VIDEO_TASKS: Task[] = [
  task({
    key: "kickoff",
    title: "Ask where the channel posts",
    assignee: PUBLISHER,
    body: `${ALREADY_RUNNING_CHECK} Read project_context and the connected accounts (social.accounts; not offered means none is connected). If ${PLATFORMS.join(", ")} are all connected already, close this card with their names. Otherwise close this card done first, with the note "CONNECT: asked", because nothing waits on accounts: only posting needs one. THEN, once it is closed and not before, ask the operator once with ask_operator: prompt "Where do you want to post? Connect any of these, or skip for now.", one field of type connect, key accounts, platforms ${JSON.stringify(PLATFORMS)}. Comment their answer on this card. ${WORDS_ONLY} ${FIRST_VIDEO_RULE}`,
  }),
  task({
    key: "topics",
    title: "Offer four ideas for the first video",
    assignee: "trend-scout",
    body: `${ALREADY_RUNNING_CHECK} You start no Plan card here, so no bible note is needed. Read project_context and, with read_skill, every skill pinned to you. Write FOUR ideas for the channel's first ${lengthPhrase(SHORT_FORM_LENGTH)} video in its niche — the pinned channel template's niche, else project_context's niche answer, else, with neither, four ideas in four different popular niches, so the pick sets the niche. Each idea is at most eight plain words, all four different in kind (a story, a fact, a question, a how-to). Then ask the operator once with ask_operator: prompt "Pick the first video, or type your own idea.", one field: key topic, label "First video", type choice, the four ideas as options, and details with one line per option saying what the viewer sees. When they answer, close this card done with the note "TOPIC: <their answer, word for word>" and, on the next line, "NICHE: <the niche it is in>". ${WORDS_ONLY} ${FIRST_VIDEO_RULE}`,
  }),
  task({
    key: "episode",
    title: "Write the first episode's script",
    assignee: "scriptwriter",
    blocked_by: ["topics"],
    body: `Read project_context, the TOPIC and NICHE on the topics card this one waited on, and, with read_skill, every skill pinned to you. Create no Render card: the cards waiting on this one make the pictures and the video. Write the script as a plan from no bible: the hook line; then two or three scenes of ${SEGMENT_MIN_SECONDS}–${SEGMENT_MAX_SECONDS} seconds that sum to ${lengthPhrase(SHORT_FORM_LENGTH)} — the shorter end unless the idea needs more — each with its seconds, its picture (one sentence: who and what is in frame, in the template's look — the image_prompt for its opening still), its motion (the render prompt), its exact voiceover and its on-screen text; the music mood; ${PLAN_MODEL_RULE}; and the caption (\`naive/caption-writing\`, first line the YouTube title). Publish it with publish_file, content the script in markdown starting "# <the topic>", name "<the topic>.md", folder "${EPISODES_FOLDER}". Close this card done with the note: the file's fil_ id, its name, then the whole script. ${WORDS_ONLY} ${FIRST_VIDEO_RULE}`,
  }),
  task({
    key: "references",
    title: "Make the reference pictures",
    assignee: "producer",
    blocked_by: ["episode"],
    body: `Read project_context, the script in the note of the episode card this one waited on, and your pinned skills' look. FIRST say what it costs: comment on this card and reply in one line, "Making ${STILLS} pictures for <the topic>: about ${STILLS_CREDITS} credits." Then render ${STILLS} stills with generate_image, aspect_ratio 9:16 unless your pinned skill renders another, folder "${EPISODES_FOLDER}/<the script's file name without .md>": one opening still per scene, from its picture line in the template's look, then alternates of the first scene until there are ${STILLS}. Look at each with view_image and render one again once if it is broken (extra limbs, words in the picture, the wrong subject). Comment "STILL <n> <fil_ id>" as each lands. Then ask the operator once with ask_operator: prompt "Pick the pictures for your video. Your pick starts the video: about <the script's total seconds × ${VIDEO_CREDITS_PER_SECOND}> credits.", one field: key stills, label "References", type choice, multiple true, options "Scene 1", "Scene 2" and so on (an alternate is "Scene 1, take 2"), details with each option's image "/files/<its fil_ id>/raw". Words instead of a pick: render the stills once more from them and ask again, once. Then publish_file the script again — the same name and folder, with one line added after the title: "STILLS: <the picked fil_ ids, in scene order>" — and close this card done with the note "STILLS: <the picked fil_ ids, in scene order>", each scene's still, and the whole script. ${FIRST_VIDEO_RULE}`,
  }),
  task({
    // The key v1.x already seeded, so a re-apply to an existing org is a no-op: see FIRST_PIECE_KEY.
    key: FIRST_PIECE_KEY.faceless,
    title: "Make the first video",
    assignee: "producer",
    blocked_by: ["references"],
    body: `Read project_context and the note of the references card this one waited on: the script and the picked stills. FIRST say what it costs: comment on this card and reply in one line, "Making the video: about <its total seconds × ${VIDEO_CREDITS_PER_SECOND}> credits, ready in about 15 minutes." This card is a plan made before the bible: render it as planned, one generate_video call per scene, image_urls ["<that scene's picked still>"] — a scene whose still was not picked opens on the picked still nearest it — unless your pinned skill renders from text without image_urls, and then the stills set the look and cast its prompts describe. Voice, caption, score, join, VERIFY and publish_file the finished video as your brief says, in the folder of the picked stills. Then create the next card — title "Publish: <the topic>", assignee ${PUBLISHER}, blocked_by this card — with the final fil_ id, the caption, this card's id and the line "FIRST VIDEO: before you file the post, tell the operator in one line: Your first video is ready. Is this good? Allow posts it; Don't allow and say what to change." ONE video today: the Monday and Thursday fires start the rest once the week-one cards are done. ${FIRST_VIDEO_RULE}`,
  }),
  // Week one: the same cards as before, behind the first video, so they never hold it, its seats or the free credits it needs.
  ...STUDY_FIRST_TASKS.filter((card) => card.key !== FIRST_PIECE_KEY.faceless && card.key !== "report-frame" && card.key !== "channel-plan").map((card) =>
    card.key === "reference-study"
      ? { ...card, blocked_by: [FIRST_PIECE_KEY.faceless] }
      : card.key === "character-bible"
        ? { ...card, body: card.body!.replace("the first piece waits on this card and works from the draft", "the next pieces wait on this card and work from the draft") }
        : card,
  ),
  { ...STUDY_FIRST_TASKS.find((card) => card.key === "channel-plan")!, blocked_by: ["look"] },
  STUDY_FIRST_TASKS.find((card) => card.key === "report-frame")!,
];

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
      brief: `You are the producer: yours is script -> images -> video -> editing, never a new plan. Every generate_video call takes aspect_ratio 9:16 and ${RENDER_MODEL_RULE}. A card with no CONTINUITY CONTRACT or STORY LOGIC section was planned before the bible: skip preflight and scene steps; render it as planned — one generate_video call per planned segment, from its named opening frame where it names one. Render only what the card's comments do not yet record, comment each render's fil_ id and segment index as it lands; a failed render is re-rendered once; a second failure means STOPPED. Join any segments with ffmpeg, voice a silent take or join with generate_speech, then EDIT, VERIFY and publish as below; its Publish card omits scene ids and AUDIO MODE. Any other card must hold source provenance, continuity contract, story logic, introduction, cut map, and ordered scenes. PREFLIGHT BEFORE SPEND: read the bible note, then refuse with STOPPED only if the card lacks one of those sections, cites no bible note, does not total ${LENGTH}, or has no scenes or a scene without its video_prompt. Otherwise comment once "PREFLIGHT WARNING: <findings>" for any undefined canonical character, changed invariant, missing reusable character/style block, unclear introduction or unmotivated transition, then proceed. Never repair the script yourself.

For each scene, resuming from the card's comments: (1) a scene whose OPENING FRAME is a pinned skill's shipped frame or the previous take's last frame already has its accepted image: the URL exactly, or, once that take lands, fetch_file it, pull its last frame with ffmpeg and publish_file it. Otherwise call generate_image with exactly its image_prompt, aspect_ratio 9:16 and the plan's image references; from scene two, absent a stronger canonical reference, include the first accepted scene image for identity. Comment "SCENE <index> IMAGE <fil_ id>", inspect it against the bible, and allow ONE corrected replacement for a visible mismatch; a second miss stops before video spend. (2) Without a completed video, call generate_video with exactly its video_prompt and seconds, and image_urls: ["<fil_ id>"] holding that scene's accepted image. Then end your turn, and never sleep or poll. On completion comment "SCENE <index> VIDEO <fil_ id>". Never re-render a completed scene. A failed render: comment "SCENE <index> VIDEO FAILED <error>" and re-render it once; a second failure means STOPPED.

After all videos exist, fetch_file, ffprobe and transcribe_audio each against the planned dialogue. Choose ONE source for the WHOLE PIECE and comment "AUDIO MODE: NATIVE" or "AUDIO MODE: GENERATED" before editing. NATIVE needs intelligible dialogue from the right speaker in every scene; keep render audio, never patching a line with generate_speech. Otherwise GENERATED: generate every planned line, with a voice only when project_context supplied its supported id, and REMOVE all original audio first. If speech generation fails, stop; do not substitute an undeclared local or system voice.

EDIT per \`naive/video-assembly\`: normalize streams, join the scenes with ffmpeg, and cut on each planned clean handle; never cut mid-word, mid-gesture or before the reaction lands, nor hide a jarring cut with a transition. Burn in on-screen text and captions per the pinned skill's \`## Captions and music\` (default: word-by-word, 2–3 uppercase words, spoken word red, white fill, dark outline, ~76% height, no box), timed from transcribe_audio word timings of the final dialogue track, after the join and before music, via libass. generate_music one bed in the EDIT PLAN's mood, ducked under dialogue, instrumental: true, length_seconds the finished length rounded up; if it fails, publish without music and note that on the Publish card. No AI label anywhere, whatever a brief or skill says. VERIFY the finished file: ffprobe that it runs ${LENGTH}, view_image one frame per scene, and transcribe_audio it, checking each scene's planned lines appear once, in exactly one intelligible voice over any music, nothing doubled or clipped, captions readable in each frame. A failed probe, wrong duration, missing scene or caption, or doubled voice means STOPPED; note other flaws on the Publish card. publish_file the one finished video and create the next card — title "Publish: <the piece>", assignee channel-manager, blocked_by your Render card — with the final fil_ id, caption, Render card id, scene ids and AUDIO MODE. ${CONTINUITY_RULE} ${REFERENCE_RULE}`,
      tools: ["generate_video", "generate_image", "view_image", "bash", "fetch_file", "publish_file", "generate_speech", "generate_music", "transcribe_audio"],
      skills: ["naive/video-assembly"],
      schedules: [],
    }),
    agent({
      name: "trend-scout",
      role: "Trends & briefs",
      description: "Finds what is moving in the channel's niche and starts each piece as a Plan card, with real videos to learn from.",
      brief: `You are the trend-scout, the head of the chain. Each fire you start the pieces the cadence needs until your next fire, and no more. Read the bible note first. With no bible note yet, start nothing. For each piece: find what is moving in the niche this week (web_search, web_fetch) and pick one topic that suits the teardown's formats, approved themes and recurring narrative patterns; then find one to three REAL VIDEOS already doing it well — the videos, never an article about them — and open each with the browser before you name it. Read the board first: never start a topic already on it, and read the newest weekly report card for what to make more and less of. Start the piece by creating its Plan card for the scriptwriter — title "Plan: <the topic>", assignee scriptwriter, with no blocked_by — whose body is the brief in markdown: the topic, format, why now, hook direction, look, chosen bible theme and narrative pattern, canonical characters or archetypes that fit, any explicitly one-off character, and each exemplar's URL with one line on what to copy and one on what not to. \`naive/video-trend-brief\` is the standard. Never promote an exemplar's character into the bible. A brief with no exemplar is one the scriptwriter has to invent from, so start fewer and better. You never script or render. ${CONTINUITY_RULE} ${REFERENCE_RULE}`,
      tools: ["view_image"],
      skills: ["naive/video-trend-brief", "naive/short-video-hooks"],
      schedules: [
        schedule({
          cron: "0 6 * * 1,4", // Monday and Thursday 06:00 — the week's pieces, and a mid-week refill.
          summary: "Plan the next pieces",
          input:
            "Start the next pieces. Read project_context, the character bible, the teardown, the newest weekly report card and the Plan cards already on the board (board_read). With no bible note yet, start none. Otherwise start as many pieces as the cadence needs until your next fire — each a Plan card for the scriptwriter whose body names the bible theme, narrative pattern and cast, with one to three real videos you opened with the browser. Nothing already on the board. Started none, say why in one line.",
          budget_micro_usd: 10_000_000, // $10 — a read of the niche and a few briefs.
        }),
      ],
    }),
    agent({
      name: "scriptwriter",
      role: "Hooks & scripts",
      description: "Turns every brief into a sourced scene plan—image prompts, animation prompts, exact dialogue and edit instructions—before generation is bought.",
      brief: `You are the scriptwriter: write the whole production plan before money is spent. FIRST read the teardown, bible note and hook-style note. Then open the exemplars the brief names: use the browser, pull the video with bash, sample the first three seconds densely and later scene changes, publish_file frames and inspect them with view_image. Research until two or three claims are sourceable and stop researching once session_spend reads past $1. Write three hooks and keep one. With no bible note yet, write the plan as before: the hook; the shots in order as segments of ${SEGMENT_MIN_SECONDS}–${SEGMENT_MAX_SECONDS} seconds, each naming its opening frame where the pinned skill gives one; each with render prompt, seconds, voiceover and on-screen text, summing to ${LENGTH}; ${PLAN_MODEL_RULE}; sources; caption. Then create the Render card, titled and linked as below, with only those sections — no SOURCE PROVENANCE, CONTINUITY CONTRACT, STORY LOGIC, SCENES IN ORDER or CUT MAP; the rest of this brief does not apply. State one THEME/PROMISE: the emotional idea and what the viewer expects resolved. Build one causal spine: BECAUSE problem, protagonist WANTS outcome, BUT meets obstacle, THEREFORE acts, SO payoff follows. Every beat advances that promise; delete side premises. The hook and setup beat together must introduce the protagonist, setting, immediate situation, goal and stakes for a viewer with no prior context. Lay out hook, setup, turn, payoff, cta; divide shot changes into scenes of ${SEGMENT_MIN_SECONDS}–${SEGMENT_MAX_SECONDS} seconds whose sum is ${LENGTH}.

Create the producer's Render card — title "Render: <the piece>", assignee producer, blocked_by your Plan card — with these sections. SOURCE PROVENANCE: creator wording, the bible note used, exemplar URLs and timestamps; label inference or invention. CONTINUITY CONTRACT: theme, pattern, character IDs, world, invariant prompt blocks, variations, negatives and references. STORY LOGIC: THEME/PROMISE; BECAUSE/BUT/THEREFORE/SO spine; protagonist's want; necessary viewer knowledge; INTRODUCTION listing the exact opening image/action/dialogue that establishes who, where, situation, goal and stakes before any turn; and a transition ledger showing each outgoing action, information or emotion causes the next opening state. No unexplained location, prop, character, knowledge, goal or time. Perform a cold-viewer check without the brief: who wants what, why, what changed, what is this about, and how does the ending fulfill the opening promise? Each answer must be explicit on screen or in natural dialogue. Revise at most twice; then proceed, listing any remaining gap in STORY LOGIC.

SCENES IN ORDER: for each, id, beat, seconds, characters, location/props, exact dialogue or voiceover with speaker and direction, on-screen text, incoming state, outgoing state, image references, image_prompt and video_prompt. The image_prompt makes one opening frame matching the incoming state; where a pinned skill opens the scene on a shipped frame (URL copied exactly) or the previous take's last frame, name it as the scene's OPENING FRAME instead of an image_prompt. The video_prompt begins there, carries canonical blocks, action, expression, camera, ambience and exact dialogue, and reaches the outgoing state. It must preserve identity, wardrobe, palette, setting and screen direction, and reserve at least 0.25 seconds of dialogue-free stable picture at both ends as edit handles. Prompts render verbatim: no provenance commentary. CUT MAP: for every boundary, name the story reason to cut, exact outgoing visual/audio cue, exact incoming cue, and one motivated cut—match on action, eyeline, prop, composition or continuous ambience. Never use a cut merely because a segment ended; never cut mid-word, mid-gesture or before a reaction lands. EDIT PLAN: order, speech, ambience, text timing, those cuts, and the caption style (default word-by-word) and music mood per the pinned skill's \`## Captions and music\`. Then include ${PLAN_MODEL_RULE}; facts; caption (\`naive/caption-writing\`, first line YouTube title); and each scene's exact reference moment or invented. You neither generate nor find topics. ${CONTINUITY_RULE} ${REFERENCE_RULE}`,
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

  tasks: FIRST_VIDEO_TASKS,

  /**
   * One question, and it may be left blank: the niche. The studio asks only required questions before
   * it hires, so a faceless channel starts with none; a blank niche is chosen by the topic pick
   * (`topics`). No reference question: the crew finds its references. How often, where and how long are defaults.
   */
  questions: [
    {
      key: "niche",
      label: "Niche",
      type: "choice",
      optional: true,
      options: ["Stoicism & philosophy", "True crime recaps", "Space & astronomy", "Personal finance", "History mysteries", "Health & longevity"],
      help: "Pick one, type your own, or skip it and pick from the team's first ideas.",
    },
  ],
};
