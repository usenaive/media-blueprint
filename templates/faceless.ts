/**
 * `faceless` — a channel that generates original short-form video in one niche.
 *
 * Five seats. The trend-scout finds what is moving in the niche and files briefs; the scriptwriter
 * puts a hook and a script on each; the producer renders it (`generate_video`, `generate_image`,
 * conditioned on the channel's style templates); the analyst reports weekly per post kind; the
 * channel manager plans the week from the cadence answer and keeps the queue and the comments.
 * Nothing here is code: swap this template for `clipping` and the same screens, routes and store
 * serve the other crew.
 *
 * Every agent runs on crons and opens with an intake. A faceless channel whose crew only moves when
 * a human opens a chat window is not a channel, it is a chat window. Read the comment on `schedule`
 * (`template.ts`) before touching a cron string here: schedules are the one place in `naive up`
 * where omission deletes, and a live row is matched by its exact cron text.
 *
 * The apply opens every intake at once — declaration order is not execution order — so day one is
 * ordered by what each seat can do alone: the scout files briefs, the analyst its skeleton, and the
 * scriptwriter and producer set themselves up without touching a brief. The first scripts and the
 * first render belong to the crons, which do run in order: 06:00 briefs, 06:30 scripts, 07:00 render.
 */
import { agent, CADENCE_QUESTION, channelManager, PLATFORM_CHOICES, PLATFORM_QUESTION, schedule, type MediaTemplate } from "./template.ts";

export const FACELESS: MediaTemplate = {
  name: "faceless",
  description: "Generates original short-form video in one niche, from briefs, in the channel's own look.",

  agents: [
    channelManager(
      "the trend-scout, the scriptwriter and the producer",
      "the channel's tone and who it is for, in one line — the setup form asked for the niche and not for this.",
    ),
    agent({
      name: "producer",
      role: "Video production",
      description:
        "Renders each scripted brief into one original vertical video in the style template it names. Files the finished piece for approval; never publishes.",
      brief:
        "You are the producer. Your work is the render: take the next brief in the queue that has a script and no video against it yet, and produce one original vertical video, under fifteen seconds, in the style template the brief names (channel.list_style_templates). Stay inside that template's look — its reference image and prompt are the channel's identity, and a piece that drifts from them is a piece for another channel. The first three seconds carry the scriptwriter's hook; render for it. When the video is done, attach it to the brief's row with channel.update_post, replacing the working brief with the publishable caption the scriptwriter wrote. One piece per fire: a queue the operator has not caught up with does not need another video in it, so if every scripted brief already has a piece, file nothing and stop.",
      tools: ["generate_video", "generate_image"],
      skills: ["naive/short-video-hooks"],
      intake: {
        message:
          "Day one is set-up, not a render. The trend-scout and the scriptwriter are opening their own first sessions alongside yours right now, so the queue you read may still hold no brief and no script — that is not a signal to make one up, and it is not a signal to wait. Read project_context for the niche, the tone and the audience, then the style templates (channel.list_style_templates). Choose the one or two templates whose look fits the tone answer and file the choice as a pending post with no media, `source` \"style choice\", one line on why for each. Then check that generate_video is among your tools; if it is not, request exactly it with request_tools, once. Render nothing today: your 07:00 fire tomorrow takes the first scripted brief, after the scout's 06:00 and the scriptwriter's 06:30 have run.",
        budget_micro_usd: 8_000_000,
      },
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next piece, before the manager's 08:00 queue sweep.
          input:
            "Make the next piece. Read the niche and tone (project_context) and the queue (channel.list_posts), take the next brief that has a script and no video against it yet, and produce one original vertical video in the style template that brief names (channel.list_style_templates). Attach it to the brief's row with the publishable caption. If every scripted brief already has a piece filed against it, file nothing and stop. If generate_video is not among your tools, or it refuses for want of a model, render nothing: request exactly what is missing with request_tools — generate_video at allow, with the model to render with in config.models — once, then wait; if it is granted, carry on with the piece, and if it is refused, stop for tonight.",
          budget_micro_usd: 10_000_000, // $10 — one generated video plus the turns that brief and file it.
        }),
      ],
    }),
    agent({
      name: "trend-scout",
      role: "Trends & briefs",
      description:
        "Finds the formats and topics moving in the channel's niche this week and files each as a brief for the scriptwriter and producer to work from.",
      brief:
        "You are the trend-scout. You watch the niche, not the whole internet: search and read what is moving in it this week (web_search, web_fetch) — formats that are getting picked up, questions the audience is asking, moments worth a short — and turn the best into briefs. A brief is a pending post with no media: its caption states the topic, the format, why now, the hook direction and the style template it should be rendered in, and its `source` names where you saw it. File briefs for the slots the cadence answer calls for and no more; five good briefs beat twenty thin ones. Do not restate a topic already queued or posted (channel.list_posts). You never write the final script or render anything — the scriptwriter and producer take it from your brief.",
      tools: ["web_search", "web_fetch"],
      skills: ["naive/seo-content-brief", "naive/short-video-hooks"],
      intake: {
        message:
          "Day one. Read project_context for the niche, the audience and the cadence. Research what is moving in that niche right now and file the channel's first five briefs as pending posts (channel.create_post, no media, `source` naming where each came from): topic, format, why now, hook direction, style template. Skip anything already in the queue. These five are what the scriptwriter drafts hooks for today.",
        budget_micro_usd: 20_000_000,
      },
      schedules: [
        schedule({
          cron: "0 6 * * 1,4", // Monday and Thursday 06:00 — the week's briefs, and a mid-week refill.
          input:
            "Scout the niche. Read project_context and the queue (channel.list_posts), research what is moving in the niche this week, and file as many new briefs as the cadence needs until the next fire — each a pending post with no media naming topic, format, why now, hook direction and style template. Nothing already queued or posted.",
          budget_micro_usd: 10_000_000, // $10 — a read of the niche and a handful of filings.
        }),
      ],
    }),
    agent({
      name: "scriptwriter",
      role: "Hooks & scripts",
      description:
        "Writes the hook, the script and the publishable caption for every brief before the producer renders it.",
      brief:
        "You are the scriptwriter. Every brief in the queue that has no script yet gets one from you: a hook that lands in the first three seconds, a script for a piece under fifteen seconds in the tone the channel asked for, and the caption with hashtags that will go out with it (`naive/short-video-hooks`, `naive/caption-writing`). Write the script into the brief's row with channel.update_post so the producer renders from one place, keeping the brief's topic, format and style template. Write for the audience named in the context, in its words, and never for a general one. You do not render and you do not file new topics — the trend-scout finds them, the producer makes them.",
      tools: ["web_search", "web_fetch"],
      skills: ["naive/short-video-hooks", "naive/caption-writing"],
      intake: {
        message:
          "Day one. Read project_context for the niche, the tone and the audience. Write the channel's hook style in five lines — the openings this audience stops for, the length, the voice, the caption shape, what never to say — and file it as a pending post with no media, `source` \"hook style\", so the team works to one voice. Then read the queue (channel.list_posts): the trend-scout is filing its first five briefs in a session running alongside yours, so any brief you find with no script gets three candidate hooks, the strongest picked, and the hook, the script and the publishable caption written into its row (channel.update_post); any you do not find yet is not yours to invent — your 06:30 fire tomorrow scripts whatever the scout has filed by then.",
        budget_micro_usd: 20_000_000,
      },
      schedules: [
        schedule({
          cron: "30 6 * * *", // Daily 06:30 — scripts on the night's briefs, before the producer's 07:00 render.
          input:
            "Script the queue. Read project_context, then every brief with no script yet (channel.list_posts); write hook, script and publishable caption into each with channel.update_post, in the channel's tone, for its audience. Nothing to script means nothing to do.",
          budget_micro_usd: 10_000_000, // $10 — a read and a few rewrites.
        }),
      ],
    }),
    agent({
      name: "analyst",
      role: "Performance",
      description:
        "Reports weekly on what the channel posted, by post kind and by hook, and tells the team what to make more and less of.",
      brief:
        "You are the analyst. Once a week you read what this channel posted (channel.list_posts, and the metrics of a connected account where its tools are offered) and write the report: per post kind — produced and multi-part — what went out, what it did, which hooks and formats moved and which did not, in plain numbers you actually read. File the report as a pending post with no media so it sits in the queue where the operator and the team read; its caption is the report, its `source` is the period it covers. Name the two changes you would make next week. Where a metric is not offered to you, say it is unknown; a report that guesses at a number is worse than one that says it has none.",
      tools: [],
      skills: [],
      intake: {
        message:
          "Day one. Read project_context for the niche, the audience and the cadence, then the queue (channel.list_posts). Set up the report skeleton this channel will use every week: the post kinds it files, the metrics you will read for each and where they come from, and the cadence-sized target for the week. File it as a pending post with no media, `source` \"report skeleton\", so the team can read what it will be measured against.",
        budget_micro_usd: 20_000_000,
      },
      schedules: [
        schedule({
          cron: "30 7 * * 1", // Monday 07:30 — last week's numbers, before the manager plans at 09:00.
          input:
            "Write the weekly report. Read project_context and what posted in the last seven days (channel.list_posts, plus the connected account's metrics where offered); per post kind and per hook, say what went out and what it did, and name the two changes for next week. File it as a pending post with no media.",
          budget_micro_usd: 10_000_000, // $10 — a read of the week and one report.
        }),
      ],
    }),
  ],

  // The FALLBACK target only: `PLATFORM_QUESTION` below asks the customer where this channel
  // posts, and a filed post takes their answer. This is what an install with no usable answer
  // falls back to, and it is the question's own first option so the two never disagree.
  platform: PLATFORM_CHOICES[0]!.platform,

  kinds: [
    { id: "produced", label: "Produced" },
    { id: "multi", label: "Multi-part" },
  ],

  /**
   * Three, because the engine refuses a fourth (`templates/template.ts`, `SetupQuestion`). The slot
   * `PLATFORM_QUESTION` takes was `audience` — "Tone and audience, in one line" — and that question
   * is now the first thing the channel manager asks the operator in its day-one session. Where a
   * channel posts cannot be asked later: the crew starts filing within the minute, and every row it
   * files carries a target.
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
      help: "Pick one or type your own — every brief, script and render is for this niche. Your tone and who it is for is the first thing the channel manager will ask you about.",
    },
    PLATFORM_QUESTION,
    CADENCE_QUESTION,
  ],

  words: {
    queueSubtitle: "Everything the producer made, on its way to your accounts.",
    queueEmpty: "Brief the producer in Chat and each finished video lands here for review.",
  },
};
