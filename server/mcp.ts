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
import { channelPlatform } from "./channel.ts";
import { proxyFetch, upstreamFor, type ProxyConfig } from "./proxy.ts";
import type { Store } from "./store.ts";
import { POST_PLATFORMS, POST_STAGES, type PostPlatform, type PostStage } from "../seed/posts.ts";
import { ACTIVE } from "../templates/index.ts";
import { labelOf } from "../templates/template.ts";

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

/**
 * THE TOOLS, WRITTEN FOR THE NETWORK THIS CHANNEL ACTUALLY POSTS TO.
 *
 * The description of `create_post`'s `platform` names the channel's own target, because a default
 * nothing tells the crew about is a default the crew never chooses against. That target used to be
 * a constant `"x"` in this file, then a constant on the running template; it is now the customer's
 * setup answer (`PLATFORM_QUESTION`), resolved per request by `server/channel.ts`. So the list is
 * built rather than declared: the same agent, on two installs that answered differently, reads two
 * different sentences, which is the point.
 */
const STAGES = POST_STAGES.join("|");

export const toolsFor = (channel: PostPlatform) => [
  { name: "list_posts", description: `The post queue, optionally filtered by status and/or stage. ${OPERATOR_ONLY}`, inputSchema: obj({
    status: str("Optional filter: pending|ready|approved|posted|rejected"),
    stage: str(`Optional filter on how far a piece is: ${STAGES}. A row with no stage is a note, not a piece.`),
  }, []) },
  { name: "get_post", description: "One post by id.", inputSchema: obj({ id: str("Post id (post_…)") }, ["id"]) },
  { name: "create_post", description: `File a finished piece into the queue for the operator to review. Lands as pending unless status is ready. Say who you are, which account it is for and what it was made from — the operator approves the row, and an unsigned one tells them nothing. ${OPERATOR_ONLY}`, inputSchema: obj({
    caption: str("The caption, hashtags included"),
    media_url: str("URL of the finished clip or video — it is published with the post, and the operator watches it here before approving"),
    platform: str(`Where it should go: ${POST_PLATFORMS.join("|")}. This channel posts to ${channel} (${labelOf(channel)}), which is what a post that names none becomes; name another only when the piece is genuinely for it. These are the only networks this channel can publish to, and every one of them publishes video and refuses a bare caption.`),
    agent: str("Your own name, as the roster lists it — who filed this"),
    account: str("The connected account this is for, from list_accounts"),
    source: str("What it was made from: the brief, the source video, the style template"),
    stage: str(`How far along the piece is: ${STAGES}. Leave unset for a note (a plan, a report) that no seat takes further.`),
    status: str("pending (default) or ready"),
  }, ["caption"]) },
  { name: "update_post", description: `Fix the title, caption, media URL or target network of a pending or ready post, or move it to the next stage. To claim a row before working on it, move it to scripting or rendering with expected_stage set to the stage it should still be at: the call is refused if another session got there first, and a refusal means the row is not yours. Approved and posted posts belong to the operator and cannot be edited. ${OPERATOR_ONLY}`, inputSchema: obj({
    id: str("Post id"), title: str("New title"), caption: str("New caption"), media_url: str("New media URL"),
    platform: str(`Retarget the post: ${POST_PLATFORMS.join("|")}`),
    stage: str(`The stage the piece has reached: ${STAGES}`),
    expected_stage: str(`The stage the row must still be at for this update to apply (${STAGES}); refused otherwise.`),
  }, ["id"]) },
  { name: "list_style_templates", description: "The channel's style templates (name, prompt, reference image, trend note).", inputSchema: obj({}, []) },
  { name: "list_accounts", description: "The social accounts the channel posts to.", inputSchema: obj({}, []) },
] as const;

/**
 * The tool list under the running template's fallback target — the names, for any caller that needs
 * them without a request in hand. What a live `tools/list` answers is `toolsFor(the resolved one)`.
 */
export const TOOLS = toolsFor(ACTIVE.platform);

class ToolError extends Error {}
const need = (params: Record<string, unknown>, key: string): string => {
  const value = params[key];
  if (typeof value !== "string" || value === "") throw new ToolError(`${key} is required`);
  return value;
};
const optional = (params: Record<string, unknown>, key: string): string | undefined =>
  typeof params[key] === "string" ? (params[key] as string) : undefined;
/** The `stage` a caller named, refused rather than persisted when it is not one the queue knows. */
const stageOf = (params: Record<string, unknown>, key = "stage"): PostStage | undefined => {
  const stage = optional(params, key);
  if (stage === undefined) return undefined;
  if (!(POST_STAGES as readonly string[]).includes(stage)) throw new ToolError(`${key} must be one of ${POST_STAGES.join(", ")}`);
  return stage as PostStage;
};

/**
 * Connected accounts from the platform when wired and activated; otherwise the accounts the queue
 * already names. A platform that refuses because social publishing is not activated yet — the
 * usual state of a fresh install — is the second case, not an error: an agent told "unavailable"
 * retries it until its budget is gone, while a list it can plan around is an answer.
 *
 * WHAT THAT MUST NOT DO IS FILL IN THE GAP WITH SOMETHING INVENTED. `res.ok` was the only success
 * test, so a 401 from a revoked key, a 403 from a missing scope and a 500 from a broken upstream
 * all fell through to this same list — handles typed into a caption by an agent, handed back as
 * though the platform had confirmed them. An agent then briefs a post at an account nobody
 * checked, and the operator reconnects one that was fine or never learns publishing is down.
 * "No accounts connected" and "we could not ask" are different answers and are said differently.
 */
async function listAccounts(store: Store, config: ProxyConfig | null): Promise<unknown> {
  const upstream = config === null ? null : upstreamFor("GET", "/api/social/accounts", config.identityId);
  if (config !== null && upstream !== null) {
    const res = await proxyFetch(config, upstream, null);
    if (res.ok) return ((await res.json()) as { data?: unknown[] }).data ?? [];
    // The one refusal that is an answer: `GET …/social/accounts` validates nothing else, so its
    // only 400 is "social publishing is not activated for this identity" (canonical-spec §27).
    if (res.status !== 400) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new ToolError(
        `could not read the connected accounts — the platform answered ${res.status}${body?.error?.message === undefined ? "" : `: ${body.error.message}`}. That is not an empty list: do not name an account, and tell the operator publishing could not be checked.`,
      );
    }
  }
  // Only rows that actually name an account: a post filed with no destination is not evidence
  // of an account existing, and listing one would invent a handle out of a blank field.
  const named = store.read().posts.filter((p) => p.account !== undefined);
  const seen = new Map(named.map((p) => [`${p.platform} ${p.account}`, { platform: p.platform, handle: p.account }]));
  return [...seen.values()];
}

async function callTool(name: string, params: Record<string, unknown>, store: Store, config: ProxyConfig | null): Promise<unknown> {
  switch (name) {
    case "list_posts": {
      const stage = stageOf(params);
      return store.read().posts.filter((p) =>
        (params.status === undefined || p.status === params.status) && (stage === undefined || p.stage === stage),
      );
    }
    case "get_post": {
      const post = store.read().posts.find((p) => p.id === need(params, "id"));
      if (!post) throw new ToolError("no such post");
      return post;
    }
    case "create_post": {
      const status = optional(params, "status") ?? "pending";
      if (status !== "pending" && status !== "ready") throw new ToolError("status must be pending or ready");
      const platform = optional(params, "platform");
      // Refused here rather than at publish time: a post filed for a network the platform cannot
      // publish to is a post the operator can only ever discover is undeliverable by pressing send.
      // Absent is not refused — the store stamps the channel's own target on it.
      if (platform !== undefined && !(POST_PLATFORMS as readonly string[]).includes(platform)) {
        throw new ToolError(`platform must be one of ${POST_PLATFORMS.join(", ")}`);
      }
      return store.createPost({
        caption: need(params, "caption"),
        mediaUrl: optional(params, "media_url"),
        agent: optional(params, "agent"),
        account: optional(params, "account"),
        source: optional(params, "source"),
        stage: stageOf(params),
        // Named by the agent, else the network the operator chose in setup. Resolved here rather
        // than left to the store's own fallback because only this layer can await the read, and
        // because the agent was just told, on the tool it called, which network that is.
        platform: (platform as PostPlatform | undefined) ?? (await channelPlatform(config)),
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
      const target = optional(params, "platform");
      if (target !== undefined && !(POST_PLATFORMS as readonly string[]).includes(target)) {
        throw new ToolError(`platform must be one of ${POST_PLATFORMS.join(", ")}`);
      }
      // The whole call runs under the store's lock, so this read-then-write is the atomic claim.
      const expected = stageOf(params, "expected_stage");
      if (expected !== undefined && post.stage !== expected) {
        throw new ToolError(`post is at stage ${post.stage ?? "none"}, not ${expected}; another session has it`);
      }
      return store.updatePost(id, {
        title: optional(params, "title"),
        caption: optional(params, "caption"),
        mediaUrl: optional(params, "media_url"),
        stage: stageOf(params),
        ...(target === undefined ? {} : { platform: target as PostPlatform }),
      });
    }
    case "list_style_templates":
      return store.read().templates;
    case "list_accounts":
      return listAccounts(store, config);
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
  // Built per request, because the sentence on `create_post` names the network this install
  // actually posts to and two installs of the same template answer differently.
  if (msg.method === "tools/list") return rpcResult(msg.id, { tools: toolsFor(await channelPlatform(config)) });
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
