/**
 * Pure proxy logic for the dashboard server: which `/api/*` paths map to which
 * platform routes, and how the upstream request is built. The org API key is
 * attached here — as an `Authorization` header on the *upstream* request only —
 * and never appears in anything sent back to the browser.
 */

import { PROJECT_NAME } from "../templates/index.ts";

export interface Upstream {
  method: string;
  path: string;
  /** True for the session event relay — the response is piped, not buffered. */
  sse?: boolean;
  /** Piped as-is with the upstream's content type — a file's bytes, not JSON. */
  raw?: boolean;
}

/**
 * Maps a browser-facing `/api/*` request onto the platform route it fronts.
 * Social routes hang off the channel persona, so they need its `idn_` id;
 * without one they are unroutable and return null (the caller answers 503).
 */
export function upstreamFor(method: string, pathname: string, identityId: string | null, query?: URLSearchParams): Upstream | null {
  if (method === "POST" && pathname === "/api/chat") return { method: "POST", path: "/v1/sessions" };
  const stream = /^\/api\/chat\/(ses_[\w-]+)\/stream$/.exec(pathname);
  if (method === "GET" && stream) {
    return { method: "GET", path: `/v1/sessions/${stream[1]}/stream`, sse: true };
  }
  // The roster and the timers are read whole (`collect` follows the cursor): a page of either
  // would show an agent as having no timer when its timer sat on the page that was not read.
  if (method === "GET" && pathname === "/api/agents") return { method: "GET", path: "/v1/agents?limit=100" };
  if (method === "GET" && pathname === "/api/deployments") return { method: "GET", path: "/v1/deployments?limit=100" };
  /**
   * The approval queue's two routes.
   *
   * A tool granted `ask` parks its session and puts the blocked call in `pending_actions`; the only
   * way to release it is `POST /v1/sessions/{id}/tool_confirmations`. Neither was reachable from
   * the dashboard, so `social.post` — `ask` on every agent of every template — stopped every
   * publish dead in a place no screen could see, and the operator's only recourse was a terminal.
   *
   * The listing asks for the largest page the platform serves rather than the default twenty: the
   * parked session is often not the most recent one, and the screen says when it is showing a page
   * rather than the whole list.
   */
  if (method === "GET" && pathname === "/api/sessions") {
    const params = new URLSearchParams({ limit: "100" });
    for (const name of SESSION_FILTERS) {
      const value = query?.get(name);
      if (value) params.set(name, value);
    }
    return { method: "GET", path: `/v1/sessions?${params}` };
  }
  const confirm = /^\/api\/sessions\/(ses_[\w-]+)\/tool_confirmations$/.exec(pathname);
  if (method === "POST" && confirm) {
    return { method: "POST", path: `/v1/sessions/${confirm[1]}/tool_confirmations` };
  }
  // A question (`ask_operator`, canonical-spec §7) is answered on its own route, never decided.
  const answer = /^\/api\/sessions\/(ses_[\w-]+)\/answers$/.exec(pathname);
  if (method === "POST" && answer) {
    return { method: "POST", path: `/v1/sessions/${answer[1]}/answers` };
  }
  // A rendered video is filed by its platform file id; the bytes stream through here under the
  // app's own key so the operator can watch what they are approving.
  const file = /^\/api\/files\/(fil_\w+)$/.exec(pathname);
  if (method === "GET" && file) return { method: "GET", path: `/v1/files/${file[1]}?download=true`, raw: true };
  // Segments are strictly [\w-]+ so `..` can never traverse out of the social subtree.
  const social = /^\/api\/social((?:\/[\w-]+)+)$/.exec(pathname);
  if (social) {
    if (identityId === null) return null;
    return { method, path: `/v1/identities/${identityId}/social${social[1]}` };
  }
  return null;
}

/** The list filters the platform's `GET /v1/sessions` takes (`canonical-spec §5`); anything else is dropped. */
const SESSION_FILTERS = ["agent_id", "status", "stop_reason"] as const;

export interface ProxyConfig {
  baseUrl: string;
  apiKey: string;
  identityId: string | null;
  /** The install this app belongs to (`NAIVE_PROJECT`, §29.7) — the row the context lookup reads; the declaration's own name when the platform did not say. */
  project: string;
}

/** Reads the server's platform config from the environment; null when the key is absent. */
export function configFromEnv(env: Record<string, string | undefined>): ProxyConfig | null {
  const apiKey = env.NAIVE_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.NAIVE_API_URL ?? "https://api.usenaive.ai").replace(/\/$/, ""),
    identityId: env.NAIVE_IDENTITY_ID ?? null,
    project: env.NAIVE_PROJECT ?? PROJECT_NAME,
  };
}

/**
 * Performs the upstream call. The key lives only in the request's
 * `Authorization` header; the returned Response is the platform's own body,
 * which never contains it.
 */
export async function proxyFetch(
  config: ProxyConfig,
  upstream: Upstream,
  body: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return fetchImpl(`${config.baseUrl}${upstream.path}`, {
    method: upstream.method,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      ...(body === null ? {} : { "content-type": "application/json" }),
    },
    ...(body === null ? {} : { body }),
  });
}

/**
 * Every row of a cursor-paginated platform list, or null when any page failed — a list cut short
 * by a failed page would read as a shorter roster, and nothing downstream could tell.
 */
export async function collect<T>(config: ProxyConfig, upstream: Upstream, fetchImpl: typeof fetch = fetch): Promise<T[] | null> {
  const all: T[] = [];
  let after: string | null = null;
  for (;;) {
    const path = after === null ? upstream.path : `${upstream.path}&after=${encodeURIComponent(after)}`;
    const res = await proxyFetch(config, { method: "GET", path }, null, fetchImpl);
    if (!res.ok) return null;
    const page = (await res.json()) as { data?: T[]; has_more?: boolean; next_cursor?: string | null };
    all.push(...(page.data ?? []));
    if (page.has_more !== true || !page.next_cursor) return all;
    after = page.next_cursor;
  }
}
