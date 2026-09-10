/**
 * What a template of the `media` blueprint is, and the pieces every one of them shares.
 *
 * The **blueprint** is the machine: the screens, `/api/*`, `/mcp`, the store and its row lock, the
 * operator bearer, build and deploy, the approval flow. It is one repository and it is shared.
 * A **template** is DATA: the crew and its prompts, the tool allow-lists, the kinds of post it
 * files, the setup questions the studio asks before anything is provisioned, and the words
 * the queue prints. Both templates this repo carries live in `templates/`, so switching is an edit
 * of `ACTIVE` (`templates/index.ts`) plus `naive up` — never a re-clone, never a new app.
 *
 * Two things are deliberately NOT in here. The demo rows a template seeds are in `seed/posts.ts`,
 * because the screens import this module and no demo row may ever reach the shipped bundle
 * (`src/no-seed.test.ts`). And the model, the budget, the approval gate and the dashboard's own
 * MCP tools are below rather than in each template: they are the machine's, and a template that
 * could restate them could quietly drop the gate.
 */
import type { AgentDecl, DefineInput, ScheduleDecl } from "@usenaive-sdk/blueprints";
import type { PostKind, PostPlatform } from "../seed/posts.ts";

export type TemplateName = "faceless" | "clipping";

/** The project `naive.config.ts` declares — the word the platform stamps on this app and its installs. */
export const PROJECT_NAME = "media";

/**
 * One setup question, in the platform's own `QuestionField` shape (`canonical-spec §7.1`): the
 * studio asks it before the crew is provisioned, the answer lands on the install, and every agent
 * reads it back through `project_context`.
 *
 * *** THERE ARE THREE OF THEM, AND THE LIMIT IS REAL. MEASURED, NOT ASSUMED. ***
 *
 * `defineProject` refuses a fourth outright, and it is worth having the sentence here because the
 * schema does not show it: `questions` is `z.array(QuestionFieldSchema)` with no bound, and the
 * cap is a separate check in `parseProject`, applied only when the project names a `template` —
 * which this one always does. Run against `@usenaive-sdk/blueprints@0.4.0`, the version this repo
 * pins and `naive up` runs, a four-question declaration comes back:
 *
 *     template "faceless" asks 4 questions, but a template asks at most 3 before anything is
 *     provisioned — a fourth belongs to the crew's first conversation
 *
 * So the three slots are a budget, and spending one is choosing what NOT to ask. `PLATFORM_QUESTION`
 * below took a slot from `audience` on `faceless` and from `niche` on `clipping`, because a channel
 * that does not know where it posts fills a queue nothing can publish, while tone and audience are
 * one sentence the channel manager asks for in its first session — which is the home the engine's
 * own refusal names for them. Both displaced questions are asked there (`channelManager`), so
 * nothing was dropped; it moved to the conversation instead of the form.
 */
export type SetupQuestion = NonNullable<DefineInput["questions"]>[number];

/** How often the channel posts, which sizes every plan and every timer. Shared: one cadence, spelled once. */
export const CADENCE_QUESTION: SetupQuestion = {
  key: "cadence",
  label: "Posting cadence",
  type: "choice",
  options: ["daily", "3× a week", "weekly"],
  other: false,
};

/** The key the platform stores the network answer under, and the one name every reader of it uses. */
export const PLATFORM_ANSWER_KEY = "platform";

/**
 * The networks a customer may pick from, and what each one is called in front of them.
 *
 * The option is the customer's word ("YouTube Shorts"), the platform is the wire's
 * (`POST_PLATFORMS`). They are paired here rather than in two lists because the studio stores a
 * `choice` answer as the option string it showed, so the only thing that can turn an answer back
 * into a target is this table. First is the default an install falls back to when it has no
 * answer at all.
 */
export const PLATFORM_CHOICES: readonly { option: string; platform: PostPlatform }[] = [
  { option: "YouTube Shorts", platform: "youtube" },
  { option: "TikTok", platform: "tiktok" },
  { option: "Instagram Reels", platform: "instagram" },
];

/**
 * *** WHERE THIS CHANNEL POSTS, ASKED OF THE PERSON WHOSE CHANNEL IT IS. ***
 *
 * It was a constant. `templates/faceless.ts` and `templates/clipping.ts` each carried
 * `platform: "tiktok"`, and the docstring on `MediaTemplate.platform` said the remedy out loud:
 * "an operator who wants another network edits this one line and runs `naive up`". That is not an
 * onboarding flow, it is a patch — and the customer this blueprint is for is connecting a YouTube
 * account, not editing TypeScript. The channel's target is the one fact about a channel that only
 * its owner knows, so it is asked in the studio with the niche, the audience and the cadence, and
 * every post the crew files reads the answer.
 *
 * `other: false` deliberately: a network typed in free text is a network nothing can publish to,
 * and the refusal would arrive at the publish button weeks later.
 */
export const PLATFORM_QUESTION: SetupQuestion = {
  key: PLATFORM_ANSWER_KEY,
  label: "Where should this channel post?",
  type: "choice",
  options: PLATFORM_CHOICES.map((choice) => choice.option),
  other: false,
  help: "Pick the app your videos go out on. Picking it is not the same as connecting it — after setup, open Accounts and connect the account you post from, or the team will fill a queue that cannot publish.",
};

/** What a customer saw this network called; the raw id for anything not on the list. */
export const labelOf = (platform: PostPlatform): string =>
  PLATFORM_CHOICES.find((choice) => choice.platform === platform)?.option ?? platform;

/**
 * One answer, turned into a target — or null when it is not one of ours.
 *
 * Both spellings are accepted, because both occur: the studio hands back the option string it
 * showed ("YouTube Shorts"), and an answer edited by hand or seeded by a script is as likely to
 * be the bare id ("youtube"). Case and surrounding space are the customer's, not the wire's.
 */
export const platformOf = (answer: unknown): PostPlatform | null => {
  if (typeof answer !== "string") return null;
  const said = answer.trim().toLowerCase();
  if (said === "") return null;
  const choice = PLATFORM_CHOICES.find(
    (one) => one.option.toLowerCase() === said || one.platform === said,
  );
  return choice?.platform ?? null;
};

/**
 * The channel's network as the customer answered it, or `fallback` when they did not.
 *
 * Takes either the whole `project_context` body (`{ template, answers, updated_at }`) or the bare
 * answers array, because the server reads the first and the browser is handed the same object. It
 * NEVER guesses: an answer naming something this blueprint cannot publish to is not "close
 * enough", it is no answer, and the caller's own default is more honest than a network nobody
 * chose. This is the one place the answer is interpreted, so the store, `/mcp` and the screens
 * cannot disagree about where the channel posts.
 */
export const platformFromAnswers = (context: unknown, fallback: PostPlatform): PostPlatform => {
  const answers = Array.isArray(context)
    ? context
    : ((context as { answers?: unknown } | null | undefined)?.answers ?? []);
  if (!Array.isArray(answers)) return fallback;
  const answer = (answers as { key?: unknown; value?: unknown }[]).find((row) => row?.key === PLATFORM_ANSWER_KEY);
  const value = Array.isArray(answer?.value) ? answer.value[0] : answer?.value;
  return platformOf(value) ?? fallback;
};

/** One kind of post a template's crew files. `id` is what a row carries; the label is what a screen prints. */
export interface PostKindDecl {
  id: PostKind;
  label: string;
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
  /**
   * THE FALLBACK TARGET — and it is a fallback now, which is the whole point.
   *
   * This line used to decide where a channel posts. `channel.create_post` takes a `platform`, and
   * in production not one of the nine rows the crew filed carried one: every filing fell through
   * to a constant, so a channel of vertical video queued nine posts at a network nobody had
   * chosen or connected. Moving the constant from `server/mcp.ts` to here made it the template's
   * constant instead of the machine's; it was still a constant, and the remedy this comment used
   * to offer — "edit this one line and run `naive up`" — is a patch, not an onboarding flow.
   *
   * `PLATFORM_QUESTION` now asks the customer, and `platformFromAnswers` is what a post is filed
   * for. This value is what an install that has no answer falls back to: a fresh clone before the
   * studio has asked anything, an install whose context cannot be read right now, an answer naming
   * a network this blueprint cannot publish to. It is the first option of the question, so the
   * fallback and the default a customer sees pre-selected are the same network.
   *
   * An agent may still name a different `POST_PLATFORMS` entry per post.
   */
  platform: PostPlatform;
  /**
   * The questions the studio asks once, before anything exists — three, because the engine refuses
   * a fourth on a project that names a template (the refusal is quoted on `SetupQuestion` above,
   * and `naive.config.test.ts` holds it to that count). The tuple is the type-level half of that
   * budget: a template cannot quietly ask a fourth and discover it at `naive up`.
   *
   * One of the three is `PLATFORM_QUESTION`, which every template of this blueprint asks, because
   * where a channel posts is not the blueprint's to decide. A template chooses the other two.
   */
  questions: [SetupQuestion, SetupQuestion, SetupQuestion];
  /** Every word a screen prints that changes with the template. */
  words: {
    queueSubtitle: string;
    queueEmpty: string;
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
 * $20/task is one render with ~6x of headroom, and it is what every seat carries: the budget is the
 * blueprint's, not a template's, so no crew can quietly hold a ceiling its flagship action cannot
 * clear. $60/day is per AGENT, not per channel — it holds the manager's three fires ($30 of
 * ceiling between them) or the specialist's daily $10 render with room for the retries a failed
 * one costs. Retune per channel after the first week.
 */
const budget = {
  cap_micro_usd: 60_000_000, // $60/day
  max_task_micro_usd: 20_000_000, // $20/task — a ~$3.32 render plus the turns that brief and file it, each holding its quote until the turn commits.
  period: "day",
} as const;

const model = "anthropic/claude-sonnet-5";

/**
 * The paragraph every template agent's `system` opens with (plan §2.4). The setup answers — niche,
 * audience, cadence, the sources — are the client's; the tool is how they are read, and the one
 * place they are true.
 */
export const CONTEXT_PREAMBLE =
  "Read `project_context` before anything else; the answers there are the client's, not yours to invent. Every brief, script, clip, caption and plan you make is for the niche, the audience and the cadence written there — when an answer is missing, ask the operator rather than filling it in.";

/**
 * The sentence every day-one message ends with, and the race it is the answer to.
 *
 * `naive up` opens one intake session per created agent, all of them together in a single
 * `eachInFlight` after every other write (`packages/blueprints/src/up.ts`), and `intake` carries no
 * ordering knob. So on day one the downstream seats read a queue the upstream ones are still
 * filling: in production the scriptwriter's first session read `channel.list_posts -> "[]"` and
 * filed *"the trend-scout hasn't filed any briefs yet in its parallel session"* as its finding,
 * while the scout was filing five briefs in the same minute. The channel's real order is not the
 * intakes': it is the handoff a seat sends after it has filed (`send_to_agent` with `wait: false`,
 * `handoffs` on the seat — canonical-spec §28.15), naming the rows, and where no seat hands on, the
 * crons', which fire hours apart in dependency order.
 *
 * It is appended by `agent()` below rather than written into each message, for the same reason the
 * approval gate is: a rule every seat needs is a rule no seat can be written without.
 */
export const DAY_ONE_ORDER =
  "One last thing about today, and it is about today only. The install opens every seat's first session at the same moment, so the queue you read may hold nothing another seat is about to file. An empty or half-filled queue right now is the install's doing and not a finding: do not report it as one, do not wait for anyone, and do not invent the work you cannot see. Work that needs another seat's output reaches you by name — a handoff naming its rows, in a session of your own — or on your next cron fire, upstream seat first, hours apart; never from today's queue. File what you can make alone, hand on exactly what your message says to hand on, and say plainly what you left for the timers.";

/** The one rule every agent of every template shares: the operator's approval queue is the only way out. */
const approvalGate =
  "You work for a short-form video channel. File every finished piece as a pending post with channel.create_post; never publish it yourself. Sign what you file — your name as `agent`, the connected account as `account` (channel.list_accounts), the video as `media_url`, what you made it from as `source`, the network as `platform`. A brief is a pending post with no media yet. The operator reviews every row and approves from the dashboard. The tools offered this turn are the complete list of what you can do right now: do not assume or invent a capability. If the task needs a tool or model you are not offered, request it once with request_tools — exact tool, permission, the model in config.models where needed, and why — then wait; a refusal is final for this task. If it needs a fact or decision only the operator has, ask once with ask_operator, then wait. A connected account's tools appear only once the operator connects it; when none is offered, say so and stop. Never describe a video you did not render or a post you did not file.";

/**
 * Every built-in tool the platform publishes, as a literal.
 *
 * It is here for the same reason `POST_PLATFORMS` is in `seed/posts.ts`: a blueprint is cloned
 * standalone and imports no workspace package at runtime. It is the list of names a toolset can
 * *enumerate* — which is exactly what the grant below turns on.
 */
export const BUILTIN_TOOLS = [
  "bash", "read", "write", "edit", "ls", "find",
  "browser", "read_skill", "publish_file", "web_search", "web_fetch", "project_context",
  "generate_image", "generate_video", "clip_video", "apps",
  "send_to_agent", "wait_for_agents", "list_agents", "board_read", "board_write",
  "ask_operator", "request_tools", "email.inboxes", "email.read", "email.send",
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
  "channel.list_style_templates", "channel.list_accounts",
];

/**
 * Read-only and offered by the platform only to an agent whose metadata names a project with an
 * applied install (`canonical-spec §31.8`) — which every agent of this crew is. Granted `allow`
 * to every agent because the preamble tells every agent to call it first.
 */
const CONTEXT_TOOL = "project_context";

/**
 * Held by every agent of every template, so the publish rule is the blueprint's and not a
 * template's to drop: `social.accounts` to know where a post is for, `social.post` behind `ask` so
 * the one outward act always stops at the Approvals screen (see `toolset`).
 */
const SOCIAL: readonly string[] = ["social.accounts", "social.post"];

/**
 * The two built-ins every agent holds whatever its template names: the gate above tells the agent
 * to ask for what it lacks, so the tools that ask must be there. `ask_operator` parks the turn as a
 * question (`canonical-spec §7.1`); `request_tools` parks it as a toolset change the operator
 * approves, which mints a new agent version and re-pins the running session (§7.4) — the producer
 * asked to render with a model this file does not pin gets it that way, not by an operator edit.
 * Neither can be `allow`, and a session-wide grant never covers them.
 */
const ALWAYS: readonly string[] = ["ask_operator", "request_tools"];

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
export const toolset = (names: readonly string[], handoffs: readonly string[] = []) => ({
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
          permission: name === "social.post" || ALWAYS.includes(name) ? ("ask" as const) : ("allow" as const),
          // The one tool with no derivable default; see `VIDEO_MODELS`.
          ...(name === "generate_video" ? { config: { models: VIDEO_MODELS } } : {}),
        },
      ]),
    ),
    // The grant `agents[].handoffs` compiles to on the platform (`canonical-spec §31.7`), written here
    // too so the declaration reads whole: `allow`, because a handoff runs with nobody watching.
    ...(handoffs.length > 0
      ? { send_to_agent: { enabled: true, permission: "allow" as const }, list_agents: { enabled: true, permission: "allow" as const } }
      : {}),
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
      "Plan the week. Read the channel's niche, audience and cadence (project_context), what has posted and what is still queued (channel.list_posts), and the looks available to produce in (channel.list_style_templates). Then file this week's plan: one brief per slot the cadence calls for, each naming the style template, the account it is for (channel.list_accounts) and the day it should go out. Brief the specialists through the plan, not by publishing anything yourself.",
    budget_micro_usd: 10_000_000, // $10 — the widest read of the week, once a week.
  }),
  schedule({
    cron: "0 8 * * *", // Daily 08:00 — the queue, an hour after the night's piece is filed.
    input:
      "Sweep the queue. Read every pending and ready post (channel.list_posts), and on each one fix the caption, the kind and the scheduled day with channel.update_post so the operator opens the dashboard to rows that are ready to approve. Flag in the caption anything you could not fix. A row at stage scripting or rendering whose stageAt is more than a day old was claimed by a session that died: put it back for the next fire — scripting to brief, rendering to scripted — with expected_stage set to the stage it shows, and leave a younger claim alone. Approve, reject and publish are the operator's — never yours.",
    budget_micro_usd: 10_000_000, // $10 — a read and a few patches.
  }),
  schedule({
    cron: "0 18 * * *", // Daily 18:00 — the comments, at the end of the channel's day.
    input:
      "Read the comments on what this channel has posted today and on the pieces still gathering them, and reply in the channel's voice. Comments are read and answered only through the tools of a connected account (channel.list_accounts says which exist); if no offered tool reads comments, say so in one line and stop — do not invent a comment or a reply. Every reply acts on a connected account, so it stops at the operator's Approvals screen with its text in front of a person — write the reply you would stand behind, and leave the ones you would not.",
    budget_micro_usd: 10_000_000, // $10 — a read and a handful of replies.
  }),
];

/** A word count of the kind the plan's 150–400-word bound on a `system` is checked against. */
export const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * One agent of a template: its role, its own brief, its skills and platform tools, over the shared
 * preamble, gate, model and budget. The `system` is preamble → brief → gate, so what the agent is
 * for is read before the rules it is bound by.
 */
export const agent = (decl: {
  name: string;
  /** Two or three words for the studio's roster: what seat this is. */
  role: string;
  description: string;
  /** The agent's own part of the system prompt, between the preamble and the gate. */
  brief: string;
  /** The platform tools this agent may call; the dashboard's own and `project_context` are added for it. */
  tools: string[];
  /** `naive/<slug>` refs into the platform's skill catalogue; read with `read_skill`. */
  skills: string[];
  /** The first session, opened by the apply that creates this agent (`canonical-spec §31.4`). */
  intake: { message: string; budget_micro_usd: number };
  /** Only where the template cannot run without this seat — the studio cannot untick it. */
  required?: boolean;
  /**
   * The seats this one may hand on to with `send_to_agent` (`wait: false`), once its own work is
   * filed (`canonical-spec §28.12, §28.15`). Day one is ordered by these, not by the crons: the scout
   * files briefs and names them to the writer, the writer scripts them and names them to the
   * producer. Each name must be an agent of the same template; `naive up` refuses one that is not. A
   * seat that declares none hands to nobody (`handoffs: false` on the wire): the platform's default
   * is anyone in the organization, and this channel's order is exactly the chain written here.
   */
  handoffs?: string[];
  /**
   * The crons this agent fires on, owned as a complete set — see `schedule` above, where the
   * ownership rule and the exact-cron-string matching are written out. An agent with none does
   * nothing until a human opens a chat window.
   */
  schedules: ScheduleDecl[];
}): AgentDecl => ({
  name: decl.name,
  role: decl.role,
  ...(decl.required === undefined ? {} : { required: decl.required }),
  model,
  budget,
  description: decl.description,
  system: `${CONTEXT_PREAMBLE} ${decl.brief} ${approvalGate}`,
  tools: toolset([CONTEXT_TOOL, ...(decl.skills.length > 0 ? ["read_skill"] : []), ...decl.tools, ...SOCIAL, ...DASHBOARD_TOOLS], decl.handoffs ?? []),
  skills: decl.skills,
  // Preamble → brief → gate for the standing prompt; message → order for the one-off. Composed here
  // so a new seat cannot be written without either.
  intake: { ...decl.intake, message: `${decl.intake.message} ${DAY_ONE_ORDER}` },
  handoffs: decl.handoffs ?? false,
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

/**
 * The channel manager, shared by both templates because the manager is: the seat the dashboard's
 * Chat talks to (`server/routes.ts` looks it up by this name), so it is the one `required` agent —
 * a channel without it has a queue nobody plans and a chat window nobody answers. `specialists`
 * names the rest of the crew in the brief, which is the only line that differs between templates.
 */
export const channelManager = (
  specialists: string,
  /**
   * THE QUESTION THE SETUP FORM HAD NO SLOT FOR, asked in the first session instead.
   *
   * The studio asks three (see `SetupQuestion`), and `PLATFORM_QUESTION` takes one of them —
   * where the channel posts gates whether anything it makes can be published at all. What it
   * displaced is named here and asked on day one with `ask_operator`, which parks the session with
   * the question in front of the operator (`canonical-spec §7`). The engine's own refusal says
   * this is where a fourth question belongs; this is the sentence that puts it there, rather than
   * leaving the crew to invent an answer the preamble forbids it to invent.
   */
  firstAsk: string,
): AgentDecl =>
  agent({
    name: "channel-manager",
    role: "Channel lead",
    required: true,
    description:
      "Runs the channel: plans the week from the cadence answer, briefs the team, keeps the post queue tidy and replies to comments in the channel's voice. Never publishes without an approved post.",
    brief: `You are the channel manager, and the person the operator talks to in Chat. You keep the calendar full at the cadence the context names — daily, three times a week or weekly — and no fuller: a plan with more slots than the channel asked for is a plan it cannot keep. You brief ${specialists} through the queue, one pending post per slot, and you never do their work for them. Every morning you sweep the queue (channel.list_posts, channel.update_post) so the operator opens the dashboard to rows that are ready to approve: captions in the channel's voice (\`naive/caption-writing\`), the right kind, the right day; flag in the caption anything you could not fix. Every evening you read the comments through a connected account's tools and reply as the channel, for the audience the context describes. When the operator asks for something in Chat, answer with what the queue actually holds, and route the work to the seat it belongs to.`,
    tools: ["web_search", "web_fetch"],
    skills: ["naive/caption-writing"],
    intake: {
      message:
        `Day one. Read project_context — what this channel is about, where it posts and how often — and the queue (channel.list_posts) and connected accounts (channel.list_accounts). The setup form asks three questions and no more, so one thing this channel needs is not in there: ask the operator for it once, with ask_operator, before you plan anything — ${firstAsk} Then write the channel plan from the cadence answer: how many slots a week, which days and times they fall on in the channel's timezone, which post kind and which account each slot is for, and what the first two weeks look like. File it as a pending post with no media, \`source\` "channel plan", so the operator can read it and the team can work to it. The context names the network this channel posts to; if no account is connected for it yet, say so as the first line of the plan — until one is connected nothing the team files can be published.`,
      budget_micro_usd: 20_000_000,
    },
    schedules: CHANNEL_MANAGER_SCHEDULES,
  });
