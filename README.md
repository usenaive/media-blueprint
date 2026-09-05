# Media — an autonomous short-form channel on the Naive platform

An open-source blueprint: a complete short-form media company you can clone and
run under your own account. It ships a management dashboard and a small agent
team that plans, makes and queues vertical video, and publishes only what you
have approved.

The blueprint is the machine — the dashboard, `/api/*`, `/mcp`, the store, the
approval flow — and it carries **two templates**, which are data:

| Template | The channel it runs | Its crew | What it files |
|---|---|---|---|
| `faceless` | Generates original short-form video in one niche | `producer`, `channel-manager` | produced, multi-part |
| `clipping` | Repurposes existing video in one niche | `clipper`, `channel-manager` | clips |

One repo carries both, so switching is an edit and a `naive up` — never a
re-clone and never a new app. See **Switching template** below.

## Quickstart

You need two things: your platform API key, and a token you invent for the
dashboard itself.

```sh
git clone <this repo> my-channel && cd my-channel
naive claim --key sk_...            # bind this clone to your organization
export DASHBOARD_TOKEN="$(openssl rand -hex 24)"   # keep this; the dashboard asks for it
naive up                            # provision everything declared in naive.config.ts
```

**`DASHBOARD_TOKEN` is required.** The dashboard is deployed at a public URL, so
every `/api/*` route — the post queue, "Post now", the agent roster, opening a
session, and deciding a held tool call — is behind that one bearer. `naive up`
refuses by name if the variable is unset, and a deployment that somehow has no
token answers `503 not configured` to every API route rather than serving your
channel to anyone who finds the URL. The dashboard asks for the token the first time you open it and
keeps it for that browser session; paste in the same string you exported.

`naive up` is idempotent — every resource is keyed by its name in
`naive.config.ts`, so re-running it is always safe.

## What gets provisioned

- **The dashboard app** — this repo's built UI, hosted under your org, backed
  by a thin server that talks to the platform on your behalf.
- **The template's agents**, each with a system prompt, a scoped tool policy
  and a daily budget:
  - `channel-manager` — plans the calendar, drafts captions, manages the
    post queue, replies to comments. Never publishes an unapproved post. Both
    templates declare it.
  - `producer` (`faceless`) — creates original short videos from briefs using
    the channel's style templates (`generate_video`, `generate_image`).
  - `clipper` (`clipping`) — cuts the most engaging vertical clips out of the
    source channel you named and files them as pending posts (`clip_video`).
- **Nine starter style templates** (reference image + prompt) covering the
  current high-performing short-form aesthetics — the blueprint's shipped
  catalogue, present from the first turn.

A freshly provisioned channel has **no posts and no channel profile**, and every screen
shows its empty state until you or an agent files something. That is the truth
about a new deployment: the dashboard never ships rows that pretend to be work
someone did.

## Where a post can go

A post names one of the networks the platform can publish to — **bluesky,
facebook, linkedin, mastodon, threads, x** — and nothing else is offered
anywhere in the dashboard or in `create_post`. Vertical-video-only networks are
absent because a post to one is refused upstream, and a "Post now" button that
returns an error is worse than a button that is not there. The list lives in one
place, `seed/posts.ts`; when the platform accepts more, it grows there.

## Operating the channel

| Screen | What it does |
|---|---|
| Onboarding | Answer what the running template asks — a niche, plus the source channel on `clipping` — in a short conversation; the answers persist |
| Chat | Talk to the channel manager — brief it, ask for clips or productions, adjust the plan |
| Posts | The post queue: Pending → Ready → Approved → Posted / Rejected, each row playing the video the agent filed; "Post now" publishes the caption and that video immediately, and only from **Approved** |
| Approvals | Every agent that has stopped to ask you something: the held call, the arguments it proposes (media played), and Approve / Reject with an optional reason |
| Analytics | Views and likes, summed from the posts this channel actually published |
| Accounts | Connect and reconnect social accounts through the hosted portal |
| Channel settings | Which template is running, the live agent roster and briefs, and the style template library |

Nothing goes out without your approval. Agents file posts as *pending* and
cannot move them: the dashboard's MCP server has no approve, reject or publish
tool. The platform's own `social.post` tool *is* granted to every agent —
publishing an approved post is their job — but at permission `ask`, so an agent
never runs it unattended: the call pauses the session (`stop_reason:
awaiting_approval`, the session itself `idle`) and waits, listed in the session's
pending actions, until you approve or reject it.

**The Approvals screen is where you answer that.** It lists every session of this
channel holding a pending call, names the agent and the tool, renders the
arguments the agent proposes — playing any video or image among them, because a
publish you cannot watch is not one you can honestly approve — and sends your
decision, with an optional reason, to the platform. The same decision is still
available from the CLI, which is where it used to be the *only* place:

```sh
naive session get <session-id>                                # pending_actions lists the held call
naive session confirm <session-id> --tool-call <id> --allow   # or --deny --reason "..."
```

So a post reaches an account by exactly two routes: you publish it yourself from
the Posts screen, or you approve an agent's held `social.post` call.

## Agents and the dashboard

The dashboard is also an MCP server (`POST /mcp`, `server/mcp.ts`), and
`naive.config.ts` declares it (`mcp: "/mcp"` on the `channel` app). On
every turn, each agent in the project is offered the dashboard's tools as
`channel.<tool>` — no per-agent wiring: the platform mints the bearer
token, injects it into the app as the `VETTA_MCP_TOKEN` secret, and sends it
with every call. Without that token the endpoint answers `401`.

| Tool | What it does |
|---|---|
| `list_posts {status?}`, `get_post {id}` | Inspect the queue |
| `create_post {caption, media_url?, platform?, agent?, account?, source?, status?}` | File a finished piece as *pending* (or *ready*), signed: who filed it, which account it is for, what it was made from |
| `update_post {id, caption?, media_url?}` | Fix a pending or ready post; approved and posted ones are yours |
| `list_style_templates`, `list_accounts`, `get_onboarding` | The style library, the connected accounts, the channel profile |

This server publishes nothing: there is no approve, reject or post tool in it,
and every tool description says so. Each `channel.*` tool is allowed by name.

**Connected accounts.** Every agent acts as the `channel` persona
(`naive.config.ts`), which is what makes the accounts you connect reachable from
a turn: the platform resolves a session's connection tools along
`session → agent → identity → connected accounts`. Those tools register as
`<connector>.<operation>`, and which operations exist depends on the account you
connected, so no config here can name them — which is why the toolsets grant
every tool they *can* name (`allow`, or `deny` for a built-in this crew has no
use for, sandbox included) and leave the default at `ask`. A connection tool is
therefore always offered and never runs unattended: it stops on the Approvals
screen with its arguments in front of you, exactly like `social.post`.

The one tool that can reach an account is the platform's own `social.post`,
which is not part of this server. `naive.config.ts` grants it to every
agent at permission `ask`, so a call to it never runs unattended — it holds
the session at `awaiting_approval` for your decision (above). Change that to
`allow` and you have removed the gate; the tests in `naive.config.test.ts`
exist to stop that happening by accident.

## Switching template

A template is data (`templates/`): the crew and its prompts, the tool
allow-lists, the post kinds it files, the questions onboarding asks and the
words the queue prints. Nothing about the machine changes with it — same
screens, same routes, same `/mcp`, same app.

```ts
// templates/index.ts
export const ACTIVE: MediaTemplate = TEMPLATES.clipping;   // was TEMPLATES.faceless
```

Then `naive up`. The switch **widens and never narrows**:

- agents the new template declares are **created**;
- an agent only the old template declared is **reported and left running** —
  `naive.config.ts` hands `naive up` both templates, so the other crew is kept,
  and nothing is deleted by dropping a declaration. Retire one deliberately by
  adding its name to `removed`;
- your own rows are untouched: the posts, the accounts, the channel profile,
  the app, its URL, its database and its MCP token.

The dashboard's Channel settings screen names the template that is running.

## Updating the deployment

The deployment is declared, not clicked together. To change agents, budgets,
tool policies, or the app itself, edit `naive.config.ts` (and/or the UI code),
rebuild, and run `naive up` again — it reports each resource as
`created | updated | unchanged | deleted | refused`, and only ships the
dashboard when `dist/` actually changed. To delete a resource, move its name
into the config's `removed` block (e.g. `removed: { agents: ["producer"] }`)
and run `naive up`; nothing is deleted just by dropping a declaration — which
is exactly what makes switching template safe.

The config can declare more than this template uses:

| Key | What it provisions |
|---|---|
| `apps[]` | `name`, `type`, `description`, `deploy_dir`, `mcp` (the path of the app's own MCP endpoint; fullstack only), and `env` — literals or `{ from_env }` written as the app's secrets |
| `agents[]` | `model`, `budget`, `system`, `tools`, `skills`, `mcp_servers`, `allowed_apps`, `identity`, `schedules` |
| `agents[].schedules[]` | cron deployments, owned as a complete set per agent and matched by `cron` |
| `skills[]` | markdown files pushed by slug, versioned by content |
| `identities[]` | personas agents and schedules act as |
| `vaults[]` | credential vaults; values are `{ from_env }` only and reconciled by presence |
| `removed` | `apps`, `agents`, `skills`, `identities`, `vaults` to delete by name |

See the `naive` CLI reference in the platform docs for the reconciliation
rules behind each key.

## Development

- **Demo mode** — `pnpm serve` in one shell and `pnpm dev` in another. The dev
  server proxies `/api` and `/mcp` to `:8788`, so the screens read the seeded
  **file** store over the real routes — seeded with the running template's own
  demo queue. No sample row is compiled into the bundle; `src/no-seed.test.ts`
  enforces that, which is why the demo rows live in `seed/posts.ts` and not in
  `templates/` (the screens import a template).
- **Configured mode** — `pnpm build`, set `NAIVE_API_KEY` (and optionally
  `NAIVE_API_URL`, `NAIVE_IDENTITY_ID` for the channel persona's social
  routes), then `pnpm serve`. The server serves the built UI and fronts the
  platform behind `/api/*`; the key lives only in that server process and
  never reaches the browser. A screen whose backing route or key is absent
  says so — 503 `not configured — set NAIVE_API_KEY` reaches the header slot
  rather than being swallowed. Set `VETTA_MCP_TOKEN` to open `/mcp` locally
  (the platform sets it in the deployed app); without it every MCP request is
  refused. `/api/*` skips the `DASHBOARD_TOKEN` gate **only** for a request that
  arrives on the loopback interface — your own browser against `pnpm serve`.
  Anything reaching this server over a real network (bound to `0.0.0.0`, a
  tunnel, a LAN peer) is gated exactly as the deployment is.

One route table serves both: `server/routes.ts` holds every path, `/mcp`
included, and `server/index.ts` (node `http`) and `server/api-entry.ts` (the
deployed function) are thin adapters over it. Locally the store is a JSON file
under `data/`, seeded on first run from `seed/`; on the deployment it is one
document in the app database the platform provisions, created **empty**. The
browser and the agents therefore read and write the same rows: a post filed
over MCP is on the Posts screen after a reload.

`pnpm build` emits `dist/api/app.js` — one function for the whole surface —
plus `dist/vercel.json`, whose rewrites send `/mcp` and `/api/*` to it and fall
back to `index.html` for every screen URL.

Run the test suite with `pnpm test` and the type check with `pnpm typecheck`.

## License

License to be determined before public release; all rights reserved until a
LICENSE file is added.
