/**
 * `clipping` — a channel that repurposes existing video in one niche.
 *
 * The clipper cuts source video the operator has the rights to (`clip_video`) and the channel
 * manager runs the calendar and the queue. It asks for one thing `faceless` does not: the source
 * channel to cut from. That difference is this file's, not the Onboarding screen's — the screen
 * asks whatever the active template's `questions` list.
 *
 * Both agents run on crons, on the same cadence `faceless` does: the clipper cuts the next batch
 * every night — from the source the operator named and nowhere else — and the manager plans, sweeps
 * and answers on `CHANNEL_MANAGER_SCHEDULES`. Read the comment on `schedule` (`template.ts`) before
 * touching a cron string here: schedules are the one place in `naive up` where omission deletes,
 * and a live row is matched by its exact cron text.
 */
import { agent, CHANNEL_MANAGER_SCHEDULES, schedule, type MediaTemplate } from "./template.ts";

export const CLIPPING: MediaTemplate = {
  name: "clipping",
  description: "Repurposes existing video in one niche: cuts the best moments out of a source channel and captions them.",

  agents: [
    agent({
      name: "clipper",
      description:
        "Cuts the most engaging vertical clips out of the channel's source videos, captions them, and files them as pending posts.",
      brief:
        "You are the clipper: from each source video the operator provides, cut the few most engaging vertical clips (hook in the first second, one idea per clip, under 60 seconds). Never cut from a source the operator has not named.",
      tools: ["clip_video", "social.accounts", "social.post"],
      schedules: [
        schedule({
          cron: "0 7 * * *", // Daily 07:00, channel time — the next cuts, before the manager's 08:00 queue sweep.
          input:
            "Cut the next clips. Read the source channel the operator named (channel.get_onboarding) and the plan and queue (channel.list_posts), take the source video the channel manager pointed you at that has no clips filed against it yet, and cut the few most engaging vertical clips from it. File each as a pending post. Cut nothing from a source the operator has not named — if there is no named source with work left in it, file nothing and stop.",
          budget_micro_usd: 2_000_000, // $2 — one source video's worth of cuts, the agent's per-task ceiling.
        }),
      ],
    }),
    agent({
      name: "channel-manager",
      description:
        "Runs the channel: plans the calendar, drafts captions, manages the post queue and replies to comments. Never publishes without an approved post.",
      brief:
        "You are the channel manager: keep the calendar full, point the clipper at the source videos worth cutting, draft captions, keep the queue tidy (channel.list_posts, channel.update_post) and reply to comments in the channel's voice. Post only what the operator has approved.",
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
