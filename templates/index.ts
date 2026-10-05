/**
 * The templates this blueprint carries, and the one it is running.
 *
 * `ACTIVE` is the whole switch: edit it and run `naive up`. The switch widens and never narrows —
 * an agent only the other template declares is kept, reported by `up` and left running, with its
 * crons. Retire one on purpose by naming it under `removed.agents` in `naive.config.ts` — and never
 * name an app there: `removed.apps: ["channel"]` would delete a 1.x install's store (README).
 */
import { CLIPPING } from "./clipping.ts";
import { FACELESS, SEGMENTED_SHORT_FORM } from "./faceless.ts";
import { LONGFORM } from "./longform.ts";
import { CADENCE_QUESTION, CLONE_CHANNEL_QUESTION, niche } from "./template.ts";
import type { MediaTemplate, TemplateName } from "./template.ts";

export type { Length, MediaTemplate, SetupQuestion, TemplateName } from "./template.ts";
export { CHANNEL_IDENTITY, CHANNEL_TIMEZONE, PLATFORMS, PROJECT_NAME, ROADMAP, lengthPhrase, niche, segmentsOf } from "./template.ts";

/**
 * The niche channel templates (ADR-1115). Each is its base crew with one niche skill pinned in every
 * seat and a niche title/description — `niche()` is the whole of it. Clipping niches reuse the
 * `clipping` crew; short-form niches reuse `faceless`, and their
 * playbooks build a piece from segments, so they extend its scriptwriter and producer
 * (`SEGMENTED_SHORT_FORM`). The skill slugs are the platform catalogue's
 * `channel-template-<niche>` (vetta-mono `skills/`).
 */
export const GAMING_CLIPS = niche(CLIPPING, {
  name: "gaming-clips",
  title: "Gaming Clips Channel",
  description: "Gaming Clips Channel is a template that builds an agent team that manages an entire social media account for you, finding the best moments in the streams you pick and cutting them into clips. This lets you post the clutch plays and streamer reactions getting big views right now.",
  skill: "channel-template-gaming-clips",
});
export const NEWS = niche(CLIPPING, {
  name: "news",
  title: "News Clips Channel",
  description: "News Clips Channel is a template that builds an agent team that manages an entire social media account for you, finding the key moments in news broadcasts and cutting them into captioned clips. This lets you post the biggest moment of a story while it is still news.",
  skill: "channel-template-news",
});
export const SPORTS = niche(CLIPPING, {
  name: "sports",
  title: "Sports Clips Channel",
  description: "Sports Clips Channel is a template that builds an agent team that manages an entire social media account for you, finding the best plays in the games you have rights to and cutting them into clips. This lets you post highlights while people are still talking about the game.",
  skill: "channel-template-sports",
});
export const UFC = niche(FACELESS, {
  name: "ufc",
  title: "AI UFC Channel",
  description: "AI UFC Channel is a template that builds an agent team that manages an entire social media account for you, researching and producing content using a UFC-style template. This lets you create the UFC-style fighting videos that are going really viral right now.",
  skill: "channel-template-ufc",
  seats: SEGMENTED_SHORT_FORM,
});
export const HISTORY = niche(FACELESS, {
  name: "history",
  title: "AI History Channel",
  description: "AI History Channel is a template that builds an agent team that manages an entire social media account for you, researching and producing videos of major historical events in color, as if filmed today. This lets you create the history videos that are going really viral right now.",
  skill: "channel-template-history",
  seats: SEGMENTED_SHORT_FORM,
});
export const ANIMAL_FEAST = niche(FACELESS, {
  name: "animal-feast",
  title: "AI Eating Animal Channel",
  description: "AI Eating Animal Channel is a template that builds an agent team that manages an entire social media account for you, researching and producing videos of an animal eating a big feast. This lets you create the animal eating videos that are going really viral right now.",
  skill: "channel-template-animal-feast",
  seats: SEGMENTED_SHORT_FORM,
});

/**
 * The second wave of generated short-form niches (ADR-1190). Each reuses the `faceless` crew with
 * `SEGMENTED_SHORT_FORM` (a piece is segments joined), pins `naive/channel-template-<niche>`, and
 * drops the niche and reference questions like the others. `channel-cloning` is the one exception:
 * it keeps a custom "clone" question in place of the dropped niche, because a clone channel's niche
 * IS the channel it clones, so `niche()` is spread and its `questions` replaced.
 */
export const CHANNEL_CLONING: MediaTemplate = {
  ...niche(FACELESS, {
    name: "channel-cloning",
    title: "AI Channel Cloning",
    description: "AI Channel Cloning is a template that builds an agent team that manages a social media account for you, cloning the format of a channel you name and producing its own original videos in that style. This lets you spin up a channel in the exact format going viral right now.",
    skill: "channel-template-channel-cloning",
    seats: SEGMENTED_SHORT_FORM,
  }),
  // A clone channel's niche is the channel it clones, so it asks for that in place of the niche.
  questions: [CLONE_CHANNEL_QUESTION, CADENCE_QUESTION],
};
export const COMICS = niche(FACELESS, {
  name: "comics",
  title: "AI Comics Channel",
  description: "AI Comics Channel is a template that builds an agent team that manages an entire social media account for you, writing original comic-book stories and producing them as motion-comic videos. This lets you create the comic videos that are going really viral right now.",
  skill: "channel-template-comics",
  seats: SEGMENTED_SHORT_FORM,
});
export const CARTOONS_IRL = niche(FACELESS, {
  name: "cartoons-irl",
  title: "AI Cartoons IRL Channel",
  description: "AI Cartoons IRL Channel is a template that builds an agent team that manages a social media account for you, turning the look of 2D cartoons into hyperrealistic live-action videos with original characters. This lets you make the cartoon-in-real-life videos going viral right now.",
  skill: "channel-template-cartoons-irl",
  seats: SEGMENTED_SHORT_FORM,
});
export const DANCING_CELEBRITY = niche(FACELESS, {
  name: "dancing-celebrity",
  title: "AI Dancing Celebrity Channel",
  description: "AI Dancing Celebrity Channel is a template that builds an agent team that manages a social media account for you, producing clearly-labelled AI parody videos of an invented public-figure type dancing. This lets you create the dancing-celebrity parody videos going viral right now.",
  skill: "channel-template-dancing-celebrity",
  seats: SEGMENTED_SHORT_FORM,
});
export const DANCING_ANIMALS = niche(FACELESS, {
  name: "dancing-animals",
  title: "AI Dancing Animals Channel",
  description: "AI Dancing Animals Channel is a template that builds an agent team that manages an entire social media account for you, producing videos of an animal from your niche doing a funny dance. This lets you create the dancing-animal videos that are going really viral right now.",
  skill: "channel-template-dancing-animals",
  seats: SEGMENTED_SHORT_FORM,
});

/**
 * Keyed by the id the wire carries; the studio shows each by its `title`. The ids never change:
 * `install.template` is a stored string on every provisioned org. The base three come first; the
 * eleven niche templates (ADR-1115, ADR-1119, ADR-1190) reuse their crews.
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
  "channel-cloning": CHANNEL_CLONING,
  comics: COMICS,
  "cartoons-irl": CARTOONS_IRL,
  "dancing-celebrity": DANCING_CELEBRITY,
  "dancing-animals": DANCING_ANIMALS,
};

/**
 * The template this repository runs. `NAIVE_TEMPLATE` overrides it for one caller: the platform's
 * artifact publisher, which builds every template of this repo in one pass.
 */
const chosen = process.env["NAIVE_TEMPLATE"] as TemplateName | undefined;
export const ACTIVE: MediaTemplate = chosen ? (TEMPLATES[chosen] ?? TEMPLATES.faceless) : TEMPLATES.faceless;
