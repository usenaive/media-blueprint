/**
 * Starter style-template library — the single source of truth shared by the
 * dashboard (`src/data.ts`) and first-run seeding. Researched set from
 * `development/workstreams/10-blueprints.md §5`: nine aesthetics currently
 * pulling views on short-form; `[brackets]` are per-brief slots. `image` is
 * the reference image the platform's `generate_image` conditioned on.
 */
export interface StyleTemplateSeed {
  name: string;
  prompt: string;
  trend: string;
  /** Reference image path, relative to the blueprint root. */
  image: string;
}

export const STYLE_TEMPLATE_SEEDS: readonly StyleTemplateSeed[] = [
  { name: "Marble & ink", image: "src/assets/styles/marble-ink.jpg", prompt: "Classical marble statue, dramatic hard side light, deep black background, subtle film grain, chiaroscuro, no text.", trend: "stoic / motivation staple" },
  { name: "Ghibli dusk", image: "src/assets/styles/ghibli-dusk.jpg", prompt: "Studio-Ghibli-style 2D animation of an everyday modern scene, hand-painted backgrounds, watercolor textures, gentle wind motion, soft pastel palette.", trend: "top saves on Reels" },
  { name: "Claymation", image: "src/assets/styles/claymation.jpg", prompt: "Stop-motion clay animation of [subject], visible thumbprints, soft studio lighting, slight imperfections, 24fps frame stutter.", trend: "nostalgia, high shares" },
  { name: "Photoreal cinematic", image: "src/assets/styles/photoreal-cinematic.jpg", prompt: "Slow cinematic camera move through [location], golden-hour lighting, film-stock grade, shallow depth of field, photoreal.", trend: "ambient B-roll, late-night views" },
  { name: "Lo-fi loop", image: "src/assets/styles/lofi-loop.jpg", prompt: "Cozy [scene], slow ambient motion, rain outside, warm interior lighting, loopable, no narrative arc, lo-fi color grade.", trend: "autoplay loops on Shorts" },
  { name: "Ambient ASMR", image: "src/assets/styles/ambient-asmr.jpg", prompt: "Ultra-realistic close-up of [natural process], night, warm light, hyper-detailed texture, seamless ambient loop, implied sound design.", trend: "fastest-growing AI niche" },
  { name: "Pixar-style 3D", image: "src/assets/styles/pixar-3d.jpg", prompt: "Pixar-style 3D render of [character], expressive eyes, soft subsurface scattering, warm rim lighting, animated-film aesthetic.", trend: "character explainer format" },
  { name: "Paper cutout", image: "src/assets/styles/paper-cutout.jpg", prompt: "Layered paper-craft illustration, warm off-white palette, layered cardstock depth, soft shadows, storybook framing.", trend: "history / education" },
  { name: "Brainrot absurdist", image: "src/assets/styles/brainrot.jpg", prompt: "Photorealistic render of [improbable animal hybrid] with [incongruous human accessory], deadpan documentary framing, absurdist meme aesthetic.", trend: "flagship meme style, billions of views" },
];
