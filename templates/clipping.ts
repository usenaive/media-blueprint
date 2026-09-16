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
 * The apply opens every intake at once — declaration order is not execution order — so day one is
 * ordered by what each seat can do alone: the scout files plans, the analyst its skeleton, the
 * caption-editor its style, and the clipper checks its tools. The first cuts and the first captions
 * belong to the crons, which do run in order: 06:00 plans, 07:00 cuts, 07:30 captions. A cron and
 * a Chat request can overlap on one plan, so the clipper claims it first (`rendering`,
 * `expected_status: planned`) — one locked write, one winner — and a rendered plan is final.
 */
import { agent, CADENCE_QUESTION, channelManager, PLATFORM_CHOICES, PLATFORM_QUESTION, schedule, TONE_QUESTION, type MediaTemplate } from "./template.ts";

export const CLIPPING: MediaTemplate = {
  name: "clipping",
  description: "Repurposes existing video in one niche: cuts the best moments out of the reference channels and captions them.",

  agents: [
    channelManager("the scout, the clipper and the caption-editor"),
    agent({
      name: "clipper",
      role: "Clip production",
      description:
        "Cuts each planned clipping project — the source video, the timestamps and the reason the scout wrote — into one vertical clip and files it for approval. Never cuts from a channel the context does not name.",
      brief:
        "You are the clipper. The scout plans moments worth cutting as video projects — kind clipping: source URL, where the moment starts and ends, why. Take one named to you, else the oldest planned (channel.list_projects); claim it first: channel.update_project, status rendering, expected_status planned; refused means another session has it: take the next. Read it (channel.get_project). clip_video takes the source URL whole — no timestamps — and returns the clips it finds as file ids, each titled: call it once per plan, vertical; pick by those titles — you have no tool to open a file — the one clip that is the moment the plan names (its from, to and reason). Cut only from the reference channels the context names; a plan from elsewhere goes back to planned. Finish: channel.update_project: status rendered, expected_status rendering, that file id as `media_url`, your name as `agent`: that files the clip as a pending post for the caption-editor. Stop once the queue holds the uncaptioned clips the cadence needs.",
      tools: ["clip_video"],
      skills: ["naive/clip-selection"],
      intake: {
        message:
          "Day one is set-up, not a cut. The scout is opening its own first session alongside yours right now, so the plans you read (channel.list_projects) may hold nothing yet — that is not a signal to pick a source yourself, and it is not a signal to wait. Read project_context for the reference channel(s) the operator named, the niche and the cadence, and confirm you can reach each named reference; then check that the tools you cut with are among yours, and if one is not, request exactly it with request_tools, once. File what you found as a pending post with no media, `source` \"clipper check\": which sources you can reach, which you cannot, and what is missing. Cut nothing today: your 07:00 fire tomorrow takes the scout's first plans, after its 06:00 has run.",
        budget_micro_usd: 8_000_000,
      },
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next cuts, before the caption-editor's 07:30 pass and the manager's 08:00 sweep.
          input:
            "Cut the next clips. Read the named sources (project_context) and the planned clipping projects (channel.list_projects, status planned, kind clipping); claim each before you cut it — channel.update_project, status rendering, expected_status planned; refused means it is not yours — and cut from its source URL with clip_video (the URL whole, vertical; it picks the clips and returns their file ids), then keep the one clip that is the moment the plan names by from, to and reason. Finish each with channel.update_project: status rendered, expected_status rendering, that file id as media_url, your name as agent. Cut nothing from a channel the context does not name — a plan from anywhere else goes back to planned with a note, and if no plan names a reference, cut nothing and stop. If clip_video is not among your tools, or it refuses for want of a provider, cut nothing: request exactly what is missing with request_tools, once, then wait — if it is granted carry on; if it is refused, stop for tonight.",
          budget_micro_usd: 10_000_000, // $10 — one fire's cuts: a clip is cut, not rendered, and nothing has measured one yet.
        }),
      ],
    }),
    agent({
      name: "scout",
      role: "Source watch",
      description:
        "Watches the channel's named reference channels for new episodes and the moments in them worth cutting, and files each as a clipping video project — source URL, timestamps and the reasoning — for the clipper.",
      brief:
        "You are the scout. You watch the reference channels the context names — only those — for new episodes and the moments in them that stand alone as a short: a claim, a turn, a laugh, a play (web_search, web_fetch, `naive/clip-selection`). Each moment you pick becomes a video project (channel.create_project, kind clipping, your name as agent): a title; a brief — the one idea in it and why it lands for this audience; its sources — the video's URL, where the moment starts and ends (estimated from what you can read — never transcribe the video; the cut finds the exact moment), and why this moment over the rest. One moment per project; the operator reads the reasoning before a cut is spent. File what the cadence needs until the next fire, no more; the clipper cuts the oldest first. Never file from a channel the context does not name, nor a moment already planned, queued or posted (channel.list_projects, channel.list_posts). You neither cut nor caption.",
      tools: ["web_search", "web_fetch"],
      skills: ["naive/clip-selection"],
      intake: {
        message:
          "Day one. Read project_context for the reference channel(s) the operator named, the niche and the cadence. Go through the most recent episodes of each named reference and file the first five moments worth cutting as video projects (channel.create_project, kind clipping): a title, the one idea and why it lands for this audience as the brief, and the source — URL, from, to, reason. If the context names no reference you can reach, say so and stop — do not go looking for another.",
        budget_micro_usd: 20_000_000,
      },
      schedules: [
        schedule({
          cron: "0 6 * * *", // Daily 06:00 — new episodes and moments, before the clipper's 07:00 cuts.
          input:
            "Watch the references. Read project_context, the plans (channel.list_projects) and the queue (channel.list_posts), check each named reference channel for new episodes since the last fire, and file the moments worth cutting as video projects (channel.create_project, kind clipping) — title, the one idea and why it lands, the source URL, from, to and the reason. Only from named references; nothing already planned or queued.",
          budget_micro_usd: 10_000_000, // $10 — a read of the references and a few filings.
        }),
      ],
    }),
    agent({
      name: "caption-editor",
      role: "Captions & titles",
      description:
        "Writes the caption, title and hashtags on every clip in the queue, in the channel's voice, before the operator reviews it.",
      brief:
        "You are the caption-editor. Every clip in the queue that still carries the scout's working text as its caption — its plan's title and reasoning; channel.get_project on the row's projectId has the source and the why — gets a publishable one from you: a title that says the one idea, a caption in the tone the context asks for that gives the moment a reason to be watched, and hashtags the audience actually follows (`naive/caption-writing`, `naive/short-video-hooks`). Credit the original creator on every clip — these are reference channels, not the operator's own footage. Write it into the clip's row with channel.update_post; keep the source and the agent that filed it. Write for the niche and audience in the context, in their words, and never in a general voice. You do not pick moments and you do not cut — the scout and the clipper do.",
      tools: ["web_search"],
      skills: ["naive/caption-writing", "naive/short-video-hooks"],
      intake: {
        message:
          "Day one. Read project_context for the niche, the audience and the reference channels. Write the channel's caption style in five lines — voice, length, hashtag set, credit line, what never to say — and file it as a pending post with no media, `source` \"caption style\", so the team works to one voice. Then read the queue (channel.list_posts): the clipper cuts nothing until its 07:00 fire tomorrow, so any clip you find with media and a working brief gets a publishable title, caption and hashtags written into its row (channel.update_post), and a queue with none is the expected day one — your 07:30 fire captions the morning's cuts.",
        budget_micro_usd: 20_000_000,
      },
      schedules: [
        schedule({
          cron: "30 7 * * *", // Daily 07:30 — captions on the morning's cuts, before the manager's 08:00 sweep.
          input:
            "Caption the cuts. Read project_context, then every clip in the queue with media and no publishable caption yet (channel.list_posts); write title, caption and hashtags into each with channel.update_post, in the channel's voice, for its audience. Nothing to caption means nothing to do.",
          budget_micro_usd: 10_000_000, // $10 — a read and a few rewrites.
        }),
      ],
    }),
    agent({
      name: "analyst",
      role: "Performance",
      description:
        "Reports weekly on what the channel posted, by source and by clip, and tells the team which sources and moments to cut more and less of.",
      brief:
        "You are the analyst. Once a week you read what this channel posted (channel.list_posts, and the metrics of a connected account where its tools are offered) and write the report: which sources the clips came from, which moments and caption styles moved and which did not, in plain numbers you actually read. File the report as a pending post with no media so it sits in the queue where the operator and the team read; its caption is the report, its `source` is the period it covers. Name the two changes you would make next week — a source to watch closer, a kind of moment to stop cutting. Where a metric is not offered to you, say it is unknown; a report that guesses at a number is worse than one that says it has none.",
      tools: [],
      skills: [],
      intake: {
        message:
          "Day one. Read project_context for the reference channels, the niche and the cadence, then the queue (channel.list_posts). Set up the report skeleton this channel will use every week: the reference channels it cuts from, the metrics you will read per clip and where they come from, and the cadence-sized target for the week. File it as a pending post with no media, `source` \"report skeleton\", so the team can read what it will be measured against.",
        budget_micro_usd: 20_000_000,
      },
      schedules: [
        schedule({
          cron: "30 7 * * 1", // Monday 07:30 — last week's numbers, before the manager plans at 09:00.
          input:
            "Write the weekly report. Read project_context and what posted in the last seven days (channel.list_posts, plus the connected account's metrics where offered); per source and per clip, say what went out and what it did, and name the two changes for next week. File it as a pending post with no media.",
          budget_micro_usd: 10_000_000, // $10 — a read of the week and one report.
        }),
      ],
    }),
  ],

  // The FALLBACK target only: `PLATFORM_QUESTION` below asks the customer where this channel
  // posts, and a filed post takes their answer. This is what an install with no usable answer
  // falls back to, and it is the question's own first option so the two never disagree.
  platform: PLATFORM_CHOICES[0]!.platform,

  kinds: [{ id: "clip", label: "Clip" }],

  /**
   * Four, because the engine refuses a fifth (`templates/template.ts`, `SetupQuestion`). The
   * references question is this template's own and the first asked: it is the one answer no seat
   * may work without, and no crew may infer. The tone — who these clips are for and the voice they
   * are cut in — the network and the cadence are every channel's.
   */
  questions: [
    {
      key: "sources",
      label: "Reference channels for inspiration",
      type: "text",
      placeholder: "Channel or playlist URLs, one per line — the crew watches these and cuts from nowhere else",
    },
    TONE_QUESTION,
    PLATFORM_QUESTION,
    CADENCE_QUESTION,
  ],

  words: {
    plansSubtitle: "Every moment the scout picked — source, timestamps and why — and what the clipper has cut from it.",
    plansEmpty: "The scout plans each cut here — the video, the moment and the reasoning — before the clipper spends a cut on it.",
    queueSubtitle: "Every clip the clipper cut from your reference channels, on its way to your accounts.",
    queueEmpty: "Point the scout at a reference video in Chat and each cut lands here for review.",
  },
};
