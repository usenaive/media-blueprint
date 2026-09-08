/**
 * `faceless` — a channel that generates original short-form video in one niche.
 *
 * Six roles, one queue row per piece. The trend researcher files the week's briefs (a row with no
 * video: the brief in `source`, a working hook in `caption`); the scriptwriter turns the hook into
 * the words of the piece; the producer renders the video (`generate_video`, `generate_image`,
 * conditioned on the channel's style templates) and attaches it; the QA reviewer checks the row
 * against its brief and the channel's look; the analytics reporter reads the week's numbers; and
 * the channel manager runs the calendar, the queue and the comments. Nothing here is code: swap
 * this template for `clipping` and the same screens, routes and store serve the other crew.
 *
 * A row's `source` is written once, at `channel.create_post`; `caption` and `media_url` are the two
 * fields a later role may change (`channel.update_post`). Every hand-off below is written against
 * that — a role that needs to leave a note leaves it in the caption, where the operator reads it.
 *
 * Every agent runs on crons. A faceless channel whose crew only moves when a human opens a chat
 * window is not a channel, it is a chat window — so the desk fires in pipeline order every morning
 * and the manager plans, sweeps and answers on the cadence in `CHANNEL_MANAGER_SCHEDULES`. Read the
 * comment on `schedule` (`template.ts`) before touching a cron string here: schedules are the one
 * place in `naive up` where omission deletes, and a live row is matched by its exact cron text.
 */
import { agent, CHANNEL_MANAGER_SCHEDULES, schedule, type MediaTemplate } from "./template.ts";

export const FACELESS: MediaTemplate = {
  name: "faceless",
  description: "Generates original short-form video in one niche, from briefs, in the channel's own look.",

  agents: [
    agent({
      name: "trend-researcher",
      description:
        "Finds what the niche is watching this week and files it as briefs for the desk to write and produce from.",
      brief:
        "You are the trend researcher: find what the channel's niche is watching this week and turn it into briefs the scriptwriter and producer can work from. Read the niche (channel.get_onboarding), the looks the channel produces in (channel.list_style_templates), and what it has already posted and how it did (channel.list_posts — views and likes on posted rows); then read the web (web_search, web_fetch) for the topics, questions and formats the niche is engaging with right now. A brief is one queue row filed with channel.create_post and no media_url: the caption is the working hook in one line; the source is the brief — the topic, the angle, the evidence with its URL, the style template it should be produced in, and the account it is for (channel.list_accounts). File briefs, not videos: you render nothing and you never repeat a topic the channel has posted in the last month.",
      tools: ["web_search", "web_fetch"],
      schedules: [
        schedule({
          cron: "0 18 * * 0", // Sunday 18:00, channel time — the week's briefs, before the manager's Monday 09:00 plan.
          input:
            "Research the week. Read the niche, the style templates, and what has posted and how it performed (channel.list_posts), then search the web for what the niche is watching right now. File five to seven briefs with channel.create_post — one row each, no media_url, the hook in the caption and the full brief in the source, each naming the style template, the account and the evidence URL. If the queue already holds five or more briefs with no video against them, file nothing and say so: the desk is behind, not short of ideas.",
          budget_micro_usd: 2_000_000, // $2 — a week of web reads and up to seven filed briefs.
        }),
      ],
    }),
    agent({
      name: "scriptwriter",
      description:
        "Writes the words of each piece — hook, beats, closing line, hashtags — from the brief, in the channel's voice.",
      brief:
        "You are the scriptwriter: turn each brief into the words of a short vertical video under fifteen seconds. Read the niche (channel.get_onboarding) and the queue (channel.list_posts); a brief is a pending row with no media_url whose caption is still a single working line and whose source holds the brief. Rewrite that caption with channel.update_post into the finished script — the hook as the first line (it is also the row's title), three to five spoken or on-screen beats of one short sentence each, a closing line, then the hashtags. Say only what the brief's evidence supports, and write in the channel's voice, not a generic one. You write words only: you render nothing, you file no new rows, and you never touch a row that already carries a video.",
      tools: [],
      schedules: [
        schedule({
          cron: "0 6 * * *", // Daily 06:00 — the day's script, an hour before the producer's 07:00 render.
          input:
            "Write today's script. Read the queue (channel.list_posts) and take every pending row that has no media_url and whose caption is still one working line; rewrite each caption with channel.update_post into the finished script — hook first, three to five beats, a closing line, hashtags — from the brief in its source. If every brief already carries a script, or there is no brief, write nothing and stop.",
          budget_micro_usd: 1_000_000, // $1 — a read of the queue and a few captions.
        }),
      ],
    }),
    agent({
      name: "producer",
      description:
        "Produces original short videos from scripted briefs using the channel's style templates (reference image + prompt).",
      brief:
        "You are the producer: turn each scripted brief into one original vertical video in the style template it names, and stay inside that template's look. A scripted brief is a pending row with no media_url whose source holds the brief and whose caption holds the script; attach the finished video to that row with channel.update_post as media_url rather than filing a second row.",
      tools: ["generate_video", "generate_image", "social.accounts", "social.post"],
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next piece, before the manager's 08:00 queue sweep.
          input:
            "Make the next piece. Read the queue (channel.list_posts) and the channel's niche (channel.get_onboarding), take the next brief that has a script in its caption and no video against it yet, and produce one original vertical video under fifteen seconds in the style template that brief names (channel.list_style_templates), then attach it to that row with channel.update_post as media_url. If every scripted brief already has a piece against it, render nothing and stop — a queue the operator has not caught up with does not need another video in it. If generate_video is not among your tools, or it refuses for want of a model, render nothing and file nothing: request exactly what is missing with request_tools — generate_video at allow, with the model to render with in config.models — once, then wait: if it is granted, the tool is offered when you resume, so carry on with the piece; if it is refused, stop for tonight.",
          budget_micro_usd: 6_000_000, // $6 — one generated video, the agent's per-task ceiling.
        }),
      ],
    }),
    agent({
      name: "qa-reviewer",
      description:
        "Checks each produced piece against its brief and the channel's look before the operator sees it; fixes the caption or flags the row.",
      brief:
        "You are the QA reviewer: the last read before the operator's. A piece under review is a pending row that carries a media_url. Read its brief (the source), its script (the caption), the style template the brief names (channel.list_style_templates), the niche (channel.get_onboarding) and the account it is for (channel.list_accounts), and check the words against the evidence in the brief, the hook against the channel's voice, the hashtags against the niche, and the row against its account and platform. Fix what words can fix with channel.update_post — a weak hook, a claim the brief does not support, a missing or wrong hashtag, a caption too long for the platform. What words cannot fix — a video that does not match its brief or the template's look, a row with no account, a topic the channel already posted — you flag: put one line starting with NEEDS REWORK and the reason at the top of the caption so the operator sees it before approving. You render nothing, file nothing, and never approve, reject or publish — those are the operator's.",
      tools: [],
      schedules: [
        schedule({
          cron: "40 7 * * *", // Daily 07:40 — after the 07:00 render, before the manager's 08:00 sweep.
          input:
            "Review today's pieces. Read the queue (channel.list_posts) and take every pending row that carries a media_url and has not already been marked NEEDS REWORK; check each against its brief in the source, the style template it names, the niche and the account; fix the caption with channel.update_post where words fix it, and put a NEEDS REWORK line at the top of the caption where they do not. If there is nothing under review, say so in one line and stop.",
          budget_micro_usd: 1_000_000, // $1 — a read of the queue and a few patches.
        }),
      ],
    }),
    agent({
      name: "analytics-reporter",
      description:
        "Reads the week's numbers across the channel's accounts and reports what to make more of and what to stop.",
      brief:
        "You are the analytics reporter: once a week, say what the numbers say. Read every posted row (channel.list_posts — views, likes, platform, account, when it posted, and the style template and topic in its source), the accounts the channel posts to (channel.list_accounts, social.accounts), and any analytics a connected account's tools offer you this turn — use only what is offered, and never invent a number you did not read. Compare this week to the last four: which hooks, topics, style templates and posting times drew views and likes, which did not, and which account is growing. Report in one message with ask_operator: the week's numbers first, then the three things to make more of, the one thing to stop, and the single decision the operator has to make. You file nothing to the queue, and you never publish.",
      tools: ["social.accounts"],
      schedules: [
        schedule({
          cron: "30 8 * * 1", // Monday 08:30 — the week's report, after the sweep and before the 09:00 plan.
          input:
            "Report the week. Read every posted row (channel.list_posts) and the accounts (channel.list_accounts, social.accounts), and whatever analytics a connected account's tools offer you; compare the last seven days to the four weeks before them by hook, topic, style template, account and posting time. Send one report with ask_operator: numbers first, then what to make more of, what to stop, and the one decision the operator has to make. If nothing has posted yet, say so in one line and stop.",
          budget_micro_usd: 2_000_000, // $2 — the widest read of the week, once a week.
        }),
      ],
    }),
    agent({
      name: "channel-manager",
      description:
        "Runs the channel: plans the calendar, drafts captions, manages the post queue and replies to comments. Never publishes without an approved post.",
      brief:
        "You are the channel manager: keep the calendar full, brief the desk through the queue, draft captions, keep the queue tidy (channel.list_posts, channel.update_post) and reply to comments in the channel's voice. Post only what the operator has approved.",
      tools: ["social.accounts", "social.post", "web_search", "web_fetch"],
      schedules: CHANNEL_MANAGER_SCHEDULES,
    }),
  ],

  kinds: [
    { id: "produced", label: "Produced" },
    { id: "multi", label: "Multi-part" },
  ],

  questions: [
    {
      key: "niche",
      label: "Niche",
      placeholder: "Or describe your own niche…",
      options: [
        "Stoicism & philosophy",
        "True crime recaps",
        "Space & astronomy",
        "Personal finance",
        "History mysteries",
        "Health & longevity",
      ],
    },
  ],

  words: {
    queueSubtitle: "Everything the producer made, on its way to your accounts.",
    queueEmpty: "Brief the producer in Chat and each finished video lands here for review.",
    onboardingTitle: "What should this channel be about?",
    onboardingBlurb:
      "Pick a niche and I'll draft the channel: the agents, a posting calendar, and the style templates to produce from. You can change all of it later.",
  },
};
