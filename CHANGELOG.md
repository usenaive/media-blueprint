# Changelog

## 3.7.0 (unreleased, not tagged)

The first video, driven from the chat (owner, 2026-11-16). `faceless` and its sixteen niches only.
`longform`, `clipping`, `music` and `ai-influencer` are unchanged.

Every company starts with 5,000 free credits ($1), and the crew runs at once. When the credits run
out, the platform asks the person to start their team (vetta-mono Track W). So the cheap steps come
first, and each costly step says what it costs before it starts.

### Day one is the first video

| Card | Seat | Waits on | What the person sees | Cost (estimate) |
|---|---|---|---|---|
| `kickoff` | channel-manager | nothing | The connect card for Instagram, TikTok, YouTube, asked after the card closes. Skippable. | ~50 credits |
| `topics` | trend-scout | nothing | A choice of four ideas it wrote. With no niche, four ideas in four niches: the pick sets it. | ~100 credits |
| `episode` | scriptwriter | `topics` | The script, filed as `Episodes/<topic>.md`. | ~100 credits |
| `references` | producer | `episode` | "Making 4 pictures: about 200 credits." Then a picture choice (`multiple`, `details[].image = /files/<id>/raw`) that says what the video will cost. | ~200–1,000 credits |
| `first-briefs` | producer | `references` | "Making the video: about <seconds × 180> credits." Then the Publish card: "Is this good?" | see below |

- The first three cards are words only: no web pages, nothing generated.
- With no account connected, the Publish card asks to connect again before it posts.
- Week one waits on the video, so it never spends what the video needs: `reference-study` →
  `look`, `hook-style`, `character-bible`; `channel-plan` after `look`; then `report-frame`. Nothing on
  day one waits on the bible.
- Each step comments one short line on its card: what is happening, what is next.
- Defaults, never asked: 15–30 s (the script takes the shorter end unless the idea needs more), 9:16,
  the template's look and voice, 3× a week.

### What 5,000 free credits cover (estimates; 1 credit = $0.0002)

- Connect, topics and script: ~250 credits of seat turns.
- Four stills: ~200–800 credits (the image price is the gateway's, not in code), plus ~100 of turns.
- So the stills arrive with ~3,800–4,450 credits left.
- The video on the pinned FLUX 3 Max: 850 credits a second, so 12,750 for 15 s and 25,500 for 30 s.
  The free credits run out at the video, as planned, and the person is asked to start their team.
- With the platform's own default video model pinned first (its own commit, so it can be dropped):
  180 credits a second, so 2,700 for 15 s, plus ~500–1,000 for voice, music and the edit. A 15 s
  first video then just fits inside the free credits; a 30 s one does not.

### Questions

- `faceless` asks one question, `niche`, and it is optional, so the studio asks nothing before it
  hires. `reference` is gone from its form. Niche templates still ask nothing.

### Media manager

- **References**: each episode under `Episodes/`, its picked stills first, the rest dimmed.
- **Styles**: fourteen looping looks from the other faceless templates (the site's `/styles/*.mp4`,
  linked, not bundled). Tapping one opens a player with **Recreate this style**, which sets up that
  style in Naive, in a new tab. Shown on faceless channels only.
- **Connect** says to tap Connect on the card in the chat; Connections stays as the fallback link.

### Existing channels

- A re-apply seeds the new keys `kickoff`, `topics`, `episode` and `references`. On a channel that
  already has a Plan, Render or Publish card, `kickoff` and `topics` close at once on
  `ALREADY RUNNING`, and so does every card behind them. Nothing is generated.
- The video card keeps the key `first-briefs`, which every older install already holds.

### Publish (owner step)

1. Merge, then tag `v3.7.0` on media-blueprint `main`.
2. In vetta-mono, run `scripts/publish-artifacts.mjs` for the `media` blueprint at `v3.7.0` (engine
   `@usenaive-sdk/blueprints` `^0.19.2`, unchanged). v3.6.0 was never published; v3.7.0 carries it.
3. On staging, start one faceless company: the connect card and four ideas come first, and each
   costly step says its cost before the wall.
