/**
 * The templates this blueprint carries, and the one it is running.
 *
 * `ACTIVE` is the whole switch: edit it and run `naive up`. The switch widens and never narrows —
 * an agent only the other template declares is kept, reported by `up` and left running, with its
 * crons. Retire one on purpose by naming it under `removed.agents` in `naive.config.ts` — and never
 * name an app there: `removed.apps: ["channel"]` would delete a 1.x install's store (README).
 */
import { CLIPPING } from "./clipping.ts";
import { FACELESS } from "./faceless.ts";
import { LONGFORM } from "./longform.ts";
import { niche } from "./template.ts";
import type { MediaTemplate, TemplateName } from "./template.ts";

export type { Length, MediaTemplate, SetupQuestion, TemplateName } from "./template.ts";
export { CHANNEL_IDENTITY, CHANNEL_TIMEZONE, PLATFORMS, PROJECT_NAME, lengthPhrase, niche, segmentsOf } from "./template.ts";

/**
 * The niche channel templates (ADR-1101). Each is its base crew with one niche skill pinned in every
 * seat and a niche title/description — `niche()` is the whole of it. Clipping niches reuse the
 * `clipping` crew; short-form niches reuse `faceless`. The skill slugs are the platform catalogue's
 * `channel-template-<niche>` (vetta-mono `skills/`).
 */
export const GAMING_CLIPS = niche(CLIPPING, {
  name: "gaming-clips",
  title: "Gaming clipping channel",
  description: "Clipping crew for streamer clutches, fails and reactions — the livestream moments worth cutting, facecam kept in frame.",
  skill: "channel-template-gaming-clips",
});
export const NEWS = niche(CLIPPING, {
  name: "news",
  title: "News clipping channel",
  description: "Clipping crew for the development, the soundbite and the on-camera moment — recency-first and rights-first.",
  skill: "channel-template-news",
});
export const SPORTS = niche(CLIPPING, {
  name: "sports",
  title: "Sports clipping channel",
  description: "Clipping crew for the clutch play, the upset and the wild reaction — cut from sources the channel may clip.",
  skill: "channel-template-sports",
});
export const UFC = niche(FACELESS, {
  name: "ufc",
  title: "AI UFC Fight short-form channel",
  description: "Short-form crew that generates a cage-fight look from shipped reference stills: a tale-of-the-tape card joined to an octagon fight.",
  skill: "channel-template-ufc",
});
export const HISTORY = niche(FACELESS, {
  name: "history",
  title: "AI History Events short-form channel",
  description: "Short-form crew that colorizes and modernizes major pre-1950s events — wars, disasters, natural disasters — from a reference frame.",
  skill: "channel-template-history",
});
export const ANIMAL_FEAST = niche(FACELESS, {
  name: "animal-feast",
  title: "AI Eating Animal short-form channel",
  description: "Short-form crew that generates cozy pet-mukbang video — a cute animal eating an aesthetic, ring-lit feast — from shipped reference stills.",
  skill: "channel-template-animal-feast",
});

/**
 * Keyed by the id the wire carries; the studio shows each by its `title`. The ids never change:
 * `install.template` is a stored string on every provisioned org. The base three come first; the
 * six niche templates (ADR-1101, ADR-1105) reuse their crews.
 */
export const TEMPLATES: Record<TemplateName, MediaTemplate> = {
  faceless: FACELESS,
  clipping: CLIPPING,
  longform: LONGFORM,
  "gaming-clips": GAMING_CLIPS,
  news: NEWS,
  sports: SPORTS,
  ufc: UFC,
  history: HISTORY,
  "animal-feast": ANIMAL_FEAST,
};

/**
 * The template this repository runs. `NAIVE_TEMPLATE` overrides it for one caller: the platform's
 * artifact publisher, which builds every template of this repo in one pass.
 */
const chosen = process.env["NAIVE_TEMPLATE"] as TemplateName | undefined;
export const ACTIVE: MediaTemplate = chosen ? (TEMPLATES[chosen] ?? TEMPLATES.faceless) : TEMPLATES.faceless;
