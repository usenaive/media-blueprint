/**
 * The whole HTTP surface, without a socket or a database — which is the point of `routes.ts`.
 * Both adapters are three lines of plumbing over what is asserted here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelProfile, handleRequest, type ApiContext, type ApiRequest } from "./routes.ts";
import { ACTIVE, TEMPLATES } from "../templates/index.ts";
import { openStoreOver, seedState, type Store, type StoreState } from "./store.ts";
import type { ProxyConfig } from "./proxy.ts";

const CONFIG: ProxyConfig = { baseUrl: "https://api.test", apiKey: "sk_test", identityId: "idn_1" };

/**
 * One template's demo queue, named rather than left to whichever template is running: these are
 * the machine's tests, and the row ids they move must say the same thing after a template switch.
 */
const demoState = () => seedState(TEMPLATES.faceless);

/** Answers to whatever the running template asks — the route validates against that template. */
const ONBOARDING = Object.fromEntries(ACTIVE.questions.map((question) => [question.key, "stoicism"]));

function ctxOver(state: StoreState, config: ProxyConfig | null = null, mcpToken?: string): ApiContext & { store(): Promise<Store> } {
  const store = openStoreOver(state, () => {});
  return { store: () => Promise.resolve(store), config, mcpToken, dashboardToken: undefined, local: true };
}

/** The deployed shape: not local, so `/api/*` is behind the operator's bearer. */
function deployedCtx(state: StoreState, dashboardToken: string | undefined, config: ProxyConfig | null = null): ApiContext {
  return { ...ctxOver(state, config), dashboardToken, local: false };
}

const req = (method: string, path: string, body = "", headers: Record<string, string | undefined> = {}): ApiRequest => ({
  method,
  path,
  query: new URLSearchParams(),
  headers,
  body,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("the store routes", () => {
  it("serves the queue, the templates and the onboarding state, and saves a niche", async () => {
    const ctx = ctxOver(demoState());
    expect((await handleRequest(req("GET", "/api/posts"), ctx)).status).toBe(200);
    expect(((await handleRequest(req("GET", "/api/posts"), ctx)).body as unknown[]).length).toBe(9);
    expect(((await handleRequest(req("GET", "/api/templates"), ctx)).body as unknown[]).length).toBeGreaterThan(0);
    expect((await handleRequest(req("PUT", "/api/onboarding", JSON.stringify(ONBOARDING)), ctx)).body).toEqual(ONBOARDING);
    expect((await handleRequest(req("GET", "/api/onboarding"), ctx)).body).toEqual(ONBOARDING);
  });

  it("asks whatever the running template asks, and refuses an answer it did not get", () => {
    // The route validated one hard-coded field, so a clipping channel — which cuts from a source
    // the operator names — would have been onboarded with no source at all, silently.
    expect(channelProfile({ niche: "stoicism" }, TEMPLATES.faceless)).toEqual({ niche: "stoicism" });
    expect(channelProfile({ niche: "podcasts", sourceChannel: "@thepod" }, TEMPLATES.clipping)).toEqual({
      niche: "podcasts",
      sourceChannel: "@thepod",
    });
    expect(channelProfile({ niche: "podcasts" }, TEMPLATES.clipping)).toBe("source channel must be a non-empty string");
    expect(channelProfile({ niche: 123 }, TEMPLATES.faceless)).toBe("niche must be a non-empty string");
    // Answers to questions this template does not ask are not persisted onto the profile.
    expect(channelProfile({ niche: "stoicism", sourceChannel: "@thepod" }, TEMPLATES.faceless)).toEqual({ niche: "stoicism" });
  });

  it("moves a post, and says which of the two ways it refused", async () => {
    const ctx = ctxOver(demoState());
    expect(await handleRequest(req("PATCH", "/api/posts/post_9f2a", "{}"), ctx)).toEqual({
      status: 400,
      body: { error: "status is required" },
    });
    expect(await handleRequest(req("PATCH", "/api/posts/post_nope", '{"status":"approved"}'), ctx)).toEqual({
      status: 404,
      body: { error: "no such post" },
    });
    const moved = await handleRequest(req("PATCH", "/api/posts/post_9f2a", '{"status":"approved"}'), ctx);
    expect(moved.body).toMatchObject({ id: "post_9f2a", status: "approved" });
  });

  it("refuses a status no screen would ever send, and a niche that is not one", async () => {
    // Both of these persisted: `{"status":"garbage"}` wrote a post into a state no tab lists and no
    // agent understands, and `{"niche":123}` fell through a `typeof` check to null and erased the
    // channel's niche outright.
    const state = demoState();
    const ctx = ctxOver(state);
    expect(await handleRequest(req("PATCH", "/api/posts/post_9f2a", '{"status":"garbage"}'), ctx)).toEqual({
      status: 400,
      body: { error: "status must be one of pending, ready, approved, posted, rejected" },
    });
    expect(state.posts.find((p) => p.id === "post_9f2a")?.status).toBe("pending");

    await handleRequest(req("PUT", "/api/onboarding", JSON.stringify(ONBOARDING)), ctx);
    for (const body of ['{"niche":123}', '{"niche":null}', '{"niche":"  "}', "{}"]) {
      expect(await handleRequest(req("PUT", "/api/onboarding", body), ctx)).toEqual({
        status: 400,
        body: { error: "niche must be a non-empty string" },
      });
    }
    expect(state.onboarding).toEqual(ONBOARDING);
  });

  it("answers 405 for a known path with the wrong method and 404 for an unknown one", async () => {
    const ctx = ctxOver(demoState(), CONFIG);
    expect(await handleRequest(req("DELETE", "/api/posts"), ctx)).toEqual({ status: 405, body: { error: "method not allowed" } });
    expect(await handleRequest(req("GET", "/api/posts/post_9f2a"), ctx)).toEqual({ status: 405, body: { error: "method not allowed" } });
    expect(await handleRequest(req("GET", "/api/nope"), ctx)).toEqual({ status: 404, body: { error: "no such route" } });
  });
});

describe("post now", () => {
  it("publishes the finished video with the caption, not the caption alone", async () => {
    // The whole point of a short-form post is the video. The old route sent `content` and
    // `title` and dropped `mediaUrl` on the floor, so "Post now" published a bare line of text.
    const state = demoState();
    const post = state.posts.find((p) => p.id === "post_4a6f")!;
    post.mediaUrl = "https://cdn.test/amor-fati.mp4";
    const fetchMock = vi.fn().mockResolvedValue(json({ id: "sp_1" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleRequest(req("POST", "/api/posts/post_4a6f/post-now"), ctxOver(state, CONFIG));

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ id: "post_4a6f", status: "posted" });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(sent).toEqual({
      content: "Love what happens. All of it.",
      title: "Amor fati in 40 seconds",
      platforms: ["x"],
      media_urls: ["https://cdn.test/amor-fati.mp4"],
    });
  });

  it("only ever names a platform the API accepts, and refuses a stored row that does not", async () => {
    // Every seeded and every agent-filed row targets one of the six networks the platform's social
    // API takes. A document written before that was true can still be in the app database, and it
    // must be refused here with a sentence rather than published into a 400 the operator cannot read.
    const state = demoState();
    for (const post of state.posts) {
      expect(["bluesky", "facebook", "linkedin", "mastodon", "threads", "x"]).toContain(post.platform);
    }
    const legacy = { ...state.posts[0]!, id: "post_old", platform: "tiktok" as never, status: "approved" as const };
    state.posts.push(legacy);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleRequest(req("POST", "/api/posts/post_old/post-now"), ctxOver(state, CONFIG));

    expect(reply).toEqual({
      status: 400,
      body: { error: "this channel cannot publish to tiktok — retarget the post first" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.posts.find((p) => p.id === "post_old")?.status).toBe("approved");
  });

  it("does not mark a post posted when the publish was refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { message: "nope" } }, 400)));
    const state = demoState();
    const reply = await handleRequest(req("POST", "/api/posts/post_4a6f/post-now"), ctxOver(state, CONFIG));
    expect(reply).toEqual({ status: 502, body: { error: "publish failed" } });
    expect(state.posts.find((p) => p.id === "post_4a6f")?.status).toBe("approved");
  });

  it("refuses to publish a post the operator never approved", async () => {
    // The gate the whole blueprint is built on: every agent's system prompt promises the operator's
    // queue is the only way out. This route checked that the post existed and that its platform was
    // publishable — never `post.status` — so one call published a pending draft, or a rejected one.
    const fetchMock = vi.fn().mockResolvedValue(json({ id: "sp_1" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    for (const [id, status] of [["post_9f2a", "pending"], ["post_7d3c", "ready"], ["post_1792", "rejected"], ["post_3970", "posted"]]) {
      const state = demoState();
      const reply = await handleRequest(req("POST", `/api/posts/${id}/post-now`), ctxOver(state, CONFIG));
      expect(reply).toEqual({
        status: 409,
        body: { error: `this post is ${status} — only an approved post can be published` },
      });
      expect(state.posts.find((p) => p.id === id)).toEqual(demoState().posts.find((p) => p.id === id));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never reports a publish that did not happen", async () => {
    // With no publish path the route skipped the upstream call, answered 200, and wrote `posted`
    // and a `postedAt` onto the row: the operator was told a video had shipped that had shipped
    // nowhere, and nothing on the screen could ever say otherwise.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const config of [null, { ...CONFIG, identityId: null }]) {
      const state = demoState();
      const reply = await handleRequest(req("POST", "/api/posts/post_4a6f/post-now"), ctxOver(state, config));
      expect(reply).toEqual({
        status: 503,
        body: { error: "publishing is not configured on this deployment — nothing was published" },
      });
      const row = state.posts.find((p) => p.id === "post_4a6f")!;
      expect(row.status).toBe("approved");
      expect(row.postedAt).toBeUndefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s an unknown post", async () => {
    expect(await handleRequest(req("POST", "/api/posts/post_nope/post-now"), ctxOver(demoState(), CONFIG))).toEqual({
      status: 404,
      body: { error: "no such post" },
    });
  });
});

describe("/mcp is the first row of the same table, over the same store", () => {
  it("is POST only and bearer-gated", async () => {
    const ctx = ctxOver(demoState(), null, "tok");
    expect(await handleRequest(req("GET", "/mcp"), ctx)).toEqual({ status: 405, body: { error: "POST only" } });
    const refused = await handleRequest(req("POST", "/mcp", "{}", { authorization: "Bearer wrong" }), ctx);
    expect(refused.status).toBe(401);
    expect(JSON.stringify(refused.body)).toContain("missing or invalid bearer token");
  });

  it("writes rows the browser routes then read back", async () => {
    const ctx = ctxOver(demoState(), null, "tok");
    const call = {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "create_post", arguments: { caption: "New cut", media_url: "https://cdn.test/c.mp4", platform: "threads" } },
    };
    const answer = await handleRequest(req("POST", "/mcp", JSON.stringify(call), { authorization: "Bearer tok" }), ctx);
    expect(answer.status).toBe(200);

    const posts = (await handleRequest(req("GET", "/api/posts"), ctx)).body as { caption: string; platform: string }[];
    expect(posts[0]).toMatchObject({ caption: "New cut", platform: "threads" });
  });

  it("answers a notification 202 with no body", async () => {
    const ctx = ctxOver(demoState(), null, "tok");
    const note = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(await handleRequest(req("POST", "/mcp", note, { authorization: "Bearer tok" }), ctx)).toEqual({ status: 202 });
  });
});

describe("the platform routes", () => {
  it("answers 503 by name when no key is configured, and the store routes still work", async () => {
    const ctx = ctxOver(demoState());
    expect(await handleRequest(req("GET", "/api/agents"), ctx)).toEqual({
      status: 503,
      body: { error: "not configured — set NAIVE_API_KEY" },
    });
    expect((await handleRequest(req("GET", "/api/posts"), ctx)).status).toBe(200);
  });

  it("hands the session stream back unbuffered", async () => {
    const upstream = new Response("event: session.idle\ndata: {}\n\n", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));
    const reply = await handleRequest(req("GET", "/api/chat/ses_1/stream"), ctxOver(demoState(), CONFIG));
    expect(reply.stream).toBe(upstream);
    expect(reply.body).toBeUndefined();
  });

  /**
   * The approval queue, end to end through the same table: the dashboard could open a session and
   * read its replies, and could neither see a session parked on `ask` nor release it.
   */
  it("lists sessions and relays one tool confirmation, with the reason the operator gave", async () => {
    const parked = {
      data: [{ id: "ses_1", agent_id: "agt_1", status: "idle", stop_reason: "awaiting_approval", pending_actions: [{ tool_call_id: "call_1", name: "social.post", args: { content: "hi" } }] }],
      has_more: false,
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(parked)).mockResolvedValueOnce(json({ id: "ses_1" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = ctxOver(demoState(), CONFIG);

    expect(await handleRequest(req("GET", "/api/sessions"), ctx)).toEqual({ status: 200, body: parked });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/v1/sessions?limit=100");

    const decided = await handleRequest(
      req("POST", "/api/sessions/ses_1/tool_confirmations", '{"tool_call_id":"call_1","decision":"deny","reason":"wrong account"}'),
      ctx,
    );
    expect(decided.status).toBe(202);
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.test/v1/sessions/ses_1/tool_confirmations");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({
      tool_call_id: "call_1",
      decision: "deny",
      reason: "wrong account",
    });
  });

  it("opens a chat session against the channel-manager agent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: "agt_1", name: "channel-manager" }] }))
      .mockResolvedValueOnce(json({ id: "ses_1" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const reply = await handleRequest(req("POST", "/api/chat", '{"message":"clip this"}'), ctxOver(demoState(), CONFIG));
    expect(reply).toEqual({ status: 202, body: { id: "ses_1" } });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string)).toEqual({ agent_id: "agt_1", message: "clip this" });
  });
});

describe("every /api/* route is behind the operator's bearer", () => {
  // Anonymous `curl` against the deployed URL moved posts between states, marked one posted, read
  // the roster with its system prompts, opened a real billable session and relayed the events of a
  // session this dashboard never created. Each of these ran green with no gate at all.
  const AUTH = { authorization: "Bearer s3cret" };
  const anyRoute: [string, string, string][] = [
    ["GET", "/api/posts", ""],
    ["GET", "/api/templates", ""],
    ["GET", "/api/onboarding", ""],
    ["PUT", "/api/onboarding", JSON.stringify(ONBOARDING)],
    ["PATCH", "/api/posts/post_9f2a", '{"status":"posted"}'],
    ["POST", "/api/posts/post_4a6f/post-now", ""],
    ["GET", "/api/agents", ""],
    ["POST", "/api/chat", '{"message":"hi"}'],
    ["GET", "/api/chat/ses_1/stream", ""],
    ["GET", "/api/social/accounts", ""],
    ["GET", "/api/sessions", ""],
    ["POST", "/api/sessions/ses_1/tool_confirmations", '{"tool_call_id":"call_1","decision":"allow"}'],
  ];

  it("401s an anonymous request and a wrong token on every one of them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const [method, path, body] of anyRoute) {
      const state = demoState();
      const anon = await handleRequest(req(method, path, body), deployedCtx(state, "s3cret", CONFIG));
      expect(anon, `${method} ${path} anonymous`).toEqual({ status: 401, body: { error: "missing or invalid dashboard token" } });
      const wrong = await handleRequest(
        req(method, path, body, { authorization: "Bearer wrong-length-token" }),
        deployedCtx(state, "s3cret", CONFIG),
      );
      expect(wrong.status, `${method} ${path} wrong token`).toBe(401);
      // Nothing reached the platform and nothing in the document moved.
      expect(state).toEqual(demoState());
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets the right token through", async () => {
    const ctx = deployedCtx(demoState(), "s3cret");
    const posts = await handleRequest(req("GET", "/api/posts", "", AUTH), ctx);
    expect(posts.status).toBe(200);
    expect((posts.body as unknown[]).length).toBe(9);
    expect((await handleRequest(req("PATCH", "/api/posts/post_9f2a", '{"status":"ready"}', AUTH), ctx)).status).toBe(200);
  });

  it("fails CLOSED when no token is configured: 503, never open", async () => {
    // The tempting bug is "no token, no gate". A deployment that was applied without the variable
    // must refuse, not serve the org's queue to the internet.
    for (const token of [undefined, ""]) {
      const ctx = deployedCtx(demoState(), token, CONFIG);
      for (const [method, path, body] of anyRoute) {
        expect(await handleRequest(req(method, path, body, AUTH), ctx)).toEqual({
          status: 503,
          body: { error: "not configured — set DASHBOARD_TOKEN on this app" },
        });
      }
    }
  });

  it("bypasses only for a genuinely local request, and never lets /mcp use the dashboard token", async () => {
    // `pnpm serve` marks a loopback request `local` (server/index.ts); nothing else does.
    expect((await handleRequest(req("GET", "/api/posts"), ctxOver(demoState()))).status).toBe(200);
    const mcp = await handleRequest(
      req("POST", "/mcp", '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', { authorization: "Bearer s3cret" }),
      { ...deployedCtx(demoState(), "s3cret"), mcpToken: "mcp-token" },
    );
    expect(mcp.status).toBe(401);
  });
});
