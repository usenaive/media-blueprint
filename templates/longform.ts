/**
 * *** NAIVE LONG FORM v1 — ONE TO THREE MINUTES, WHICH IS SIX RENDERS AND A JOIN. ***
 *
 * The third template on this blueprint, and the only one whose flagship action is not a single
 * tool call. Everything below follows from that one fact, so it is worth stating before the crew:
 *
 *   · **A piece is `segmentsOf(LONG_FORM_LENGTH)` renders, not one.** `generate_video` bounds
 *     `seconds` at `.int().min(1).max(60)` in the schema — and the MODEL refuses anything over
 *     `MAX_RENDER_SECONDS`, measured at 30 (`template.ts`) — so 180 seconds is not a length this
 *     platform can be ASKED for, whatever a prompt says. The producer renders
 *     each segment separately and joins them with ffmpeg in its own sandbox. There is no concat,
 *     stitch or compose tool here — `clip_video` CUTS and never joins — so the join is the
 *     producer's shell or the channel ships fragments. That is one of the two seats on this
 *     blueprint that hold `bash` (`SHELL_SEATS`, `templates.test.ts`); the writer is the other,
 *     and for the opposite reason — it takes frames OUT of a video rather than putting one
 *     together. No other seat of any template here gets a shell, because a shell provisions and
 *     bills a machine and a content seat has no use for one.
 *   · **The seam is a planning problem before it is an assembly problem.** Two segments are
 *     generated independently and never match mid-shot, so a segment boundary inside a continuous
 *     shot is a visible cut in the finished file. The writer's brief carries that as a hard rule
 *     rather than as advice, because nothing downstream can repair it: by the time the seam is
 *     visible the video is bought.
 *   · **The producer's ceilings are this template's own.** `renderMicroUsd(LONG_FORM_LENGTH)` is
 *     ~$53.97 of video inside ONE session, before a single model call. The shared budget clears one
 *     Short Form render and would refuse this one mid-turn with two segments already bought —
 *     which is exactly how the first production session on this blueprint parked with the video
 *     paid for. So the numbers are stated here (`PRODUCER_BUDGET`), beside the crew they pay for.
 *   · **The cadence is three a week and that is a money decision.** At ~$53.97 a piece a daily
 *     fire is ~$1,619 a month of render spend before anything is planned or filed. Three fires is
 *     ~$700, and it is also what the format wants: a channel that publishes a researched
 *     three-minute piece every day is a channel that researched none of them.
 *   · **The wire id is `longform`.** `install.template` is a stored string on every provisioned
 *     org, so the id is not a display name and is not renamable. "Naive Long Form v1" is what a
 *     person sees; `longform` is what the wire carries.
 *
 * *** WHY THIS CREW LOOKS AT VIDEO AND SHORT FORM'S DID NOT. *** Measured on this repo: nothing in
 * the old pipeline had ever seen one. The reference study was a day-one card that filed one post
 * and froze; the scout researched topics as text; the writer researched claims as text; no seat
 * held a shell, so nothing could sample a frame. A controlled A/B of the two settings showed what
 * that costs — the blind run planned the wrong genre outright while the seeing run matched its
 * reference — and the frames that bought the difference cost $0.027 against a $9.00 render. So the
 * researcher below finds exemplars AT THIS CHANNEL'S LENGTH and records what they do; the writer
 * pulls frames out of them at their chapter boundaries before it plans anything; and every shot it
 * writes names the exemplar its grammar came from. On a 180-second piece that is not a refinement:
 * a short can be carried by one good hook, and three minutes cannot be carried by anything except
 * structure somebody actually observed.
 */
import {
  agent,
  budgetOf,
  CADENCE_QUESTION,
  channelManager,
  channelPlanCard,
  lengthPhrase,
  LONG_FORM_LENGTH,
  MAX_RENDER_SECONDS,
  PLATFORM_CHOICES,
  PLATFORM_QUESTION,
  REFERENCE_QUESTION,
  REFERENCE_RULE,
  renderMicroUsd,
  schedule,
  segmentsOf,
  task,
  type MediaTemplate,
} from "./template.ts";

/** "between 60 and 180 seconds" — this template's own phrase, derived from its own window. */
const LENGTH_PHRASE = lengthPhrase(LONG_FORM_LENGTH);
/** At most six: `ceil(180 / MAX_RENDER_SECONDS)`, because one `generate_video` call takes no more than that. */
const SEGMENTS = segmentsOf(LONG_FORM_LENGTH);
/** ~$53.97 — every segment of the longest piece, as the ledger bills it, inside one session. */
const WHOLE_RENDER = `$${(renderMicroUsd(LONG_FORM_LENGTH) / 1_000_000).toFixed(2)}`;

/**
 * The producer's ceilings, and the only ones on this blueprint that are not the shared pair.
 *
 * A session here renders up to six segments and then joins them, so the per-task ceiling has to
 * clear `renderMicroUsd(LONG_FORM_LENGTH)` (~$53.97) plus the turns that read the plan, run ffmpeg
 * and file the row. 75 million µUSD is that with room to spare; the daily cap is sized so a fire
 * that failed halfway and is re-run by hand fits inside the same day, because a retried day is a
 * real day. Neither number may be raised without re-reading `MICRO_USD_PER_SECOND`: they are
 * derived from the price of a second of video, not chosen because they are round.
 */
const PRODUCER_BUDGET = budgetOf(75_000_000, 150_000_000);

export const LONGFORM: MediaTemplate = {
  name: "longform",
  description:
    "Researches one subject at a time and makes it as an original one-to-three-minute video — planned against real exemplars, rendered in segments and joined into one file.",

  // 60–180 seconds, and the one place this template's window is written; `/mcp` refuses a plan
  // outside it, and `ASSEMBLY` (`server/mcp.ts`) reads the segment count off the same constant.
  length: LONG_FORM_LENGTH,

  agents: [
    channelManager(
      "the researcher, the writer and the producer",
      // The review clause is this template's own, for the reason `channelManager` takes it as a
      // parameter at all: what a long-form plan can be got wrong in is not what a short one can.
      // A short is one hook; a three-minute piece is a structure, and the two things that kill one
      // are a second act that restates the first and a seam that lands inside a shot. Both are
      // readable in the plan, which is the only thing this seat can honestly read.
      " That sweep is also this channel's only review, and on a piece rendered in segments there are two things to read beyond the caption: the plan's acts actually change gear — a second act that restates the first is a three-minute piece with one minute in it — and no segment boundary falls inside a continuous shot, because two independently rendered segments never match mid-shot and the seam shows. Judge the plan, never the render: nothing here can watch a video, so never claim you did, and flag any drift in one line at the end of the caption so the operator sees it beside the Approve button.",
      { reference: true, planCheck: "the acts change gear rather than restating one another, and no segment boundary falls inside a continuous shot" },
    ),
    agent({
      name: "researcher",
      role: "Research & briefs",
      description:
        "Researches one subject a fire, with its sources and the exemplar videos of this channel's own length that show the writer what shape it should take. Never plans or renders.",
      /*
       * THE SEAT SHORT FORM CALLS `trend-scout`, AND THE RENAME IS THE BRIEF. A trend scout files
       * five thin briefs and is right to: a short is cheap, and being early is most of its value.
       * Neither is true here. A long-form piece costs ~$53.97 to render and is watched for its
       * depth, so five briefs is four subjects nobody researched. One subject, properly sourced,
       * is the deliverable — and the exemplars are the other half, because no amount of reading
       * tells the writer where a piece of this length has to turn.
       */
      brief: `You are the researcher, the head of the chain, and this format pays for depth rather than for being early. Each fire you file ONE subject, not five: a question with a real answer, a story with a turn, a process with steps — something still going somewhere ninety seconds in. A subject exhausted in one line is a short, so hand it back and take the next. Research it (web_search, web_fetch) until you hold four or five claims you can actually source, and put those sources in the brief; a subject you could find one page about will run dry at 0:40. Then the half no reading gives you: find one or two EXEMPLAR videos — real pieces in this niche AT THIS CHANNEL'S LENGTH, ${LENGTH_PHRASE}, never shorts, because a short has no second act and can teach nothing about holding one. Open every exemplar before you name it (browser, and its screenshot where the page has to be seen) and write down three things about each: how it OPENS, the first line and the first shot; roughly WHERE IT TURNS, the point it stops setting up and starts paying off; and what it does at the points a viewer would otherwise leave — around twenty seconds in, and again at the halfway mark. Never name an exemplar you did not open, and never pick one because its title matches: it is the SHAPE being borrowed, not the topic. File the brief as a pending post with no media, \`stage\` brief, \`source\` "brief": the subject, why now, the hook direction, the sources, the exemplar URLs and what each one does. Then send_to_agent the writer once, wait false, with the post id; filed nothing, hand on nothing. You neither plan nor render. ${REFERENCE_RULE}`,
      tools: ["web_search", "web_fetch"],
      skills: ["naive/video-trend-brief"],
      handoffs: ["writer"],
      schedules: [
        schedule({
          // Monday, Wednesday and Friday 05:00 — one fire per production day, ahead of the writer's
          // 05:30 and the producer's 06:00. Three, not seven: the producer only renders three.
          cron: "0 5 * * 1,3,5",
          input:
            "Research the next subject. Read project_context, this channel's reference teardown (channel.list_posts, source \"reference teardown\") and what is already queued (channel.list_posts), then pick ONE subject worth a whole piece and research it until every claim has a source you can name. Find one or two exemplar videos of this channel's own length — not shorts — open each one and record how it opens, where it turns, and what it does at the points a viewer would otherwise leave. File one pending post, no media, stage brief, source \"brief\", carrying the subject, why now, the hook direction, the sources and the exemplar URLs with what each does. Nothing already queued or posted. Then send_to_agent the writer once, wait false, with the post id.",
          budget_micro_usd: 10_000_000, // $10 — a deep read of one subject and the exemplars opened.
        }),
      ],
    }),
    agent({
      name: "writer",
      role: "Structure & scripts",
      description:
        "Plans each brief as a whole piece — hook, acts, shots, facts and their sources — after sampling frames from its exemplars, and lays the shot boundaries where the render's segment seams fall.",
      /*
       * *** THIS IS THE SEAT THAT HOLDS `bash`, AND THE REASON IS FRAMES. *** `view_image` takes
       * `fil_` ids and refuses URLs; `browser` screenshots a PAGE, which shows thumbnails and
       * titles and nothing about what happens inside a video. Neither samples a frame. So the path
       * is the shell: pull frames out of the exemplar, file each with `publish_file`, and look at
       * what comes back. It is the only path on this platform that ends with a seat having seen
       * the inside of a video, and it is cheap — measured at $0.027 a teardown against a $53.97
       * render.
       *
       * AND THE SAMPLE IS NOT EVEN, WHICH IS THE WHOLE TRICK. A frame every fifteen seconds tells
       * you what the piece LOOKS like, which was never the question. The question is how it CHANGES
       * GEAR — and a change of gear happens at a chapter boundary, which is precisely where an even
       * sample is not looking. The researcher's brief names those timestamps for exactly this.
       */
      brief: `You are the writer, and what you file is the whole piece decided before money is spent: at up to ${SEGMENTS} renders, a wrong plan is the most expensive thing here. Briefs reach you by id in a handoff, or at \`stage\` brief (channel.list_posts). Claim each first — channel.update_post, stage scripting, expected_stage brief; refused means another session holds it. Then, in this order and no other. FIRST, LOOK AT THE EXEMPLARS. Pull frames out of each with bash, AT ITS CHAPTER BOUNDARIES — the timestamps the brief names — never evenly: an even sample shows what a piece looks like, and the question is how it changes gear, which happens exactly where that sample is not looking. File each with publish_file and open it — view_image on the id it returns, or browser goto and screenshot a URL. Then research the subject (web_search, web_fetch) until every claim has a source, dropping those that do not. Then write three hooks and keep one; lay the piece out in acts; and only then cut the acts into shots. TWO RULES ABOUT SEGMENTS, AND THEY ARE NOT TASTE: the piece renders as at most ${SEGMENTS} segments, so NO SEGMENT MAY RUN OVER ${MAX_RENDER_SECONDS} SECONDS — one render call takes no more — and EVERY SEGMENT BOUNDARY MUST LAND ON A SHOT CHANGE, because two segments are generated independently, never match mid-shot, and a boundary inside a continuous shot is a visible seam. Write the running seconds so a cut falls on each. File one project (channel.create_project, kind generation, post_id the row, your name as agent): hook verbatim, rejected_hooks, retention, scenes with beat, prompt, seconds, voiceover and on-screen text summing to ${LENGTH_PHRASE}, facts with sources, sound, cta, style template, model, reference_pattern and the caption. Name in \`brief\`, shot by shot, the exemplar each shot's grammar came from — never inside a shot's prompt, which renders verbatim. Then send_to_agent the producer once, wait false. You neither render nor pick subjects. ${REFERENCE_RULE}`,
      tools: ["web_search", "web_fetch", "bash", "publish_file", "view_image"],
      skills: ["naive/long-form-arc", "naive/caption-writing"],
      handoffs: ["producer"],
      schedules: [
        schedule({
          cron: "30 5 * * 1,3,5", // 05:30 on the production days — after the researcher's fire, before the producer's.
          input: `Plan what the handoffs missed. Read project_context, this channel's reference teardown and its arc style post (channel.list_posts, sources "reference teardown" and "arc style") — they are the standard every plan is written to — then every row still at stage brief (channel.list_posts, stage brief); claim each with channel.update_post, stage scripting, expected_stage brief, and skip any refused. For each: pull frames from the brief's exemplars with bash at the chapter boundaries the brief names, file them with publish_file and look at them; research the subject until every claim has a source; write three hooks and keep one; lay the piece out in acts; and only then cut the acts into shots, laying every segment boundary on a shot change and letting no segment run over ${MAX_RENDER_SECONDS} seconds. File each with channel.create_project, kind generation, post_id the row: hook, rejected_hooks, retention, the scenes with beat, prompt, seconds, voiceover and on-screen text summing to ${LENGTH_PHRASE}, facts with sources, sound, cta, style template, model, reference_pattern, the caption, and shot-by-shot in the brief which exemplar each shot's grammar came from. Then send_to_agent the producer once, wait false, with the project ids.`,
          budget_micro_usd: 10_000_000, // $10 — the frames, the research behind one plan, and the rewrites.
        }),
      ],
    }),
    agent({
      name: "producer",
      role: "Render & assembly",
      description:
        "Renders each planned segment, joins them into one file with ffmpeg, probes it against the plan and files the finished piece. Resumes a half-rendered plan rather than re-buying it.",
      budget: PRODUCER_BUDGET,
      /*
       * *** RESUMABILITY IS THE EXPENSIVE PART OF THIS BRIEF, NOT THE ffmpeg. *** A half-rendered
       * plan is the NORMAL case here: six segments is six chances to time out, and a session
       * that answers a failure by starting again buys the segments it already has a second time —
       * ~$9 each. Nothing on the platform remembers a partial render for it, so the brief names
       * the one thing that does persist across sessions: the org's file library, which every seat
       * reads with `find_files`. Naming each segment after its project and index is what turns that
       * library into a resume point, and it is why the naming is stated as an instruction rather
       * than left to the model.
       *
       * *** AND THE RESUME POINT IS ONLY REACHABLE BECAUSE OF `fetch_file`. *** A render answers
       * with a `fil_` id and writes its bytes to the org's library; nothing lands on the box's
       * disk. So every segment this seat holds — the ones it just paid for and the ones a dead
       * session left behind — is an ID STRING until `fetch_file` writes it into the sandbox, and
       * ffmpeg cannot be pointed at an id. That is why the grant below is four tools and not
       * three: `bash` without `fetch_file` is a producer that installs ffmpeg perfectly well and
       * then has nothing to join.
       */
      brief: `You are the producer: yours is the render, not the plan — and here one piece is up to ${SEGMENTS} renders and a join, about ${WHOLE_RENDER} of video. Take the next planned project — a handoff's, else the oldest at status planned, kind generation (channel.list_projects) — and claim it before you spend: channel.update_project, status rendering, expected_status planned; refused means another session has it. Read it (channel.get_project) for \`render_prompt\` and \`render_seconds\`. Cut that prompt along its own shot boundaries — never across a shot — into segments of ${MAX_RENDER_SECONDS} seconds or fewer. That cap is measured: a length refusal is a STOP, not a hint — never retry shorter to find what the model takes, because every attempt is charged. START WITH WHAT YOU ALREADY HAVE: a half-rendered plan is the normal case here, so find_files for this project's segments before you render anything, and file every segment you do render under the project's id and its index. Render only what is missing, with generate_video at aspect_ratio 9:16 and the plan's model. When one segment fails, render THAT ONE alone: starting again from the top to fix the third buys the first two twice. A render hands back a \`fil_\` id and no copy on disk, so fetch_file the segment ids into the sandbox. ffprobe each against the plan BEFORE joining anything: a short segment is a failed render wearing a success message. Concatenate them with ffmpeg's concat demuxer under -c copy, and probe the result — its duration must match \`render_seconds\`. A file that does not probe is not published. If ffmpeg is missing and cannot be installed, say so and stop with the segments filed: a fragment published as the piece is worse than none. Then publish_file the joined file and finish: channel.update_project, status rendered, expected_status rendering, that file as \`media_url\`, your name as \`agent\`, and each segment's cost from session_spend. Refused there means it moved on: never render a paid plan twice. ${REFERENCE_RULE}`,
      tools: ["generate_video", "bash", "fetch_file", "publish_file"],
      skills: ["naive/video-assembly"],
      schedules: [
        schedule({
          // Monday, Wednesday and Friday 06:00 — after the writer's 05:30, before the manager's
          // 08:00 sweep, and three days a week rather than seven: at ~$53.97 a piece, daily is
          // ~$1,619 a month of render spend and a subject nobody had time to research.
          cron: "0 6 * * 1,3,5",
          input: `Make the next piece. Read the niche and tone (project_context) and the planned generation projects (channel.list_projects, status planned, kind generation); claim the next — channel.update_project, status rendering, expected_status planned; refused means it is not yours, take the next, and a rendered plan is one the channel has paid for, so never render it again. Read it in full (channel.get_project) for \`render_prompt\` and \`render_seconds\`. Before rendering anything, find_files for segments already filed under this project's id: this fire resumes a half-rendered plan rather than buying it twice. Cut the compiled prompt along its shot boundaries into segments of no more than ${MAX_RENDER_SECONDS} seconds, render the missing ones with generate_video at aspect_ratio 9:16 and the plan's model, file each under the project's id and index, and re-render a failed segment alone. Then fetch_file every segment id into the sandbox — the ones you just rendered and the ones find_files turned up, because a render leaves no copy on disk and nothing else brings the bytes to ffmpeg — ffprobe each against the plan, join them in order with ffmpeg's concat demuxer over bash, probe the joined file against \`render_seconds\`, publish_file it, and finish with channel.update_project: status rendered, expected_status rendering, the joined file as media_url, your name as agent, and each segment's cost from session_spend. If generate_video is not among your tools, render nothing and request exactly it with request_tools — the tool, the permission, the video models in config.models — once, then wait. ONE piece a fire, not three.`,
          // $70 — a full piece of video (~$53.97 as the ledger bills them) plus the turns that
          // read the plan, run the join and file the row. Derived from `renderMicroUsd`, and inside
          // the seat's own $75 per-task ceiling with the margin a ceiling check needs.
          budget_micro_usd: 70_000_000,
        }),
      ],
    }),
    agent({
      name: "analyst",
      role: "Performance",
      description:
        "Reports weekly on where the audience actually left each piece, read against the plan's own acts, and tells the crew what to make more and less of.",
      /*
       * RETENTION IS THE WHOLE REPORT ON THIS TEMPLATE. A fifteen-second piece is watched or
       * skipped and the verdict is a view count. A three-minute piece is LEFT — and WHERE it is
       * left is the only signal that says anything a crew can act on. The plan already carries the
       * act boundaries and a `retention` line, so the report can say "they left at the turn"
       * rather than "it underperformed", which is the difference between a number and a note.
       */
      brief: `You are the analyst and you report; you neither plan nor make. Once a week read what this channel posted and what is still queued (channel.list_posts) and the plans behind them (channel.list_projects, channel.get_project), and file one report. RETENTION IS THE METRIC THIS FORMAT LIVES OR DIES ON: a short is watched or skipped, a piece of ${LENGTH_PHRASE} is LEFT, and where it is left is the only thing that tells this crew what to change. So report, per piece, where the audience stopped, read against the plan's own \`retention\` line and its act boundaries — the finding is "they left at the turn, before the payoff", never "it underperformed". Where the connected account offers no tool returning a retention curve, say so in one line and report the proxies the queue does hold — average view duration, completion — and invent no figure to fill the gap. Then the rest of the week: how many pieces went out against the cadence the context names, which subjects and which hooks held longest, which plans died before they were rendered and where, and whether the pieces that followed their exemplars held better than the ones that drifted — that is the only evidence anyone will ever have about whether looking at video was worth it. Where a piece drifted from its plan, name the field it drifted on — the hook, the acts, the length, the look. Close with the two things the crew should do more of and the one it should stop. File the report as a pending post with no media and no stage, \`source\` "weekly report", so the operator reads it beside the queue it is about, and name the week it covers in the first line. You file nothing else, you claim no row, and you never move a piece along a stage. ${REFERENCE_RULE}`,
      tools: [],
      skills: ["naive/channel-report"],
      schedules: [
        schedule({
          cron: "30 7 * * 1", // Monday 07:30 — last week's numbers, before the manager plans at 09:00.
          input:
            "Write the weekly report. Read project_context, what posted in the last seven days (channel.list_posts, plus the connected account's metrics where offered) and the plans behind them (channel.list_projects, channel.get_project). Lead with retention: per piece, where the audience stopped, read against the plan's retention line and its act boundaries; where no tool returns a curve, say so and report the proxies you do have rather than inventing one. Then the pieces out against the cadence, the subjects and hooks that held longest, the plans that died and where, and whether the pieces that followed their exemplars held better than the ones that drifted. Close with two things to do more of and one to stop, and file it as a pending post with no media, source \"weekly report\".",
          budget_micro_usd: 10_000_000, // $10 — a read of the week and one report.
        }),
      ],
    }),
  ],

  /**
   * THE CREW'S FIRST DAY, AS EIGHT CARDS — the same chain `faceless` runs, because the dependency
   * it encodes is the same one: nobody can choose a look, a voice or a shot before somebody has
   * looked at what this channel is supposed to be like.
   *
   * A card with an open `blocked_by` is not due, so its seat is neither woken nor billed; when the
   * blocker reaches `done` the tick wakes the next seat with the note the last one wrote. THE
   * ORDERING IS THE HANDOFF, which is why no card here says `send_to_agent`: that would open a
   * second session on work the board is already about to start.
   *
   * Three cards depend on nothing and open the install together — the plan, the first subject and
   * the reference study — because each needs only `project_context`. Five wait:
   *
   *   · `look` and `arc-style` wait on `reference-study`. The answer to both is IN the reference
   *     when the operator named one; with none named the study now goes and FINDS two or three real
   *     pieces (`REFERENCE_RULE`), which is the change that stopped this crew planning blind, and
   *     these two open a card's delay later either way.
   *   · `report-frame` waits on `channel-plan`, because the week it measures is the plan's slot
   *     count and not one it invents for itself.
   *   · `first-script` waits on the subject, the voice and the look — a plan names a style template
   *     the producer actually chose, and is written to an arc somebody wrote down.
   *   · `first-assembly` waits on `first-script` and is last because it is the only card here that
   *     spends real money: `WHOLE_RENDER` of video, ~$53.97, in one session.
   *
   * Declaration order is dependency order: `up` writes the cards in this order and a `blocked_by`
   * carries the `crd_` an earlier create answered, so a blocker declared after the card it blocks
   * is refused at apply time.
   */
  tasks: [
    channelPlanCard("the channel's tone and who it is for, in one line — the setup form asked for the niche and not for this."),
    task({
      key: "first-topic",
      title: "Research the channel's first subject, with its sources and its exemplars",
      assignee: "researcher",
      body: `Read project_context for the niche, the audience and the cadence. Pick ONE subject worth a whole piece of ${LENGTH_PHRASE} — a question with a real answer, a story with a turn, a process with steps — and research it (web_search, web_fetch) until you hold four or five claims you can source by name. One subject, not five: a subject nobody researched is what this format cannot carry. Then find one or two exemplar videos in this niche AT THIS CHANNEL'S LENGTH, never shorts — a short has no second act and can teach nothing about holding one. Open each before you name it (browser, and its screenshot where the page has to be seen) and record how it opens, roughly where it turns, and what it does at the points a viewer would otherwise leave. Never name an exemplar you did not open. File the brief as one pending post with no media, stage brief, \`source\` "brief": the subject, why now, the hook direction, the sources, and the exemplar URLs with one line each on what they do. Do not plan it and do not hand off — the writer's card is blocked on this one and the board wakes it when you close yours. Put the post id in the note. Your Monday, Wednesday and Friday 05:00 fires take it from here.`,
    }),
    /*
     * *** THE STUDY IS NO LONGER ALLOWED TO ANSWER "NOTHING NAMED" WITH "THEN WORK BLIND". ***
     * On `faceless` this card closed in a line when the optional reference question went
     * unanswered, and every piece that channel ever made was then planned against nothing. The
     * rewritten `REFERENCE_RULE` keeps the ban on INVENTING a reference and drops the ban on
     * LOOKING for one, and this card is where that lands first: unanswered now means go and find
     * two or three real pieces of this length and study those. It still must never `ask_operator` —
     * two cards are blocked on it, and a question parks the session behind a person who may not
     * open the dashboard today.
     */
    task({
      key: "reference-study",
      title: "Study what this channel should be like, and file the teardown",
      assignee: "writer",
      body: `Read project_context. Where it names a reference, study what it names; where it names none, find two or three real videos in this niche that already make pieces of ${LENGTH_PHRASE} well and study those — "none given" is not "work from the niche alone", it is "go and look". Either way, LOOK before you write. A still (.jpg, .jpeg, .png, .gif, .webp): browser goto it and screenshot it, which is the only way a URL becomes something you can see — view_image takes \`fil_\` ids and refuses URLs outright. A \`fil_\` id: that goes to view_image, up to four at a time. A handle or a title: web_search it, then treat what you find as the next case. A video link: web_fetch it for the titles and descriptions, browser goto and screenshot the page, and then go inside it — pull frames with bash at the points the piece changes chapter, file them with publish_file, and look at what comes back. That last step is the one this crew used to skip, and skipping it is how a channel imitates the wrong genre. File ONE pending post, no media, no stage, \`source\` "reference teardown": what these pieces actually are, in one line, naming the technique you can SEE — live footage, animation, a composite; how they open and the first three seconds; where each turns; what they do at the points a viewer would otherwise leave; how fast they cut and how many shots a piece runs to; the shot grammar and what the camera does; the narration and caption shape; the formats they repeat, named; what they never do; and their length. Mark every line you INFERRED rather than saw. Name every piece you studied by URL, and never describe one you did not open — everything downstream trusts this post. Put its id in the note. Write no hooks, scripts or briefs here: the cards behind this one do that, and they read what you filed.`,
    }),
    task({
      key: "look",
      title: "Choose the style templates this channel renders in",
      assignee: "producer",
      blocked_by: ["reference-study"],
      body: "Day one is set-up, not a render. Read project_context for the niche, the tone and the audience, and the reference teardown the writer just filed (channel.list_posts, `source` \"reference teardown\" — its note names the post). Then the style templates (channel.list_style_templates). Choose the one or two whose look is closest to the teardown's shot grammar and file the choice as a pending post with no media and no stage, `source` \"style choice\", one line on why for each — the writer names a style template in every plan and is blocked on this card, so this note is what stops it choosing at random. A look chosen here is held across every segment of every piece: two segments in different looks read as two videos, so name ONE primary look and treat the second as a fallback rather than a variation. Then look for generate_video in the tools you were offered this turn — that list is complete. If it is there, say so in the note and do not call request_tools. Only if it is missing, request exactly it, once, and say in the note whether it was granted. Render nothing in this session: the card for the first piece is a separate one and it waits on a plan.",
    }),
    task({
      key: "arc-style",
      title: "Write the channel's arc — how a piece of this length is built",
      assignee: "writer",
      blocked_by: ["reference-study"],
      body: `Day one is set-up, not scripts. Read project_context for the niche, the tone and the audience, and your own reference teardown (channel.list_posts, \`source\` "reference teardown" — the card you just closed). Then write this channel's arc and file it as a pending post with no media and no stage, \`source\` "arc style": the openings this audience stops for; the shape of a ${LENGTH_PHRASE} piece in acts, with roughly where each act ends; what holds a viewer at the two places they leave — around twenty seconds in, and at the halfway mark, which is the whole difference between this format and a short; the voice; the caption shape; and what never to say. Every line of it is derived from the teardown and says which of its patterns it came from: that is the difference between a house arc and a guess, and every plan this channel ever files is written to this post. One more line, and it is a rendering fact rather than a taste: a piece here is rendered as at most ${SEGMENTS} segments of ${MAX_RENDER_SECONDS} seconds or fewer and joined, so say where the act boundaries should fall relative to those seams — a seam inside a continuous shot is a visible cut, and the acts are the natural place to put one. Do not read the queue for briefs and do not invent one: the researcher's subject reaches you on your next card, which the board opens once this one and its card are closed. Put the post id in the note.`,
    }),
    task({
      key: "report-frame",
      title: "Set up the weekly report this channel will be measured against",
      assignee: "analyst",
      blocked_by: ["channel-plan"],
      body: "Read project_context for the niche, the audience and the cadence, then the channel plan the manager filed (channel.list_posts, `source` \"channel plan\" — the card this one waited on, and its note names the post). Set up the skeleton this channel is measured by every week: the post kinds it files, the metrics you will read for each and where they come from, and the week's target taken from the manager's slot count rather than invented here. Lead the skeleton with retention and say exactly how you will read it — which tool of a connected account returns a curve, what you will report when none does, and that you will read where the audience stopped against each plan's own act boundaries rather than reporting a piece as having underperformed. File it as a pending post with no media, `source` \"report skeleton\". Write no report today — nothing has posted, and your Monday 07:30 fire writes the first real one.",
    }),
    task({
      key: "first-script",
      title: "Plan the first subject in full, before anything is rendered",
      assignee: "writer",
      blocked_by: ["first-topic", "arc-style", "look"],
      body: `The subject exists now — the researcher's card closed and its note names the post. Read project_context, your own reference teardown and arc style posts and the producer's style choice post (channel.list_posts), then the row at stage brief. Claim it — channel.update_post, stage scripting, expected_stage brief; refused means another session has it. Then, in this order: pull frames out of the brief's exemplars with bash, at the chapter boundaries the brief names rather than at an even interval, file them with publish_file and LOOK at them; research the subject until every claim has a source; write three hooks and keep one; lay the piece out in acts; and only then cut the acts into shots. File it as one video project (channel.create_project, kind generation, post_id the row, your name as agent): title and brief; hook verbatim; rejected_hooks and why the kept one won; retention; the scenes in order, each with beat, render prompt inside a style template the producer actually chose, seconds, voiceover and on-screen text, the seconds summing to ${LENGTH_PHRASE}; facts with their sources; sound; cta; a video model; reference_pattern; and the caption. TWO HARD RULES ON THE SHOTS: no segment may run over ${MAX_RENDER_SECONDS} seconds, because generate_video refuses more in one call, and every segment boundary must land on a shot change, because two segments are rendered independently and a boundary inside a continuous shot is a visible seam. Name in the brief, shot by shot, which exemplar each shot's grammar came from. Do not hand off to the producer: its card is blocked on this one and the board wakes it. Put the project id in the note.`,
    }),
    task({
      key: "first-assembly",
      title: "Render the channel's first piece in segments and join it into one file",
      assignee: "producer",
      blocked_by: ["first-script"],
      body: `There is a plan now — the writer's card closed and its note names the project. Read project_context, then take the oldest planned generation project (channel.list_projects, status planned, kind generation) and claim it before you spend: channel.update_project, status rendering, expected_status planned; refused means another has it. Read it in full (channel.get_project): it returns \`render_prompt\`, the shots compiled in order, and \`render_seconds\`, their sum, which is ${LENGTH_PHRASE}. That is longer than one call may be — generate_video takes at most ${MAX_RENDER_SECONDS} seconds — so cut the prompt along its own shot boundaries, never across a shot, into at most ${SEGMENTS} segments and render each with generate_video at aspect_ratio 9:16 and the plan's model, filing each under this project's id and its index so a later session can find it with find_files. A segment that fails is re-rendered ALONE: starting again from the top to fix the third buys the first two twice. Do not rewrite a shot and do not drop one to make the piece shorter. Then join: with bash, fetch the segments into your sandbox in order, concatenate them with ffmpeg and probe the result against \`render_seconds\`; a file that does not probe is not published, and if the shell has no ffmpeg, say so in the note and stop with the segments filed rather than publishing a fragment as the piece. Then publish_file the joined file and finish: channel.update_project, status rendered, expected_status rendering, that file as \`media_url\`, your name as \`agent\`. Refused there means it moved on while you rendered: say so and stop rather than render a second time — this piece costs about ${WHOLE_RENDER}, and a rendered plan is one the channel has already paid for. ONE piece today; your 06:00 fire takes the next one. Name the project in the note, and what each segment cost.`,
    }),
  ],

  // The FALLBACK target only: `PLATFORM_QUESTION` below asks the customer where this channel posts
  // and a filed post takes their answer. This is the question's own first option, so the fallback
  // and the default a customer sees pre-selected are the same network.
  platform: PLATFORM_CHOICES[0]!.platform,

  kinds: [
    { id: "produced", label: "Long-form" },
    { id: "multi", label: "Series part" },
  ],

  /**
   * THE SAME FOUR QUESTIONS AS THE OTHER TEMPLATES, AND THAT IS A CONSTRAINT RATHER THAN A CHOICE.
   * The engine refuses a fifth on a project that names a template, `PLATFORM_QUESTION` takes one
   * because where a channel posts gates whether anything it makes can be published at all, and the
   * fourth may only be optional. Everything a long-form crew needs beyond these — the tone, the
   * audience, whether the channel wants chapters — is asked by the channel manager in its first
   * session, or read out of the reference teardown, and never bolted onto this form.
   */
  questions: [
    {
      key: "niche",
      label: "Niche",
      type: "choice",
      options: [
        "Stoicism & philosophy",
        "True crime recaps",
        "Space & astronomy",
        "Personal finance",
        "History mysteries",
        "Health & longevity",
      ],
      help: "Pick one or type your own — every subject, script and render is for this niche. Your tone and who it is for is the first thing the channel manager will ask you about.",
    },
    PLATFORM_QUESTION,
    REFERENCE_QUESTION,
    CADENCE_QUESTION,
  ],

  words: {
    queueSubtitle: "Every long-form piece the producer rendered and joined, on its way to your accounts.",
    queueEmpty: "Brief the crew in Chat and each finished piece lands here, joined into one file, for review.",
    plansSubtitle: "Every piece the writer planned — hook, acts and shots, with the segment seams they were cut for — and what the producer has rendered of it.",
    plansEmpty: "The writer plans each subject here in full — the hook, the acts, the facts and their sources — against exemplars it actually watched, before the producer spends a whole piece of render on it.",
  },
};
