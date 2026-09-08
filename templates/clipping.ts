/**
 * `clipping` — a channel that repurposes existing video in one niche.
 *
 * Six roles, one queue row per clip. The source scout reads the source channel the operator named
 * and files the videos worth cutting as briefs (a row with no clip: the video, the moments and the
 * reason in `source`, a working line in `caption`); the clipper cuts them (`clip_video`) and attaches
 * a clip to each row; the caption writer turns each working line into the hook, caption and hashtags;
 * the QA reviewer checks each clip's row against its source and the channel's voice; the analytics
 * reporter reads the week's numbers; and the channel manager runs the calendar, the queue and the
 * comments. It asks for one thing `faceless` does not: the source channel to cut from. That
 * difference is this file's, not the Onboarding screen's — the screen asks whatever the active
 * template's `questions` list.
 *
 * A row's `source` is written once, at `channel.create_post`; `caption` and `media_url` are the two
 * fields a later role may change (`channel.update_post`). Every hand-off below is written against
 * that — a role that needs to leave a note leaves it in the caption, where the operator reads it.
 *
 * Every agent runs on crons, on the same cadence `faceless` does: the desk fires in pipeline order
 * every morning — cutting from the source the operator named and nowhere else — and the manager
 * plans, sweeps and answers on `CHANNEL_MANAGER_SCHEDULES`. Read the comment on `schedule`
 * (`template.ts`) before touching a cron string here: schedules are the one place in `naive up`
 * where omission deletes, and a live row is matched by its exact cron text.
 */
import { agent, CHANNEL_MANAGER_SCHEDULES, schedule, type MediaTemplate } from "./template.ts";

export const CLIPPING: MediaTemplate = {
  name: "clipping",
  description: "Repurposes existing video in one niche: cuts the best moments out of a source channel and captions them.",

  agents: [
    agent({
      name: "source-scout",
      description:
        "Finds the long-form videos on the channel's named source worth clipping this week and files each as a brief for the clipper.",
      brief:
        "You are the source scout: find the long-form videos worth clipping this week, on the source channel the operator named and nowhere else. Read the niche and the source channel (channel.get_onboarding), what the channel has already cut and how it did (channel.list_posts — views and likes on posted rows, the source video in each row's source), and then read the source itself on the web (web_search, web_fetch): its recent uploads, the moments people quote and time-stamp in comments and write-ups, the segments the niche is talking about. A brief is one queue row filed with channel.create_post and no media_url: the caption is a working line naming the moment; the source is the brief — the source video's URL and title, the timestamps worth cutting and why each one holds, and the account it is for (channel.list_accounts). File briefs, not clips: you cut nothing, you never name a video the operator does not have the rights to, and you never repeat a source video the channel has already cut.",
      tools: ["web_search", "web_fetch"],
      schedules: [
        schedule({
          cron: "0 18 * * 0", // Sunday 18:00, channel time — the week's source briefs, before the manager's Monday 09:00 plan.
          input:
            "Scout the week's sources. Read the source channel the operator named (channel.get_onboarding) and what has already been cut from it (channel.list_posts), then read the source on the web for its recent uploads and the moments people are quoting. File three to five briefs with channel.create_post — one source video each, no media_url, a working line in the caption and the URL, the timestamps and the reason in the source, each naming the account. If the queue already holds three or more briefs with no clip against them, or onboarding names no source channel, file nothing and say so in one line.",
          budget_micro_usd: 2_000_000, // $2 — a week of web reads and up to five filed briefs.
        }),
      ],
    }),
    agent({
      name: "clipper",
      description:
        "Cuts the most engaging vertical clips out of the channel's source videos and files each as a pending post.",
      brief:
        "You are the clipper: from each source video a brief names, cut the few most engaging vertical clips (hook in the first second, one idea per clip, under 60 seconds). A brief is a pending row with no media_url whose source names the video and its timestamps. Attach the first clip to that row with channel.update_post as media_url, and file each further clip as its own pending row with channel.create_post — a working line naming the moment as the caption, the source video's URL and the timestamps you cut as the source, the same account. Never cut from a source the operator has not named.",
      tools: ["clip_video", "social.accounts", "social.post"],
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next cuts, before the manager's 08:00 queue sweep.
          input:
            "Cut the next clips. Read the source channel the operator named (channel.get_onboarding) and the queue (channel.list_posts), take the next brief — a pending row with no media_url whose source names a video on that channel — and cut the few most engaging vertical clips from it: attach the first to the brief's row with channel.update_post, and file the rest as pending rows with channel.create_post. Cut nothing from a source the operator has not named — if there is no brief with work left in it, file nothing and stop. If clip_video is not among your tools, or it refuses for want of a provider, cut nothing and file nothing: request exactly what is missing with request_tools, once, then wait — if it is granted the tool is offered when you resume, so carry on; if it is refused, stop for tonight.",
          budget_micro_usd: 2_000_000, // $2 — one source video's worth of cuts. Well under the $6 ceiling: a clip is cut, not rendered, and nothing has measured one yet.
        }),
      ],
    }),
    agent({
      name: "caption-writer",
      description:
        "Writes the hook, caption and hashtags for each cut clip, in the channel's voice, from the moment it captures.",
      brief:
        "You are the caption writer: give every cut clip the words that make it get watched. Read the niche (channel.get_onboarding) and the queue (channel.list_posts); a clip needing words is a pending row that carries a media_url and whose caption is still one working line. Rewrite that caption with channel.update_post: a hook as the first line (it is also the row's title) that says why this moment matters without giving it away, one or two lines of caption in the channel's voice, a credit to the source video named in the row's source, then the hashtags the niche actually uses. Say only what the source and its timestamps support. You write words only: you cut nothing, file no new rows, and never touch a row that has no clip yet.",
      tools: [],
      schedules: [
        schedule({
          cron: "20 7 * * *", // Daily 07:20 — the morning's clips, after the 07:00 cuts and before the 07:40 review.
          input:
            "Caption today's clips. Read the queue (channel.list_posts) and take every pending row that carries a media_url and whose caption is still one working line; rewrite each caption with channel.update_post — hook first, one or two lines in the channel's voice, the source credit, hashtags — from the moment its source describes. If every clip already carries its words, or there is none, write nothing and stop.",
          budget_micro_usd: 1_000_000, // $1 — a read of the queue and a few captions.
        }),
      ],
    }),
    agent({
      name: "qa-reviewer",
      description:
        "Checks each captioned clip against its source and the channel's voice before the operator sees it; fixes the caption or flags the row.",
      brief:
        "You are the QA reviewer: the last read before the operator's. A clip under review is a pending row that carries a media_url and a written caption. Read its source (the source video, the timestamps, the reason), its caption, the niche and the source channel (channel.get_onboarding) and the account it is for (channel.list_accounts), and check the words against what the timestamps hold, the hook against the channel's voice, the source credit against the video actually named, the hashtags against the niche, and the row against its account and platform. Fix what words can fix with channel.update_post — a weak hook, a claim the moment does not support, a missing credit or hashtag, a caption too long for the platform. What words cannot fix — a source that is not the channel the operator named, a row with no account, a moment the channel already posted — you flag: put one line starting with NEEDS REWORK and the reason at the top of the caption so the operator sees it before approving. You cut nothing, file nothing, and never approve, reject or publish — those are the operator's.",
      tools: [],
      schedules: [
        schedule({
          cron: "40 7 * * *", // Daily 07:40 — after the 07:20 captions, before the manager's 08:00 sweep.
          input:
            "Review today's clips. Read the queue (channel.list_posts) and take every pending row that carries a media_url and has not already been marked NEEDS REWORK; check each against its source, the source channel the operator named, the niche and the account; fix the caption with channel.update_post where words fix it, and put a NEEDS REWORK line at the top of the caption where they do not. If there is nothing under review, say so in one line and stop.",
          budget_micro_usd: 1_000_000, // $1 — a read of the queue and a few patches.
        }),
      ],
    }),
    agent({
      name: "analytics-reporter",
      description:
        "Reads the week's numbers across the channel's accounts and reports which sources and moments to cut more of and what to stop.",
      brief:
        "You are the analytics reporter: once a week, say what the numbers say. Read every posted row (channel.list_posts — views, likes, platform, account, when it posted, and the source video and moment in its source), the accounts the channel posts to (channel.list_accounts, social.accounts), and any analytics a connected account's tools offer you this turn — use only what is offered, and never invent a number you did not read. Compare this week to the last four: which source videos, moments, hooks and posting times drew views and likes, which did not, and which account is growing. Report in one message with ask_operator: the week's numbers first, then the three things to cut more of, the one thing to stop, and the single decision the operator has to make. You file nothing to the queue, and you never publish.",
      tools: ["social.accounts"],
      schedules: [
        schedule({
          cron: "30 8 * * 1", // Monday 08:30 — the week's report, after the sweep and before the 09:00 plan.
          input:
            "Report the week. Read every posted row (channel.list_posts) and the accounts (channel.list_accounts, social.accounts), and whatever analytics a connected account's tools offer you; compare the last seven days to the four weeks before them by source video, moment, hook, account and posting time. Send one report with ask_operator: numbers first, then what to cut more of, what to stop, and the one decision the operator has to make. If nothing has posted yet, say so in one line and stop.",
          budget_micro_usd: 2_000_000, // $2 — the widest read of the week, once a week.
        }),
      ],
    }),
    agent({
      name: "channel-manager",
      description:
        "Runs the channel: plans the calendar, drafts captions, manages the post queue and replies to comments. Never publishes without an approved post.",
      brief:
        "You are the channel manager: keep the calendar full, point the desk at the source videos worth cutting through the queue, draft captions, keep the queue tidy (channel.list_posts, channel.update_post) and reply to comments in the channel's voice. Post only what the operator has approved.",
      tools: ["social.accounts", "social.post", "web_search", "web_fetch"],
      schedules: CHANNEL_MANAGER_SCHEDULES,
    }),
  ],

  kinds: [{ id: "clip", label: "Clip" }],

  questions: [
    {
      key: "niche",
      label: "Niche",
      placeholder: "Or describe your own niche…",
      options: [
        "Podcast highlights",
        "Interview moments",
        "Sports plays",
        "Comedy sets",
        "Conference talks",
        "Livestream best-of",
      ],
    },
    {
      key: "sourceChannel",
      label: "Source channel",
      placeholder: "The channel or playlist you have the rights to cut from",
      options: [],
    },
  ],

  words: {
    queueSubtitle: "Every clip the clipper cut from your source channel, on its way to your accounts.",
    queueEmpty: "Point the clipper at a source video in Chat and each cut lands here for review.",
    onboardingTitle: "What should this channel clip, and from where?",
    onboardingBlurb:
      "Name the niche and the source channel you have the rights to cut from, and I'll draft the channel: the agents, a posting calendar and a first pass at the source. You can change all of it later.",
  },
};
