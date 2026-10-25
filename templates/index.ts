/**
 * The templates this blueprint carries, and the one it is running.
 *
 * `ACTIVE` is the whole switch: edit it and run `naive up`. The switch widens and never narrows —
 * an agent only the other template declares is kept, reported by `up` and left running, with its
 * crons. Retire one on purpose by naming it under `removed.agents` in `naive.config.ts` — and never
 * name an app there: `removed.apps: ["channel"]` would delete a 1.x install's store (README).
 */
import { AI_INFLUENCER } from "./ai-influencer.ts";
import { CLIPPING } from "./clipping.ts";
import { FACELESS, SEGMENTED_SHORT_FORM } from "./faceless.ts";
import { LONGFORM } from "./longform.ts";
import { budgetOf, CADENCE_QUESTION, CLONE_CHANNEL_QUESTION, niche, renderMicroUsd, SEEDANCE_MICRO_USD_PER_SECOND, SEGMENT_MAX_SECONDS } from "./template.ts";
import type { Budget, MediaTemplate, TemplateName } from "./template.ts";

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
 * The second wave of generated short-form niches (ADR-1174). Each reuses the `faceless` crew with
 * `SEGMENTED_SHORT_FORM` (a piece is segments joined), pins `naive/channel-template-<niche>`, and
 * drops the niche and reference questions like the others. `channel-cloning` is the one exception:
 * it keeps a custom "clone" question in place of the dropped niche, because a clone channel's niche
 * IS the channel it clones, so `niche()` is spread and its `questions` replaced.
 */
export const CHANNEL_CLONING: MediaTemplate = {
  ...niche(FACELESS, {
    name: "channel-cloning",
    title: "AI Channel Cloning",
    description: "AI Channel Cloning is a template that builds an agent team that manages an entire social media account for you, studying a channel you name and producing new videos in the same format. This lets you create videos in a format that is already going really viral right now.",
    skill: "channel-template-channel-cloning",
    seats: SEGMENTED_SHORT_FORM,
  }),
  // A clone channel's niche is the channel it clones, so it asks for that in place of the niche.
  questions: [CLONE_CHANNEL_QUESTION, CADENCE_QUESTION],
};
export const COMICS = niche(FACELESS, {
  name: "comics",
  title: "AI Comics Channel",
  description: "AI Comics Channel is a template that builds an agent team that manages an entire social media account for you, researching and producing motion-comic videos, comic-book stories told as moving panels. This lets you create the comic videos that are going really viral right now.",
  skill: "channel-template-comics",
  seats: SEGMENTED_SHORT_FORM,
});
export const CARTOONS_IRL = niche(FACELESS, {
  name: "cartoons-irl",
  title: "AI Cartoons IRL Channel",
  description: "AI Cartoons IRL Channel is a template that builds an agent team that manages an entire social media account for you, producing videos of 2D cartoon characters reimagined in live action. This lets you create the cartoon-in-real-life videos that are going really viral right now.",
  skill: "channel-template-cartoons-irl",
  seats: SEGMENTED_SHORT_FORM,
});
export const DANCING_ANIMALS = niche(FACELESS, {
  name: "dancing-animals",
  title: "AI Dancing Animals Channel",
  description: "AI Dancing Animals Channel is a template that builds an agent team that manages an entire social media account for you, producing videos of an animal from your niche dancing on its hind legs. This lets you create the dancing animal videos that are going really viral right now.",
  skill: "channel-template-dancing-animals",
  seats: SEGMENTED_SHORT_FORM,
});
export const ROADSTER = niche(FACELESS, {
  name: "roadster",
  title: "AI Impossible Roadster Channel",
  description: "AI Impossible Roadster Channel is a template that builds an agent team that manages an entire social media account for you, producing phone-shot videos of a white roadster doing impossible things, like driving up a skyscraper. These are going really viral right now.",
  skill: "channel-template-roadster",
  seats: SEGMENTED_SHORT_FORM,
});
/** ADR-1286: photoreal cats living human lives, a recurring invented cat family, told in a few scenes. */
export const CAT_STORIES = niche(FACELESS, {
  name: "cat-stories",
  title: "AI Cat Stories Channel",
  description: "AI Cat Stories Channel is a template that builds an agent team that manages an entire social media account for you, producing short stories of cats living human lives. This lets you create the AI cat story videos that are going really viral right now.",
  skill: "channel-template-cat-stories",
  seats: SEGMENTED_SHORT_FORM,
});
/** ADR-1289: real-looking food kneaded into glossy slime, ASMR, one continuous transformation. */
export const FOOD_SLIME = niche(FACELESS, {
  name: "food-slime",
  title: "AI Food Slime Channel",
  description: "AI Food Slime Channel is a template that builds an agent team that manages an entire social media account for you, producing ASMR videos of real-looking food being kneaded into slime. This lets you create the food-to-slime videos that are going really viral right now.",
  skill: "channel-template-food-slime",
  seats: SEGMENTED_SHORT_FORM,
});

/** ADR-1288: a food made of glass sliced slowly on a board — glass-cutting ASMR, three foods. */
export const GLASS_FOOD = niche(FACELESS, {
  name: "glass-food",
  title: "AI Glass Food Channel",
  description: "AI Glass Food Channel is a template that builds an agent team that manages an entire social media account for you, producing videos of foods made of glass being sliced with a knife. This lets you create the glass fruit cutting ASMR videos that are going really viral right now.",
  skill: "channel-template-glass-food",
  seats: SEGMENTED_SHORT_FORM,
});
export const WOULD_YOU_CHOOSE = niche(FACELESS, {
  name: "would-you-choose",
  title: "AI Would You Choose Channel",
  description: "AI Would You Choose Channel is a template that builds an agent team that manages an entire social media account for you, producing \"which one would you choose\" videos of absurd options. This lets you create the would-you-choose videos that are going really viral right now.",
  skill: "channel-template-would-you-choose",
  seats: SEGMENTED_SHORT_FORM,
});
/** ADR-1290: photoreal fruit characters in reality-show dramas, a recurring invented cast, three scenes to a cliffhanger. */
export const FRUIT_DRAMA = niche(FACELESS, {
  name: "fruit-drama",
  title: "AI Fruit Drama Channel",
  description: "AI Fruit Drama Channel is a template that builds an agent team that manages an entire social media account for you, producing reality-show style dramas starring fruit characters. This lets you create the AI fruit drama videos that are going really viral right now.",
  skill: "channel-template-fruit-drama",
  seats: SEGMENTED_SHORT_FORM,
});
/**
 * The raw-film niches (ADR-1580 empires, ADR-1640 legend-flex and surreal-satire) copy reels that are
 * rendered from text and carry no text at all (owner, 2026-10-24), so their lines follow the base
 * pipeline and win where it says 9:16 or an opening image. The disclosure is the post's
 * `ai_generated` setting, never pixels.
 */
export const RAW_FILM_VIDEO_MODELS: readonly string[] = ["bytedance/seedance-2.5"];
/** The raw-film producer whose piece is cut to a rapped song (empires, legend-flex). */
export const RAW_FILM_PRODUCER =
  "Follow your pinned skills' scene grammar, which overrides the pipeline above: aspect_ratio 4:3, generate_video without image_urls, generate_music instrumental: false, nothing burned in.";

/** A raw-film niche: its producer's ceiling is sized for its Seedance calls, and its publisher labels every post AI-generated. */
function rawFilm(template: MediaTemplate, producerBudget: Budget): MediaTemplate {
  return {
    ...template,
    agents: template.agents.map((seat) => {
      const sized = seat.name === "producer" ? { ...seat, budget: producerBudget } : seat;
      const post = sized.tools!.configs["social.post"];
      if (post?.enabled !== true) return sized;
      return { ...sized, tools: { ...sized.tools!, configs: { ...sized.tools!.configs, "social.post": { ...post, config: { ai_generated: true } } } } };
    }),
  };
}

/** A producer ceiling that clears `calls` 15-second Seedance calls and $5 of turns around them. The day stays the default $60. */
const seedanceCeiling = (calls: number): Budget =>
  budgetOf(renderMicroUsd({ min: calls * SEGMENT_MAX_SECONDS, max: calls * SEGMENT_MAX_SECONDS }, SEEDANCE_MICRO_USD_PER_SECOND) + 5_000_000, 60_000_000);

/** The raw-film scriptwriter whose piece is cut to a rapped song (empires, legend-flex). */
export const RAW_FILM_SCRIPTWRITER =
  "This channel renders from text: a scene has no image_prompt, and its video_prompt is one multi-shot prompt of 7 to 8 shots for 15 seconds, as the pinned skill writes it. The EDIT PLAN's music is a rapped song with the lyrics you write.";
/**
 * ADR-1580: one empire at one moment as raw 4:3 film, one modern flex per shot, cut to a rapped song.
 * Up to three 15-second calls a piece, and two retakes for a logo or a gesture: five calls (~$22.49).
 */
export const EMPIRES_PRODUCER_BUDGET = seedanceCeiling(5);
export const EMPIRES = rawFilm(
  niche(FACELESS, {
    name: "empires",
    title: "AI Empires Channel",
    description: "AI Empires Channel is a template that builds an agent team that manages an entire social media account for you, producing funny videos of one empire at one moment in history, with one modern object in every shot. These history videos are going really viral right now.",
    skill: "channel-template-empires",
    seats: {
      scriptwriter: { brief: `${SEGMENTED_SHORT_FORM.scriptwriter!.brief} ${RAW_FILM_SCRIPTWRITER}` },
      producer: { brief: RAW_FILM_PRODUCER, videoModels: RAW_FILM_VIDEO_MODELS },
    },
  }),
  EMPIRES_PRODUCER_BUDGET,
);

/** A legend-flex or surreal-satire piece is two 15-second calls; two retakes make four calls (~$17.99). */
export const TWO_CALL_PIECE_BUDGET = seedanceCeiling(4);

/**
 * ADR-1640: one legendary figure's famous signs as late-1990s rap-video flexes, shot like a
 * direct-flash 35 mm roll, ~1-second cuts on a rapped trap song. Its scenes are written as empires' are.
 */
export const LEGEND_FLEX = rawFilm(
  niche(FACELESS, {
    name: "legend-flex",
    title: "AI Legend Flex Channel",
    description: "AI Legend Flex Channel is a template that builds an agent team that manages an entire social media account for you, producing funny videos where a legend's famous signs become 1990s rap-video flexes, shot like a flash photo roll. These videos are going really viral right now.",
    skill: "channel-template-legend-flex",
    seats: {
      scriptwriter: { brief: `${SEGMENTED_SHORT_FORM.scriptwriter!.brief} ${RAW_FILM_SCRIPTWRITER}` },
      producer: { brief: RAW_FILM_PRODUCER, videoModels: RAW_FILM_VIDEO_MODELS },
    },
  }),
  TWO_CALL_PIECE_BUDGET,
);

/**
 * ADR-1640: an ordinary sunlit city where people's heads show what they really are (rat-headed
 * commuters, a peacock-headed show-off), six deadpan setups on an instrumental hip-hop groove.
 */
export const SURREAL_SATIRE_SCRIPTWRITER =
  "This channel renders from text: a scene has no image_prompt, and its video_prompt is one multi-shot prompt of 3 to 4 shots for 15 seconds, as the pinned skill writes it. The EDIT PLAN's music is an instrumental bed.";
export const SURREAL_SATIRE_PRODUCER =
  "Follow your pinned skills' scene grammar, which overrides the pipeline above: aspect_ratio 4:3, generate_video without image_urls, nothing burned in.";
export const SURREAL_SATIRE = rawFilm(
  niche(FACELESS, {
    name: "surreal-satire",
    title: "AI Surreal Satire Channel",
    description: "AI Surreal Satire Channel is a template that builds an agent team that manages an entire social media account for you, producing deadpan films where people's heads show what they really are, like rat-headed commuters. These surreal videos are going really viral right now.",
    skill: "channel-template-surreal-satire",
    seats: {
      scriptwriter: { brief: `${SEGMENTED_SHORT_FORM.scriptwriter!.brief} ${SURREAL_SATIRE_SCRIPTWRITER}` },
      producer: { brief: SURREAL_SATIRE_PRODUCER, videoModels: RAW_FILM_VIDEO_MODELS },
    },
  }),
  TWO_CALL_PIECE_BUDGET,
);

/**
 * Keyed by the id the wire carries; the studio shows each by its `title`. The ids never change:
 * `install.template` is a stored string on every provisioned org. The base three come first; the
 * nineteen niche templates (ADR-1115, ADR-1119, ADR-1174, ADR-1287, ADR-1314, ADR-1286, ADR-1289, ADR-1288, ADR-1290, ADR-1580, ADR-1640) and `ai-influencer` (ADR-1360) reuse their crews.
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
  "dancing-animals": DANCING_ANIMALS,
  roadster: ROADSTER,
  "fruit-drama": FRUIT_DRAMA,
  "ai-influencer": AI_INFLUENCER,
  "cat-stories": CAT_STORIES,
  "food-slime": FOOD_SLIME,
  "glass-food": GLASS_FOOD,
  "would-you-choose": WOULD_YOU_CHOOSE,
  empires: EMPIRES,
  "legend-flex": LEGEND_FLEX,
  "surreal-satire": SURREAL_SATIRE,
};

/**
 * The template this repository runs. `NAIVE_TEMPLATE` overrides it for one caller: the platform's
 * artifact publisher, which builds every template of this repo in one pass.
 */
const chosen = process.env["NAIVE_TEMPLATE"] as TemplateName | undefined;
export const ACTIVE: MediaTemplate = chosen ? (TEMPLATES[chosen] ?? TEMPLATES.faceless) : TEMPLATES.faceless;
