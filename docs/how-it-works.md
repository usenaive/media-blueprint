# How the media blueprint works

A trace of what `naive up` provisions, what each agent is told, which tools it can call, and where
a post lives. Everything below is read off the code; file paths are given so it can be checked.

## 1. Blueprint vs. template

- **Blueprint** = the machine, shared by every template: the React dashboard (`src/`), the
  `/api/*` routes (`server/routes.ts`), the `/mcp` endpoint (`server/mcp.ts`), the store
  (`server/store.ts`, `server/api-entry.ts`) and the approval flow.
- **Template** = data: the crew, its prompts, tool allow-lists, post kinds, three setup questions,
  and the words the queue prints (`templates/faceless.ts`, `templates/clipping.ts`).
- `templates/index.ts` — `ACTIVE` picks the running template (`faceless` by default,
  `NAIVE_TEMPLATE` overrides). Switching is an edit of that line plus `naive up`.
- `naive.config.ts` hands `naive up` **both** templates plus their demo seeds, so switching only
  ever widens: an agent only the other template declares is kept running (its crons keep firing
  and billing — the README's "Switching template" covers the `removed` remedy).

## 2. What `naive up` provisions

From `naive.config.ts`:

| Resource | What |
| --- | --- |
| Project `media` | template `ACTIVE.name`, 3 setup questions (`ACTIVE.questions`) |
| Identity `channel` | the one persona every agent, cron and social route acts as |
| App `channel` (fullstack, required) | `deploy_dir: dist`, `mcp: "/mcp"`, env `NAIVE_API_KEY` (from env), `DASHBOARD_TOKEN` + `DASHBOARD_PASSWORD` (platform-generated); platform also injects `VETTA_MCP_TOKEN`, `NAIVE_API_URL`, `NAIVE_IDENTITY_ID`, `DATABASE_URL` |
| Agents | the template's crew (5 seats each) |
| Schedules | every agent's crons, owned as a complete set (omission deletes; matched by exact cron string) |
| Intake sessions | one per created agent, all opened at once |

Setup questions are capped at three by the SDK (`parseProject`). Both templates spend one on
`platform` (multi-select of YouTube Shorts / TikTok / Instagram Reels) and one on `cadence`;
`faceless` asks `niche`, `clipping` asks `sources` (reference channel URLs). The displaced question
(tone/audience) is asked by the channel manager on day one via `ask_operator`.

## 3. The crews

Both templates share `channel-manager` (the `required` seat, and the one Chat talks to —
`routes.ts` looks it up by name). Every agent runs `anthropic/claude-sonnet-5` with a budget of
$60/day and $20/task (`templates/template.ts`, sized around one ~$3.32 render).

### faceless

| Agent | Role | Extra tools | Skills | Hands off to | Crons (America/New_York) |
| --- | --- | --- | --- | --- | --- |
| channel-manager | Channel lead | web_search, web_fetch | caption-writing | — | Mon 09:00 plan · daily 08:00 queue sweep · daily 18:00 comments |
| trend-scout | Trends & briefs | web_search, web_fetch | seo-content-brief, short-video-hooks | scriptwriter | Mon/Thu 06:00 |
| scriptwriter | Hooks & scripts | web_search, web_fetch | short-video-hooks, caption-writing | producer | daily 06:30 |
| producer | Video production | generate_video (models pinned: wan-3.0, wan-3.0-prime, happyhorse-1.1), generate_image | short-video-hooks | — | daily 07:00 |
| analyst | Performance | — | — | — | Mon 07:30 |

Pipeline: scout files briefs at `stage: brief` → `send_to_agent(scriptwriter, wait:false)` with
the ids → scriptwriter claims (`scripting`, `expected_stage: brief`), writes hook/script/caption
into the row, moves to `scripted`, hands to producer → producer claims (`rendering`,
`expected_stage: scripted`), renders one <15s vertical video in the named style template, attaches
`media_url`, moves to `rendered`. Crons are the fallback that picks up whatever a handoff missed.

### clipping

| Agent | Role | Extra tools | Skills | Crons |
| --- | --- | --- | --- | --- |
| channel-manager | Channel lead | web_search, web_fetch | caption-writing | as above |
| scout | Source watch | web_search, web_fetch | clip-selection | daily 06:00 |
| clipper | Clip production | clip_video | clip-selection | daily 07:00 |
| caption-editor | Captions & titles | web_search | caption-writing, short-video-hooks | daily 07:30 |
| analyst | Performance | — | — | Mon 07:30 |

No handoffs here; the chain is ordered purely by cron time (briefs → cuts → captions). The one rule
every seat repeats: cut only from reference channels the context names.

## 4. What the prompts say

Every `system` is composed by `agent()` in `templates/template.ts` as
**preamble → seat brief → approval gate**:

- `CONTEXT_PREAMBLE` — read `project_context` first; the answers are the client's, never invent a
  missing one, ask the operator instead.
- The seat's own `brief` (quoted in full in each template file).
- `approvalGate` — file every finished piece as a *pending* post via `channel.create_post`, never
  publish yourself; sign it (`agent`, `account`, `media_url`, `source`, `platform`); the tools
  offered this turn are the complete list; request a missing one once with `request_tools`; ask
  the operator once with `ask_operator`; never describe a video you did not render.

Every intake message gets `DAY_ONE_ORDER` appended: all intakes open simultaneously, so an empty
queue on day one is not a finding — file what you can alone, hand on by name, leave the rest to
the timers. Day-one work per seat is set-up, filed as notes into the queue (`source` = "channel
plan", "style choice", "hook style", "report skeleton", "clipper check", "caption style"); the
trend-scout is the exception and files five real briefs.

## 5. Tool permissions

`toolset()` in `templates/template.ts` builds each agent's grant:

- `default_config.permission = "ask"` — this is how connected-account tools
  (`<connector>.<operation>`, not enumerable ahead of time) become reachable, and every such call
  parks at the Approvals screen.
- Every `BUILTIN_TOOLS` entry the seat was not granted is `deny` by name — including all sandbox
  tools (bash/read/write/…), so no session provisions a machine.
- Granted `allow`: `project_context`, `read_skill` (if the seat has skills), the seat's own tools,
  `social.accounts`, and the six dashboard tools `channel.list_posts / get_post / create_post /
  update_post / list_style_templates / list_accounts`.
- Granted `ask`: `social.post` (the one outward act), `ask_operator`, `request_tools`.
- Seats with `handoffs` also get `send_to_agent` and `list_agents` at `allow`.

The dashboard surfaces both parked states: `GET /api/sessions` lists them, `POST
/api/sessions/:id/tool_confirmations` approves/denies a parked tool call,
`POST /api/sessions/:id/answers` answers an `ask_operator` question (`server/proxy.ts`).

## 6. The dashboard's MCP tools (`server/mcp.ts`)

Hand-rolled JSON-RPC (`initialize`, `tools/list`, `tools/call`), bearer = `VETTA_MCP_TOKEN`.
Nothing here approves, rejects or publishes.

| Tool | Behaviour |
| --- | --- |
| `list_posts {status?, stage?}` | filters the queue; stage read via `postStage()` |
| `get_post {id}` | one row |
| `create_post {caption, media_url?, platform?, agent?, account?, source?, stage?, status?}` | lands `pending` (or `ready`); `platform` refused if not in `POST_PLATFORMS`, defaults to the customer's first setup pick (`server/channel.ts`) |
| `update_post {id, title?, caption?, media_url?, platform?, stage?, expected_stage?}` | only `pending`/`ready` rows; `expected_stage` mismatch → refused (atomic claim under the store lock); a row with media cannot move to a stage before `rendered`; `rendered` requires media |
| `list_style_templates` | the channel's style library |
| `list_accounts` | platform's connected accounts, or the accounts the queue names when social isn't activated; a 401/403/500 is an error, never an empty list |

The `create_post.platform` description is generated per request from the customer's setup answer
(`toolsFor(channels)`), so two installs read two different sentences.

## 7. Storage — what "the DB" actually is

There is **no relational schema for posts**. The whole store is one JSON document:

```ts
interface StoreState { posts: Post[]; templates: StyleTemplateSeed[] }
```

- **Local (`pnpm serve`)** — `server/store.ts` persists it as one JSON file under `data/`, seeded
  with the template's demo rows.
- **Deployed** — `server/api-entry.ts` keeps the same document in the platform app database
  (Postgres via `DATABASE_URL`) as a single row:

  ```sql
  create table if not exists channel_store (id text primary key, state jsonb not null);
  -- one row, id = 'singleton'
  ```

  Every request does `begin` → `select … for update` → run the handler over the in-memory state →
  `update … set state` (if dirty) → `commit`. The row lock is what serialises concurrent
  `create_post` calls. A fresh deployment starts empty (no demo rows reach the bundle —
  `src/no-seed.test.ts`).

Style templates (`seed/style-templates.ts`: `{name, prompt, trend, image}`) live in the same
document. Connected accounts, agents, sessions and deployments are **not** stored here — they are
read live from the platform through `server/proxy.ts`.

### The `Post` row (`seed/posts.ts`)

```ts
interface Post {
  id: string;                 // post_…
  title: string;              // cut from the caption if not given
  caption: string;            // brief text before scripting, publishable caption after
  mediaUrl?: string;          // URL or fil_… id; the receipt that a render was paid for
  platform: "instagram" | "tiktok" | "youtube";
  account?: string;           // connected handle, when named
  status: "pending" | "ready" | "approved" | "posted" | "rejected";
  agent?: string;             // who filed it
  source?: string;            // brief / source video / style template / note kind
  kind: "clip" | "produced" | "multi";
  stage?: "brief" | "scripting" | "scripted" | "rendering" | "rendered";
  stageAt?: string;           // ISO; lets the 08:00 sweep age out dead claims
  duration?: string;
  scheduledFor?: string;
  postedAt?: string;          // ISO, stamped by the store when status → posted
  rejectedReason?: string;
  views?: number;
  likes?: number;
}
```

`postStage()` derives `rendered` for a stageless row carrying `mediaUrl` or `duration`; a row with
neither stage nor media is a *note* (plan, report, style choice) and belongs to no pipeline. The
UI's `rowKind()` (`src/data.ts`) maps rows to `piece | production | note` from the same fields.

## 8. Post lifecycle end to end

1. Agent files → `channel.create_post` → `status: pending` (agents can also send `ready`).
2. Seats move `stage` forward with claims (`expected_stage`); the manager's 08:00 sweep tidies
   captions/kind/day and returns stale `-ing` claims (>1 day) to the prior stage — but never a row
   with media.
3. Operator, on Posts: `PATCH /api/posts/:id` moves between `pending / ready / approved /
   rejected` (`posted` is refused there with a 409).
4. Operator presses Post now → `POST /api/posts/:id/post-now` (`routes.ts` `postNow`): requires
   `approved`, a publishable platform, and media; then `POST /v1/identities/:idn/social/posts`
   with `{content, title?, platforms:[…], media_urls | file_ids}`; on success the store stamps
   `status: posted`, `postedAt: <ISO now>`, `views/likes ??= 0`.
5. Analytics reads only `posted` rows and derives totals and the daily series from `postedAt`,
   `views` and `likes` — there is no separate metrics table; views/likes are whatever is on the
   row (the analyst agent reads real metrics only via connected-account tools where offered).

An agent's direct `social.post` call takes a different path: it parks at Approvals
(`tool_confirmations`) and, if approved, publishes through the platform without touching the
store — so a post published that way is not a `posted` row unless someone also files/moves it.

## 9. Chat

`POST /api/chat {message}` → resolves the `channel-manager` agent id → `POST /v1/sessions
{agent_id, message}`; the UI then streams `GET /api/chat/:ses/stream` (SSE proxy). The manager
answers from the queue and routes work to the seat it belongs to; it does not publish.

## 10. Observed vs. inferred

Everything above is read from the repository. Two things are not verifiable here: how the platform
composes `agents[].handoffs` / `intake` on the wire (only the SDK's declaration shape is visible),
and what the analyst's connected-account metrics tools return — no code in this repo reads views
or likes from a network, so today those numbers on a row are whatever was filed or seeded.
