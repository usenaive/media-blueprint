# 🎬 Media Blueprint

**An autonomous video channel as data. Clone it, run `naive up`, and the Naive platform provisions
the crew, its timers and its first day of work into your organization.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![engine: @usenaive-sdk/blueprints](https://img.shields.io/npm/v/@usenaive-sdk/blueprints?label=engine%3A%20%40usenaive-sdk%2Fblueprints&color=0a7ea4)](https://www.npmjs.com/package/@usenaive-sdk/blueprints)
[![CLI: @usenaive-sdk/vetta-cli](https://img.shields.io/npm/v/@usenaive-sdk/vetta-cli?label=cli%3A%20naive&color=0a7ea4)](https://www.npmjs.com/package/@usenaive-sdk/vetta-cli)

There is no app. The crew runs on the platform's own screens:

- **The board.** Every piece is a chain of cards. Each card's body is the brief for one seat.
- **The Media gallery.** Every render and every cut lands there on its own.
- **The approval card.** One seat publishes. Every post waits for your **Allow**.
- **Chat.** Talk to the channel manager like any agent.

The repo carries **three templates**. A template is a crew:

| Template | Shown as | The channel it runs | Its crew | Piece length |
|---|---|---|---|---|
| `faceless` | Naive Short Form v1 | Original short-form video in one niche | `channel-manager`, `producer`, `trend-scout`, `scriptwriter`, `analyst` | 15–30s |
| `longform` | Naive Long Form v1 | One researched subject at a time, rendered in segments and joined | `channel-manager`, `researcher`, `writer`, `producer`, `analyst` | 60–180s |
| `clipping` | Naive Clipping v1 | The best moments of the channels you name, cut and captioned | `channel-manager`, `clipper`, `scout`, `caption-editor`, `analyst` | 15–60s |

The id in the first column is stored on every install. It never changes.

## 🚀 Get started

```sh
git clone https://github.com/usenaive/media-blueprint && cd media-blueprint
pnpm install
export NAIVE_API_KEY=…        # your organization key; never commit it
pnpm test && naive up
```

`naive up` creates the crew, the `channel` persona, the crons and the day-one cards. Running it
again changes only what changed. Pick the template in [`templates/index.ts`](templates/index.ts)
(`ACTIVE`).

### ⚠️ Known limits of a data-only blueprint

- **The studio's catalog cannot publish it yet.** The platform's artifact publisher refuses a
  declaration with no built app (`scripts/publish-artifacts.mjs`, and `trees: .min(1)` in
  `packages/core/src/schema/blueprint.ts`). So today this installs with `naive up` from a clone.
- **`project_context` answers only on a catalog install.** A `naive up` from a clone has no setup
  answers, so each seat asks you for what it needs, once. See
  [docs/how-it-works.md](docs/how-it-works.md#9-what-the-platform-cannot-express-yet).

Both are platform changes, not changes to this repo.

## 🧭 How a piece is made

Every piece is a chain of cards on the company board. A seat does its step, then creates the next
card for the next seat, blocked on its own. When it closes its card, the board wakes the next seat.

```
faceless   trend-scout ─Plan→ scriptwriter ─Render→ producer ─Publish→ channel-manager → approval card
longform   researcher  ─Plan→ writer       ─Render→ producer ─Publish→ channel-manager → approval card
clipping   scout       ─Cut→  clipper      ─Caption→ caption-editor ─Publish→ channel-manager → approval card
```

Step by step, on `faceless`:

1. **The trend-scout** fires Monday and Thursday. For each slot the cadence needs, it finds a topic
   and one to three real videos doing it well. It creates a **Plan** card for the scriptwriter.
   The card's body is the brief.
2. **The scriptwriter** is woken on the Plan card. It looks inside the exemplars, researches, and
   writes the whole plan: hook, shots with prompts and seconds, sources, caption, networks. It
   creates a **Render** card for the producer. The card's body is the plan.
3. **The producer** is woken on the Render card. It renders the plan with `generate_video`. The
   video lands in the Media gallery. It creates a **Publish** card for the channel manager with
   the file id, the caption and the networks.
4. **The channel manager** is woken on the Publish card. It checks the caption and calls
   `social.post`. The post waits on the approval card.
5. **You** press Allow, or Don't allow with what to change. Allowed, it goes out at its slot.

Each card's note records what that seat made. The board is the channel's memory. A seat that
cannot finish closes its card with a note starting `STOPPED:`, and the piece stops there.

## 📮 Publishing

Only `channel-manager` publishes. It holds `social.post` at **ask**, so every post stops on the
platform's approval card. Every other seat is denied `social.post` by name.

- **The file.** The post carries the render's `fil_` id (`file_ids`).
- **The caption.** Its first line is the YouTube title.
- **Where.** Only the networks you picked at setup.
- **Visibility.** YouTube goes on its own call, `unlisted` unless you answered otherwise. Only
  YouTube takes a visibility; the platform refuses one for any other network.
- **When.** `scheduled_at` is the next free slot for your cadence at least a day out, at 17:00
  channel time (`America/New_York`): daily is every day; 3× a week is Monday, Wednesday and
  Friday; weekly is Friday. An approved post goes out exactly as it was filed.
- **Declined.** Don't allow, with a reason, and the manager re-files a corrected post. It never
  re-files an identical one. With no reason, it asks you once what to change.

One post waits for you at a time. While it waits, the manager is busy on that card.

## 📊 Analytics

The analyst records every post's numbers each morning at 09:05 (`social.post_metrics`). On a
Monday at 07:30 it writes the weekly report: what went out, what it did, what to make more of and
less of. It files the report as a **Weekly report** card for the channel manager. The manager
applies what is its own — captions and posting times. The head of each chain reads the same card
before it starts the next pieces.

## 👥 The crew

Every seat reads `project_context` first, acts as the `channel` persona, and works on the board.
The org's CEO owns the board and is told when a card closes or blocks. A seat with no timer is
woken by its cards.

### `faceless`

| Seat | Role | Timers | Day one | What it does |
|---|---|---|---|---|
| `channel-manager` | Channel lead | — | `channel-plan` | Publishes each piece on the cadence; reads the weekly report |
| `producer` | Video production | — | `look` | Renders the plan as one vertical video; creates the Publish card |
| `trend-scout` | Trends & briefs | Mon & Thu 06:00 ($10) | `first-piece` | Starts each piece as a Plan card, with exemplars it opened |
| `scriptwriter` | Hooks & scripts | — | `reference-study`, `hook-style` | Looks inside the exemplars, writes the plan, creates the Render card |
| `analyst` | Performance | Mon 07:30 ($10), daily 09:05 ($2) | `report-frame` | Records the numbers; files the weekly report card |

### `longform`

| Seat | Role | Timers | Day one | What it does |
|---|---|---|---|---|
| `channel-manager` | Channel lead | — | `channel-plan` | Publishes each piece on the cadence; reads the weekly report |
| `researcher` | Research & briefs | Mon, Wed & Fri 05:00 ($10) | `first-piece` | Starts one sourced subject a fire, with exemplars of this length |
| `writer` | Structure & scripts | — | `reference-study`, `arc-style` | Samples exemplar frames at chapter boundaries; plans every seam on a shot change |
| `producer` | Render & assembly | — | `look` | Renders up to six segments, joins them with ffmpeg, probes the file |
| `analyst` | Performance | Mon 07:30 ($10), daily 09:05 ($2) | `report-frame` | Reports where the audience left each piece |

### `clipping`

| Seat | Role | Timers | Day one | What it does |
|---|---|---|---|---|
| `channel-manager` | Channel lead | — | `channel-plan` | Publishes each clip on the cadence; reads the weekly report |
| `clipper` | Clip production | — | `source-check` | Cuts the moment with `clip_video`; creates the Caption card |
| `scout` | Source watch | daily 06:00 ($10) | `first-piece` | Starts each moment from the named channels as a Cut card |
| `caption-editor` | Captions & titles | — | `caption-style` | Writes the caption and credits the creator; creates the Publish card |
| `analyst` | Performance | Mon 07:30 ($10), daily 09:05 ($2) | `report-frame` | Reports by source and by clip |

The skills are the platform's `naive/*` catalogue, read with `read_skill`:
`naive/short-video-hooks`, `naive/long-form-arc`, `naive/video-assembly`, `naive/clip-selection`,
`naive/caption-writing`, `naive/video-trend-brief`, `naive/reference-teardown` and
`naive/channel-report`.

## 📝 The setup questions

The studio asks at most four before anything is provisioned. The engine refuses a fifth.

| Template | Questions |
|---|---|
| `faceless`, `longform` | Niche · Where should this channel post? · A channel or video to model this on (optional) · Posting cadence |
| `clipping` | Reference channels to cut from · Where should this channel post? · Who sees a new YouTube video? (optional) · Posting cadence |

"Where should this channel post?" takes several networks. The `channel` persona maps each answer
to its network, so the studio's **Add connections** step asks you to connect exactly those
accounts. `faceless` and `longform` have no room for the visibility question, so they post YouTube
unlisted; tell the manager otherwise when you decline a post.

The tone and who the channel is for is not on the form. The manager asks it once, after its
day-one card closes.

## 🌅 Day one

The cards are seeded on the company board. A card waiting on another is not woken, and costs
nothing, until that card closes.

```
channel-plan ──→ report-frame
reference-study ──→ look ─────┐
                └─→ hook-style ┴→ first-piece → the piece's own chain
```

(`longform` has `arc-style` for `hook-style`; `clipping` has `source-check` and `caption-style`
open at once, with no reference study.)

Day one sets up the plan, the reference, the look and the voice, then starts **one** piece. That
piece runs its full chain to your approval card. The timers start the rest.

A card carries no budget of its own: a woken seat runs on its per-task ceiling. So day one is
bounded by one ceiling per seeded card, plus one per card of the first piece's chain
($180 on `faceless`, $290 on `longform`, $160 on `clipping`).

## 💰 Money

- Every seat: **$20 per task, $60 per day.** $20 clears one 30-second render (~$9.00 as the ledger
  bills it) and the turns around it.
- The `longform` producer: **$75 per task, $150 per day.** One piece is up to six segments,
  ~$53.97 of video, in one session.
- Each fire has its own budget, inside its seat's ceiling.
- `generate_video` is pinned to `bytedance/seedance-2.5` first (with `google/veo-3.1` allowed).
  `generate_image` is left unpinned, so it takes the cheapest priced model.

## 🔐 Tool permissions

- The default is **deny**. A connected account's own tools are not a second way out.
- Every seat holds the board (`board_read`, `board_write`), `project_context`, `find_files`,
  `session_spend` and `browser`.
- `ask_operator` and `request_tools` are always `ask`.
- `social.post`: `ask` on `channel-manager`, `deny` everywhere else.
- `social.post_metrics`: `allow` on `analyst` only.
- Every other publish, pay or file tool (email, legal, wallet, card) is denied by name.
- Nobody messages another seat. The board wakes the next one.
- `bash` only where a shell is the job: the Short Form scriptwriter and the Long Form writer
  sample frames; the Long Form producer joins segments.

## 🔁 Switching template

Edit `ACTIVE` in [`templates/index.ts`](templates/index.ts) and run `naive up`. The switch widens:
the new crew is created, and a seat only the old template had is **kept and still firing**. Its
crons keep billing. Retire it by adding its name to `removed` in `naive.config.ts` and running
`naive up` again.

Schedules are the one place where omission deletes. An agent's `schedules` are owned as a whole
set and matched by exact cron text: `"0 8 * * 1"` and `"0 08 * * 1"` are a delete plus a create.
A seat woken only by its cards declares `schedules: []`, which removes any cron an older version
of this repo gave it.

## 🧪 Tests

`pnpm typecheck && pnpm test`. The suite reads the declarations and the engine itself:

- [`templates/templates.test.ts`](templates/templates.test.ts) — every seat's tools, the card
  chains, publishing, analytics, and that no prompt names a surface that is gone.
- [`naive.config.test.ts`](naive.config.test.ts) — what `naive up` is handed, after the engine
  parses it.
- [`onboarding.test.ts`](onboarding.test.ts) — the setup questions, and the engine's refusal of a
  fifth.
- [`docs.test.ts`](docs.test.ts) — this README's tables and figures against the code.

## 🤝 Contributing

Keep a change to one thing. Nothing may add a second way to publish: the tests above exist to
catch exactly that. Write the why in the commit message.

## 📄 License

[MIT](LICENSE) © Naive.
