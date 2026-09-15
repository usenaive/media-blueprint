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
 * Every agent runs on crons and starts from a card. A faceless channel whose crew only moves when
 * a human opens a chat window is not a channel, it is a chat window. Read the comment on `schedule`
 * (`template.ts`) before touching a cron string here: schedules are the one place in `naive up`
 * where omission deletes, and a live row is matched by its exact cron text.
 *
 * The pieces move as a chain, not a race. Day one is the board: the apply seeds `tasks` on the
 * channel's board and the tick wakes a seat only when its card has no open blocker, so the scout's
 * briefs card is done before the scriptwriter's scripts card is due, and that before the producer's
 * render (`blocked_by`). From then on the pipeline is ordered by handoffs (`handoffs`;
 * `send_to_agent` with `wait: false`): the scout files briefs at
 * `stage: brief` and names their ids to the scriptwriter, who writes into those rows, moves them to
 * `scripted` and names them to the producer, who renders and moves them to `rendered`. The crons are
 * the fallback — 06:00 briefs, 06:30 scripts, 07:00 render — and pick up, by stage, whatever a
 * handoff did not carry. A handoff and a cron can overlap, so a seat claims a row before it spends
 * on it (`scripting` / `rendering`, with `expected_stage`): the claim is one locked write, one
 * session wins it, and the other is refused before the work — not after the render. The render is
 * also the one step that cannot be replayed, so the claim is guarded at both ends: the producer's
 * completion write carries `expected_stage` too, and the media on a row is the receipt for the
 * render, which nothing — the producer, or the sweep freeing a dead session's claim — may send back
 * to a stage before `rendered` (`server/mcp.ts`).
 */
import { agent, CADENCE_QUESTION, channelManager, channelPlanTask, PLATFORM_CHOICES, PLATFORM_QUESTION, schedule, type MediaTemplate } from "./template.ts";

export const FACELESS: MediaTemplate = {
  name: "faceless",
  description: "Generates original short-form video in one niche, from briefs, in the channel's own look.",

  agents: [
    channelManager("the trend-scout, the scriptwriter and the producer"),
    agent({
      name: "producer",
      role: "Video production",
      description:
        "Renders each scripted brief into one original vertical video in the style template it names. Files the finished piece for approval; never publishes.",
      brief:
        "You are the producer. Your work is the render: take a scripted row — one the scriptwriter named to you in a handoff, or else the next at `stage` scripted (channel.list_posts) — and claim it before you spend anything: channel.update_post with stage rendering and expected_stage scripted. A refusal means another session has it: take the next, or stop. Then produce one original vertical video, under fifteen seconds, in the style template the row names (channel.list_style_templates). Stay inside that look: the reference image and prompt are the channel's identity. The first three seconds carry the hook; render for it. Attach the video to the row with channel.update_post: `media_url`, the publishable caption the scriptwriter wrote, `stage` rendered and `expected_stage` rendering — refused there, the row is no longer yours: stop rather than render it twice. One piece per session: a handoff's other rows wait for your 07:00 fires; if nothing is at scripted, file nothing and stop. You are the end of the chain; you hand on to nobody.",
      tools: ["generate_video", "generate_image"],
      skills: ["naive/short-video-hooks"],
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next piece, before the manager's 08:00 queue sweep.
          input:
            "Make the next piece. Read the niche and tone (project_context) and the scripted rows (channel.list_posts with stage scripted); claim the next one — channel.update_post, stage rendering, expected_stage scripted; refused means it is not yours, take the next; and a row that already carries a media_url is one the channel has paid to render, so never render it again — and produce one original vertical video in the style template that row names (channel.list_style_templates). Attach it to the row with channel.update_post — media_url, the publishable caption, stage rendered, expected_stage rendering; refused there means the row moved on while you rendered, so say so and stop rather than render a second time. If nothing is at scripted, file nothing and stop. If generate_video is not among your tools, or it refuses for want of a model, render nothing: request exactly what is missing with request_tools — generate_video at allow, with the model to render with in config.models — once, then wait; if it is granted, carry on with the piece, and if it is refused, stop for tonight.",
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
        "You are the trend-scout, the head of the chain. You watch the niche, not the whole internet: read what is moving in it this week (web_search, web_fetch) — formats getting picked up, questions the audience asks, moments worth a short — and brief the best. A brief is a pending post with no media, filed with `stage` brief: its caption states the topic, the format, why now, the hook direction and the style template it should be rendered in, and its `source` names where you saw it. File only what the cadence calls for; five good briefs beat twenty thin ones. Do not restate a topic already queued or posted (channel.list_posts). When the last brief is filed — and only then — send_to_agent the scriptwriter once, wait false: the exact post ids you filed, the instruction to script them, a handoff_key naming today's date. Filed nothing, hand on nothing. You never script or render — the scriptwriter and producer take it from your brief.",
      tools: ["web_search", "web_fetch"],
      skills: ["naive/seo-content-brief", "naive/short-video-hooks"],
      handoffs: ["scriptwriter"],
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
        "Writes the hook, the script and the publishable caption for every brief before the producer renders it.",
      brief:
        "You are the scriptwriter. Briefs reach you two ways: named by id in a handoff from the trend-scout, or at `stage` brief on your 06:30 fire (channel.list_posts, stage brief). Claim each before you write it — channel.update_post, stage scripting, expected_stage brief; a refusal means another session has that row. Each row you claimed gets a hook that lands in the first three seconds, a script for a piece under fifteen seconds in the channel's tone, and the hashtagged caption that goes out with it (`naive/short-video-hooks`, `naive/caption-writing`), written into the row with channel.update_post — caption and `stage` scripted — keeping the brief's topic, format and style template. Write for the audience the context names, in its words, never a general one. When the last claimed row is scripted, send_to_agent the producer once, wait false: those ids, the instruction to render, the handoff_key you were handed or today's date; claimed nothing, hand on nothing. You neither render nor file topics — the trend-scout finds them, the producer makes them.",
      tools: ["web_search", "web_fetch"],
      skills: ["naive/short-video-hooks", "naive/caption-writing"],
      handoffs: ["producer"],
      schedules: [
        schedule({
          cron: "30 6 * * *", // Daily 06:30 — scripts on the night's briefs, before the producer's 07:00 render.
          input:
            "Script what the handoffs missed. Read project_context, then every row still at stage brief (channel.list_posts, stage brief); claim each — channel.update_post, stage scripting, expected_stage brief; skip any refused — and write hook, script and publishable caption into it with channel.update_post, stage scripted, in the channel's tone, for its audience. Then send_to_agent the producer once, wait false, with the ids you scripted, handoff_key scripts-<today's date>. Nothing claimed means nothing to do, and no trigger.",
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

  /**
   * Day one, as cards. One per seat; the chain is `blocked_by`, so the scriptwriter is woken with
   * five briefs already filed and the producer with a scripted row already waiting — nobody reads
   * an empty queue and reports it as a finding. The handover from one card to the next is the
   * `done` note: the ids of the rows it filed.
   */
  tasks: [
    channelPlanTask("the channel's tone and who it is for, in one line — the setup form asked for the niche and not for this."),
    {
      key: "briefs",
      title: "File the channel's first five briefs",
      assignee: "trend-scout",
      body:
        "Read project_context for the niche, the audience and the cadence. Research what is moving in that niche right now and file the channel's first five briefs as pending posts (channel.create_post, no media, stage brief, `source` naming where each came from): topic, format, why now, hook direction, style template. Skip anything already in the queue (channel.list_posts). " +
        "Done when five briefs stand at stage brief; your done note lists their post ids, because the scriptwriter's card is woken from it. Acceptance: each brief names topic, format, why now, hook direction and a style template; none repeats a queued or posted topic; every `source` names where you saw it. Nothing is scripted or rendered here.",
    },
    {
      key: "scripts",
      title: "Script the first five briefs",
      assignee: "scriptwriter",
      blocked_by: ["briefs"],
      body:
        "Read project_context for the niche, the tone and the audience. First write the channel's hook style in five lines — the openings this audience stops for, the length, the voice, the caption shape, what never to say — and file it as a pending post with no media and no stage, `source` \"hook style\", so the team works to one voice. Then script the briefs the trend-scout's card left at stage brief (channel.list_posts, stage brief): claim each first (channel.update_post, stage scripting, expected_stage brief — refused means another session has it), write three candidate hooks and pick the strongest, then write hook, script and publishable caption into the row with stage scripted. " +
        "Done when the hook style is filed and every brief you claimed stands at stage scripted; your done note lists the scripted post ids, because the producer's card is woken from it. Acceptance: each hook lands in the first three seconds; each script is under fifteen seconds in the channel's tone; each caption is publishable and hashtagged; the brief's topic, format and style template are kept. Render nothing.",
    },
    {
      key: "render",
      title: "Render the channel's first piece",
      assignee: "producer",
      blocked_by: ["scripts"],
      body:
        "Read project_context for the niche, the tone and the audience, then the style templates (channel.list_style_templates). Choose the one or two templates whose look fits the tone answer and file the choice as a pending post with no media and no stage, `source` \"style choice\", one line on why for each. Check that generate_video is among your tools; if it is not, request exactly it with request_tools, once, and move this card to blocked until it is granted. Then take one scripted row (channel.list_posts, stage scripted), claim it (channel.update_post, stage rendering, expected_stage scripted — refused means it is not yours, take the next) and render one original vertical video under fifteen seconds in the style template the row names, the hook in the first three seconds. Attach it with channel.update_post: media_url, the scriptwriter's caption, stage rendered, expected_stage rendering. " +
        "Done when the style choice is filed and one row carries a media_url at stage rendered; your done note names that row. Acceptance: exactly one render — the other scripted rows wait for your 07:00 fires — and never a second render of a row that already carries a media_url.",
    },
    {
      key: "report-skeleton",
      title: "Set up the weekly report",
      assignee: "analyst",
      body:
        "Read project_context for the niche, the audience and the cadence, then the queue (channel.list_posts). Set up the report skeleton this channel will use every week: the post kinds it files, the metrics you will read for each and where they come from, and the cadence-sized target for the week. " +
        "Done when it is filed as a pending post with no media, `source` \"report skeleton\", so the team can read what it will be measured against. Acceptance: every post kind of this template has a line; every metric names its source or is marked as not offered yet; the weekly target is derived from the cadence answer and says so.",
    },
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
   * is now the first thing the channel manager asks the operator on its first card. Where a
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
