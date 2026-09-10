/**
 * `clipping` — a channel that repurposes existing video: the best moments out of sources the
 * operator holds the rights to, cut vertical and captioned.
 *
 * Five seats. The scout watches the named sources for new episodes and moments and files each
 * worth cutting as a brief; the clipper cuts (`clip_video`); the caption-editor writes the caption,
 * title and hashtags on every clip; the analyst reports weekly; the channel manager plans the week
 * from the cadence answer and keeps the queue and the comments. Nothing here is code: swap this
 * template for `faceless` and the same screens, routes and store serve the other crew.
 *
 * The rights question is the first one asked and the one rule every seat repeats: nothing is cut
 * from a source the context does not name. Read the comment on `schedule` (`template.ts`) before
 * touching a cron string here.
 *
 * The apply opens every intake at once — declaration order is not execution order — so day one is
 * ordered by what each seat can do alone: the scout files briefs, the analyst its skeleton, the
 * caption-editor its style, and the clipper checks its tools. The first cuts and the first captions
 * belong to the crons, which do run in order: 06:00 briefs, 07:00 cuts, 07:30 captions.
 */
import { agent, CADENCE_QUESTION, channelManager, schedule, type MediaTemplate } from "./template.ts";

export const CLIPPING: MediaTemplate = {
  name: "clipping",
  description: "Repurposes existing video in one niche: cuts the best moments out of a source channel and captions them.",

  agents: [
    channelManager("the scout, the clipper and the caption-editor"),
    agent({
      name: "clipper",
      role: "Clip production",
      description:
        "Cuts the most engaging vertical clips out of the sources the channel holds rights to and files each for approval. Never cuts from a source the context does not name.",
      brief:
        "You are the clipper. The scout files the moments worth cutting as briefs — pending posts with no media naming the source video, the timestamp and why it lands — and you cut them: one idea per clip, the hook in the first second, under sixty seconds, vertical (clip_video, `naive/clip-selection`). Cut only from the sources named in the context; a clip from anywhere else is a rights problem the operator has to answer for, so if a brief names a source the context does not, leave it and say so. Attach each finished clip to its brief's row with channel.update_post and leave the caption to the caption-editor. Work the oldest brief first and stop when the queue holds as many uncaptioned clips as the cadence needs — a queue the operator has not caught up with does not need another clip in it.",
      tools: ["clip_video"],
      skills: ["naive/clip-selection"],
      intake: {
        message:
          "Day one is set-up, not a cut. The scout is opening its own first session alongside yours right now, so the queue you read may hold no brief yet — that is not a signal to pick a source yourself, and it is not a signal to wait. Read project_context for the source channel(s) the operator holds rights to, the niche and the cadence, and confirm you can reach each named source; then check that the tools you cut with are among yours, and if one is not, request exactly it with request_tools, once. File what you found as a pending post with no media, `source` \"clipper check\": which sources you can reach, which you cannot, and what is missing. Cut nothing today: your 07:00 fire tomorrow takes the scout's first briefs, after its 06:00 has run.",
        budget_micro_usd: 8_000_000,
      },
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next cuts, before the caption-editor's 07:30 pass and the manager's 08:00 sweep.
          input:
            "Cut the next clips. Read the named sources (project_context) and the queue (channel.list_posts), take the scout's briefs that have no clip against them yet, and cut each from its named source. Attach every clip to its brief's row. Cut nothing from a source the context does not name — if there is no brief from a named source, file nothing and stop. If clip_video is not among your tools, or it refuses for want of a provider, cut nothing: request exactly what is missing with request_tools, once, then wait — if it is granted carry on; if it is refused, stop for tonight.",
          budget_micro_usd: 10_000_000, // $10 — one fire's cuts: a clip is cut, not rendered, and nothing has measured one yet.
        }),
      ],
    }),
    agent({
      name: "scout",
      role: "Source watch",
      description:
        "Watches the channel's named source channels for new episodes and the moments in them worth cutting, and files each as a brief for the clipper.",
      brief:
        "You are the scout. You watch the sources the context names — and only those — for new episodes and for the moments inside them that will stand alone as a short: a claim, a turn, a laugh, a play (web_search, web_fetch, `naive/clip-selection`). Each moment you pick becomes a brief: a pending post with no media whose caption names the source video, the timestamp range, the one idea in it and why it will land for this audience, with `source` naming the episode. File as many as the cadence needs until the next fire and no more; the clipper cuts the oldest first. Never file from a source the context does not name, and never restate a moment already queued or posted (channel.list_posts). You do not cut and you do not caption.",
      tools: ["web_search", "web_fetch"],
      skills: ["naive/clip-selection"],
      intake: {
        message:
          "Day one. Read project_context for the source channel(s) the operator holds rights to, the niche and the cadence. Go through the most recent episodes of each named source and file the first five moments worth cutting as briefs (channel.create_post, no media): source video, timestamp range, the one idea, why it lands for this audience. If the context names no source you can reach, say so and stop — do not go looking for another.",
        budget_micro_usd: 20_000_000,
      },
      schedules: [
        schedule({
          cron: "0 6 * * *", // Daily 06:00 — new episodes and moments, before the clipper's 07:00 cuts.
          input:
            "Watch the sources. Read project_context and the queue (channel.list_posts), check each named source for new episodes since the last fire, and file the moments worth cutting as briefs — source video, timestamp range, the one idea, why it lands. Only from named sources; nothing already queued.",
          budget_micro_usd: 10_000_000, // $10 — a read of the sources and a few filings.
        }),
      ],
    }),
    agent({
      name: "caption-editor",
      role: "Captions & titles",
      description:
        "Writes the caption, title and hashtags on every clip in the queue, in the channel's voice, before the operator reviews it.",
      brief:
        "You are the caption-editor. Every clip in the queue that still carries the scout's working brief as its caption gets a publishable one from you: a title that says the one idea, a caption in the tone the context asks for that gives the moment a reason to be watched, and hashtags the audience actually follows (`naive/caption-writing`, `naive/short-video-hooks`). Credit the source where the operator's rights ask for it. Write it into the clip's row with channel.update_post; keep the source and the agent that filed it. Write for the niche and audience in the context, in their words, and never in a general voice. You do not pick moments and you do not cut — the scout and the clipper do.",
      tools: ["web_search"],
      skills: ["naive/caption-writing", "naive/short-video-hooks"],
      intake: {
        message:
          "Day one. Read project_context for the niche, the audience and the sources. Write the channel's caption style in five lines — voice, length, hashtag set, credit line, what never to say — and file it as a pending post with no media, `source` \"caption style\", so the team works to one voice. Then read the queue (channel.list_posts): the clipper cuts nothing until its 07:00 fire tomorrow, so any clip you find with media and a working brief gets a publishable title, caption and hashtags written into its row (channel.update_post), and a queue with none is the expected day one — your 07:30 fire captions the morning's cuts.",
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
          "Day one. Read project_context for the sources, the niche and the cadence, then the queue (channel.list_posts). Set up the report skeleton this channel will use every week: the sources it cuts from, the metrics you will read per clip and where they come from, and the cadence-sized target for the week. File it as a pending post with no media, `source` \"report skeleton\", so the team can read what it will be measured against.",
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

  // Vertical short-form video is what this crew makes, so the network for it is where it files.
  // One line, one `naive up`, and every post the crew files after it targets somewhere else.
  platform: "tiktok",

  kinds: [{ id: "clip", label: "Clip" }],

  questions: [
    {
      key: "sources",
      label: "Source channel(s) you hold the rights to",
      type: "text",
      placeholder: "Channel or playlist URLs, one per line — nothing is cut from anywhere else",
    },
    {
      key: "niche",
      label: "Niche / audience",
      type: "text",
      placeholder: "e.g. podcast highlights for founders who skip the full episode",
    },
    CADENCE_QUESTION,
  ],

  words: {
    queueSubtitle: "Every clip the clipper cut from your source channel, on its way to your accounts.",
    queueEmpty: "Point the scout at a source video in Chat and each cut lands here for review.",
  },
};
