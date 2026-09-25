/**
 * The templates this blueprint carries, and the one it is running.
 *
 * `ACTIVE` is the whole switch: edit it and run `naive up`. The switch widens and never narrows —
 * an agent only the other template declares is kept, reported by `up` and left running, with its
 * crons. Retire one on purpose by naming it in `removed` in `naive.config.ts`.
 */
import { CLIPPING } from "./clipping.ts";
import { FACELESS } from "./faceless.ts";
import { LONGFORM } from "./longform.ts";
import type { MediaTemplate, TemplateName } from "./template.ts";

export type { Length, MediaTemplate, SetupQuestion, TemplateName } from "./template.ts";
export { CHANNEL_IDENTITY, CHANNEL_TIMEZONE, PLATFORM_ANSWER_KEY, PLATFORM_CHOICES, PLATFORM_QUESTION, PROJECT_NAME, lengthPhrase, segmentsOf } from "./template.ts";

/**
 * Keyed by the id the wire carries. `faceless` is shown as "Naive Short Form v1", `longform` as
 * "Naive Long Form v1", `clipping` as "Naive Clipping v1". The ids never change: `install.template`
 * is a stored string on every provisioned org.
 */
export const TEMPLATES: Record<TemplateName, MediaTemplate> = { faceless: FACELESS, clipping: CLIPPING, longform: LONGFORM };

/**
 * The template this repository runs. `NAIVE_TEMPLATE` overrides it for one caller: the platform's
 * artifact publisher, which builds every template of this repo in one pass.
 */
const chosen = process.env["NAIVE_TEMPLATE"] as TemplateName | undefined;
export const ACTIVE: MediaTemplate = chosen ? (TEMPLATES[chosen] ?? TEMPLATES.faceless) : TEMPLATES.faceless;
