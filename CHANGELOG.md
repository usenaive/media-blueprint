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
| `references` | producer | `episode` | "Making 4 pictures: about 200 to 1,600 credits." Then a picture choice (`multiple`, `details[].image = /files/<id>/raw`) that says what the video costs. |
| `first-briefs` | producer | `references` | "Making the video: about 2,800 credits." A 10-second video, then the Publish card: "Is this good?" |

- The first three cards are words only: no web pages, nothing generated.
- **Cost lines are each template's own.** The video line is the first video's length times the
  producer's first pinned model's rate (`VIDEO_RATES`, copied from vetta-mono
  `packages/billing/src/video-rates.ts`), plus about 1,000 credits for voice, music and the edit. The
  stills line is a range: 4 to 8 pictures (one redo each at most) at $0.01–0.04 a picture, the
  cheapest image model's price, which is the gateway's and not in code.
- **The first run fits the free credits on the faceless crews**: at most ~4,650 (words 250, stills
  1,600, video 2,800). The raw-film niches (`empires`, `legend-flex`, `surreal-satire`) render one
  15-second Seedance call and say "about 18,600 credits", so their wall comes at the video.
- **Week one** (`reference-study` → `look`, `hook-style`, `character-bible`; `channel-plan` after
  `look`; `report-frame`) waits for the video to finish, done or STOPPED. A failed video never stops
  the channel, and week one never spends what the video needs.
- **A pick nobody makes doesn't hold the channel.** The analyst's daily fire nudges an unanswered
  topic or picture choice once, after half a day. A day later it goes on with the first option.
- **One connect card at a time.** While the first is unanswered, the first post waits for it and is
  filed again once an account is connected. If it was skipped, the Publish card asks again.
- Each step comments one short line on its card: what is happening, what is next.

### The video model (proposal: the owner's call)

The faceless producers render every scene from a still, so they pin `heygen/heygen-video-1` first
(`FACELESS_VIDEO_MODELS`). It is the platform's own default since 2026-11-07: $0.036 a second, rated
higher than FLUX 3 Max. It takes a first frame only, and a refused call is never passed down the list,
so `longform` (renders from text) keeps FLUX 3 Max first.

| First pinned model | Credits/s | 10 s video line | Whole first run at most |
|---|---|---|---|
| `heygen/heygen-video-1` (proposed) | 180 | 2,800 | ~4,650: fits 5,000 |
| `black-forest-labs/flux-3-max` | 850 | 9,500 | ~11,350: wall at the video |
| `minimax/hailuo-3` | 650 | 7,500 | ~9,350 |
| `bytedance/seedance-2.5` (15 s, raw-film) | ~1,168 | 18,600 | ~20,450 |

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
- **Styles**: fourteen looks from the other faceless templates (the site's `/styles/*.mp4`, linked, not
  bundled). Posters first; at most four clips play, only while on screen. Tapping one opens a player
  with **Recreate this style**, which opens Naive's Add card for that style in this company. It never
  makes a new company. `legend-flex` and `surreal-satire` are not shown: the site publishes no clip
  or poster for them yet.
- **Connect** says to tap Connect on the card in the chat; Connections stays as the fallback link.

### Existing channels

- A re-apply seeds the new keys `kickoff`, `topics`, `episode` and `references`. `kickoff` and `topics`
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
