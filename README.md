# 🎬 Media Blueprint

**An autonomous video channel as data. Clone it, run `naive up`, and the Naive platform provisions
the crew, its timers and its first day of work into your organization.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![engine: @usenaive-sdk/blueprints](https://img.shields.io/npm/v/@usenaive-sdk/blueprints?label=engine%3A%20%40usenaive-sdk%2Fblueprints&color=0a7ea4)](https://www.npmjs.com/package/@usenaive-sdk/blueprints)
[![CLI: @usenaive-sdk/vetta-cli](https://img.shields.io/npm/v/@usenaive-sdk/vetta-cli?label=cli%3A%20naive&color=0a7ea4)](https://www.npmjs.com/package/@usenaive-sdk/vetta-cli)

There is no hosted app. The crew runs on the platform's own screens:

- **Media manager.** One mini app under Apps, declared as data in `templates/`: one page with the
  week's numbers on top, then what waits on you, what is scheduled (a row of cards), and what went
  out (a picture grid with each post's views). The platform draws it and reads every number.
- **The board.** Every piece is a chain of cards. Each card's body is the brief for one seat.
- **The Media gallery.** Every render and every cut lands there on its own.
- **The approval card.** One seat publishes. Every post waits for your **Allow**.
- **Chat.** Talk to the channel manager like any agent.

The repo carries **three templates**. A template is a crew:

| Template | Shown as | The channel it runs | Its crew | Piece length |
|---|---|---|---|---|
| `faceless` | Faceless channel | Original short-form video in one niche | `channel-manager`, `producer`, `trend-scout`, `scriptwriter`, `analyst` | 15–30s |
| `longform` | Long-form channel | One researched subject at a time, rendered in segments and joined | `channel-manager`, `researcher`, `writer`, `producer`, `analyst` | 60–180s |
| `clipping` | Clipping channel | The best moments of the channels you name, cut and captioned | `channel-manager`, `clipper`, `scout`, `caption-editor`, `analyst` | 15–60s |

The id in the first column is stored on every install. It never changes. The studio shows the
title, the one-line description, and the networks each template is made for (`PLATFORMS`) as icons.

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

From 2.0.0 the studio's catalog publishes this data-only blueprint too (no built app, zero
trees), so a new channel can also be installed from the studio.

### ⚠️ Known limit

- **`project_context` answers only on a catalog install.** A `naive up` from a clone has no setup
  answers, so each seat asks you for what it needs, once. See
  [docs/how-it-works.md](docs/how-it-works.md#9-what-the-platform-cannot-express-yet). That is a
  platform change, not a change to this repo.

### ⬆️ Coming from 1.x

1.x ran a hosted `channel` app with its own store of posts. 2.0.0 declares no app, and it does
**not** remove the old one: an install on 1.x keeps its app and its store until an operator
retires them, after the store is exported.

**Never add `removed: { apps: ["channel"] }`** to `naive.config.ts`. It would delete the old
store, irreversibly, on whichever apply ran first (a customer's own **Update** included), before
anyone exported it. It would not revoke the old app's key either. Retiring the old app is an
operator step, not a change to this repo.

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
   writes the whole plan: hook, shots with prompts and seconds, sources, caption. It
   creates a **Render** card for the producer. The card's body is the plan.
3. **The producer** is woken on the Render card. It renders the plan with `generate_video`. The
   video lands in the Media gallery. It creates a **Publish** card for the channel manager with
   the file id and the caption.
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
- **Where.** Every account connected to the channel. With none connected, it asks you to connect
  one and waits.
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
| `trend-scout` | Trends & briefs | Mon & Thu 06:00 ($10) | `first-briefs` | Starts each piece as a Plan card, with exemplars it opened |
| `scriptwriter` | Hooks & scripts | — | `reference-study`, `hook-style` | Looks inside the exemplars, writes the plan, creates the Render card |
| `analyst` | Performance | Mon 07:30 ($10), daily 09:05 ($2) | `report-frame` | Records the numbers; files the weekly report card |

### `longform`

| Seat | Role | Timers | Day one | What it does |
|---|---|---|---|---|
| `channel-manager` | Channel lead | — | `channel-plan` | Publishes each piece on the cadence; reads the weekly report |
| `researcher` | Research & briefs | Mon, Wed & Fri 05:00 ($10) | `first-topic` | Starts one sourced subject a fire, with exemplars of this length |
| `writer` | Structure & scripts | — | `reference-study`, `arc-style` | Samples exemplar frames at chapter boundaries; plans every seam on a shot change |
| `producer` | Render & assembly | — | `look` | Renders up to six segments, joins them with ffmpeg, probes the file |
| `analyst` | Performance | Mon 07:30 ($10), daily 09:05 ($2) | `report-frame` | Reports where the audience left each piece |

### `clipping`

| Seat | Role | Timers | Day one | What it does |
|---|---|---|---|---|
| `channel-manager` | Channel lead | — | `channel-plan` | Publishes each clip on the cadence; reads the weekly report |
| `clipper` | Clip production | — | `source-check` | Cuts the moment with `clip_video`; creates the Caption card |
| `scout` | Source watch | daily 06:00 ($10) | `first-moments` | Starts each moment from the named channels as a Cut card |
| `caption-editor` | Captions & titles | — | `caption-style` | Writes the caption and credits the creator; creates the Publish card |
| `analyst` | Performance | Mon 07:30 ($10), daily 09:05 ($2) | `report-frame` | Reports by source and by clip |

The skills are the platform's `naive/*` catalogue, read with `read_skill`:
`naive/short-video-hooks`, `naive/long-form-arc`, `naive/video-assembly`, `naive/clip-selection`,
`naive/caption-writing`, `naive/video-trend-brief`, `naive/reference-teardown` and
`naive/channel-report`.

## 📝 The setup questions

The studio asks three before anything is provisioned. The engine refuses a fifth.

| Template | Questions |
|---|---|
| `faceless`, `longform` | Niche · Reference (optional) · Posting cadence |
| `clipping` | Channels to cut from · Who sees a new YouTube video? (optional) · Posting cadence |

No question asks where the channel posts. It posts to the accounts you connect to it; the channel
manager asks you for one when none is connected. `faceless` and `longform` do not ask the
visibility question, so they post YouTube unlisted; tell the manager otherwise when you decline a
post.

The tone and who the channel is for is not on the form. The manager asks it once, after its
day-one card closes.

## 🌅 Day one

The cards are seeded on the company board. A card waiting on another is not woken, and costs
nothing, until that card closes.

```
channel-plan ──→ report-frame
reference-study ──→ look ─────┐
                └─→ hook-style ┴→ first-briefs → the piece's own chain
```

(`longform` has `arc-style` for `hook-style` and `first-topic`; `clipping` has `source-check` and
`caption-style` open at once, with no reference study, and `first-moments`.)

The first-piece card reuses the key 1.x already seeded (`first-briefs`, `first-topic`,
`first-moments`). A card is keyed `media:<key>` and a re-apply never re-seeds a key the board
holds, so updating an existing channel to 2.0 does not start a new paid piece.

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
- `generate_video` renders with `bytedance/seedance-2.5` by default: it is first in the pinned
  allow-list (`google/veo-3.1` is allowed too), and no brief names a model unless your setup answers
  or context explicitly ask for another.
  `generate_image` is left unpinned, so it takes the cheapest priced model.

## 🔐 Tool permissions

- The default is **deny**. A connected account's own tools are not a second way out.
- Every seat holds the board (`board_read`, `board_write`), `project_context`, `find_files`,
  `session_spend`, `browser`, `web_search` and `web_fetch`.
- `view_image` on every seat that judges a picture: `channel-manager`, the producers, the
  scriptwriter and writer, `trend-scout`, `researcher`, `clipper`, `scout` and `caption-editor`.
- `ask_operator` and `request_tools` are always `ask`.
- `social.post`: `ask` on `channel-manager`, `deny` everywhere else.
- `social.accounts` and `social.status`: `allow` on `channel-manager` only.
- `social.post_metrics`: `allow` on `analyst` and `channel-manager`.
- `company.set_timezone`, `company.set_logo` and `apps.request_access` are denied on every seat.
- Every other built-in and platform tool (email, legal, wallet, card, connections) is denied by
  name. `generate_speech` and `transcribe_audio` are not granted to any seat.
- Nobody messages another seat. The board wakes the next one.
- `bash` only where a shell is the job: the Short Form scriptwriter and the Long Form writer
  sample frames; the Long Form producer joins segments.

## 🔁 Switching template

Edit `ACTIVE` in [`templates/index.ts`](templates/index.ts) and run `naive up`. The switch widens:
the new crew is created, and a seat only the old template had is **kept and still firing**. Its
crons keep billing. To retire that seat, name it, and only it, under `removed.agents` in
`naive.config.ts` and run `naive up` again. Never name an app under `removed`: see
*Coming from 1.x* above.

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
