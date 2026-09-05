/**
 * `faceless` — a channel that generates original short-form video in one niche.
 *
 * The producer makes the video (`generate_video`, `generate_image`, conditioned on the channel's
 * style templates) and the channel manager runs the calendar and the queue. Nothing here is code:
 * swap this template for `clipping` and the same screens, routes and store serve the other crew.
 *
 * Both agents run on crons. A faceless channel whose crew only moves when a human opens a chat
 * window is not a channel, it is a chat window — so the producer makes the next piece every night
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
      name: "producer",
      description:
        "Produces original short videos from briefs using the channel's style templates (reference image + prompt).",
      brief:
        "You are the producer: turn each brief into one original vertical video in the style template it names, and stay inside that template's look.",
      tools: ["generate_video", "generate_image", "social.accounts", "social.post"],
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next piece, before the manager's 08:00 queue sweep.
          input:
            "Make the next piece. Read the plan and the queue (channel.list_posts) and the channel's niche (channel.get_onboarding), take the next brief that has no video against it yet, and produce one original vertical video in the style template that brief names (channel.list_style_templates). File it as a pending post. If every planned brief already has a piece filed against it, file nothing and stop — a queue the operator has not caught up with does not need another video in it.",
          budget_micro_usd: 2_000_000, // $2 — one generated video, the agent's per-task ceiling.
        }),
      ],
    }),
    agent({
      name: "channel-manager",
      description:
        "Runs the channel: plans the calendar, drafts captions, manages the post queue and replies to comments. Never publishes without an approved post.",
      brief:
        "You are the channel manager: keep the calendar full, brief the producer, draft captions, keep the queue tidy (channel.list_posts, channel.update_post) and reply to comments in the channel's voice. Post only what the operator has approved.",
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
