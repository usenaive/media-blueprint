/**
 * The templates this blueprint carries, and the one it is running.
 *
 * `ACTIVE` is the whole switch. Edit this line to the other template, run `naive up`, and the same
 * app keeps its URL, its database and its MCP token while the crew changes. The switch WIDENS and
 * never narrows: `naive.config.ts` hands `naive up` BOTH templates, so the chosen one's agents are
 * created and an agent only the other declares is kept — reported by `up` and left running, since
 * `removed` names are the only tombstones and this config has none. The operator's own rows —
 * posts, accounts, the channel profile — are never touched.
 */
import { CLIPPING } from "./clipping.ts";
import { FACELESS } from "./faceless.ts";
import type { MediaTemplate, TemplateName } from "./template.ts";

export type { MediaTemplate, OnboardingQuestion, PostKindDecl, TemplateName } from "./template.ts";
export { CHANNEL_IDENTITY, CHANNEL_TIMEZONE } from "./template.ts";

export const TEMPLATES: Record<TemplateName, MediaTemplate> = { faceless: FACELESS, clipping: CLIPPING };

/**
 * The template this repository runs. Editing this line and running `naive up` is the switch, and
 * for an operator that is the whole story.
 *
 * `NAIVE_TEMPLATE` overrides it, and exists for exactly one caller: the platform's artifact
 * publisher builds EVERY template of this repository in one pass, and it cannot edit a file it does
 * not own between builds. Without the override it asked for `clipping` and got this
 * line's answer back, so only the default template could ever be published. Unset — which is every
 * run that is not that publisher — nothing changes.
 */
const chosen = process.env["NAIVE_TEMPLATE"] as TemplateName | undefined;
export const ACTIVE: MediaTemplate = chosen ? (TEMPLATES[chosen] ?? TEMPLATES.faceless) : TEMPLATES.faceless;
