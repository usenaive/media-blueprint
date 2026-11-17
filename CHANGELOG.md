# Changelog

## 3.7.0 (unreleased, not tagged)

The first video, driven from the chat (owner and design, 2026-11-16). `faceless` and its sixteen
niches only. `longform`, `clipping`, `music` and `ai-influencer` are unchanged.

### Before payment: the CEO, in words (`before_start`)

A new template field, `before_start`: plain instructions (1,676 of 2,000 characters) that the setup
CEO reads from the held install. Only the CEO runs before payment, and it makes nothing that costs.

1. The connect card for Instagram, TikTok and YouTube. Skipping is fine; nothing waits on it.
2. Four ideas for the first video, as one choice. With no niche, four ideas in four niches: the pick sets it.
3. The picked idea's script, saved as `Episodes/<idea>.md`.
4. The hook and scenes in one line each, then the button **Make the references** (`?start`), which opens the paywall.

**Depends on vetta-mono Track W.** The pinned engine (`@usenaive-sdk/blueprints` 0.19.2) does not
know `before_start` and drops it without a word. Pin the engine release that carries it before
publishing, or the CEO never sees these steps.

### After payment: the crew

| Card | Seat | Waits on | What the person sees |
|---|---|---|---|
| `references` | producer | nothing | Four stills from the newest `Episodes/` script (it writes one if none is there), then a picture choice: `multiple`, `details[].image = /files/<id>/raw`. The first step that spends. |
| `first-briefs` | producer | `references` | The video from the picked stills, then the Publish card's approval: "Is this good?" |

- With no account connected, the Publish card asks to connect again before it posts.
- Week one follows, behind the picked pictures: `reference-study` → `look`, `hook-style`,
  `character-bible`; `channel-plan` after `look`; then `report-frame`. Nothing on day one waits on the bible.
- Each step comments one short line on its card: what is happening, what is next.
- Defaults, never asked: 15–30 s, 9:16, the template's look and voice, 3× a week.

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

- A re-apply seeds the new `references` key. On a channel that already has a Plan, Render or Publish
  card, it closes at once on `ALREADY RUNNING`, and so does the video card behind it. Nothing is generated.
- The video card keeps the key `first-briefs`, which every older install already holds.

### Publish (owner step)

1. Land Track W's `before_start` in vetta-mono and publish the engine that carries it.
2. Pin that engine here (`package.json`, lockfile), run `pnpm test`, merge, then tag `v3.7.0`.
3. In vetta-mono, run `scripts/publish-artifacts.mjs` for the `media` blueprint at `v3.7.0`. v3.6.0
   was never published; v3.7.0 carries its changes.
4. On staging, check one faceless start: the connect card, four ideas and the script come before
   payment, and no image is made until "Make the references" is paid.
