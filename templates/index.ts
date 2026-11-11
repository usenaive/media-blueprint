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
import { MUSIC } from "./music.ts";
import { budgetOf, CADENCE_QUESTION, CLONE_CHANNEL_QUESTION, niche, renderMicroUsd, SEEDANCE_MICRO_USD_PER_SECOND, SEGMENT_MAX_SECONDS } from "./template.ts";
import type { Budget, MediaTemplate, TemplateName } from "./template.ts";

export type { Length, MediaTemplate, SetupQuestion, TemplateName } from "./template.ts";
export { FFMPEG_SETUP, MUSIC, MUSIC_PUBLISHER_BRIEF, MUX_RECIPE, OWN_CARDS } from "./music.ts";
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
  description: "Cuts the best moments from the streams you pick into short clips: the clutch plays and the streamer reactions.",
  skill: "channel-template-gaming-clips",
});
export const NEWS = niche(CLIPPING, {
  name: "news",
  title: "News Clips Channel",
  description: "Cuts the key moments from news broadcasts into short captioned clips, while the story is still news.",
  skill: "channel-template-news",
});
export const SPORTS = niche(CLIPPING, {
  name: "sports",
  title: "Sports Clips Channel",
  description: "Cuts the best plays from games you have the rights to into short highlight clips, while people still talk about the game.",
  skill: "channel-template-sports",
});
export const UFC = niche(FACELESS, {
  name: "ufc",
  title: "AI UFC Channel",
  description: "Researches and makes short UFC-style fight videos.",
  skill: "channel-template-ufc",
  seats: SEGMENTED_SHORT_FORM,
});
export const HISTORY = niche(FACELESS, {
  name: "history",
  title: "AI History Channel",
  description: "Makes short videos of major historical events in color, as if filmed today.",
  skill: "channel-template-history",
  seats: SEGMENTED_SHORT_FORM,
});
export const ANIMAL_FEAST = niche(FACELESS, {
  name: "animal-feast",
  title: "AI Eating Animal Channel",
  description: "Makes short videos of an animal eating a big feast.",
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
    description: "Studies a channel you name and makes new videos in the same format.",
    skill: "channel-template-channel-cloning",
    seats: SEGMENTED_SHORT_FORM,
  }),
  // A clone channel's niche is the channel it clones, so it asks for that in place of the niche.
  questions: [CLONE_CHANNEL_QUESTION, CADENCE_QUESTION],
};
export const COMICS = niche(FACELESS, {
  name: "comics",
  title: "AI Comics Channel",
  description: "Makes motion-comic videos: comic-book stories told as moving panels.",
  skill: "channel-template-comics",
  seats: SEGMENTED_SHORT_FORM,
});
export const CARTOONS_IRL = niche(FACELESS, {
  name: "cartoons-irl",
  title: "AI Cartoons IRL Channel",
  description: "Makes videos of 2D cartoon characters reimagined in live action.",
  skill: "channel-template-cartoons-irl",
  seats: SEGMENTED_SHORT_FORM,
});
export const DANCING_ANIMALS = niche(FACELESS, {
  name: "dancing-animals",
  title: "AI Dancing Animals Channel",
  description: "Makes videos of an animal from your niche dancing on its hind legs.",
  skill: "channel-template-dancing-animals",
  seats: SEGMENTED_SHORT_FORM,
});
export const ROADSTER = niche(FACELESS, {
  name: "roadster",
  title: "AI Impossible Roadster Channel",
  description: "Makes phone-shot videos of a white roadster doing impossible things, like driving up a skyscraper.",
  skill: "channel-template-roadster",
  seats: SEGMENTED_SHORT_FORM,
});
/** ADR-1286: photoreal cats living human lives, a recurring invented cat family, told in a few scenes. */
export const CAT_STORIES = niche(FACELESS, {
  name: "cat-stories",
  title: "AI Cat Stories Channel",
  description: "Makes short stories of cats living human lives.",
  skill: "channel-template-cat-stories",
  seats: SEGMENTED_SHORT_FORM,
});
/** ADR-1289: real-looking food kneaded into glossy slime, ASMR, one continuous transformation. */
export const FOOD_SLIME = niche(FACELESS, {
  name: "food-slime",
  title: "AI Food Slime Channel",
  description: "Makes ASMR videos of real-looking food being kneaded into slime.",
  skill: "channel-template-food-slime",
  seats: SEGMENTED_SHORT_FORM,
});

/** ADR-1288: a food made of glass sliced slowly on a board — glass-cutting ASMR, three foods. */
export const GLASS_FOOD = niche(FACELESS, {
  name: "glass-food",
  title: "AI Glass Food Channel",
  description: "Makes ASMR videos of foods made of glass being sliced with a knife.",
  skill: "channel-template-glass-food",
  seats: SEGMENTED_SHORT_FORM,
});
export const WOULD_YOU_CHOOSE = niche(FACELESS, {
  name: "would-you-choose",
  title: "AI Would You Choose Channel",
  description: "Makes \"which one would you choose\" videos of absurd options.",
  skill: "channel-template-would-you-choose",
  seats: SEGMENTED_SHORT_FORM,
});
/** ADR-1290: photoreal fruit characters in reality-show dramas, a recurring invented cast, three scenes to a cliffhanger. */
export const FRUIT_DRAMA = niche(FACELESS, {
  name: "fruit-drama",
  title: "AI Fruit Drama Channel",
  description: "Makes reality-show style dramas starring fruit characters.",
  skill: "channel-template-fruit-drama",
  seats: SEGMENTED_SHORT_FORM,
});
/**
 * The raw-film niches (ADR-1580 empires, ADR-1640 legend-flex and surreal-satire) copy reels that are
 * rendered from text by Seedance and carry no text at all (owner, 2026-10-24), so their lines follow the
 * base pipeline and win where it says 9:16, an opening image or an instrumental bed. No label in the
 * picture, and no seat marks a post AI-generated: no AI label on videos (vetta-mono ADR-1792), and a
 * seat's `social.post` config is ignored for it anyway.
 */
export const RAW_FILM_VIDEO_MODELS: readonly string[] = ["bytedance/seedance-2.5"];
/** The raw-film producer whose piece is cut to a rapped song (empires, legend-flex). */
export const RAW_FILM_PRODUCER =
  "Follow your pinned skills' scene grammar, which overrides the pipeline above: aspect_ratio 4:3, generate_video without image_urls, generate_music instrumental: false, nothing burned in.";

/** A raw-film niche: its producer's ceiling is sized for its Seedance calls. No other seat changes. */
function rawFilm(template: MediaTemplate, producerBudget: Budget): MediaTemplate {
  return {
    ...template,
    agents: template.agents.map((seat) => (seat.name === "producer" ? { ...seat, budget: producerBudget } : seat)),
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
    description: "Makes funny videos of one empire at one moment in history, with one modern object in every shot.",
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
    description: "Makes funny videos where a legend's famous signs become 1990s rap-video flexes, shot like a flash photo roll.",
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
    description: "Makes deadpan films where people's heads show what they really are, like rat-headed commuters.",
    skill: "channel-template-surreal-satire",
    seats: {
      scriptwriter: { brief: `${SEGMENTED_SHORT_FORM.scriptwriter!.brief} ${SURREAL_SATIRE_SCRIPTWRITER}` },
      producer: { brief: SURREAL_SATIRE_PRODUCER, videoModels: RAW_FILM_VIDEO_MODELS },
    },
  }),
  TWO_CALL_PIECE_BUDGET,
);

/**
 * vetta-mono ADR-1904: the AI Music Channel's genre niches. Each is the `music` crew with the genre's
 * playbook pinned (`naive/channel-template-<genre>`): its Context seed is the channel note, copied
 * word for word on day one, so the genre is never asked.
 */
export const HARDSTYLE = niche(MUSIC, {
  name: "hardstyle",
  title: "AI Hardstyle Channel",
  description: "Writes one original hardstyle song at a time and posts each with its cover as a short video.",
  skill: "channel-template-hardstyle",
});
export const TECHNO = niche(MUSIC, {
  name: "techno",
  title: "AI Techno Channel",
  description: "Writes one original techno song at a time and posts each with its cover as a short video.",
  skill: "channel-template-techno",
});
export const RAP = niche(MUSIC, {
  name: "rap",
  title: "AI Rap Channel",
  description: "Writes one original rap song at a time and posts each with its cover as a short video.",
  skill: "channel-template-rap",
});
export const POP = niche(MUSIC, {
  name: "pop",
  title: "AI Pop Channel",
  description: "Writes one original pop song at a time and posts each with its cover as a short video.",
  skill: "channel-template-pop",
});

/**
 * Keyed by the id the wire carries; the studio shows each by its `title`. The ids never change:
 * `install.template` is a stored string on every provisioned org. The base three come first; the
 * nineteen niche templates (ADR-1115, ADR-1119, ADR-1174, ADR-1287, ADR-1314, ADR-1286, ADR-1289, ADR-1288, ADR-1290, ADR-1580, ADR-1640) and `ai-influencer` (ADR-1360) reuse their crews.
 * Then the fourth base, `music`, and its four genre niches (vetta-mono ADR-1904), carried from
 * engine 0.17.0 on: an older engine skips them (`naive.config.ts`).
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
  music: MUSIC,
  hardstyle: HARDSTYLE,
  techno: TECHNO,
  rap: RAP,
  pop: POP,
};

/**
 * The template this repository runs. `NAIVE_TEMPLATE` overrides it for one caller: the platform's
 * artifact publisher, which builds every template of this repo in one pass.
 */
const chosen = process.env["NAIVE_TEMPLATE"] as TemplateName | undefined;
export const ACTIVE: MediaTemplate = chosen ? (TEMPLATES[chosen] ?? TEMPLATES.faceless) : TEMPLATES.faceless;
