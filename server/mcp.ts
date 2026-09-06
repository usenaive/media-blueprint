/**
 * The `/mcp` endpoint: MCP streamable-HTTP is JSON-RPC over POST, so the
 * subset agents actually need (initialize, tools/list, tools/call) is
 * implemented by hand — no SDK dependency. Every tool is a thin layer over
 * the same `store.ts` + `proxy.ts` the dashboard uses.
 *
 * Auth: one bearer, the platform-minted `VETTA_MCP_TOKEN` in this app's
 * environment. No token in the environment means the endpoint is closed.
 * Nothing here approves, rejects or publishes — those stay operator actions
 * on the Posts screen.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { proxyFetch, upstreamFor, type ProxyConfig } from "./proxy.ts";
import type { Store } from "./store.ts";
import { POST_PLATFORMS, type PostPlatform } from "../seed/posts.ts";

interface JsonRpcRequest { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> }

const rpcResult = (id: JsonRpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const rpcError = (id: JsonRpcRequest["id"], code: number, message: string) =>
  ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/**
 * True when `Authorization: Bearer <token>` carries exactly `expected`. Constant time, so the
 * answer cannot be walked out one byte at a time. Lives here because this file has always owned
 * the bearer check; `routes.ts` gates `/api/*` with the same comparison against its own token.
 */
export function bearerMatches(expected: string, authHeader: string | undefined): boolean {
  return secretMatches(expected, /^Bearer\s+(\S+)$/i.exec(authHeader ?? "")?.[1] ?? "");
}

/** The comparison itself, over two raw values — the cookie the browser holds is not a header. */
export function secretMatches(expected: string, given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A PLATFORM ENTRY TICKET: `<expiry-ms>.<base64url HMAC-SHA256>`, keyed by this app's own
 * `DASHBOARD_TOKEN` over `vetta.app-entry.v1:<expiry-ms>` (`canonical-spec §29.7`).
 *
 * The point of the shape is what it is NOT. The operator's browser is handed a ticket and never the
 * token: the ticket is a one-way function of it, so a ticket read out of a log, a history entry or
 * a `Referer` is worth two minutes and cannot be turned back into the bearer this app compares. The
 * expiry rides in the clear because this function has to read it before it can reject a stale one,
 * and inside the MAC because otherwise it would be the one field a holder could edit.
 *
 * Nothing about this is a session: it is one hop, and what it buys is the cookie (`routes.ts`).
 */
export function ticketMatches(token: string, ticket: string, now: number): boolean {
  const [expiry, mac] = ticket.split(".");
  const expiresAt = Number(expiry);
  if (mac === undefined || !Number.isSafeInteger(expiresAt) || now >= expiresAt) return false;
  return secretMatches(createHmac("sha256", token).update(`vetta.app-entry.v1:${expiresAt}`).digest("base64url"), mac);
}

/**
 * The JSON-RPC error a request must be refused with, or null when its bearer
 * matches the token this deployment was given. Compared in constant time.
 */
export function authError(token: string | null, authHeader: string | undefined): object | null {
  if (token === null) return rpcError(null, -32001, "MCP is not enabled on this deployment: VETTA_MCP_TOKEN is not set");
  if (!bearerMatches(token, authHeader)) return rpcError(null, -32001, "missing or invalid bearer token");
  return null;
}

const obj = (props: Record<string, unknown>, required: string[]) =>
  ({ type: "object", properties: props, required }) as const;
const str = (description: string) => ({ type: "string", description }) as const;

const OPERATOR_ONLY = "Approving, rejecting and publishing are operator actions on the dashboard; no tool does them.";

/** What a post with no stated destination gets — see `store.createPost`. */
const DEFAULT_PLATFORM = "x";

export const TOOLS = [
  { name: "list_posts", description: `The post queue, optionally filtered by status. ${OPERATOR_ONLY}`, inputSchema: obj({
    status: str("Optional filter: pending|ready|approved|posted|rejected"),
  }, []) },
  { name: "get_post", description: "One post by id.", inputSchema: obj({ id: str("Post id (post_…)") }, ["id"]) },
  { name: "create_post", description: `File a finished piece into the queue for the operator to review. Lands as pending unless status is ready. Say who you are, which account it is for and what it was made from — the operator approves the row, and an unsigned one tells them nothing. ${OPERATOR_ONLY}`, inputSchema: obj({
    caption: str("The caption, hashtags included"),
    media_url: str("URL of the finished clip or video — it is published with the post, and the operator watches it here before approving"),
    platform: str(`Where it should go: ${POST_PLATFORMS.join("|")} (default ${DEFAULT_PLATFORM}). These are the only networks this channel can publish to.`),
    agent: str("Your own name, as the roster lists it — who filed this"),
    account: str("The connected account this is for, from list_accounts"),
    source: str("What it was made from: the brief, the source video, the style template"),
    status: str("pending (default) or ready"),
  }, ["caption"]) },
  { name: "update_post", description: `Fix the caption or media URL of a pending or ready post. Approved and posted posts belong to the operator and cannot be edited. ${OPERATOR_ONLY}`, inputSchema: obj({
    id: str("Post id"), caption: str("New caption"), media_url: str("New media URL"),
  }, ["id"]) },
  { name: "list_style_templates", description: "The channel's style templates (name, prompt, reference image, trend note).", inputSchema: obj({}, []) },
  { name: "list_accounts", description: "The social accounts the channel posts to.", inputSchema: obj({}, []) },
  { name: "get_onboarding", description: "The channel profile: what onboarding was asked and answered — its niche, and on a clipping channel the source channel it cuts from. Every value is null before onboarding.", inputSchema: obj({}, []) },
] as const;

class ToolError extends Error {}
const need = (params: Record<string, unknown>, key: string): string => {
  const value = params[key];
  if (typeof value !== "string" || value === "") throw new ToolError(`${key} is required`);
  return value;
};
const optional = (params: Record<string, unknown>, key: string): string | undefined =>
  typeof params[key] === "string" ? (params[key] as string) : undefined;

/** Connected accounts from the platform when wired; otherwise the accounts the queue already names. */
async function listAccounts(store: Store, config: ProxyConfig | null): Promise<unknown> {
  const upstream = config === null ? null : upstreamFor("GET", "/api/social/accounts", config.identityId);
  if (config === null || upstream === null) {
    // Only rows that actually name an account: a post filed with no destination is not evidence
    // of an account existing, and listing one would invent a handle out of a blank field.
    const named = store.read().posts.filter((p) => p.account !== undefined);
    const seen = new Map(named.map((p) => [`${p.platform} ${p.account}`, { platform: p.platform, handle: p.account }]));
    return [...seen.values()];
  }
  const res = await proxyFetch(config, upstream, null);
  if (!res.ok) throw new ToolError("accounts unavailable");
  return ((await res.json()) as { data?: unknown[] }).data ?? [];
}

async function callTool(name: string, params: Record<string, unknown>, store: Store, config: ProxyConfig | null): Promise<unknown> {
  switch (name) {
    case "list_posts":
      return store.read().posts.filter((p) => params.status === undefined || p.status === params.status);
    case "get_post": {
      const post = store.read().posts.find((p) => p.id === need(params, "id"));
      if (!post) throw new ToolError("no such post");
      return post;
    }
    case "create_post": {
      const status = optional(params, "status") ?? "pending";
      if (status !== "pending" && status !== "ready") throw new ToolError("status must be pending or ready");
      const platform = optional(params, "platform") ?? DEFAULT_PLATFORM;
      // Refused here rather than at publish time: a post filed for a network the platform cannot
      // publish to is a post the operator can only ever discover is undeliverable by pressing send.
      if (!(POST_PLATFORMS as readonly string[]).includes(platform)) {
        throw new ToolError(`platform must be one of ${POST_PLATFORMS.join(", ")}`);
      }
      return store.createPost({
        caption: need(params, "caption"),
        mediaUrl: optional(params, "media_url"),
        agent: optional(params, "agent"),
        account: optional(params, "account"),
        source: optional(params, "source"),
        platform: platform as PostPlatform,
        status,
      });
    }
    case "update_post": {
      const id = need(params, "id");
      const post = store.read().posts.find((p) => p.id === id);
      if (!post) throw new ToolError("no such post");
      if (post.status !== "pending" && post.status !== "ready") {
        throw new ToolError(`post is ${post.status}; only pending or ready posts can be edited`);
      }
      return store.updatePost(id, { caption: optional(params, "caption"), mediaUrl: optional(params, "media_url") });
    }
    case "list_style_templates":
      return store.read().templates;
    case "list_accounts":
      return listAccounts(store, config);
    case "get_onboarding":
      return store.read().onboarding;
    default:
      throw new ToolError(`unknown tool: ${name}`);
  }
}

/**
 * Handles one JSON-RPC message. Answers null for notifications (the caller
 * responds 202 with no body, per the streamable-HTTP transport).
 */
export async function handleMcp(raw: string, store: Store, config: ProxyConfig | null): Promise<object | null> {
  let msg: JsonRpcRequest;
  try {
    msg = JSON.parse(raw) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  if (typeof msg.method !== "string") return rpcError(msg.id, -32600, "invalid request");
  if (msg.method.startsWith("notifications/")) return null;
  if (msg.method === "initialize") {
    return rpcResult(msg.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "media", version: "0.0.0" },
    });
  }
  if (msg.method === "tools/list") return rpcResult(msg.id, { tools: TOOLS });
  if (msg.method === "tools/call") {
    const { name, arguments: args } = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    try {
      const result = await callTool(name ?? "", args ?? {}, store, config);
      return rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (err) {
      if (err instanceof ToolError) {
        return rpcResult(msg.id, { content: [{ type: "text", text: err.message }], isError: true });
      }
      throw err;
    }
  }
  return rpcError(msg.id, -32601, "method not found");
}
