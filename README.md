# 🎬 Media Blueprint

**An autonomous video channel, declared. Clone it, run `naive up`, and the Naive platform provisions
the crew, its timers and its first day of work into your organization.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![engine: @usenaive-sdk/blueprints](https://img.shields.io/npm/v/@usenaive-sdk/blueprints?label=engine%3A%20%40usenaive-sdk%2Fblueprints&color=0a7ea4)](https://www.npmjs.com/package/@usenaive-sdk/blueprints)
[![CLI: @usenaive-sdk/vetta-cli](https://img.shields.io/npm/v/@usenaive-sdk/vetta-cli?label=cli%3A%20naive&color=0a7ea4)](https://www.npmjs.com/package/@usenaive-sdk/vetta-cli)

Media manager is a hosted app whose source is in [`apps/media-manager`](apps/media-manager); agents
can pull, change and deploy it like any app. The crew runs on it and on the platform's own screens:

- **Media manager.** One page under Apps, signed in through Naive: the week's numbers on top, then
  what waits on you (each with a link to its chat, where you decide it), what is scheduled (a row of
  cards), and what went out (a picture grid with each post's views). It reads the platform with the
  read key Naive gives it; you set nothing up.
- **The board.** Every piece is a chain of cards. Each card's body is the brief for one seat.
- **The Media gallery.** Every render and every cut lands there on its own.
- **The approval card.** One seat publishes. Every post waits for your **Allow**.
- **Chat.** Talk to the channel manager like any agent.

The repo carries **three base templates**, plus sixteen niche channel templates and the AI Influencer template, which reuse them (below).
A template is a crew:

| Template | Shown as | The channel it runs | Its crew | Piece length |
|---|---|---|---|---|
| `faceless` | Faceless channel | Original short-form video in one niche | `channel-manager`, `producer`, `trend-scout`, `scriptwriter`, `analyst` | 15–30s |
| `longform` | Long-form channel | One researched subject at a time, rendered in segments and joined | `channel-manager`, `researcher`, `writer`, `producer`, `analyst` | 60–180s |
| `clipping` | Clipping channel | The best moments of the channels you name, cut and captioned | `channel-manager`, `clipper`, `scout`, `caption-editor`, `analyst` | 15–60s |

The id in the first column is stored on every install. It never changes. The studio shows the
title, the one-line description, and the networks each template is made for (`PLATFORMS`) as icons.

### Niche channel templates

On top of the base three, the repo carries **sixteen niche channel templates**. Each is its base crew
with one thing added: a niche playbook (a platform catalogue skill, `naive/channel-template-<niche>`)
pinned in **every** seat's `skills[]`, plus a niche title and one-line description. `niche()` in
[`templates/template.ts`](templates/template.ts) is the whole of it — no new crew, question or card
(the one exception is `channel-cloning`, which keeps a single custom question — the channel to clone —
in place of the dropped niche question). The niche's own content is the skill, which lives in the
platform catalogue, not this repo.

Where a niche's playbook needs a seat to do more than its base seat, `niche()` takes `seats`, which
**extends** that seat: tools added at `allow`, skills appended, and a brief clause before the crew's
rules. Every generated short uses the base scene pipeline: script, one opening image per scene, one
image-to-video render per scene, then speech, creator-style captions, a ducked music bed and an
ffmpeg join. A scene opens on a generated
image unless a pinned skill names its opener — a shipped frame, or the previous take's last frame.
Scenes run 5 to 15 seconds and total 15–30. The thirteen niche templates use `SEGMENTED_SHORT_FORM`
only to point each seat at their pinned skill, which supplies the genre-specific scene grammar.

| Template | Shown as | Reuses | Pins the skill |
|---|---|---|---|
| `gaming-clips` | Gaming Clips Channel | `clipping` | `naive/channel-template-gaming-clips` |
| `news` | News Clips Channel | `clipping` | `naive/channel-template-news` |
| `sports` | Sports Clips Channel | `clipping` | `naive/channel-template-sports` |
| `ufc` | AI UFC Channel | `faceless` | `naive/channel-template-ufc` |
| `history` | AI History Channel | `faceless` | `naive/channel-template-history` |
| `animal-feast` | AI Eating Animal Channel | `faceless` | `naive/channel-template-animal-feast` |
| `channel-cloning` | AI Channel Cloning | `faceless` | `naive/channel-template-channel-cloning` |
| `comics` | AI Comics Channel | `faceless` | `naive/channel-template-comics` |
| `cartoons-irl` | AI Cartoons IRL Channel | `faceless` | `naive/channel-template-cartoons-irl` |
| `dancing-animals` | AI Dancing Animals Channel | `faceless` | `naive/channel-template-dancing-animals` |
| `roadster` | AI Impossible Roadster Channel | `faceless` | `naive/channel-template-roadster` |
| `cat-stories` | AI Cat Stories Channel | `faceless` | `naive/channel-template-cat-stories` |
| `food-slime` | AI Food Slime Channel | `faceless` | `naive/channel-template-food-slime` |
| `glass-food` | AI Glass Food Channel | `faceless` | `naive/channel-template-glass-food` |
| `would-you-choose` | AI Would You Choose Channel | `faceless` | `naive/channel-template-would-you-choose` |
| `fruit-drama` | AI Fruit Drama Channel | `faceless` | `naive/channel-template-fruit-drama` |

A niche is picked at company creation like any other template; its crew carries the niche skill from
the first session. It publishes, installs and switches through the exact paths the base three do.

### AI Influencer

`ai-influencer` (shown as **AI Influencer**, ADR-1360) is the `faceless` crew with the segmented
seats, pinning `naive/channel-template-ai-influencer`, for one photoreal creator who posts every day
in a few chosen looks ([`templates/ai-influencer.ts`](templates/ai-influencer.ts)). The character is
a setup answer, not a niche: one of four prebuilt creators, ready at once, or a face trained from the
operator's own photos ($3.25, about 20 minutes, approved first). Every still of the influencer is
`generate_image` with their character and a look, and every video is `generate_video` with the
character and such a still as its first frame, so the face never changes. Day one's `look` card
becomes **Meet the influencer** (same key): the producer resolves the character, trains it if photos
were uploaded (waiting on an `ask_operator` reply, since nothing wakes a seat when training ends),
and renders one still per picked look as the channel's look sheet. The producer holds
`get_character` and `list_characters`, and `create_character` at `ask`; the scriptwriter reads
`get_character`. Every seat denies `edit_video` by name (an edit can change the face). It renders on
`AI_INFLUENCER_VIDEO_MODELS`, the two image-to-video models measured keeping a face from a still. It asks no cadence: the manager and the scout read it
as daily.

It runs on the short-form scene pipeline (script -> images -> video -> edit, with a character bible),
with the parts that would change the face replaced rather than added to. The producer's scene step is
the influencer's (`PRODUCER_SCENE_STEP`): scene 1's image is a character still in the plan's look, and
every later scene's image is that still re-posed (`generate_image` with the character and the still in
`image_urls`, an edit that keeps the room, props and outfit and is still the character's); no scene
opens on a skill's shipped frame or a previous take's last frame, and every scene's clip animates its
still with the character, all submitted in one turn. No render prompt holds words, not even a spoken
line: the line stays in the plan and is voiced in the edit (AUDIO MODE GENERATED, since the clips are
silent). The burned-in label is a disclosure only; a call to action shows in the last scene only.
Preflight, AUDIO MODE, the edit and VERIFY are the base producer's, word for word. Both seats drop
the base's pre-bible (legacy) path: the day-one `character-bible` card is the influencer's own, drawn
from the persona, the purpose answer and the picked looks (no page, no video), waits on nothing, and
the first piece waits on it. Day one starts the first piece from the face, that bible and a hook
style that waits on nothing; the reference study runs after the first piece starts, on the analyst,
capped at about $0.40 and by the analyst's $1 per-task ceiling. The first piece runs 15 seconds (three
5-second scenes, a line of at most 12 words each), and every seat has a ceiling sized to this
template's render (`AI_INFLUENCER_BUDGETS`: producer $8 a task, the others $3, the analyst $1).

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

The studio's catalog publishes this blueprint too, so a new channel can also be installed from the
studio. From 3.0.0 the published tree of Media manager is its source; the platform builds it.

### ⚠️ Known limit

- **`project_context` answers only on a catalog install.** A `naive up` from a clone has no setup
  answers, so each seat asks you for what it needs, once. See
  [docs/how-it-works.md](docs/how-it-works.md#9-what-the-platform-cannot-express-yet). That is a
  platform change, not a change to this repo.

### ⬆️ Coming from 2.x

2.x drew Media manager as a mini app, declared as data. 3.0.0 declares it as a hosted app instead.
A company on 2.x keeps its mini app until it applies 3.0.0; that apply creates the hosted app.

### ⬆️ Coming from 1.x

1.x ran a hosted `channel` app with its own store of posts. 2.0.0 declared no app, and it does
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
2. **The scriptwriter** reads the character bible (approved, else the draft), looks inside the
   exemplars, researches, and writes the whole scene plan: provenance, continuity contract, image
   and motion prompts, exact dialogue, an edit plan naming the caption style and music mood, sources
   and caption. It creates the
   **Render** card.
3. **The producer** stops before spend only on an objective gap (a missing section or bible note,
   the wrong total length, no scenes) and posts one warning for judgement calls. It generates and
   checks each scene's opening image, passes it to `generate_video` as `image_urls: ["fil_…"]`,
   records every image and segment on the card, and retries a failed scene once. It transcribes the
   renders and chooses one dialogue source for the whole piece: native character performances or
   generated speech over stripped audio, never both. It adds on-screen text, captions in the pinned
   skill's style (word-by-word by default) timed from word timings, and a `generate_music` bed ducked
   under dialogue — never a generic AI label — joins, then verifies with ffprobe, one frame per
   scene (captions readable) and a transcript of the finished file (music audible, dialogue clear),
   and creates the
   **Publish** card. A
   Render card planned before the bible existed is rendered as planned, resumably, then finished
   with its voice and the same captioned, scored edit.
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
  Friday; weekly is Friday. The channel's first post is the exception: it goes out the day it is
  made, at 17:00, when that is still at least an hour away — so day one ends with a post. An
  approved post goes out exactly as it was filed.
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
| `producer` | Video production | — | `look` | Generates scene images and videos, edits the final piece, creates the Publish card |
| `trend-scout` | Trends & briefs | Mon & Thu 06:00 ($10) | `first-briefs` | Starts each piece as a Plan card, with exemplars it opened |
| `scriptwriter` | Hooks & scripts | — | `reference-study`, `character-bible`, `hook-style` | Drafts the continuity bible and asks for approval; writes every scene and prompt |
| `analyst` | Performance | Mon 07:30 ($10), daily 09:05 ($2) | `report-frame` | Records the numbers; files the weekly report card |

### `longform`

| Seat | Role | Timers | Day one | What it does |
|---|---|---|---|---|
| `channel-manager` | Channel lead | — | `channel-plan` | Publishes each piece on the cadence; reads the weekly report |
| `researcher` | Research & briefs | Mon, Wed & Fri 05:00 ($10) | `first-topic` | Starts one sourced subject a fire, with exemplars of this length |
| `writer` | Structure & scripts | — | `reference-study`, `arc-style` | Samples exemplar frames at chapter boundaries; plans every seam on a shot change |
| `producer` | Render & assembly | — | `look` | Renders up to twelve segments, joins them with ffmpeg, probes the file |
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

The studio asks at most three before anything is provisioned; the engine refuses a fifth. A niche
template asks fewer: it **is** its niche, and its reference is the niche skill's playbook, so the
niche and the reference questions are dropped (ADR-1143). A generative niche is then left asking only
the cadence; a clipping niche keeps the sources it cannot cut without. `channel-cloning` is the one
exception: in place of the dropped niche it keeps a single question, the channel it clones.

| Template | Questions |
|---|---|
| `faceless`, `longform` | Niche · Reference (optional) · Posting cadence |
| `clipping` | Channels to cut from · Who sees a new YouTube video? (optional) · Posting cadence |
| `ufc`, `history`, `animal-feast`, `comics`, `cartoons-irl`, `dancing-animals`, `roadster`, `cat-stories`, `food-slime`, `glass-food`, `would-you-choose`, `fruit-drama` | Posting cadence |
| `channel-cloning` | Channel to clone · Posting cadence |
| `ai-influencer` | Who is your influencer? · Photos of your character (optional) · Pick the looks · What is your influencer for? |
| `gaming-clips`, `news`, `sports` | Channels to cut from · Who sees a new YouTube video? (optional) · Posting cadence |

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
                ├─→ hook-style ─────┤
                └─→ character-bible ┴→ first-briefs → the piece's own chain
```

(`longform` has `arc-style` for `hook-style` and `first-topic`; `clipping` has `source-check` and
`caption-style` open at once, with no reference study, and `first-moments`.)

The first-piece card reuses the key 1.x already seeded (`first-briefs`, `first-topic`,
`first-moments`). A card is keyed `media:<key>` and a re-apply never re-seeds a key the board
holds, so updating an existing channel to 2.0 does not start a new paid piece.

Day one sets up the plan, reference, look, voice and a draft continuity bible, then starts **one**
piece. That piece runs its full chain to your approval card. The timers start the rest.

A card carries no budget of its own: a woken seat runs on its per-task ceiling. So day one is
bounded by one ceiling per seeded card, plus one per card of the first piece's chain
($200 on `faceless`, $290 on `longform`, $160 on `clipping`).

## 💰 Money

- Every seat: **$20 per task, $60 per day.** $20 clears one 30-second piece of video (~$5.07 as the
  ledger bills Hailuo 3, 169,000 µUSD a second; ~$9.00 on Seedance 2.5) and the turns around it.
- The `longform` producer: **$75 per task, $150 per day.** One piece is up to twelve segments,
  ~$30.42 of video (~$53.97 on Seedance 2.5), in one session.
- Each fire has its own budget, inside its seat's ceiling.
- `generate_video` renders with `minimax/hailuo-3` by default on every template: it is first in the
  pinned allow-list `VIDEO_MODELS` (`bytedance/seedance-2.5` is allowed too), and no brief names a
  model unless your setup answers or context explicitly ask for another. Hailuo 3 renders 5 to 15
  seconds a call, so every segment and scene keeps to that. `ai-influencer` pins
  `AI_INFLUENCER_VIDEO_MODELS` (`templates/ai-influencer.ts`).
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
  name. `generate_speech` and `generate_music` are on generated-short producers for exact dialogue
  and the music bed;
  `transcribe_audio` is on their scriptwriters for dialogue references.
- Nobody messages another seat. The board wakes the next one.
- `bash` only where a shell is the job: the Short Form scriptwriter and Long Form writer sample
  frames; Short Form and Long Form producers assemble segments.

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
