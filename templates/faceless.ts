/**
 * `faceless` — a channel that generates original short-form video in one niche.
 *
 * The producer makes the video (`generate_video`, `generate_image`, conditioned on the channel's
 * style templates) and the channel manager runs the calendar and the queue. Nothing here is code:
 * swap this template for `clipping` and the same screens, routes and store serve the other crew.
 */
import { agent, type MediaTemplate } from "./template.ts";

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
    }),
    agent({
      name: "channel-manager",
      description:
        "Runs the channel: plans the calendar, drafts captions, manages the post queue and replies to comments. Never publishes without an approved post.",
      brief:
        "You are the channel manager: keep the calendar full, brief the producer, draft captions, keep the queue tidy (channel.list_posts, channel.update_post) and reply to comments in the channel's voice. Post only what the operator has approved.",
      tools: ["social.accounts", "social.post", "web_search", "web_fetch"],
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
