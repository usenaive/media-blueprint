# Changelog

## 3.7.0 (unreleased, not tagged)

The first video, driven from the chat (owner, 2026-11-16). `faceless` and its sixteen niches only.
`longform`, `clipping`, `music` and `ai-influencer` keep their day one.

Every company starts with 5,000 free credits ($1), and the crew runs at once. When the credits run
out, the platform asks the person to start their team (vetta-mono Track W). So the cheap steps come
first, and each costly step says what it costs before it starts.

### Day one is the first video

| Card | Seat | Waits on | What the person sees |
|---|---|---|---|
| `kickoff` | channel-manager | nothing | The connect card for Instagram, TikTok, YouTube, asked after the card closes. Skippable. |
| `topics` | trend-scout | nothing | A choice of four ideas it wrote. With no niche, four ideas in four niches: the pick sets it. |
| `episode` | scriptwriter | `topics` | The script, written once as `Episodes/<slug>.md`, its title inside. |
| `references` | producer | `episode` | "Making 3 pictures: about 450 to 1,300 credits." Then a picture choice (`multiple`, `details[].image = /files/<id>/raw`) that says what the video costs. |
| `first-briefs` | producer | `references` | "Making the video: about 2,800 credits." One 8-second scene. |
| `first-post` | channel-manager | `first-briefs` | "Your first video is ready. Is this good?" on the approval card. |

- The first three cards are words only: no web pages, nothing generated.
- **Cost lines are each template's own.** The video line is the first video's length times the
  producer's first pinned model's rate (`VIDEO_RATES`, copied from vetta-mono
  `packages/billing/src/video-rates.ts`), plus 1,300 credits: the producer's turns, voice, music,
  transcription and the first post's turn. The stills line covers 3 to 5 pictures (two redos at
  most) at $0.01–0.04 each (the cheapest image model's price, not in code), plus the producer's turns.
- **Turns are estimated from the real prompts.** `turnCredits` re-sends each seat's system and card,
  the platform prompt and the tools at every step. The tests hold each constant to that estimate on
  all 17 templates:
  - words, at most 538 against the 600 held (the CEO's six digests are 228 of it);
  - the references turns, 244 against 300;
  - around the video, 1,043 against 1,300.
- **Worst case on the faceless crews: 4,700 of 5,000 credits**: words 600, stills 1,300, video 2,800.
  The raw-film niches (`empires`, `legend-flex`, `surreal-satire`) render one 15-second Seedance
  call and say "about 18,900 credits", so their wall comes at the video.
- **Week one** (`reference-study` → `look`, `hook-style`, `character-bible`; `channel-plan` after
  `look`; `report-frame`) waits for the first post to be decided: posted, not posted, or stopped. So
  week one never competes with the first post for the last free credits, and a failed video never stops
  the channel. The study names both STOPPED rules it sets aside: the crew rules' and the card's.
- **A pick nobody makes doesn't hold the channel.** After 12 hours unanswered, the analyst's daily
  fire comments a nudge on the topic or picture card. At the next daily check it goes on with the first
  option. It never asks from the fire: the platform skips every later fire of a schedule whose last run
  waits on the person (ADR-1453), and a waiting fire holds the seat's standing card.
- **One connect card at a time.** While the first is unanswered, `first-post` closes "Not posted: no
  account yet" and `kickoff` files the post again once an account is connected. If it was skipped, the
  publisher asks again.
- Each step comments one short line on its card: what is happening, what is next.

### The video model (proposal: the owner's call)

The faceless producers pin `heygen/heygen-video-1` first (`FACELESS_VIDEO_MODELS`). It is the
platform's own default since 2026-11-07: $0.036 a second, rated higher than FLUX 3 Max. It is scoped
to the crews whose first video must fit the free credits; `longform` keeps its pin.

| First pinned model | Credits/s | 8 s video line | Whole first run at most |
|---|---|---|---|
| `heygen/heygen-video-1` (proposed) | 180 | 2,800 | 4,700: fits 5,000 |
| `black-forest-labs/flux-3-max` | 850 | 8,100 | 10,000: wall at the video |
| `minimax/hailuo-3` | 650 | 6,500 | 8,400 |
| `bytedance/seedance-2.5` (15 s, raw-film) | ~1,168 | 18,900 | 20,800 |

To drop the proposal, set `FACELESS_VIDEO_MODELS` to `VIDEO_MODELS`. Every cost line follows; the fit
test and the 2,800 example then fail, because no length fits 5,000 credits on FLUX 3 Max.

**Platform note:** a media render is not refused on an empty balance today (vetta-mono ADR-0641;
`routes/characters.ts:141`: "may run the balance negative"). A cost line that is low therefore means
a negative balance. Track W's free-credit wall must refuse a render the balance can't cover.

### Questions

- `faceless` asks one question, `niche`, and it is optional, so the studio asks nothing before it
  hires. `reference` is gone from its form. Niche templates still ask nothing.

### Media manager

- **References**: each episode under `Episodes/`, with its title, its stills and how far it is
  ("Script ready", "Pick in your chat", "Video ready").
- The Seedance rate the raw-film ceilings use is the platform's 233,530 µUSD a second, not 299,851.
- **Styles**: fourteen looks from the other faceless templates (the site's `/styles/*.mp4`, linked, not
  bundled). Posters first; at most four clips play, only while on screen, and a clip that scrolls away
  hands its place to the next one on screen. Tapping one opens a player
  with **Recreate this style**, which opens Naive's Add card for that style in this company. It never
  makes a new company. `legend-flex` and `surreal-satire` are not shown: the site publishes no clip
  or poster for them yet.
- **Connect** says to tap Connect on the card in the chat; Connections stays as the fallback link.

### Existing channels

- A re-apply seeds the new keys `kickoff`, `topics`, `episode`, `references` and `first-post`. `kickoff` and `topics`
  first check whether the channel is new, reading only this crew's cards by exact template titles. The
  channel was set up before if:
  - the channel manager has a done card other than "Ask where the channel posts", or
  - the trend-scout holds "Start the channel's first piece" (the first-piece card 2.0–3.6 seeded,
    still blocked on a v3.5 install).
  If so, they close at once on `ALREADY RUNNING`, and so does every card behind them. Nothing is asked
  or generated.
- The video card keeps the key `first-briefs`, which every older install already holds.

### Publish (owner step)

1. Take or drop the video-model proposal, merge, then tag `v3.7.0` on media-blueprint `main`.
2. In vetta-mono, run `scripts/publish-artifacts.mjs` for the `media` blueprint at `v3.7.0` (engine
   `@usenaive-sdk/blueprints` `^0.19.2`, unchanged). v3.6.0 was never published; v3.7.0 carries it.
3. On staging, start one faceless company: the connect card and four ideas come first, and each
   costly step says its cost before the wall.
