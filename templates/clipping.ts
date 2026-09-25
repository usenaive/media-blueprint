/**
 * `clipping` — a channel that repurposes existing video: the best moments out of the reference
 * channels the operator points it at, cut vertical and captioned.
 *
 * Five seats. The scout watches the named references for new episodes and moments and files each
 * worth cutting as a clipping video project — the plan: the source URL, the timestamps, why that
 * moment (`channel.create_project`); the clipper claims the plan, cuts it (`clip_video`) and
 * finishes it, which files the clip as a post; the caption-editor writes the caption, title and
 * hashtags on every clip; the analyst reports weekly; the channel manager plans the week from the
 * cadence answer and keeps the queue and the comments. Nothing here is code: swap this template
 * for `faceless` and the same screens, routes and store serve the other crew.
 *
 * The references question is the first one asked and the one rule every seat repeats: nothing is
 * cut from a channel the context does not name. Read the comment on `schedule` (`template.ts`) before
 * touching a cron string here.
 *
 * *** DAY ONE IS THE BOARD NOW, AND IT IS WHY THIS TEMPLATE GOT CARDS TOO. *** It used to be
 * ordered by what each seat could do ALONE — the scout filed plans, the analyst its skeleton, the
 * caption-editor its style, the clipper checked its tools — because the apply opened every intake
 * at once and declaration order was not execution order. So the first cuts and the first captions
 * belonged to the crons, and a channel installed at nine in the morning cut nothing until 07:00 the
 * next day. `tasks` below (`canonical-spec §31.11`) says the order the intakes could not: a card
 * with an open `blocked_by` is not due and its seat is not woken, so the clipper is woken by the
 * scout's plans and the caption-editor by the clipper's cuts, on the same day. The crons stay the
 * standing work — 06:00 plans, 07:00 cuts, 07:30 captions — and no card restates them. A cron and
 * a Chat request can still overlap on one plan, so the clipper claims it first (`rendering`,
 * `expected_status: planned`) — one locked write, one winner — and a rendered plan is final.
 */
import {
  agent,
  CADENCE_QUESTION,
  CLIPPING_LENGTH,
  channelManager,
  channelPlanCard,
  lengthPhrase,
  PLATFORM_QUESTION,
  schedule,
  task,
  type MediaTemplate,
} from "./template.ts";

/**
 * "between 15 and 60 seconds" — this template's band and no sibling's, derived from the window
 * below rather than typed into the prompt that quotes it.
 *
 * It is written into the clipper's brief because the number was in circulation three different
 * ways and only one of them is enforced by anything that runs: `naive/clip-selection` taught
 * 20–45 seconds, the landing copy said "under sixty", and `clip_video` — the tool a clipping plan
 * actually becomes — defaults its cut band to 15–60. The tool's is the one that decides which
 * clips come back, so it is the one the seat choosing among them is told, and the skill now
 * teaches the same range.
 */
const LENGTH_PHRASE = lengthPhrase(CLIPPING_LENGTH);

export const CLIPPING: MediaTemplate = {
  name: "clipping",
  // 15–60 seconds — `clip_video`'s own default cut band, which is what a clipping plan becomes.
  length: CLIPPING_LENGTH,
  description: "Repurposes existing video in one niche: cuts the best moments out of the reference channels and captions them.",

  agents: [
    channelManager("the scout, the clipper and the caption-editor", "", { reference: false, planCheck: "" }),
    agent({
      name: "clipper",
      role: "Clip production",
      description:
        "Cuts each planned clipping project — the source video, the timestamps and the reason the scout wrote — into one vertical clip and files it for approval. Never cuts from a channel the context does not name.",
      brief: `You are the clipper. The scout plans moments worth cutting as video projects (kind clipping): source URL, where the moment starts and ends, and why. Take one named to you, else the oldest planned (channel.list_projects); claim it: channel.update_project, status rendering, expected_status planned; refused, another has it: take the next. Read it (channel.get_project). clip_video takes the whole source URL, no timestamps, and returns titled file ids: call it once per plan, vertical; pick by title (you cannot open a file) the clip that is the plan's moment. A clip of this channel runs ${LENGTH_PHRASE} — clip_video's own band, and what the tool cuts to unless you say otherwise — so a plan whose moment needs longer than that is not a clip: put it back to planned with a note saying so rather than shipping half of it. Cut only from the reference channels the context names; a plan from elsewhere goes back to planned. Finish: channel.update_project: status rendered, expected_status rendering, that file id as \`media_url\`, your name as \`agent\`: that files it for the caption-editor. A revision arrives as a message on your session: re-read the plan with channel.get_project, apply the operator's note, finish with the same update_project write, changed sources on it. Never open a second project. Stop when the queue holds the cadence's need.`,
      tools: ["clip_video"],
      skills: ["naive/clip-selection"],
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next cuts, before the caption-editor's 07:30 pass and the manager's 08:00 sweep.
          input:
            "Cut the next clips. Read the named sources (project_context) and the planned clipping projects (channel.list_projects, status planned, kind clipping); claim each before you cut it — channel.update_project, status rendering, expected_status planned; refused means it is not yours — and cut from its source URL with clip_video (the URL whole, vertical; it picks the clips and returns their file ids), then keep the one clip that is the moment the plan names by from, to and reason. Finish each with channel.update_project: status rendered, expected_status rendering, that file id as media_url, your name as agent. Cut nothing from a channel the context does not name — a plan from anywhere else goes back to planned with a note, and if no plan names a reference, cut nothing and stop. If clip_video is not among your tools, or it refuses for want of a provider, cut nothing: request exactly what is missing with request_tools, once, then wait — if it is granted carry on; if it is refused, stop for tonight.",
          budget_micro_usd: 10_000_000, // $10 — one fire's cuts: a clip is cut, not rendered, and nothing has measured one yet.
        }),
      ],
    }),
    /**
     * *** THE ONE THING THIS SEAT GAINS, AND IT IS THAT IT LOOKS AT THE EPISODE. ***
     *
     * The scout picked moments out of titles, descriptions and whatever `web_fetch` returned as
     * text, which is the outside of a video: it can tell you what a moment SAYS and nothing about
     * what it LOOKS like. The moments that came back read well and cut badly — a title promising
     * a play, ten minutes of two people at a desk — and the clipper only finds out after it has
     * spent a cut. `browser` is granted to every seat here (`BROWSER_TOOL`, `template.ts`) and its
     * screenshot comes back as a picture, so the fix is one sentence in the brief rather than a
     * tool grant. `view_image` is NOT the path: it takes `fil_` ids and refuses a URL outright,
     * and everything this seat looks at is a URL a customer typed.
     *
     * Nothing else about this seat moves. The moment-selection this template lives on is the
     * clip-pipeline's own scorer, not a prompt, so the rest of the brief is left as it was — and
     * the rights rule ("only those", twice) is the strongest sentence on this template: every cut
     * is somebody else's footage, and a scout that widens its own source list is a legal problem
     * rather than a quality one.
     */
    agent({
      name: "scout",
      role: "Source watch",
      description:
        "Watches the channel's named reference channels for new episodes and the moments in them worth cutting, and files each as a clipping video project — source URL, timestamps and the reasoning — for the clipper.",
      brief:
        "You are the scout. You watch the reference channels the context names — only those — for new episodes and the moments in them that stand alone as a short: a claim, a turn, a laugh, a play (web_search, web_fetch, `naive/clip-selection`). Look at the episode before you file anything from it: browser goto its page and screenshot it, because the screenshot is the only thing here that turns a URL into a picture, and a title and a description tell you what a moment says and nothing about what it looks like. A moment that reads well and looks like nothing — a title promising a play over ten minutes of two people at a desk — is a cut spent for nothing. Say in the reasoning what you actually saw, and never file from a source you did not open. Each moment you pick becomes a video project (channel.create_project, kind clipping, your name as agent): a title; a brief — the one idea in it and why it lands for this audience; its sources — the video's URL, where the moment starts and ends (estimated from what you can read — never transcribe the video; the cut finds the exact moment), and why this moment over the rest. One moment per project; the operator reads the reasoning before a cut is spent. File what the cadence needs until the next fire, no more; the clipper cuts the oldest first. Never file from a channel the context does not name, nor a moment already planned, queued or posted (channel.list_projects, channel.list_posts). You neither cut nor caption.",
      tools: ["web_search", "web_fetch"],
      skills: ["naive/clip-selection"],
      schedules: [
        schedule({
          cron: "0 6 * * *", // Daily 06:00 — new episodes and moments, before the clipper's 07:00 cuts.
          input:
            "Watch the references. Read project_context, the plans (channel.list_projects) and the queue (channel.list_posts), check each named reference channel for new episodes since the last fire, and file the moments worth cutting as video projects (channel.create_project, kind clipping) — title, the one idea and why it lands, the source URL, from, to and the reason. Open each episode you file from and screenshot it with the browser first: a title is not a picture, and the reason you write says what you saw. Only from named references; nothing already planned or queued.",
          budget_micro_usd: 10_000_000, // $10 — a read of the references and a few filings.
        }),
      ],
    }),
    /**
     * *** `naive/short-video-hooks` IS GONE FROM THIS SEAT, AND IT WAS THE WRONG STANDARD. ***
     *
     * That skill teaches how to OPEN a piece — the first three seconds, the structure the hook
     * buys. This seat opens nothing: the scout chose the moment and the clipper cut it, and the
     * caption is written after both, on somebody else's footage. Handing it a hook standard asked
     * it to judge a cut it cannot change and spent the read on the one thing it may not touch.
     * `naive/caption-writing` is the standard that is actually its own, and it now carries the
     * per-network norms this seat needs — the same skill the channel manager sweeps with, so the
     * queue and the rewrite are held to one voice.
     */
    agent({
      name: "caption-editor",
      role: "Captions & titles",
      description:
        "Writes the caption, title and hashtags on every clip in the queue, in the channel's voice, before the operator reviews it.",
      brief:
        "You are the caption-editor. Every clip in the queue that still carries the scout's working text as its caption — its plan's title and reasoning; channel.get_project on the row's projectId has the source and the why — gets a publishable one from you: a title that says the one idea, a caption in the tone the context asks for that gives the moment a reason to be watched, and hashtags the audience actually follows (`naive/caption-writing`). Credit the original creator on every clip — these are reference channels, not the operator's own footage, and a clip posted without the credit is the one mistake here that costs the channel rather than a view. Write for the network the row names: the skill carries each network's own norms, and a caption in another network's shape reads as a repost. Write it into the clip's row with channel.update_post; keep the source and the agent that filed it. Write for the niche and audience in the context, in their words, and never in a general voice. You do not pick moments and you do not cut — the scout and the clipper do.",
      tools: ["web_search"],
      skills: ["naive/caption-writing"],
      schedules: [
        schedule({
          cron: "30 7 * * *", // Daily 07:30 — captions on the morning's cuts, before the manager's 08:00 sweep.
          input:
            "Caption the cuts. Read project_context, then every clip in the queue with media and no publishable caption yet (channel.list_posts); write title, caption and hashtags into each with channel.update_post, in the channel's voice, for its audience. Nothing to caption means nothing to do.",
          budget_micro_usd: 10_000_000, // $10 — a read and a few rewrites.
        }),
      ],
    }),
    /**
     * The seat that writes this channel's only recurring document held `skills: []` — on every
     * template, since the first one was written. A weekly report is exactly the kind of work a
     * catalogue skill is for: the same sections in the same order every week is what makes two
     * weeks comparable, and a report that reinvents its own layout each Monday is a document the
     * operator has to re-read from the top. `naive/channel-report` is that shape, and naming it
     * here is also what grants the seat `read_skill` (`agent()`, `template.ts`).
     */
    agent({
      name: "analyst",
      role: "Performance",
      description:
        "Reports weekly on what the channel posted, by source and by clip, and tells the team which sources and moments to cut more and less of.",
      brief:
        "You are the analyst. Once a week you read what this channel posted (channel.list_posts, and the metrics of a connected account where its tools are offered) and write the report: which sources the clips came from, which moments and caption styles moved and which did not, in plain numbers you actually read. File the report as a pending post with no media so it sits in the queue where the operator and the team read; its caption is the report, its `source` is the period it covers. Write it to the shape `naive/channel-report` sets, every week, so the weeks can be read against each other rather than each one inventing its own layout. Name the two changes you would make next week — a source to watch closer, a kind of moment to stop cutting. Where a metric is not offered to you, say it is unknown; a report that guesses at a number is worse than one that says it has none.",
      // Read-only numbers for the Monday fire; unlisted, it falls to `ask` and the cron stalls on an approval nobody sees.
      tools: ["social.post_metrics"],
      skills: ["naive/channel-report"],
      schedules: [
        schedule({
          cron: "30 7 * * 1", // Monday 07:30 — last week's numbers, before the manager plans at 09:00.
          input:
            "Write the weekly report. Read project_context and what posted in the last seven days (channel.list_posts, and their numbers from social.post_metrics with since_days 7); per source and per clip, say what went out and what it did, and name the two changes for next week. File it as a pending post with no media.",
          budget_micro_usd: 10_000_000, // $10 — a read of the week and one report.
        }),
      ],
    }),
  ],

  /**
   * THE CREW'S FIRST DAY, AS SEVEN CARDS (`canonical-spec §31.11`) — the same shape as `faceless`,
   * because the crew is the same shape: one seat that plans, one that makes, one that finishes, one
   * that measures and the manager over them.
   *
   * Four open the install together, each needing nothing but `project_context`: the plan, the first
   * moments, the caption style, and the clipper's check that it can actually reach the references
   * the operator named — that last one is not busywork here, it is the one template whose whole
   * premise is a URL a customer typed, and finding out at 07:00 tomorrow that none of them resolve
   * is a day lost. Three wait:
   *
   *   · `report-frame` waits on `channel-plan`, for the reason it does on `faceless`: the skeleton
   *     measures against the manager's target rather than one it invented.
   *   · `first-cuts` waits on `first-moments` (there is nothing to cut before the scout has planned
   *     a moment) and on `source-check` (a cut from a source the clipper cannot reach is a session
   *     spent to learn what the check already knows).
   *   · `first-captions` waits on `first-cuts` and on `caption-style`: a caption needs a clip to sit
   *     on, and the voice it is written in is the caption-editor's own earlier card.
   *
   * Nothing else is blocked. `first-cuts` is the card that spends — a cut, not a render, and nobody
   * has yet measured one — and it is behind two blockers for that reason as well as the honest one.
   */
  tasks: [
    channelPlanCard("who these clips are for and the tone they are cut in, in one line — the setup form asked for the reference channels and not for this."),
    task({
      key: "first-moments",
      title: "Plan the first five moments worth cutting from the named references",
      assignee: "scout",
      body: "Read project_context for the reference channel(s) the operator named, the niche and the cadence. Go through the most recent episodes of each named reference and file the first five moments worth cutting as video projects (channel.create_project, kind clipping): a title, the one idea and why it lands for this audience as the brief, and the source — URL, from, to, reason. Open each episode's page and screenshot it (browser goto, then screenshot — it is the only way a URL becomes a picture here) before you file from it, so the moment you pick is one you have seen and not one you read about. Estimate the timestamps from what you can read; never transcribe the video, the cut finds the exact moment. If the context names no reference you can reach, file nothing, move this card to blocked and say which URLs failed — do not go looking for another channel, and do not cut from one the context does not name. The clipper's card is blocked on this one and the board wakes it when you close yours, so nothing here hands off. Put the five project ids in the note; your 06:00 fire watches the references from here.",
    }),
    task({
      key: "source-check",
      title: "Confirm this channel can reach the references and cut at all",
      assignee: "clipper",
      body: "Day one is set-up, not a cut. Read project_context for the reference channel(s) the operator named, then confirm you can reach each one. Look for clip_video in the tools you were offered this turn — that list is complete. If it is there, say so in the note and do not call request_tools: never request a tool you already hold, and never request one for a card you are not on. Only if it is missing, request exactly it with request_tools, once, and say in the note whether it was granted. File what you found as a pending post with no media, `source` \"clipper check\": which sources you can reach, which you cannot, and what is missing. Cut nothing today — your card for the first cuts is a separate one and it waits on the scout's plans. This is the check that decides whether this channel can work at all, so say plainly in the note whether it can.",
    }),
    task({
      key: "caption-style",
      title: "Write the channel's caption style, so every clip reads in one voice",
      assignee: "caption-editor",
      body: "Day one is set-up, not captions. Read project_context for the niche, the audience and the reference channels, then write the channel's caption style in five lines — voice, length, hashtag set, the credit line every clip carries because these are somebody else's reference channels and not the operator's footage, and what never to say — and file it as a pending post with no media, `source` \"caption style\". Do not read the queue for clips: nothing is cut yet, and your card for the first captions waits on the clipper's. Put the post's id in the note.",
    }),
    task({
      key: "report-frame",
      title: "Set up the weekly report this channel will be measured against",
      assignee: "analyst",
      body: "Read project_context for the reference channels, the niche and the cadence, then the channel plan the manager filed (channel.list_posts, `source` \"channel plan\" — it is the card this one waited on, and its note names the post). Set up the report skeleton this channel will use every week: the reference channels it cuts from, the metrics you will read per clip and where they come from, and the week's target taken from the manager's slot count rather than invented here. File it as a pending post with no media, `source` \"report skeleton\", so the team can read what it will be measured against. Write no report today — nothing has posted, and your Monday 07:30 fire writes the first real one.",
      blocked_by: ["channel-plan"],
    }),
    task({
      key: "first-cuts",
      title: "Cut the channel's first clips from the scout's plans",
      assignee: "clipper",
      body: "There are plans now — the scout's card closed, and its note names the project ids; your own check card says which sources you can reach. Take the oldest planned clipping projects (channel.list_projects, status planned, kind clipping) and claim each before you cut it: channel.update_project, status rendering, expected_status planned; refused means another has it, take the next. Read it (channel.get_project). clip_video takes the whole source URL, no timestamps, and returns titled file ids: call it once per plan, vertical; pick by title — you cannot open a file — the clip that is the moment the plan names by from, to and reason. Cut only from the reference channels the context names; a plan from anywhere else goes back to planned with a note. Finish each: channel.update_project, status rendered, expected_status rendering, that file id as `media_url`, your name as `agent` — which files the clip for the caption-editor, whose card is blocked on this one. TWO clips today, not five; your 07:00 fire takes the rest tomorrow. Name what you cut in the note.",
      blocked_by: ["first-moments", "source-check"],
    }),
    task({
      key: "first-captions",
      title: "Write publishable titles and captions on the first clips",
      assignee: "caption-editor",
      body: "The first clips are in the queue — the clipper's card closed and named them. Read project_context and your own caption style post, then every clip in the queue with media that still carries the scout's working text as its caption (channel.list_posts; channel.get_project on the row's projectId has the source and the why). Write each a publishable one with channel.update_post: a title that says the one idea, a caption in the channel's voice that gives the moment a reason to be watched, hashtags this audience actually follows, and the credit to the original creator — every clip, no exceptions. Keep the source and the agent that filed it. Nothing publishes here; the operator approves from the dashboard. Say in the note how many you captioned; your 07:30 fire takes each morning's cuts from here.",
      blocked_by: ["first-cuts", "caption-style"],
    }),
  ],

  /**
   * Three, where the engine now allows four (ADR-0757) — clipping simply has no fourth worth asking.
   * `faceless` spends its fourth on the reference question; this template's sources arrive as a list, so
   * there is nothing a form could ask here that the channel plan does not answer better. The slot
   * `PLATFORM_QUESTION` takes was `niche` — "Niche / audience" — and the channel manager asks for
   * it in its day-one session instead. The references question keeps its slot whatever else goes: it is
   * the one answer no seat may work without, and no crew may infer.
   */
  questions: [
    {
      key: "sources",
      label: "Reference channels for inspiration",
      type: "text",
      placeholder: "Channel or playlist URLs, one per line — the crew watches these and cuts from nowhere else",
    },
    PLATFORM_QUESTION,
    CADENCE_QUESTION,
  ],

};
