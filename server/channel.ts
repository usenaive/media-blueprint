/**
 * WHERE THIS CHANNEL POSTS, RESOLVED FROM THE CUSTOMER'S OWN ANSWER.
 *
 * The studio asks `PLATFORM_QUESTION` before the crew exists, the platform holds the answer on the
 * install, and every agent reads it through `project_context`. The dashboard's server has to read
 * the same answer, because the dashboard is what actually stamps a network on a filed row: the
 * agents mostly name none, so whatever this function returns is what the queue fills up with.
 *
 * Before this file the answer did not exist and the stamp was a constant on the running template —
 * measured in production, nine rows in a row filed for a network nobody had chosen and nobody had
 * connected. The constant is still here, as the last of four fallbacks, and that is the right
 * place for it: an install that cannot be asked is not an install that chose TikTok.
 *
 * The read is the same two hops `GET /api/context` makes (`server/routes.ts`), for the same reason:
 * the spec publishes no `GET /v1/blueprints/installs/{id}` by project, so the applied install is
 * found by listing and its context read by id (`canonical-spec §31.8`).
 */
import { POST_PLATFORMS, type PostPlatform } from "../seed/posts.ts";
import { ACTIVE } from "../templates/index.ts";
import { platformFromAnswers } from "../templates/template.ts";
import { proxyFetch, type ProxyConfig } from "./proxy.ts";

export { PLATFORM_ANSWER_KEY, platformFromAnswers, platformOf } from "../templates/template.ts";

/**
 * How long a resolved answer is trusted inside one warm instance.
 *
 * The answer changes when a person edits it in the studio, which is rare and never urgent; a
 * filing agent, on the other hand, is a JSON-RPC call that must not pay two upstream round trips
 * every time. Sixty seconds is the compromise, and it is per instance: a deployed function is cold
 * far more often than this, so the practical worst case is two extra reads per cold start and none
 * after. `forgetChannelPlatform` exists for tests, which must not inherit each other's answer.
 */
const TTL_MS = 60_000;

let cached: { at: number; platform: PostPlatform } | null = null;

/** Drops the memoised answer. Tests only — nothing in a request path should need to call it. */
export function forgetChannelPlatform(): void {
  cached = null;
}

/** The install this app belongs to, most recently applied first; only an `applied` row has context. */
interface WireInstall {
  id: string;
  status: string;
}

/**
 * The customer's answer, or the running template's fallback — never an error and never a throw.
 *
 * EVERY FAILURE FALLS BACK RATHER THAN REFUSING, and that is deliberate: this is called on the
 * path that files an agent's finished work, and a post that cannot be filed because the context
 * read timed out is a render already paid for and thrown away. A wrong-but-retargetable network is
 * recoverable from the dashboard in one call (`update_post`); a lost post is not.
 *
 * What it must never do is fall back SILENTLY where the operator cannot see it — which is why the
 * dashboard now prints the channel's network and whether an account is connected for it
 * (`src/connect.ts`), instead of leaving the first sign of a wrong target to the publish button.
 */
export async function channelPlatform(
  config: ProxyConfig | null,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<PostPlatform> {
  const fallback = ACTIVE.platform;
  if (config === null) return fallback;
  if (cached !== null && now - cached.at < TTL_MS) return cached.platform;
  const platform = await read(config, fetchImpl, fallback);
  cached = { at: now, platform };
  return platform;
}

async function read(config: ProxyConfig, fetchImpl: typeof fetch, fallback: PostPlatform): Promise<PostPlatform> {
  try {
    const listed = await proxyFetch(
      config,
      { method: "GET", path: `/v1/blueprints/installs?project=${encodeURIComponent(config.project)}` },
      null,
      fetchImpl,
    );
    if (!listed.ok) return fallback;
    const page = (await listed.json()) as { data?: WireInstall[] };
    const applied = (page.data ?? []).find((row) => row.status === "applied");
    if (applied === undefined) return fallback;
    const context = await proxyFetch(
      config,
      { method: "GET", path: `/v1/blueprints/installs/${applied.id}/context` },
      null,
      fetchImpl,
    );
    if (!context.ok) return fallback;
    return platformFromAnswers(await context.json(), fallback);
  } catch {
    // A network that is down, a body that is not JSON: the channel still has a default.
    return fallback;
  }
}

/** True for a target this dashboard can file and publish; used wherever a caller's string arrives. */
export const publishable = (name: unknown): name is PostPlatform =>
  typeof name === "string" && (POST_PLATFORMS as readonly string[]).includes(name);
