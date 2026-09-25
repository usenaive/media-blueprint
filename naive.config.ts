/**
 * The `media` blueprint, declared. This is the file `naive up` reads.
 *
 * It is data only. There is no app: the crew works on the platform's own primitives — cards on the
 * company board, renders in the Media gallery, and each post on the platform's approval card.
 * `templates/` holds the three crews; `ACTIVE` in `templates/index.ts` picks the one that runs.
 * Re-running `naive up` is idempotent — every resource is keyed by name.
 */
import { BLUEPRINTS, defineProject } from "@usenaive-sdk/blueprints";
import { ACTIVE, CHANNEL_IDENTITY, PROJECT_NAME, TEMPLATES } from "./templates/index.ts";

/**
 * Every template this repo carries that the installed engine admits. The engine refuses a repo
 * that carries only some of its blueprint's templates, and it keeps — never deletes — an agent
 * only a sibling template declares, so switching template widens rather than narrows.
 *
 * `kinds`, `seed` and `words` are empty on purpose. The engine's `Template` type still requires
 * them (`packages/blueprints/src/template.ts:36-40`), but they describe a dashboard's queue,
 * demo rows and screen copy, and the engine itself never reads them.
 */
const carried = new Set<string>(BLUEPRINTS.media?.templates ?? Object.keys(TEMPLATES));
const templates = Object.values(TEMPLATES)
  .filter((one) => carried.has(one.name))
  .map((one) => ({ ...one, kinds: [], seed: {}, words: {} }));

/** What `naive up` is handed. Named so `naive.config.test.ts` can read the declaration itself. */
export const declaration = {
  name: PROJECT_NAME,
  blueprint: "media",
  template: ACTIVE.name,
  templates,

  /**
   * What the studio asks before anything is provisioned (`canonical-spec §31.2`). The answers land
   * on the install and every seat reads them with the built-in `project_context` tool (§31.8).
   * The engine refuses a fifth question on a project that names a template.
   */
  questions: ACTIVE.questions,

  /**
   * The crew's first work, as cards on the company board (§31.11). Each card is keyed
   * `media:<task.key>`, so a re-apply answers the card it already wrote. A card with an open
   * `blocked_by` is not due; the platform's tick wakes the assignee of each card that is.
   */
  tasks: ACTIVE.tasks,

  /**
   * The channel persona. Every seat and every cron acts as it, and connected accounts hang off it:
   * the platform resolves `session → agent → identity → connected accounts`.
   */
  identities: [
    {
      name: CHANNEL_IDENTITY,
      description: "The channel itself — the persona its agents post, read and connect accounts as.",
    },
  ],
};

export default defineProject(declaration);
