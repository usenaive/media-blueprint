/**
 * The templates this blueprint carries, and the one it is running.
 *
 * `ACTIVE` is the whole switch. Edit this line to the other template, run `naive up`, and the same
 * app keeps its URL, its database and its MCP token while the crew changes. The switch WIDENS and
 * never narrows: `naive.config.ts` hands `naive up` BOTH templates, so the chosen one's agents are
 * created and an agent only the other declares is kept — reported by `up` and left running, since
 * `removed` names are the only tombstones and this config has none. The operator's own rows —
 * posts, accounts, the install's setup answers — are never touched.
 *
 * LEFT RUNNING IS NOT LEFT IDLE, and this is the one cost of the switch. `up` owns an agent's
 * `schedules` through the template that declares it, and a kept agent is declared by neither, so
 * it is reported `unchanged` and nothing on it is touched — its crons included. The replaced crew
 * goes on firing daily, as the channel identity, each fire a billable session: three daily fires
 * (up to $30/day of ceiling) switching `clipping` → `faceless`, two daily and one twice-weekly
 * the other way. No declaration here can disarm them — `kept` carries names, not schedules — so
 * the remedy is the operator's and it is `removed` in `naive.config.ts`, which deletes the agent
 * rather than parking it. README, "Switching template", says it in the operator's words.
 */
import { CLIPPING } from "./clipping.ts";
import { FACELESS } from "./faceless.ts";
import type { MediaTemplate, TemplateName } from "./template.ts";

export type { MediaTemplate, PostKindDecl, SetupQuestion, TemplateName } from "./template.ts";
export {
  CHANNEL_IDENTITY,
  CHANNEL_TIMEZONE,
  labelOf,
  PLATFORM_ANSWER_KEY,
  PLATFORM_CHOICES,
  PLATFORM_QUESTION,
  platformFromAnswers,
  platformOf,
  PROJECT_NAME,
} from "./template.ts";

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
