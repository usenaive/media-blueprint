/**
 * The `media` blueprint, declared.
 *
 * This is the file `naive up` reads. A person clones this repo, sets NAIVE_API_KEY, runs
 * `naive up`, and the platform provisions everything below into their organization: the dashboard
 * app and the crew of the template named here. Re-running `naive up` is idempotent — resources are
 * keyed by name.
 *
 * The blueprint is the machine — the screens, `/api/*`, `/mcp`, the store, the approval flow — and
 * it is shared by every template it carries. The template is data: the crew and its prompts, the
 * tool allow-lists, the post kinds, the three setup questions and the words the queue prints
 * (`templates/`). Switching template is an edit of `ACTIVE` in `templates/index.ts` plus
 * `naive up`, on the same clone and the same app.
 *
 * Nothing is ever narrowed by that switch: both templates are declared below and no name is listed
 * in `removed`, so an agent only the other template declares is kept — reported by `up` and left
 * running rather than deleted — and the operator's own rows (posts, accounts, the app, its URL and
 * its MCP token) are untouched.
 *
 * The app is named `channel`, not `dashboard`: app names are unique per organization, so two
 * blueprints sharing a generic name means the second `naive up` adopts and overwrites the first's
 * app — its deployment, its database and its MCP token — and reports it as a routine update.
 *
 * The dashboard declares its MCP endpoint (`mcp: "/mcp"`, served by `server/mcp.ts`), so every
 * agent is offered its tools as `channel.<tool>` on each turn; the platform mints the bearer and
 * injects it into the app as `VETTA_MCP_TOKEN`. The agents' toolsets deny by default, so the
 * dashboard tools are listed explicitly (`templates/template.ts`).
 *
 * Standalone clones install `@vetta/blueprints` from npm; inside the monorepo it resolves via the
 * workspace protocol.
 */
import { defineProject } from "@usenaive-sdk/blueprints";
import { CLIPPING_SEEDS, FACELESS_SEEDS } from "./seed/posts.ts";
import { ACTIVE, CHANNEL_IDENTITY, PROJECT_NAME, TEMPLATES } from "./templates/index.ts";

/**
 * Every template this repo carries — all of them, not just the running one. The engine takes the
 * chosen one's agents as the crew and keeps the rest: an agent only a sibling template declares is
 * reported and left running, never deleted. A repo carrying only some of its blueprint's templates
 * is refused, because switching would then silently narrow.
 *
 * The demo rows are attached here and nowhere else. `templates/` is imported by the screens and no
 * demo row may reach the shipped bundle (`src/no-seed.test.ts`); this file is read only by
 * `naive up`, so it is where the rows and the rest of a template meet.
 */
const templates = [
  { ...TEMPLATES.faceless, seed: { posts: FACELESS_SEEDS } },
  { ...TEMPLATES.clipping, seed: { posts: CLIPPING_SEEDS } },
];

/**
 * What `naive up` is handed. Named rather than inlined so `naive.config.test.ts` can read the
 * declaration itself — including the pair that chooses the machine and the crew that runs on it.
 */
export const declaration = {
  name: PROJECT_NAME,
  blueprint: "media",
  template: ACTIVE.name,
  templates,

  /**
   * The three things the studio asks before anything is provisioned (`canonical-spec §7.1`): what
   * the channel is about, WHERE IT POSTS, and how often. The answers land on the install and reach
   * every agent through the built-in `project_context` tool (§31.8) — there is no other place they
   * are asked, which is why the dashboard has no onboarding screen of its own.
   *
   * The engine refuses a fourth, and it is not a style rule — `parseProject` in
   * `@usenaive-sdk/blueprints@0.4.0` throws "a template asks at most 3 before anything is
   * provisioned" for any project that names a template, which this one always does. So the middle
   * slot is spent on the network deliberately: a channel that does not know where it posts fills a
   * queue nothing can publish, while the question it displaced is asked by the channel manager in
   * its first session (`templates/template.ts`, `channelManager`).
   */
  questions: ACTIVE.questions,

  /**
   * The channel persona, and the whole reason a connected account is reachable from a turn.
   *
   * Connection tools resolve `session → agent → identity → connected accounts`, so an agent with no
   * identity is offered none — which is what every agent of this blueprint was. Declaring the
   * persona here and naming it on each agent (`templates/template.ts`) is the grant; `up` refuses
   * an agent whose identity was not provisioned rather than creating one that runs as nobody.
   * It is also the persona the dashboard's own social routes already act as.
   */
  identities: [
    {
      name: CHANNEL_IDENTITY,
      description: "The channel itself — the persona its agents post, read and connect accounts as.",
    },
  ],

  apps: [
    {
      name: "channel",
      type: "fullstack" as const,
      description: "Media channel dashboard — post queue, style templates, accounts, analytics.",
      // The crew files into this app's queue and the operator approves from it; a crew without it
      // has nowhere to put its work, so the studio cannot untick it (`canonical-spec §31.2`).
      required: true,
      deploy_dir: "dist",
      mcp: "/mcp",
      // The dashboard's server half fronts the platform for the browser, so the deployed process
      // needs the org key. `{from_env}` keeps the secret out of this file: on a laptop it is read
      // from the author's shell, and a hosted install reads it from the PLATFORM ENVIRONMENT
      // (`canonical-spec §29.7`), which mints a scoped organization key for this app. Unset in both
      // places still refuses the apply by name, with the variable named and never a value.
      //
      // DASHBOARD_TOKEN is the operator's bearer for every `/api/*` route (`server/routes.ts`).
      // It is deliberately required: the deployed URL is public, and without a token the dashboard
      // answers 503 rather than letting anyone move posts, publish, read the roster or open a
      // billable session. It is `{generate: true}` because the value is "any long random string" —
      // asking a person to invent entropy was never a setup question, it was a defect — so the
      // platform makes one, once, on the apply that creates the app, and never rolls it after.
      //
      // NAIVE_API_URL and NAIVE_IDENTITY_ID are NOT declared here and must not be. They were
      // `process.env` reads, which meant the PUBLISHER'S shell was baked into the declaration every
      // customer installs — and, on a hosted apply, that there is no shell, so both silently
      // vanished and the dashboard's social routes answered 503 for want of a persona. The platform
      // knows both and writes them into this app itself (§29.7), the way it already writes
      // VETTA_MCP_TOKEN.
      env: {
        NAIVE_API_KEY: { from_env: "NAIVE_API_KEY" },
        DASHBOARD_TOKEN: { generate: true as const },
      },
    },
  ],
};

export default defineProject(declaration);
