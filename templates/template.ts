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
import type { AgentDecl } from "@usenaive-sdk/blueprints";
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

/** Modest daily channel budget; retune per channel after the first week. */
const budget = {
  cap_micro_usd: 10_000_000, // $10/day
  max_task_micro_usd: 2_000_000, // $2/task
  period: "day",
} as const;

const model = "anthropic/claude-sonnet-5";

/** The one rule every agent of every template shares: the operator's approval queue is the only way out. */
const approvalGate =
  "You work for a short-form video channel. File every finished piece as a pending post with a caption using channel.create_post; never publish it yourself. Sign what you file — pass your own name as `agent`, the connected account it is for as `account` (channel.list_accounts lists them), the media URL of the finished video as `media_url`, and what you made it from as `source`. The operator reviews the row you filed, watches the video on it, and approves posts from the dashboard.";

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
] as const;

/** The persona every agent of this channel acts as, and the one connected accounts hang off. */
export const CHANNEL_IDENTITY = "channel";

/** The dashboard's own MCP tools (`server/mcp.ts`) — file and inspect, never approve or publish. They are the blueprint's, so every crew gets them. */
const DASHBOARD_TOOLS = [
  "channel.list_posts", "channel.get_post", "channel.create_post", "channel.update_post",
  "channel.list_style_templates", "channel.list_accounts", "channel.get_onboarding",
];

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
      BUILTIN_TOOLS.filter((name) => !names.includes(name)).map((name) => [
        name,
        { enabled: false, permission: "deny" as const },
      ]),
    ),
    ...Object.fromEntries(
      names.map((name) => [
        name,
        { enabled: true, permission: name === "social.post" ? ("ask" as const) : ("allow" as const) },
      ]),
    ),
  },
});

/** One agent of a template: its own brief and platform tools, over the shared gate, model and budget. */
export const agent = (decl: {
  name: string;
  description: string;
  /** Appended to the approval gate to make the system prompt. */
  brief: string;
  /** The platform tools this agent may call; the dashboard's own are added for it. */
  tools: string[];
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
});
