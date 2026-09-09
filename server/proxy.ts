/**
 * Pure proxy logic for the dashboard server: which `/api/*` paths map to which
 * platform routes, and how the upstream request is built. The org API key is
 * attached here — as an `Authorization` header on the *upstream* request only —
 * and never appears in anything sent back to the browser.
 */

export interface Upstream {
  method: string;
  path: string;
  /** True for the session event relay — the response is piped, not buffered. */
  sse?: boolean;
}

/**
 * Maps a browser-facing `/api/*` request onto the platform route it fronts.
 * Social routes hang off the channel persona, so they need its `idn_` id;
 * without one they are unroutable and return null (the caller answers 503).
 */
export function upstreamFor(method: string, pathname: string, identityId: string | null): Upstream | null {
  if (method === "POST" && pathname === "/api/chat") return { method: "POST", path: "/v1/sessions" };
  const stream = /^\/api\/chat\/(ses_[\w-]+)\/stream$/.exec(pathname);
  if (method === "GET" && stream) {
    return { method: "GET", path: `/v1/sessions/${stream[1]}/stream`, sse: true };
  }
  if (method === "GET" && pathname === "/api/agents") return { method: "GET", path: "/v1/agents" };
  // The crew's timers, for the home's "next fire" — every cron `naive up` armed, with its `next_run_at`.
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
  if (method === "GET" && pathname === "/api/sessions") return { method: "GET", path: "/v1/sessions?limit=100" };
  const confirm = /^\/api\/sessions\/(ses_[\w-]+)\/tool_confirmations$/.exec(pathname);
  if (method === "POST" && confirm) {
    return { method: "POST", path: `/v1/sessions/${confirm[1]}/tool_confirmations` };
  }
  // A question (`ask_operator`, canonical-spec §7) is answered on its own route, never decided.
  const answer = /^\/api\/sessions\/(ses_[\w-]+)\/answers$/.exec(pathname);
  if (method === "POST" && answer) {
    return { method: "POST", path: `/v1/sessions/${answer[1]}/answers` };
  }
  // Segments are strictly [\w-]+ so `..` can never traverse out of the social subtree.
  const social = /^\/api\/social((?:\/[\w-]+)+)$/.exec(pathname);
  if (social) {
    if (identityId === null) return null;
    return { method, path: `/v1/identities/${identityId}/social${social[1]}` };
  }
  return null;
}

export interface ProxyConfig {
  baseUrl: string;
  apiKey: string;
  identityId: string | null;
}

/** Reads the server's platform config from the environment; null when the key is absent. */
export function configFromEnv(env: Record<string, string | undefined>): ProxyConfig | null {
  const apiKey = env.NAIVE_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.NAIVE_API_URL ?? "https://api.usenaive.ai").replace(/\/$/, ""),
    identityId: env.NAIVE_IDENTITY_ID ?? null,
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
