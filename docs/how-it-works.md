# How the media blueprint works

This repo is data. It declares a crew, its tools, its timers, its setup questions and its first
day of cards. The platform runs all of it. There is no app of our own.

## 1. What a template is

A template is one crew: five seats, their prompts, their tool lists, their crons, their setup
questions and their day-one cards. The three live in `templates/`. `ACTIVE` in
`templates/index.ts` picks the one that runs. `templates/template.ts` holds what they share: the
channel manager, the analyst's crons, the tool rules, the crew rules every prompt ends with.

## 2. What `naive up` provisions

- **The crew** of the running template — five agents, each acting as the `channel` persona.
- **The `channel` identity**. The accounts connected to it are where the channel posts.
- **The crons**: one on the head of the chain, two on the analyst. Every other seat declares
  `schedules: []`.
- **The day-one cards** on the company board, keyed `media:<key>`. A re-apply answers the card it
  already wrote.
- **The setup questions**, which the studio asks before anything is provisioned.

No app, no database, no deploy, no secret beyond your own `NAIVE_API_KEY`.

## 3. The board is the pipeline

Every piece is a chain of cards. Each card is assigned to one seat. Its body is that seat's brief.

- A seat is woken when its card is **due**: `todo`, assigned, no open blocker, and the seat holds
  no other `doing` card (canonical-spec §28.18). The platform's tick starts the session.
- The seat reads the card (`board_read`) and claims it (`board_write update`, `doing`).
- It does its step. Then it hands on: `board_write create` — the next card, assigned to the next
  seat, `blocked_by` its own card, with its output as the new card's body.
- It closes its own card `done`, with a note naming what it made and the new card's id. Closing is
  what wakes the next seat.
- Work it cannot finish: it comments what is missing and closes its card `done` with a note that
  starts `STOPPED:`, handing nothing on. A seat woken behind a STOPPED card stops the same way.
  It never moves a chain card to `blocked`: the platform's healer re-opens any `blocked` card whose
  blockers are all done and wakes the seat again (`packages/db/src/queries/board.ts:282-291`).
- The head of a chain starts its cards with no `blocked_by`. A cron fire works a standing
  "Recurring" card that every fire reopens, so it is never a blocker.
- The org's CEO owns the board and is told when a card closes or blocks.

The cards per piece:

| Template | Head starts | Then | Then | Ends at |
|---|---|---|---|---|
| `faceless` | **Plan** (scriptwriter) — body: the brief | **Render** (producer) — body: the plan | **Publish** (channel-manager) — body: file id, caption | approval card |
| `longform` | **Plan** (writer) — body: the brief | **Render** (producer) — body: the plan, cut into segments | **Publish** (channel-manager) | approval card |
| `clipping` | **Cut** (clipper) — body: source URL, start, end, why | **Caption** (caption-editor) — body: file id, source, creator | **Publish** (channel-manager) | approval card |

Two platform rules keep this safe:

- A card's body cannot be edited after it is created (`board_write update` moves status and writes
  a note). That is why each seat writes its output into the **next** card, not its own.
- A session that ended its turn to wait for a render is not parked; the render's completion wakes
  it (`packages/db/src/queries/board.ts`, ADR-0809). So a producer can wait for its `fil_` id.

A card is woken at most three times. After that it is parked for the CEO.

## 4. The crews

### `faceless` — Faceless channel, 15–30 seconds

- **trend-scout** (Mon & Thu 06:00): reads the teardown and the newest weekly report. For each slot
  the cadence needs, picks a topic, opens one to three real videos doing it well, and creates a
  Plan card whose body is the brief.
- **scriptwriter**: opens the exemplars first — the browser for the page, `bash` to sample frames
  through the first three seconds, `view_image` to look. Then research, three hooks, beats, shots.
  Creates the Render card; its body is the plan: hook, shots with prompts and seconds summing to
  15–30, model, facts with sources, caption.
- **producer**: one `generate_video` call — the shots in order as one take, 9:16, the plan's model.
  Creates the Publish card with the `fil_` id.
- **channel-manager**: publishes (section 5).
- **analyst**: the numbers daily, the report weekly (section 6).

### `longform` — Long-form channel, 60–180 seconds

`generate_video` renders at most 30 seconds a call (measured: the model refuses 59 and 60). So a
piece is up to six segments, rendered separately and joined with ffmpeg.

- **researcher** (Mon, Wed & Fri 05:00): one subject a fire, four or five sourced claims, one or two
  exemplars of this length — never shorts — with where each opens and turns.
- **writer**: samples exemplar frames at their chapter boundaries, then plans acts and shots. No
  segment runs over 30 seconds; every segment boundary lands on a shot change, because two
  independently rendered segments never match mid-shot.
- **producer** ($75/task): comments each segment's `fil_` id on the Render card the moment it
  lands, so a re-woken session renders only what is missing. `generate_video` takes no file name,
  so the card is the resume point. It `fetch_file`s each segment into its sandbox, probes, joins
  with ffmpeg, probes the join, `publish_file`s it, and creates the Publish card.
- **analyst**: leads with retention — where the audience left, against the plan's acts.

### `clipping` — Clipping channel, 15–60 seconds

- **scout** (daily 06:00): watches only the named reference channels, screenshots each episode it
  picks from, and creates a Cut card per moment.
- **clipper**: `clip_video` on the whole source URL, vertical; picks the clip that is the card's
  moment; creates the Caption card with the `fil_` id.
- **caption-editor**: title, caption, hashtags, and a credit to the original creator on every clip;
  creates the Publish card.
- **analyst**: by source and by clip.

### Day one

Each template seeds five or six cards. Set-up first — the channel plan, the reference study, the
look, the voice, the report skeleton — then one `first-piece` card for the head of the chain. That
piece runs its full chain to the approval card. The reference study never asks the operator: a
blank reference answer means go and find two or three real videos in the niche.

## 5. Publishing

`channel-manager` is the one seat that publishes. It is on every template, it owns the calendar,
and it spends nothing on renders — so the seat that bought a video never decides it ships.

Woken on a Publish card, it:

1. reads the plan behind it and fixes the caption where it drifts;
2. reads the card's comments — a post id already there is never posted again;
3. reads the connected accounts with `social.accounts` — they are where it posts; with none (or no
   `social.post` offered), asks the operator once to connect one, and waits;
4. calls `social.post` with `file_ids`, the caption as `content` (first line is the YouTube title),
   and the connected accounts' platform ids;
5. posts YouTube on its own call with `visibility` — the setup answer, else `unlisted` — and the
   other networks on a second call without one (the platform refuses a visibility on them);
6. sets `scheduled_at` to the next free slot at least a day out: daily is every day, 3× a week is
   Monday, Wednesday and Friday, weekly is Friday — 17:00 `America/New_York`, with that date's
   UTC offset. An approved call goes out exactly as it was filed, so a slot chosen too close could
   pass while it waits;
7. comments each post id on the card the moment it is approved, then closes the card.

`social.post` is `ask` for this seat, so each call stops on the platform's approval card: the
video, the caption, the time it goes out, the visibility, and **Allow** / **Don't allow**. There is
no "Ask for changes" button. A Don't allow reaches the seat as *"The person DENIED this call: …
Do not issue it again unchanged."* The prompt says: re-file a corrected post from what they said,
never an identical one; with no reason given, ask once what to change.

While a post waits for approval, the manager holds that card `doing`, so its next Publish card
waits too. One post waits for you at a time.

## 6. Analytics

- **Daily 09:05**: `social.post_metrics` with `since_days 14`. The platform stores each reading, so
  every post gets a history. Outliers get a one-line comment on their Publish card.
- **Monday 07:30**: the weekly report, created as a **Weekly report** card for the channel manager.
  It ends with two things to make more of and one to make less of.
- The manager is woken on it and applies what is its own — captions and posting times. The head of
  the chain reads the newest report before it starts the next pieces.

`post_to_channel` is not used: the platform offers it only to a session seated in a chat room, and
a cron fire is not.

## 7. Tool permissions

`toolset` in `templates/template.ts` builds every seat's list:

- default `deny`;
- every built-in, every `social.*` tool and every platform publish-or-pay tool
  (`ASK_BY_DEFAULT_TOOLS`: email, legal, wallet, card) the seat is not granted is written `deny`
  by name — unnamed, the platform would default those to `ask`;
- every seat: `board_read`, `board_write`, `project_context`, `find_files`, `session_spend`,
  `browser` at `allow`; `ask_operator`, `request_tools` at `ask`;
- `channel-manager`: `social.accounts` `allow`, `social.post` `ask`;
- `analyst`: `social.post_metrics` `allow`;
- `handoffs: false` everywhere, so `send_to_agent` and `list_agents` are denied;
- `generate_video` carries `config.models`, Seedance 2.5 first.

## 8. Setup questions and `project_context`

The studio asks three questions, never where to post; the answers land on the install; every seat reads them with
`project_context`. The engine prepends its own "read the project context first" preamble to every
template agent, and our `CONTEXT_PREAMBLE` adds what the answers are on a media channel.

## 9. What the platform cannot express yet

Found while building this, with where it lives in the platform repo:

- **A catalog artifact needs a built app.** `scripts/publish-artifacts.mjs:171-176` throws "an
  artifact addresses at least one built tree"; `packages/core/src/schema/blueprint.ts:188` is
  `trees: z.array(BlueprintTreeSchema).min(1)`; migration `0040_blueprint_artifact_trees.sql`
  checks `jsonb_array_length(trees) > 0`. A data-only blueprint installs with `naive up`, not from
  the studio.
- **No setup answers without a catalog install.** `projectContextOf`
  (`apps/api/src/routes/sessions.ts:135-146`) needs an install with a published artifact;
  canonical-spec §31.8 says an apply from a working tree has no context.
- **A template must still carry an app's screen fields.** The engine's `Template` type requires `kinds`,
  `seed` and `words` (`packages/blueprints/src/template.ts:36-40`) and never reads them; we pass
  them empty.
- **Four questions per template.** `define.ts:388-390`. A choice question has no `default` field.
- **A card has no attachments, and its body cannot change.** `board_write` offers
  create / update / comment / assign (`apps/runtime-do/src/board-tools.ts:136-153`); `update`
  refuses a title or `blocked_by` change (`apps/runtime-do/src/board.ts:189`). File ids travel in
  bodies, notes and comments.
- **The approval card has no "Ask for changes".** `apps/web/app/components/chat/Gate.tsx:157-163`
  renders Allow and Don't allow; a reason is accepted on the wire but has no field on the card.
- **`clip_video` does not hold a woken card.** The parking sweep exempts a session waiting on a
  `media_job` (`packages/db/src/queries/board.ts:494-496`) but not on a `clip_job`, so a Cut card
  can be parked while its clip is still being cut. The platform fix is one more `not exists`.
- **A blocked chain card is re-opened.** The healer promotes any `blocked` card whose blockers
  are all done (`board.ts:282-291`). That is why a seat stops a piece with a STOPPED note.
- **`board_read` lists oldest first, at most 100.** There is no paging
  (`packages/db/src/queries/board.ts:251`, `apps/runtime-do/src/board-tools.ts:110`), so after a
  few busy weeks the newest cards fall out of an unfiltered read.
- **`create` does not check the assignee.** Only `assign` does (`apps/runtime-do/src/board.ts:218-227`).
  A misspelled seat name leaves a card nobody is woken for; the prompts spell each name exactly.
- **No room for a cron. `post_to_channel` is offered only to a session seated in a room
  (`apps/runtime-do/src/team-tools.ts:399`), so the weekly report is a board card, not a team-channel post.
