/**
 * The starter style library: nine looks currently pulling views on short-form. `[brackets]` are
 * per-brief slots. The producer's day-one `look` card lists them and picks the channel's one or two;
 * every plan after names its look in the render prompt.
 */
export interface StyleTemplateSeed {
  name: string;
  prompt: string;
  trend: string;
}

export const STYLE_TEMPLATE_SEEDS: readonly StyleTemplateSeed[] = [
  { name: "Marble & ink", prompt: "Classical marble statue, dramatic hard side light, deep black background, subtle film grain, chiaroscuro, no text.", trend: "stoic / motivation staple" },
  { name: "Ghibli dusk", prompt: "Studio-Ghibli-style 2D animation of an everyday modern scene, hand-painted backgrounds, watercolor textures, gentle wind motion, soft pastel palette.", trend: "top saves on Reels" },
  { name: "Claymation", prompt: "Stop-motion clay animation of [subject], visible thumbprints, soft studio lighting, slight imperfections, 24fps frame stutter.", trend: "nostalgia, high shares" },
  { name: "Photoreal cinematic", prompt: "Slow cinematic camera move through [location], golden-hour lighting, film-stock grade, shallow depth of field, photoreal.", trend: "ambient B-roll, late-night views" },
  { name: "Lo-fi loop", prompt: "Cozy [scene], slow ambient motion, rain outside, warm interior lighting, loopable, no narrative arc, lo-fi color grade.", trend: "autoplay loops on Shorts" },
  { name: "Ambient ASMR", prompt: "Ultra-realistic close-up of [natural process], night, warm light, hyper-detailed texture, seamless ambient loop, implied sound design.", trend: "fastest-growing AI niche" },
  { name: "Pixar-style 3D", prompt: "Pixar-style 3D render of [character], expressive eyes, soft subsurface scattering, warm rim lighting, animated-film aesthetic.", trend: "character explainer format" },
  { name: "Paper cutout", prompt: "Layered paper-craft illustration, warm off-white palette, layered cardstock depth, soft shadows, storybook framing.", trend: "history / education" },
  { name: "Brainrot absurdist", prompt: "Photorealistic render of [improbable animal hybrid] with [incongruous human accessory], deadpan documentary framing, absurdist meme aesthetic.", trend: "flagship meme style, billions of views" },
];
