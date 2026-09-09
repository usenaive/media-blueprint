/**
 * The whole HTTP surface, without a socket or a database — which is the point of `routes.ts`.
 * Both adapters are three lines of plumbing over what is asserted here.
 */
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRequest, type ApiContext, type ApiRequest } from "./routes.ts";
import { TEMPLATES } from "../templates/index.ts";
import { openStoreOver, seedState, type Store, type StoreState } from "./store.ts";
import type { ProxyConfig } from "./proxy.ts";

const CONFIG: ProxyConfig = { baseUrl: "https://api.test", apiKey: "sk_test", identityId: "idn_1", project: "media" };

/**
 * One template's demo queue, named rather than left to whichever template is running: these are
 * the machine's tests, and the row ids they move must say the same thing after a template switch.
 */
const demoState = () => seedState(TEMPLATES.faceless);

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
  it("serves the queue and the templates", async () => {
    const ctx = ctxOver(demoState());
    expect((await handleRequest(req("GET", "/api/posts"), ctx)).status).toBe(200);
    expect(((await handleRequest(req("GET", "/api/posts"), ctx)).body as unknown[]).length).toBe(9);
    expect(((await handleRequest(req("GET", "/api/templates"), ctx)).body as unknown[]).length).toBeGreaterThan(0);
  });

  it("has no onboarding route: the studio asks the questions, once, before the crew exists", async () => {
    // Two places to answer the same three questions is two answers. `PUT /api/onboarding` and its
    // screen are gone; the answers live on the install and reach the dashboard via `/api/context`.
    const ctx = ctxOver(demoState(), CONFIG);
    expect(await handleRequest(req("GET", "/api/onboarding"), ctx)).toEqual({ status: 404, body: { error: "no such route" } });
    expect(await handleRequest(req("PUT", "/api/onboarding", '{"niche":"x"}'), ctx)).toEqual({ status: 404, body: { error: "no such route" } });
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

  it("refuses a status no screen would ever send", async () => {
    // This persisted: `{"status":"garbage"}` wrote a post into a state no tab lists and no agent
    // understands.
    const state = demoState();
    const ctx = ctxOver(state);
    expect(await handleRequest(req("PATCH", "/api/posts/post_9f2a", '{"status":"garbage"}'), ctx)).toEqual({
      status: 400,
      body: { error: "status must be one of pending, ready, approved, posted, rejected" },
    });
    expect(state.posts.find((p) => p.id === "post_9f2a")?.status).toBe("pending");
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

  it("publishes a rendered video by its file id, which the platform signs itself", async () => {
    const state = demoState();
    const post = state.posts.find((p) => p.id === "post_4a6f")!;
    post.mediaUrl = "fil_4pb4vmt1m862sf0r42tx0anjc9";
    const fetchMock = vi.fn().mockResolvedValue(json({ id: "sp_1" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleRequest(req("POST", "/api/posts/post_4a6f/post-now"), ctxOver(state, CONFIG));

    expect(reply.status).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({ file_ids: ["fil_4pb4vmt1m862sf0r42tx0anjc9"] });
    expect(sent).not.toHaveProperty("media_urls");
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
    expect(reply).toEqual({ status: 502, body: { error: "publish failed: nope" } });
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

  it("lets a bare GET fail with the store while the database is unreachable", async () => {
    const down = new Error("connect ECONNREFUSED");
    const ctx: ApiContext = { ...ctxOver(demoState(), null, "tok"), store: () => Promise.reject(down) };
    await expect(handleRequest(req("GET", "/mcp"), ctx)).rejects.toBe(down);
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

  /**
   * The home's context card: the setup answers as the platform holds them (`canonical-spec §31.8`),
   * read off this project's latest *applied* install — never a local row, never a pending apply.
   */
  it("reads the project context of the latest applied install, with its team and its day one read by session id", async () => {
    // The intake sessions were opened on install day; a session list is the hundred most recent
    // and stops holding them once the crons have run a while. The report names them by `ses_` id,
    // and the team by `agt_` id — a refused seat has neither and is on neither list.
    const context = { object: "project_context", project: "media", template: "faceless", answers: [{ key: "niche", label: "Niche", value: "Stoicism" }] };
    const report = {
      agents: [{ name: "trend-scout", action: "created", id: "agt_s" }, { name: "producer", action: "unchanged", id: "agt_p" }, { name: "analyst", action: "refused", reason: "no budget" }],
      intake: [{ name: "trend-scout", action: "created", id: "ses_9" }, { name: "producer", action: "created", id: "ses_8" }, { name: "analyst", action: "refused", reason: "agent refused" }],
    };
    const installs = {
      data: [
        { id: "bpi_new", status: "pending", report: null },
        { id: "bpi_live", status: "applied", report },
        { id: "bpi_old", status: "applied", report: { intake: [] } },
      ],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(installs))
      .mockResolvedValueOnce(json(context))
      .mockResolvedValueOnce(json({ id: "ses_9", status: "completed", stop_reason: "end_turn", pending_actions: [] }))
      .mockResolvedValueOnce(json({ error: { type: "api_error", code: "internal", message: "boom" } }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleRequest(req("GET", "/api/context"), ctxOver(demoState(), CONFIG));

    expect(reply).toEqual({
      status: 200,
      body: {
        context,
        team: [{ name: "trend-scout", id: "agt_s" }, { name: "producer", id: "agt_p" }],
        day_one: [
          { name: "trend-scout", action: "created", id: "ses_9", session: { status: "completed", stop_reason: "end_turn", waiting: false } },
          { name: "producer", action: "created", id: "ses_8", session: null },
          { name: "analyst", action: "refused", reason: "agent refused", session: null },
        ],
      },
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/blueprints/installs?project=media",
      "https://api.test/v1/blueprints/installs/bpi_live/context",
      "https://api.test/v1/sessions/ses_9",
      "https://api.test/v1/sessions/ses_8",
    ]);
  });

  it("says so when the project has never been applied, and 503s by name without a key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ data: [{ id: "bpi_1", status: "pending" }] })));
    expect(await handleRequest(req("GET", "/api/context"), ctxOver(demoState(), CONFIG))).toEqual({
      status: 404,
      body: { error: "this project has no applied install yet" },
    });
    expect(await handleRequest(req("GET", "/api/context"), ctxOver(demoState()))).toEqual({
      status: 503,
      body: { error: "not configured — set NAIVE_API_KEY" },
    });
    expect(await handleRequest(req("POST", "/api/context"), ctxOver(demoState(), CONFIG))).toEqual({
      status: 405,
      body: { error: "method not allowed" },
    });
  });

  it("assembles every page of the crew's timers, and fails the whole read rather than hand back a shorter list", async () => {
    // "no timer armed" on an agent whose timer sat on the page that did not arrive is a lie the
    // screen has no way to catch; a 502 it can show.
    const timer = { id: "dep_1", agent_id: "agt_1", cron: "0 9 * * 1", next_run_at: "2026-09-14T13:00:00Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [timer], has_more: true, next_cursor: "dep_1" }))
      .mockResolvedValueOnce(json({ data: [{ ...timer, id: "dep_2" }], has_more: false, next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await handleRequest(req("GET", "/api/deployments"), ctxOver(demoState(), CONFIG))).toEqual({
      status: 200,
      body: { data: [timer, { ...timer, id: "dep_2" }], has_more: false, next_cursor: null },
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/deployments?limit=100",
      "https://api.test/v1/deployments?limit=100&after=dep_1",
    ]);

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json({ data: [timer], has_more: true, next_cursor: "dep_1" }))
      .mockResolvedValueOnce(json({ error: { type: "api_error", code: "internal", message: "boom" } }, 500)));
    expect((await handleRequest(req("GET", "/api/agents"), ctxOver(demoState(), CONFIG))).status).toBe(502);
  });

  it("passes the session filters through, so the home counts the parked sessions and not the recent ones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [], has_more: false }));
    vi.stubGlobal("fetch", fetchMock);
    const query = new URLSearchParams({ stop_reason: "awaiting_approval" });
    expect((await handleRequest({ ...req("GET", "/api/sessions"), query }, ctxOver(demoState(), CONFIG))).status).toBe(200);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/v1/sessions?limit=100&stop_reason=awaiting_approval");
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
    ["GET", "/api/context", ""],
    ["GET", "/api/deployments", ""],
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
      expect(anon, `${method} ${path} anonymous`).toEqual({
        status: 401,
        body: { error: "missing or invalid dashboard token — this dashboard is opened from the studio that installed it" },
      });
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

  /**
   * THE ONE DOOR THROUGH THE GATE (`canonical-spec §29.7`).
   *
   * `DASHBOARD_TOKEN` is generated by the platform so that nobody has to invent one, and no route
   * anywhere returns an app secret — so there is no value for an operator to be asked for and none
   * for them to paste. The studio posts a two-minute ticket here instead, and this route trades it
   * for the cookie the browser then carries on its own.
   */
  describe("the entry ticket is the way in, and the ticket is not the token", () => {
    const TOKEN = "a-long-generated-value";
    const ticket = (expiresAt: number, token = TOKEN) =>
      `${expiresAt}.${createHmac("sha256", token).update(`vetta.app-entry.v1:${expiresAt}`).digest("base64url")}`;

    const post = (body: string) =>
      handleRequest(req("POST", "/api/enter", body, { "content-type": "application/x-www-form-urlencoded" }), deployedCtx(demoState(), TOKEN, CONFIG));

    it("trades a live ticket for an HttpOnly cookie and a redirect, and answers no body at all", async () => {
      const reply = await post(new URLSearchParams({ ticket: ticket(Date.now() + 60_000) }).toString());
      expect(reply.status).toBe(303);
      expect(reply.body).toBeUndefined();
      expect(reply.headers?.["location"]).toBe("/");
      const cookie = reply.headers?.["set-cookie"] ?? "";
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain(`dashboard_session=${TOKEN}`);
    });

    it("takes the ticket from a JSON body too, because the host parses a form for us", async () => {
      expect((await post(JSON.stringify({ ticket: ticket(Date.now() + 60_000) }))).status).toBe(303);
    });

    it("refuses an expired ticket, a forged one and a bare token, and sets no cookie", async () => {
      for (const bad of [
        ticket(Date.now() - 1),
        ticket(Date.now() + 60_000, "some-other-app-token"),
        `${Date.now() + 60_000}.not-a-mac`,
        TOKEN,
        "",
      ]) {
        const reply = await post(new URLSearchParams({ ticket: bad }).toString());
        expect(reply.status, bad).toBe(403);
        expect(reply.headers?.["set-cookie"]).toBeUndefined();
      }
    });

    it("opens every gated route for the cookie it set, with no header anywhere", async () => {
      const ctx = deployedCtx(demoState(), TOKEN);
      const cookied = req("GET", "/api/posts", "", { cookie: `other=1; dashboard_session=${TOKEN}` });
      expect((await handleRequest(cookied, ctx)).status).toBe(200);
      // A cookie that is not the token is still refused: the cookie is checked, not merely present.
      const wrong = req("GET", "/api/posts", "", { cookie: "dashboard_session=nope-wrong-length" });
      expect((await handleRequest(wrong, ctx)).status).toBe(401);
    });

    it("is the only route that runs before the gate, so it needs no credential to reach", async () => {
      // Reached with no bearer and no cookie on a deployed, non-local context.
      expect((await post("ticket=")).status).not.toBe(401);
    });
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
