/**
 * `clipping` — Naive Clipping v1: the best moments out of the reference channels the operator
 * names, cut vertical and captioned, 15–60 seconds a clip.
 *
 *   scout ──Cut──▶ clipper ──Caption──▶ caption-editor ──Publish──▶ channel-manager ──▶ approval card
 *
 * The one rule every seat repeats: nothing is cut from a channel the context does not name. Every
 * frame this template posts is somebody else's, so every caption credits the original creator.
 */
import {
  agent,
  ANALYST_REPORT,
  analystSchedules,
  CADENCE_QUESTION,
  CLIPPING_LENGTH,
  channelManager,
  channelPlanCard,
  lengthPhrase,
  PLATFORM_QUESTION,
  schedule,
  VISIBILITY_QUESTION,
  task,
  type MediaTemplate,
} from "./template.ts";

/** `clip_video`'s own default band — the one length anything here enforces. */
const LENGTH = lengthPhrase(CLIPPING_LENGTH);

export const CLIPPING: MediaTemplate = {
  name: "clipping",
  length: CLIPPING_LENGTH,
  description: "Repurposes existing video in one niche: cuts the best moments out of the reference channels and captions them.",
  pipeline: ["scout", "clipper", "caption-editor", "channel-manager"],

  agents: [
    channelManager(),
    agent({
      name: "clipper",
      role: "Clip production",
      description: "Cuts each moment the scout picked into one vertical clip and hands it to the caption editor. Never cuts from a channel the context does not name.",
      brief: `You are the clipper. A Cut card wakes you; its body is the moment the scout picked: the source URL, where it starts and ends, and why. Cut only from the reference channels project_context names — a card from anywhere else goes to blocked with a comment saying so. clip_video takes the whole source URL, no timestamps, and returns titled file ids: call it once, vertical, and pick by title the clip that is the card's moment. A clip of this channel runs ${LENGTH} — clip_video's own band — so a moment that needs longer is not a clip: move the card to blocked with that reason rather than ship half of it. Hand the clip on as the Caption card for the caption editor — title "Caption: <the moment>", assignee caption-editor, blocked_by your Cut card — whose body is the clip's fil_ id, the source URL and its creator, and the scout's why. One cut per card. If clip_video is not among your tools, request it once with request_tools and wait.`,
      tools: ["clip_video"],
      skills: ["naive/clip-selection"],
      schedules: [],
    }),
    agent({
      name: "scout",
      role: "Source watch",
      description: "Watches the named reference channels for new episodes and starts each moment worth cutting as a Cut card, with the reasoning.",
      brief: `You are the scout, the head of the chain. You watch the reference channels the context names — only those — for new episodes and the moments in them that stand alone as a short: a claim, a turn, a laugh, a play (web_search, web_fetch, \`naive/clip-selection\`). Look at the episode before you pick from it: open its page with the browser and screenshot it, because a title tells you what a moment says and nothing about what it looks like. Read the board first: never start a moment already on it, and read the newest weekly report card for which sources and moments to cut more and less of. Start the moments the cadence needs until your next fire, each as a Cut card for the clipper — title "Cut: <the moment>", assignee clipper — whose body is the source URL, where the moment starts and ends (estimated from what you can read — never transcribe; the cut finds it), why it lands for this audience, and what you saw. One moment per card. Never start one from a channel the context does not name. You neither cut nor caption.`,
      tools: ["web_search", "web_fetch"],
      skills: ["naive/clip-selection"],
      schedules: [
        schedule({
          cron: "0 6 * * *", // Daily 06:00 — new episodes and moments.
          input:
            "Watch the references. Read project_context, the newest weekly report card and the Cut cards already on the board (board_read). Check each named reference channel for new episodes since the last fire, open each episode you pick from with the browser, and start the moments the cadence needs until tomorrow — each a Cut card for the clipper with the source URL, start, end, why and what you saw. Only from named references; nothing already on the board.",
          budget_micro_usd: 10_000_000, // $10 — a read of the references and a few cards.
        }),
      ],
    }),
    agent({
      name: "caption-editor",
      role: "Captions & titles",
      description: "Writes the title, caption and hashtags on every clip, credits the original creator, and hands it to the channel manager to publish.",
      brief: `You are the caption editor. A Caption card wakes you; its body is a cut clip — its fil_ id, its source and its creator, and why the scout picked it. Write it a publishable caption (\`naive/caption-writing\`): a first line that says the one idea — it becomes the YouTube title — a caption in the tone the context asks for that gives the moment a reason to be watched, and hashtags this audience actually follows. Credit the original creator on every clip: these are reference channels, not the operator's footage, and a clip posted without the credit costs the channel rather than a view. Write for each network the context names; the skill carries each one's norms. Use your caption-style card's note as the voice. Hand it on as the Publish card for the channel manager — title "Publish: <the moment>", assignee channel-manager, blocked_by your Caption card — whose body is the fil_ id, the caption, the networks and the source. You neither pick moments nor cut.`,
      tools: ["web_search"],
      skills: ["naive/caption-writing"],
      schedules: [],
    }),
    agent({
      name: "analyst",
      role: "Performance",
      description: "Records every post's numbers daily and reports weekly, by source and by clip, on what to cut more and less of.",
      brief: `You are the analyst: you measure, and you never pick, cut or publish. Every morning you record the numbers (social.post_metrics). Once a week you write the report: per clip — each closed Publish card names its post ids — which source it came from, what it did, and which moments and caption styles moved and which did not, in numbers you actually read. Name the source to watch closer and the kind of moment to stop cutting. ${ANALYST_REPORT}`,
      tools: ["social.post_metrics"],
      skills: ["naive/channel-report"],
      schedules: analystSchedules("Per source and per clip, say what went out and what it did."),
    }),
  ],

  tasks: [
    channelPlanCard("who these clips are for and the tone they are cut in, in one line — the setup form asked for the reference channels and not for this."),
    task({
      key: "source-check",
      title: "Confirm this channel can reach the references and cut at all",
      assignee: "clipper",
      body: "Day one is set-up, not a cut. Read project_context for the reference channels the operator named, then open each with the browser and say whether you can reach it. Look for clip_video in the tools offered this turn — that list is complete. If it is there, say so and do not call request_tools. Only if it is missing, request exactly it with request_tools, once. Write in this card's note which sources you can reach, which you cannot, and plainly whether this channel can work at all. Cut nothing today.",
    }),
    task({
      key: "caption-style",
      title: "Write the channel's caption style, so every clip reads in one voice",
      assignee: "caption-editor",
      body: "Day one is set-up, not captions. Read project_context for the niche, the audience and the reference channels, then write the caption style as this card's note, in five lines: the voice, the length, the hashtag set, the credit line every clip carries, and what never to say. Every caption this channel files is written to this note.",
    }),
    task({
      key: "report-frame",
      title: "Set up the weekly report this channel will be measured against",
      assignee: "analyst",
      blocked_by: ["channel-plan"],
      body: "Read project_context for the reference channels and the cadence, and the channel plan — the note on the channel-plan card this one waited on. Write, as this card's note, the skeleton of the weekly report: the sources it cuts from, the metrics you will read per clip (social.post_metrics), and the week's target taken from the plan's posting slots. Write no report today — nothing has posted, and your Monday 07:30 fire writes the first real one.",
    }),
    task({
      key: "first-piece",
      title: "Start the channel's first clip",
      assignee: "scout",
      blocked_by: ["source-check", "caption-style"],
      body: `The clipper's check and the caption style exist now — the notes on the cards this one waited on. Read project_context. Go through the most recent episodes of a reference channel the clipper can reach, open the episode's page with the browser and screenshot it, and pick ONE moment that stands alone ${LENGTH}. Then create its Cut card for the clipper — title "Cut: <the moment>", assignee clipper — whose body is the source URL, where the moment starts and ends, why it lands, and what you saw. If no named reference can be reached, create nothing and move this card to blocked, naming the URLs that failed; never look for another channel. ONE clip today: its chain of cards takes it to the approval card, and your daily fire starts the rest. Put the Cut card's id in your note.`,
    }),
  ],

  /**
   * The sources come first: they are the one answer no seat may work without and none may infer.
   * Three are required, so the form has room for the optional visibility question.
   */
  questions: [
    {
      key: "sources",
      label: "Reference channels to cut from",
      type: "text",
      placeholder: "Channel or playlist URLs, one per line — the crew cuts from these and nowhere else",
    },
    PLATFORM_QUESTION,
    VISIBILITY_QUESTION,
    CADENCE_QUESTION,
  ],
};
