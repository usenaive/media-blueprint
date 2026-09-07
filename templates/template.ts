/**
 * What a template of the `media` blueprint is, and the pieces every one of them shares.
 *
 * The **blueprint** is the machine: the screens, `/api/*`, `/mcp`, the store and its row lock, the
 * operator bearer, build and deploy, the approval flow. It is one repository and it is shared.
 * A **template** is DATA: the crew and its prompts, the tool allow-lists, the kinds of post it
 * files, the questions onboarding asks and the words the queue prints. Both templates this repo
 * carries live in `templates/`, so switching is an edit of `ACTIVE` (`templates/index.ts`) plus
 * `naive up` — never a re-clone, never a new app.
 *
 * Two things are deliberately NOT in here. The demo rows a template seeds are in `seed/posts.ts`,
 * because the screens import this module and no demo row may ever reach the shipped bundle
 * (`src/no-seed.test.ts`). And the model, the budget, the approval gate and the dashboard's own
 * MCP tools are below rather than in each template: they are the machine's, and a template that
 * could restate them could quietly drop the gate.
 */
import type { AgentDecl, ScheduleDecl } from "@usenaive-sdk/blueprints";
import type { PostKind } from "../seed/posts.ts";

export type TemplateName = "faceless" | "clipping";

/** One kind of post a template's crew files. `id` is what a row carries; the label is what a screen prints. */
export interface PostKindDecl {
  id: PostKind;
  label: string;
}

/** One question onboarding asks. Faceless asks for a niche; clipping asks for a niche and a source channel. */
export interface OnboardingQuestion {
  /** The key it is persisted under on the channel profile, and sent to `PUT /api/onboarding`. */
  key: "niche" | "sourceChannel";
  /** Names the answer, in the screen and in the refusal when it is missing. */
  label: string;
  placeholder: string;
  /** One-click answers; typing your own is always allowed. */
  options: string[];
}

export interface MediaTemplate {
  /** Spelled exactly as `defineProject({ template })` names it. */
  name: TemplateName;
  /** One line for the operator: what this crew does. */
  description: string;
  /** The crew, declared as `naive.config.ts` declares any agent. */
  agents: AgentDecl[];
  /** What this crew files; the first is what a post filed over MCP with no kind stated becomes. */
  kinds: [PostKindDecl, ...PostKindDecl[]];
  questions: [OnboardingQuestion, ...OnboardingQuestion[]];
  /** Every word a screen prints that changes with the template. */
  words: {
    queueSubtitle: string;
    queueEmpty: string;
    onboardingTitle: string;
    onboardingBlurb: string;
  };
}

/**
 * What one render actually costs, measured rather than guessed.
 *
 * PRODUCTION, 2026-09-07: one 10-second 1080x1920 video was debited **2,210,000 µUSD**
 * (`led_vna2cf3v27phg8meh4tdnxfcx0`) — 221,000 µUSD per second. The producer is briefed for a short
 * "under 15 seconds", so the length it is actually asked for costs up to ~3,320,000 µUSD, and that
 * is the number every ceiling below has to clear. Nothing publishes a price for a video model, so
 * this figure comes from a real invoice and is the only honest one available; re-measure it when the
 * model changes.
 */
export const ONE_RENDER_MICRO_USD = 3_320_000;

/**
 * The channel's daily budget. Sized from `ONE_RENDER_MICRO_USD` above, not from a round number:
 * the per-task ceiling has to hold one render of the length the producer is briefed for (~$3.32)
 * **plus** the session's own model calls, because the render's admission hold and the turn's model
 * calls draw on the same ceiling. At $2 the very first production session on production spent the
 * money, blew the ceiling and parked with the video already rendered.
 *
 * $6/task is one render with ~1.8x of headroom; $20/day is the producer's daily fire, the manager's
 * three sweeps, and room for one retry. Retune per channel after the first week.
 */
const budget = {
  cap_micro_usd: 20_000_000, // $20/day
  max_task_micro_usd: 6_000_000, // $6/task — one ~$3.32 render plus the turns that brief and file it.
  period: "day",
} as const;

const model = "anthropic/claude-sonnet-5";

/** The one rule every agent of every template shares: the operator's approval queue is the only way out. */
const approvalGate =
  "You work for a short-form video channel. File every finished piece as a pending post with a caption using channel.create_post; never publish it yourself. Sign what you file — pass your own name as `agent`, the connected account it is for as `account` (channel.list_accounts lists them), the media URL of the finished video as `media_url`, and what you made it from as `source`. The operator reviews the row you filed, watches the video on it, and approves posts from the dashboard. The tools offered to you this turn are the complete list of what you can do right now: do not assume a capability that is not in it, and do not invent one. If the task needs something you are not offered — generate_video or a video model, a connected account, a tool — say exactly which tool or model is missing and use ask_operator to ask for it once, in one message, then wait; never describe a video you did not render or a post you did not file.";

/**
 * Every built-in tool the platform publishes, as a literal.
 *
 * It is here for the same reason `POST_PLATFORMS` is in `seed/posts.ts`: a blueprint is cloned
 * standalone and imports no workspace package at runtime. It is the list of names a toolset can
 * *enumerate* — which is exactly what the grant below turns on.
 */
const BUILTIN_TOOLS = [
  "bash", "read", "write", "edit", "ls", "find",
  "browser", "read_skill", "publish_file", "web_search", "web_fetch",
  "generate_image", "generate_video", "clip_video", "apps",
  "send_to_agent", "wait_for_agents", "list_agents", "board_read", "board_write",
  "ask_operator", "email.inboxes", "email.read", "email.send",
] as const;

/**
 * The video models the producer may render with, best-first — and the reason this list exists.
 *
 * `generate_video` derives its default from the catalogue: the agent's first pinned model, or else
 * the cheapest model the catalogue publishes a price for. Video models publish no price, so with no
 * pin here there is no default to derive and **every call refuses** with "name a video model". A
 * chat session survives that (a human reads the refusal and names one); the 07:00 producer cron
 * does not — it fails the same way every night with nobody watching. A channel that renders video
 * has to say what it renders with.
 *
 * First is the default. The rest are named so the producer can still reach for a different look
 * without an operator editing this file; narrowing the list narrows what it can choose.
 */
const VIDEO_MODELS = ["alibaba/wan-3.0", "alibaba/wan-3.0-prime", "alibaba/happyhorse-1.1"];

/** The persona every agent of this channel acts as, and the one connected accounts hang off. */
export const CHANNEL_IDENTITY = "channel";

/** The dashboard's own MCP tools (`server/mcp.ts`) — file and inspect, never approve or publish. They are the blueprint's, so every crew gets them. */
const DASHBOARD_TOOLS = [
  "channel.list_posts", "channel.get_post", "channel.create_post", "channel.update_post",
  "channel.list_style_templates", "channel.list_accounts", "channel.get_onboarding",
];

/**
 * The one built-in every agent holds whatever its template names: the gate above tells the agent to
 * ask for what it lacks, so the tool that asks must be there. It parks the turn as a question
 * (`canonical-spec §7`) and can never be `allow` — there is nobody to answer without stopping.
 */
const ALWAYS: readonly string[] = ["ask_operator"];

/**
 * The named tools, allowed; every built-in they do not name, denied by name; and everything left —
 * which can only be a tool from an account this channel connected — behind the operator.
 *
 * `social.post` is granted as `ask` (canonical-spec §6): the turn parks with the call in
 * `session.pending_actions` until the operator decides on the Approvals screen. Granting it `allow`
 * (as this config once did) was a publish path straight around the queue the dashboard and the
 * system prompts promise, so the permission is decided here, by the blueprint, and not by whichever
 * template lists the tool.
 *
 * THE DEFAULT IS `ask`, AND THAT IS THE CONNECTIONS GRANT. A connected account contributes its
 * tools to the turn as `<connector>.<operation>` (`apps/runtime-do/src/connection-tools.ts`), and
 * that namespace comes from the org's live connections — `packages/core` says in as many words that
 * it "cannot be enumerated ahead of time", so no blueprint can name those tools in `configs`. Under
 * the old `deny` default that made the whole primitive unreachable: this dashboard sells connected
 * accounts as the publishing story, and not one agent could call a single tool on one. The default
 * is the only lever that reaches an unnameable name, and `ask` is the honest setting for it — a
 * connection tool acts on someone else's account, and every one of those calls now stops at the
 * Approvals screen with its arguments in front of a person.
 *
 * It widens nothing else, because everything else CAN be named: every built-in this crew was not
 * granted is written `deny` above the default, including all six sandbox tools — a content agent
 * needs no shell, and denying them is also what keeps the session from provisioning (and billing) a
 * machine it would never use.
 */
export const toolset = (names: readonly string[]) => ({
  default_config: { permission: "ask" as const },
  configs: {
    ...Object.fromEntries(
      BUILTIN_TOOLS.filter((name) => !names.includes(name) && !ALWAYS.includes(name)).map((name) => [
        name,
        { enabled: false, permission: "deny" as const },
      ]),
    ),
    ...Object.fromEntries(
      [...names, ...ALWAYS].map((name) => [
        name,
        {
          enabled: true,
          permission: name === "social.post" || name === "ask_operator" ? ("ask" as const) : ("allow" as const),
          // The one tool with no derivable default; see `VIDEO_MODELS`.
          ...(name === "generate_video" ? { config: { models: VIDEO_MODELS } } : {}),
        },
      ]),
    ),
  },
});

/**
 * The channel's clock, and the only place it is written.
 *
 * `POST /v1/deployments` defaults an omitted `timezone` to UTC, and a channel's 08:00 is not UTC's:
 * an unstated timezone is not "local", it is a cron that fires in the middle of somebody's night
 * and drifts an hour twice a year against the audience it was tuned for. Every schedule below
 * states it, and a channel that runs on another clock is this one line rather than six.
 */
export const CHANNEL_TIMEZONE = "America/New_York";

/**
 * One cron on an agent — and the sharp edge of declaring any.
 *
 * SCHEDULES ARE THE SINGLE PLACE IN `naive up` WHERE OMISSION DELETES. Everywhere else in this
 * config dropping a declaration is inert and only the `removed` block is a tombstone; a declared
 * agent's `schedules` are instead owned as a COMPLETE SET, and any live deployment on that agent
 * whose cron no schedule below names is deleted on the next `up`. Two consequences for whoever
 * edits this file next:
 *
 *   · The reconciler matches live rows BY EXACT CRON STRING and by nothing else — deployments carry
 *     no name. So `"0 8 * * 1"` and `"0 08 * * 1"` are not the same schedule: retyping one as the
 *     other is a DELETE plus a CREATE, not a patch, and the row loses its id and its history.
 *     Change a fire's *time* deliberately; never re-spell one that is not changing.
 *   · Deleting a line here deletes the cron in the operator's org. Changing `input`, `timezone`,
 *     `budget_micro_usd`, `identity` or `enabled` on a line whose cron is unchanged is a patch.
 *
 * (The agent's `schedules` key being absent altogether owns nothing and deletes nothing — that is
 * how this blueprint got here. It is stating a partial set that is destructive.)
 *
 * `identity` is set for the same reason the agent's is: a fire with no identity speaks as nobody,
 * and the session resolves `session → agent → identity → connected accounts` to zero accounts —
 * an unattended run that cannot reach the very accounts it exists to feed. This blueprint declares
 * exactly one persona (`naive.config.ts`), so every schedule names it; `up` refuses a schedule
 * whose identity was never provisioned rather than creating one that runs as nobody.
 *
 * `budget_micro_usd` is per fire, and a fire is one task: keep it at or under the agent's
 * `max_task_micro_usd` above, and keep a day's fires under `cap_micro_usd` between them.
 */
export const schedule = (decl: { cron: string; input: string; budget_micro_usd: number }): ScheduleDecl => ({
  ...decl,
  timezone: CHANNEL_TIMEZONE,
  identity: CHANNEL_IDENTITY,
});

/**
 * The channel manager's week, shared by both templates because the manager is.
 *
 * Three fires, and the cadence the landing copy already promises: the plan on Monday, the queue and
 * the comments every day. They are staggered around the specialist's morning fire below — the plan
 * is filed before the week's production starts, the queue is swept after the night's piece has
 * landed in it, and the comments are read at the end of the day.
 */
export const CHANNEL_MANAGER_SCHEDULES: ScheduleDecl[] = [
  schedule({
    cron: "0 9 * * 1", // Monday 09:00, channel time — the week's plan, before anything is produced against it.
    input:
      "Plan the week. Read the channel profile and its niche (channel.get_onboarding), what has posted and what is still queued (channel.list_posts), and the looks available to produce in (channel.list_style_templates). Then file this week's plan: one brief per planned slot, each naming the style template, the account it is for (channel.list_accounts) and the day it should go out. Brief the specialist through the plan, not by publishing anything yourself.",
    budget_micro_usd: 2_000_000, // $2 — the widest read of the week, once a week.
  }),
  schedule({
    cron: "0 8 * * *", // Daily 08:00 — the queue, an hour after the night's piece is filed.
    input:
      "Sweep the queue. Read every pending and ready post (channel.list_posts), and on each one fix the caption, the kind and the scheduled day with channel.update_post so the operator opens the dashboard to rows that are ready to approve. Flag in the caption anything you could not fix. Approve, reject and publish are the operator's — never yours.",
    budget_micro_usd: 1_000_000, // $1 — a read and a few patches.
  }),
  schedule({
    cron: "0 18 * * *", // Daily 18:00 — the comments, at the end of the channel's day.
    input:
      "Read the comments on what this channel has posted today and on the pieces still gathering them, and reply in the channel's voice. Every reply acts on a connected account, so it stops at the operator's Approvals screen with its text in front of a person — write the reply you would stand behind, and leave the ones you would not.",
    budget_micro_usd: 1_000_000, // $1 — a read and a handful of replies.
  }),
];

/** One agent of a template: its own brief and platform tools, over the shared gate, model and budget. */
export const agent = (decl: {
  name: string;
  description: string;
  /** Appended to the approval gate to make the system prompt. */
  brief: string;
  /** The platform tools this agent may call; the dashboard's own are added for it. */
  tools: string[];
  /**
   * The crons this agent fires on, owned as a complete set — see `schedule` above, where the
   * ownership rule and the exact-cron-string matching are written out. An agent with none does
   * nothing until a human opens a chat window.
   */
  schedules: ScheduleDecl[];
}): AgentDecl => ({
  name: decl.name,
  model,
  budget,
  description: decl.description,
  system: `${approvalGate} ${decl.brief}`,
  tools: toolset([...decl.tools, ...DASHBOARD_TOOLS]),
  /**
   * The persona this agent acts as, and the reason it can act on a connected account at all: the
   * platform resolves a turn's connection tools along `session → agent → identity → connected
   * accounts`, so an agent holding no identity is offered none of them however its toolset reads.
   * Every agent of this channel holds the one channel persona — the same persona the dashboard's
   * social routes already hang off.
   */
  identity: CHANNEL_IDENTITY,
  schedules: decl.schedules,
});
