/**
 * `faceless` — a channel that generates original short-form video in one niche.
 *
 * Five seats. The trend-scout finds what is moving in the niche and files briefs; the scriptwriter
 * turns each into a video project — the plan: scenes, prompts, voiceover, model, look, caption
 * (`channel.create_project`); the producer renders that plan (`generate_video`, `generate_image`,
 * conditioned on the channel's style templates) and finishes it, which files the post; the analyst
 * reports weekly per post kind; the channel manager plans the week from the cadence answer and
 * keeps the queue and the comments.
 * Nothing here is code: swap this template for `clipping` and the same screens, routes and store
 * serve the other crew.
 *
 * Every agent runs on crons and opens with an intake. A faceless channel whose crew only moves when
 * a human opens a chat window is not a channel, it is a chat window. Read the comment on `schedule`
 * (`template.ts`) before touching a cron string here: schedules are the one place in `naive up`
 * where omission deletes, and a live row is matched by its exact cron text.
 *
 * The pieces move as a chain, not a race. The apply opens every intake at once — declaration order
 * is not execution order — so no seat's first session reads another's; the intakes are set-up, and
 * the pipeline is ordered by handoffs (`handoffs`; `send_to_agent` with `wait: false`): the scout files briefs at
 * `stage: brief` and names their ids to the scriptwriter, who writes a video project against each
 * (the row moves to `scripted` with the plan on it) and names the project ids to the producer, who
 * renders the plan and finishes it (`rendered`, on the project and the row). The crons are the
 * fallback — 06:00 briefs, 06:30 plans, 07:00 render — and pick up, by stage and by status,
 * whatever a handoff did not carry. A handoff and a cron can overlap, so a seat claims before it
 * spends: the writer claims the row (`scripting`, `expected_stage: brief`), the producer claims the
 * plan (`rendering`, `expected_status: planned`); each claim is one locked write, one session wins
 * it, and the other is refused before the work — not after the render. The render is also the one
 * step that cannot be replayed, so the claim is guarded at both ends: the producer's completion
 * write carries `expected_status` too, and a rendered plan — and the media on its row — is the
 * receipt for the render, which nothing — the producer, or the sweep freeing a dead session's
 * claim — may send back (`server/mcp.ts`).
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
        "Renders each planned video project into one original vertical video — one render, every scene in it — in the model and style template the plan names. Finishing the plan files the piece for approval; never publishes.",
      brief:
        "You are the producer: yours is the render, not the plan. Take a planned generation project, one named to you by the operator or a handoff or the next planned (channel.list_projects), and claim it before you spend anything: channel.update_project, status rendering and expected_status planned. Refused, another has it: take the next. Read the plan (channel.get_project) and its style template (channel.list_style_templates). Render it as one generate_video call — nothing here joins clips: the prompt is the scenes in order with seconds, voiceover, on-screen text and look; seconds their sum; aspect_ratio 9:16; its model. Wait for the file. Do not rewrite it. Finish with channel.update_project: status rendered, expected_status rendering, the video as `media_url`, your name as `agent`. Refused there, the plan moved on: never render twice. A revision arrives as a message on your session: re-read the plan with channel.get_project, apply the operator's note, finish with the same update_project write. Never open a second project. One plan per session; nothing planned, render nothing. You end the chain.",
      tools: ["generate_video", "generate_image"],
      skills: ["naive/short-video-hooks"],
      intake: {
        message:
          "Day one is set-up, not a render. Do not read the queue for work: the first plan reaches you as a handoff from the scriptwriter, in its own session, naming the video project to render. Read project_context for the niche, the tone and the audience, then the style templates (channel.list_style_templates). Choose the one or two templates whose look fits the tone answer and file the choice as a pending post with no media and no stage, `source` \"style choice\", one line on why for each. Then check that generate_video is among your tools; if it is not, request exactly it with request_tools, once. Render nothing in this session.",
        budget_micro_usd: 8_000_000,
      },
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next piece, before the manager's 08:00 queue sweep.
          input:
            "Make the next piece. Read the niche and tone (project_context) and the planned generation projects (channel.list_projects, status planned, kind generation); claim the next one — channel.update_project, status rendering, expected_status planned; refused means it is not yours, take the next; and a rendered plan is one the channel has paid for, so never render it again. Read the plan in full (channel.get_project) and render it as one generate_video call — nothing joins clips: prompt the scenes in order with their seconds, voiceover and on-screen text and the look of the style template it names (channel.list_style_templates); seconds their sum; aspect_ratio 9:16; its model. Wait for the file. Finish it with channel.update_project — status rendered, expected_status rendering, media_url, your name as agent; refused there means the plan moved on while you rendered, so say so and stop rather than render a second time. If nothing is planned, render nothing and stop. If generate_video is not among your tools, or it refuses for want of a model, render nothing: request exactly what is missing with request_tools — generate_video at allow, with the model to render with in config.models — once, then wait; if it is granted, carry on with the piece, and if it is refused, stop for tonight.",
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
        "You are the trend-scout, the head of the chain. You watch the niche, not the whole internet: read what is moving in it this week (web_search, web_fetch) — formats getting picked up, questions the audience asks, moments worth a short — and brief the best. A brief is a pending post with no media, filed with `stage` brief: its caption states the topic, the format, why now, the hook direction and the style template to render in; its `source` names where you saw it. File only what the cadence calls for; five good briefs beat twenty thin ones. Do not restate a topic already queued or posted (channel.list_posts). When the last brief is filed — and only then — send_to_agent the scriptwriter once, wait false: the exact post ids, the instruction to plan them, a handoff_key naming today's date. Filed nothing, hand on nothing. You never plan or render — the scriptwriter and producer take it from your brief.",
      tools: ["web_search", "web_fetch"],
      skills: ["naive/seo-content-brief", "naive/short-video-hooks"],
      handoffs: ["scriptwriter"],
      intake: {
        message:
          "Day one. Read project_context for the niche, the audience and the cadence. Research what is moving in that niche right now and file the channel's first five briefs as pending posts (channel.create_post, no media, stage brief, `source` naming where each came from): topic, format, why now, hook direction, style template. Skip anything already in the queue. When all five are filed, send_to_agent the scriptwriter once — wait false, the message \"script these briefs\" with the five post ids, handoff_key \"briefs-day-one\" — and stop. That handoff, not a timer, is how day one gets its first scripts.",
        budget_micro_usd: 20_000_000,
      },
      schedules: [
        schedule({
          cron: "0 6 * * 1,4", // Monday and Thursday 06:00 — the week's briefs, and a mid-week refill.
          input:
            "Scout the niche. Read project_context and the queue (channel.list_posts), research what is moving in the niche this week, and file as many new briefs as the cadence needs until the next fire — each a pending post with no media, stage brief, naming topic, format, why now, hook direction and style template. Nothing already queued or posted. Then send_to_agent the scriptwriter once, wait false, with the ids you filed, handoff_key briefs-<today's date>; if you filed none, hand on nothing.",
          budget_micro_usd: 10_000_000, // $10 — a read of the niche and a handful of filings.
        }),
      ],
    }),
    agent({
      name: "scriptwriter",
      role: "Hooks & scripts",
      description:
        "Turns every brief into a video project — the scene plan, the prompts, the voiceover, the model, the look and the publishable caption — before the producer renders it.",
      brief:
        "You are the scriptwriter; what you write is the plan. Briefs reach you named by id in a handoff from the trend-scout, or at `stage` brief on your 06:30 fire (channel.list_posts). Claim each before you write it — channel.update_post, stage scripting, expected_stage brief; a refusal means another session has that row. Each claimed row becomes one video project (channel.create_project, kind generation, post_id the row, your name as agent): title; the brief's reasoning; style template (channel.list_style_templates) and video model; the scenes in order — render prompt inside that look, seconds, voiceover line, on-screen text — hook in the first scene, under fifteen seconds in all; the hashtagged caption (`naive/short-video-hooks`, `naive/caption-writing`). Filing it moves the row to `stage` scripted. Write for the audience the context names, in its words. When the last row is planned, send_to_agent the producer once, wait false: the project ids, the instruction to render, the handoff_key you were handed or today's date; claimed nothing, hand on nothing. You neither render nor find topics.",
      tools: ["web_search", "web_fetch"],
      skills: ["naive/short-video-hooks", "naive/caption-writing"],
      handoffs: ["producer"],
      intake: {
        message:
          "Day one is set-up, not scripts. Read project_context for the niche, the tone and the audience. Write the channel's hook style in five lines — the openings this audience stops for, the length, the voice, the caption shape, what never to say — and file it as a pending post with no media and no stage, `source` \"hook style\", so the team works to one voice. Do not read the queue for briefs and do not invent one: the trend-scout's first five reach you as a handoff naming their ids, in a session of your own, and that is where you plan them — each claimed first (stage scripting, expected_stage brief), three candidate hooks, the strongest picked, then one video project per row (channel.create_project: kind generation, post_id, title, brief, style template, model, scenes with prompt, seconds, voiceover and on-screen text, caption), then one send_to_agent to the producer, wait false, with the project ids. Stop here.",
        budget_micro_usd: 8_000_000,
      },
      schedules: [
        schedule({
          // Daily 06:30 — scripts on the night's briefs, before the producer's 07:00 render, and the
          // only seat that rescues a row stranded at `scripted` with no plan on it. The producer now
          // reads plans (`channel.list_projects`), not rows, so a row the old chain moved to
          // `scripted` by writing the script into its caption is read by nobody: the writer's list
          // (stage brief) skips it and the producer's (status planned) never sees it. `list_posts`
          // filters on status and stage only, so the missing plan is not a filter — it is `projectId`
          // on the rows that come back, which is why the fire is told to read stage `scripted` and
          // then drop the ones that carry one. `scripting` is left out on purpose: a row there may
          // be a live claim, and `expected_stage scripting` would not tell the two apart, so a stale
          // one is aged back to `brief` by the manager's 08:00 sweep and picked up here on the next fire.
          cron: "30 6 * * *",
          input:
            "Plan what the handoffs missed. Read project_context, then every row still at stage brief (channel.list_posts, stage brief); claim each — channel.update_post, stage scripting, expected_stage brief; skip any refused. Then the rows nothing else will ever take: channel.list_posts, stage scripted, keeping only those that carry no projectId — their plan was never written, so no producer can render them; claim each the same way, channel.update_post, stage scripting, expected_stage scripted, and plan it from the caption already on the row rather than inventing a new topic. Write every claimed row's video project with channel.create_project (kind generation, post_id the row): title, brief, style template, video model, the scenes in order with prompt, seconds, voiceover and on-screen text, and the publishable caption, in the channel's tone, for its audience; filing it puts the row back at stage scripted with the plan on it. Then send_to_agent the producer once, wait false, with the project ids you planned, handoff_key plans-<today's date>. Nothing claimed means nothing to do, and no trigger.",
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
    plansSubtitle: "Every scene plan the scriptwriter wrote, and what the producer has made of it.",
    plansEmpty: "The scriptwriter plans each brief here — scenes, prompts, model and look — before the producer spends a render on it.",
  },
};
