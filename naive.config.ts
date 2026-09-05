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
 * tool allow-lists, the post kinds, the onboarding questions and the words the queue prints
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
import { ACTIVE, CHANNEL_IDENTITY, TEMPLATES } from "./templates/index.ts";

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
  name: "media",
  blueprint: "media",
  template: ACTIVE.name,
  templates,

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
      deploy_dir: "dist",
      mcp: "/mcp",
      // The dashboard's server half fronts the platform for the browser, so the deployed process
      // needs the org key. `{from_env}` keeps the secret out of this file and refuses the apply by
      // name when the variable is unset; the other two are literals — a base URL and an identity id
      // are not secrets, and a `{from_env}` on an unset optional would refuse the whole apply.
      //
      // DASHBOARD_TOKEN is the operator's bearer for every `/api/*` route (`server/routes.ts`).
      // It is deliberately required: the deployed URL is public, and without a token the dashboard
      // answers 503 rather than letting anyone move posts, publish, read the roster or open a
      // billable session. Refusing the apply by name is the right failure — set it to any long
      // random string before `naive up`, and paste the same string into the dashboard when asked.
      env: {
        NAIVE_API_KEY: { from_env: "NAIVE_API_KEY" },
        DASHBOARD_TOKEN: { from_env: "DASHBOARD_TOKEN" },
        ...(process.env["NAIVE_API_URL"] ? { NAIVE_API_URL: process.env["NAIVE_API_URL"] } : {}),
        ...(process.env["NAIVE_IDENTITY_ID"] ? { NAIVE_IDENTITY_ID: process.env["NAIVE_IDENTITY_ID"] } : {}),
      },
    },
  ],
};

export default defineProject(declaration);
