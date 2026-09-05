/**
 * The screens' only door to the dashboard server (`server/routes.ts`).
 *
 * It no longer hides failure. The old contract answered a compiled-in fallback whenever the server
 * did not reply with JSON, which meant a dashboard whose every `/api/*` route 404'd still looked
 * fully populated — with rows nobody had made. A screen now holds `rows | null` plus `error`: null
 * renders the skeleton, an error renders the sentence the server sent, and an empty array renders
 * the screen's own empty state. An empty channel is the truth about a new deployment.
 */

import type { Account } from "./data";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const UNREACHABLE = "the dashboard server is unreachable";

const TOKEN_KEY = "channel.dashboard-token";
const ASK = "Dashboard token\n\nThis channel's queue, accounts and agents are behind one token. Paste the DASHBOARD_TOKEN this dashboard was deployed with.";

/** Read through `globalThis` so the module also loads outside a browser (tests, SSR of any kind). */
const session = (): Storage | undefined => (globalThis as { sessionStorage?: Storage }).sessionStorage;

/**
 * The operator's bearer for `/api/*`. Asked for once per browser session and kept in
 * `sessionStorage` — not `localStorage`: it is the whole channel's key, and it should not outlive
 * the tab that was given it. A 401 forgets it, so the next call asks again (`call` retries once).
 */
export function dashboardToken(): string {
  const saved = session()?.getItem(TOKEN_KEY);
  if (saved) return saved;
  const asked = (globalThis as { prompt?: (message: string) => string | null }).prompt?.(ASK)?.trim() ?? "";
  if (asked) session()?.setItem(TOKEN_KEY, asked);
  return asked;
}

/** Called on a 401: the token in hand is wrong or expired, so it must not be reused. */
export const forgetDashboardToken = (): void => session()?.removeItem(TOKEN_KEY);

/** Callers always hand a plain header bag, so the bearer can be merged into it by name. */
interface Call extends Omit<RequestInit, "headers"> {
  headers: Record<string, string>;
}

async function call<T>(path: string, init: Call, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${dashboardToken()}` },
    });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  // The token is wrong: drop it and let one retry ask for it again, rather than making the operator
  // reload the tab to be asked. Only once — a second 401 is an answer, not a typo.
  if (res.status === 401) {
    forgetDashboardToken();
    if (retry) return call<T>(path, init, false);
  }
  const isJson = res.headers.get("content-type")?.includes("application/json") ?? false;
  const body: unknown = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new ApiError(res.status, refusal(body));
  }
  // A 200 that is not JSON is the single-page fallback answering an API path — the route is gone.
  if (!isJson) throw new ApiError(res.status, UNREACHABLE);
  return body as T;
}

/**
 * What a refused call actually said.
 *
 * Two shapes reach the browser and only one of them was read. This server refuses with
 * `{ error: "<sentence>" }`; a platform route this server proxies refuses with
 * `{ error: { type, code, message } }`, and that object fell through to "the dashboard server is
 * unreachable" — which names the wrong layer and hides the only sentence that would have told the
 * operator what to do. A refused approval has to say why it was refused.
 */
export function refusal(body: unknown): string {
  const said = (body as { error?: unknown } | null)?.error;
  if (typeof said === "string" && said !== "") return said;
  const message = (said as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message !== "" ? message : UNREACHABLE;
}

export function apiGet<T>(path: string): Promise<T> {
  return call<T>(path, { headers: { accept: "application/json" } });
}

export function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  return call<T>(path, {
    method,
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** The sentence to put in a screen's header slot when a load failed. */
export const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : UNREACHABLE;

interface WireAccount {
  id: string;
  platform: string;
  username?: string;
  display_name?: string;
}

/** The connected social accounts, in the dashboard's shape. Every platform the org connected. */
export async function fetchAccounts(): Promise<Account[]> {
  const page = await apiGet<{ data?: WireAccount[] }>("/social/accounts");
  return (page.data ?? []).map((a) => ({
    id: a.id,
    handle: a.username ?? a.display_name ?? a.id,
    platform: a.platform,
    state: "connected" as const,
  }));
}

/**
 * The agent's prose out of one session-stream frame, or null when the frame is not the agent
 * talking. The wire carries `data: <the whole event>`, so the reply is one level in.
 *
 * The filter used to be `!event.data.role`, which the spec's own wording invites — a caller's
 * message carries `role: "user"` and the agent's reply was meant to carry none. The harness that
 * actually runs stamps every assistant message `role: "assistant"`, so that test dropped exactly
 * the frames it existed to render and no reply ever reached the transcript. Only the caller's own
 * turn is excluded now, because the composer already rendered it.
 */
export function replyText(raw: string): string | null {
  let data: { role?: string; content?: unknown } | undefined;
  try {
    data = (JSON.parse(raw) as { data?: { role?: string; content?: unknown } }).data;
  } catch {
    return null;
  }
  if (data?.role === "user") return null;
  return typeof data?.content === "string" && data.content !== "" ? data.content : null;
}
