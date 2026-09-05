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
export { CHANNEL_IDENTITY } from "./template.ts";

export const TEMPLATES: Record<TemplateName, MediaTemplate> = { faceless: FACELESS, clipping: CLIPPING };

/** The template this channel runs. Switching template is this line plus `naive up`. */
export const ACTIVE: MediaTemplate = TEMPLATES.faceless;
