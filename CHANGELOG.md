# Changelog

## 3.7.0 (unreleased, not tagged)

Channel first (owner, 2026-11-16; vetta-mono channel-first `SPEC.md`, Track H4). `faceless` and its
sixteen niches start with the first video, shown on the channel's home. `longform`, `clipping`,
`music` and `ai-influencer` keep their day one.

Paywall (b): the topic, the script, the stills and hiring run on the 5,000 free credits ($1). Rendering
the video needs a plan.

### Day one is the first video

| Card | Seat | Waits on | What the person sees |
|---|---|---|---|
| `topics` | trend-scout | nothing | A choice of four ideas it wrote. With no niche, four ideas in four niches: the pick sets it. |
| `episode` | scriptwriter | `topics` | The script, written once as `Episodes/<slug>.md`, its title inside. |
| `references` | producer | `episode` | "Making 3 pictures." Then a picture choice (`multiple`, `details[].image = /files/<id>/raw`): "Your pick starts the video." |
| `first-briefs` | producer | `references`, and a plan | `needs_plan`. "Making the video: about 8,100 credits." One 8-second scene. |
| `first-post` | channel-manager | `first-briefs` | "Your video is ready. Is this good?" on the approval card. With no account connected, first a connect question, alone. |

- **`needs_plan` on `first-briefs`.** The board holds the card, with no turn spent, until the
  company has a plan; activation wakes it (SPEC §5). No other card carries it.
- **Connect only at the end.** There is no upfront connect card. `first-post` reads the connected
  accounts; with none, it asks one connect question with the video ready, the chain's only one.
  Answered with none connected, it closes "Not posted: no account yet".
- **No credit line in front of a pick.** The stills and the pick prompt say no price. The video card
  says its cost as it starts, at the template's own model rate.
- **The channel's name is the words the person typed** (the `niche` answer). No naming turn.
- The first two cards are words only: no web pages, nothing generated.
- **Week one** (`reference-study` → `look`, `hook-style`, `character-bible`; `channel-plan` after
  `look`; `report-frame`) waits for the first post to be decided: posted, not posted, or stopped. A
  failed video never stops the channel. The study names both STOPPED rules it sets aside.
- **A pick nobody makes doesn't hold the channel.** After 12 hours unanswered, the analyst's daily
  fire comments a nudge on the topic or picture card. At the next daily check it goes on with the first
  option, "DEFAULTED". It never asks from the fire (ADR-1453).
- Each step comments one short line on its card. The channel shows it as the episode's line.

### What it costs

| What | Credits at most |
|---|---|
| Words: topics, script, the CEO's five digests (estimated 415–417) | 500 |
| Stills: 3 to 5 at $0.01–0.04, and the producer's turns (estimated 243–244) | 1,300 |
| **Before a plan, per sign-up** | **1,800 (~$0.36)** |

| Template | First video, on the plan's credits | Credits |
|---|---|---|
| `faceless` and 13 image-to-video niches | 8 s on FLUX 3 Max (850 credits/s) | 8,100 |
| `empires`, `legend-flex`, `surreal-satire` | 15 s on Seedance 2.5 (~1,168 credits/s) | 18,900 |

Each video line is the seconds times the producer's first pinned model's rate (`VIDEO_RATES`, copied
from vetta-mono `packages/billing/src/video-rates.ts`), plus 1,300 credits around it (estimated
1,041–1,043): the producer's turns, voice, music, transcription and the first post's turn. One guard
stays: what runs before a plan fits 5,000. The HeyGen proposal (`FACELESS_VIDEO_MODELS`) and the
"fits 5,000" tests are gone; the faceless producers pin `VIDEO_MODELS` again. The Seedance rate the
raw-film ceilings use is the platform's 233,530 µUSD a second, not 299,851.

### The channel app (`media-manager`, `home: true`)

The app is the company's home screen. It only shows; the studio draws every decision.

- **Header**: the creator's face and name on a channel that has one, else the typed words and the cadence.
- **Episodes**: a "Create new episode" card, then each episode, newest first, from its board cards:
  the first run's five, or a later piece's Plan → Render → Publish. Each reads **Generating** (the
  working card's newest line), **Needs you** (Pick a topic, Pick pictures, Start your team, Post,
  Connect to post), **Posted** (with the day) or **Stopped** (Ask CEO).
- **An episode's page**: its steps, its script and its stills.
- **Links**: only `?needs=<ses_ id>` (a waiting question or approval, read off the sessions the
  studio's rail reads) and `?say=<words>`, handed to the studio as `{ type: "naive:open", href }`
  after one `naive:ready`. "Create new episode" is `?say=New episode: `. It writes nothing.
- **Deleted**: the numbers and spend (20 ledger pages), Waiting on you, Connect, Scheduled, Posted,
  Stills and clips, Styles and References. Recreate this style stays on the site.
- No Characters tab yet.

### Contract with Track H (vetta-mono)

- `home: true` on an `apps[]` entry and `needs_plan: true` on a task, both as SPEC §3 and §5 name
  them. The installed engine (`@usenaive-sdk/blueprints` 0.19.2) strips both on parse;
  `naive.config.ts` warns when it does, and a test pins it.
- `?needs=` carries a `ses_` id: the parked session's, as the rail keys its needs.
- The app reads the board as `GET /v1/me` → `GET /v1/organizations/:id` (`ceo_agent_id`) →
  `GET /v1/boards/<ceo>/cards`, and the waiting sessions as
  `GET /v1/sessions?status=idle&stop_reason=awaiting_answer|awaiting_approval`. All are in the app
  read preset (`agents:read`, `sessions:read`).
- "Start your team" is shown on the episode with no link: the studio's chrome holds Start.

### Questions

- `faceless` asks one question, `niche`, and it is optional, so the studio asks nothing before it
  hires. Niche templates ask nothing.

### Existing channels

- A re-apply seeds the new keys `topics`, `episode`, `references` and `first-post`. `topics` first
  checks whether the channel is new, reading only this crew's cards by exact template titles. The
  channel was set up before if the channel manager has a done card, or the trend-scout holds "Start
  the channel's first piece" (the first-piece card 2.0–3.6 seeded). If so, it closes at once on
  `ALREADY RUNNING`, and so does every card behind it.
- `first-post` waits on the held `first-briefs` card, which on an older channel is the old first
  piece, already done. It checks that title first and closes on `ALREADY RUNNING` too.
- The video card keeps the key `first-briefs`, so a re-apply never re-seeds it and `needs_plan`
  reaches new channels only.

### Publish (owner step)

1. Wait for an engine that keeps `home` and `needs_plan` (Track H1). Without `needs_plan`, the
   first video renders before a plan. Bump `@usenaive-sdk/blueprints`, flip the engine test in
   `naive.config.test.ts`, then merge and tag `v3.7.0` on media-blueprint `main`.
2. In vetta-mono, run `scripts/publish-artifacts.mjs` for the `media` blueprint at `v3.7.0`. v3.6.0
   was never published; v3.7.0 carries it.
3. On staging, start one faceless company: the channel opens, four ideas come first, the stills are
   free, "Make the video" opens Start, and connect is asked only once the video is ready.
