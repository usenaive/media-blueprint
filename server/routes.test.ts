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
import { POST_PLATFORMS } from "../seed/posts.ts";

const CONFIG: ProxyConfig = { baseUrl: "https://api.test", apiKey: "sk_test", identityId: "idn_1", project: "media" };

/**
 * One template's demo queue, named rather than left to whichever template is running: these are
 * the machine's tests, and the row ids they move must say the same thing after a template switch.
 */
const demoState = () => seedState(TEMPLATES.faceless);

function ctxOver(state: StoreState, config: ProxyConfig | null = null, mcpToken?: string): ApiContext & { store(): Promise<Store> } {
  const store = openStoreOver(state, () => {});
  return {
    store: () => Promise.resolve(store),
    config,
    mcpToken,
    dashboardToken: undefined,
    dashboardPassword: undefined,
    studioUrl: undefined,
    appId: undefined,
    local: true,
  };
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
      body: { error: "status must be one of pending, ready, approved, rejected" },
    });
    expect(state.posts.find((p) => p.id === "post_9f2a")?.status).toBe("pending");
  });

  /**
   * #4 — the guard `postNow` enforces, walked around by its neighbour.
   *
   * MEASURED IN PRODUCTION, 2026-09-09: `PATCH /api/posts/{id} -d '{"status":"posted"}'` answered
   * `HTTP 200 "status":"posted"` on a `pending` row nothing had published — one hop, no upstream
   * call, and the store stamped `postedAt` on it. `postNow` refuses exactly that with a 409 and
   * publishes for real before it writes the word. `posted` is that route's to write and no other's.
   */
  it("refuses to write `posted`: a row is posted by publishing it, not by naming it", async () => {
    const state = demoState();
    const ctx = ctxOver(state);
    const refused = await handleRequest(req("PATCH", "/api/posts/post_9f2a", '{"status":"posted"}'), ctx);
    expect(refused.status).toBe(409);
    expect((refused.body as { error: string }).error).toMatch(/post-now/);
    const row = state.posts.find((p) => p.id === "post_9f2a")!;
    expect(row.status).toBe("pending");
    expect(row.postedAt).toBeUndefined();
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
      platforms: ["youtube"],
      media_urls: ["https://cdn.test/amor-fati.mp4"],
    });
  });

  /**
   * A fresh install has never activated a social workspace — nothing in this app called
   * `social/activate`, and the studio's Connect (platform PR #418) is a different app. So the
   * portal call answered `400 social publishing is not activated for this identity` for exactly
   * the operator the connect line had just sent to Accounts.
   */
  it("activates the workspace before minting a connect link, so a fresh install can connect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ url: "https://connect.test/x" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleRequest(
      req("POST", "/api/social/portal", '{"platforms":["youtube"]}'),
      ctxOver(demoState(), CONFIG),
    );

    expect(reply.status).toBe(200);
    const paths = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(paths[0], "activate must come first, or the portal call 400s").toContain(
      "/v1/identities/idn_1/social/activate",
    );
    expect(paths[1]).toContain("/v1/identities/idn_1/social/portal");
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

  it("refuses to publish a text-only row to a network that takes only media", async () => {
    // TikTok is now the channel's target, and TikTok publishes video, not text: the platform
    // refuses `tiktok` on a post carrying no `media_urls` and no `file_ids`. A brief — a pending
    // row with no video yet — is exactly that post, so the refusal is said here, in the channel's
    // own words, rather than discovered by pressing a button and reading a 502.
    const state = demoState();
    const brief = { ...state.posts[0]!, id: "post_brief", platform: "tiktok" as const, status: "approved" as const };
    delete (brief as { mediaUrl?: string }).mediaUrl;
    state.posts.push(brief);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleRequest(req("POST", "/api/posts/post_brief/post-now"), ctxOver(state, CONFIG));

    expect(reply.status).toBe(400);
    expect((reply.body as { error: string }).error).toMatch(/tiktok publishes video, not text/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.posts.find((p) => p.id === "post_brief")?.status).toBe("approved");
  });

  it("only ever names a platform the API accepts, and refuses a stored row that does not", async () => {
    // Every seeded and every agent-filed row targets one of the networks the platform's social API
    // takes. A document written before that was true can still be in the app database, and it must
    // be refused here with a sentence rather than published into a 400 the operator cannot read.
    const state = demoState();
    for (const post of state.posts) {
      expect(POST_PLATFORMS as readonly string[]).toContain(post.platform);
    }
    // `x` is the shape of that row exactly: it was a valid target until `POST_PLATFORMS` was
    // narrowed to the networks that take video, and a document written then is still in the
    // database. The narrowing is safe precisely because this line refuses it with a remedy.
    const legacy = { ...state.posts[0]!, id: "post_old", platform: "x" as never, status: "approved" as const };
    state.posts.push(legacy);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleRequest(req("POST", "/api/posts/post_old/post-now"), ctxOver(state, CONFIG));

    expect(reply).toEqual({
      status: 400,
      body: { error: "this channel cannot publish to x — retarget the post first" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.posts.find((p) => p.id === "post_old")?.status).toBe("approved");
  });

  it("does not mark a post posted when the publish was refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { message: "nope" } }, 400)));
    const state = demoState();
    // Every network this channel targets publishes video and refuses text, so a row reaches the
    // upstream call at all only once it carries the finished piece.
    state.posts.find((p) => p.id === "post_4a6f")!.mediaUrl = "https://cdn.test/amor-fati.mp4";
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
      state.posts.find((p) => p.id === "post_4a6f")!.mediaUrl = "https://cdn.test/amor-fati.mp4";
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

  /**
   * A row whose title is blank was unpublishable, permanently. The title is cut from the caption
   * (`store.createPost`), an `update_post` may blank it, and the platform's social API refuses
   * `title: ""` (`title: z.string().trim().min(1).max(200).optional()`) — so "Post now" answered
   * 502 on a post the operator had approved and nothing on the screen could fix it. The field is
   * optional upstream and the platform cuts its own title from `content` when it is absent, so a
   * blank one is omitted rather than sent.
   */
  it("publishes a post whose title is blank, by letting the platform cut its own", async () => {
    const state = demoState();
    const post = state.posts.find((p) => p.id === "post_4a6f")!;
    post.title = "";
    post.mediaUrl = "https://cdn.test/amor-fati.mp4";
    const fetchMock = vi.fn().mockResolvedValue(json({ id: "sp_1" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleRequest(req("POST", "/api/posts/post_4a6f/post-now"), ctxOver(state, CONFIG));

    expect(reply.status).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(sent).not.toHaveProperty("title");
    expect(sent).toMatchObject({ content: post.caption, platforms: ["youtube"] });
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
      params: { name: "create_post", arguments: { caption: "New cut", media_url: "https://cdn.test/c.mp4", platform: "instagram" } },
    };
    const answer = await handleRequest(req("POST", "/mcp", JSON.stringify(call), { authorization: "Bearer tok" }), ctx);
    expect(answer.status).toBe(200);

    const posts = (await handleRequest(req("GET", "/api/posts"), ctx)).body as { caption: string; platform: string }[];
    expect(posts[0]).toMatchObject({ caption: "New cut", platform: "instagram" });
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
  // Shaped like the platform's generated value; a fixture, not a secret.
  const PASSWORD = "kq7m-x2rt-8bvn-pz4h";
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

    it("still refuses a bad ticket the same way when a password is also set: the ticket path is untouched", async () => {
      const ctx = { ...deployedCtx(demoState(), TOKEN, CONFIG), dashboardPassword: PASSWORD };
      const form = { "content-type": "application/x-www-form-urlencoded" };
      expect(await handleRequest(req("POST", "/api/enter", "ticket=", form), ctx)).toEqual({
        status: 403,
        body: { error: "this link did not check out — this dashboard is opened from the studio that installed it" },
      });
      const live = await handleRequest(req("POST", "/api/enter", new URLSearchParams({ ticket: ticket(Date.now() + 60_000) }).toString(), form), ctx);
      expect(live.status).toBe(303);
      expect(live.headers?.["location"]).toBe("/");
    });
  });

  /**
   * THE SECOND DOOR: the operator's own `DASHBOARD_PASSWORD`, generated by the platform and shown in
   * the studio's Access panel, for a browser that reached the URL without the studio's handoff.
   */
  describe("the dashboard password is the other way in, and it buys the very same cookie", () => {
    const TOKEN = "a-long-generated-value";
    const FORM = { "content-type": "application/x-www-form-urlencoded" };
    const JSON_BODY = { "content-type": "application/json" };
    const withPassword = (password: string | undefined) => ({ ...deployedCtx(demoState(), TOKEN, CONFIG), dashboardPassword: password });

    it("trades the right password for the cookie and the redirect home, from a form or from JSON", async () => {
      for (const [body, headers] of [
        [new URLSearchParams({ password: PASSWORD }).toString(), FORM],
        [JSON.stringify({ password: PASSWORD }), JSON_BODY],
        // The host parses a form and the adapter re-encodes it: JSON body under a form content type.
        [JSON.stringify({ password: PASSWORD }), FORM],
      ] as const) {
        const reply = await handleRequest(req("POST", "/api/enter", body, headers), withPassword(PASSWORD));
        expect(reply.status, body).toBe(303);
        expect(reply.body).toBeUndefined();
        expect(reply.headers?.["location"]).toBe("/");
        const cookie = reply.headers?.["set-cookie"] ?? "";
        expect(cookie).toContain(`dashboard_session=${TOKEN}`);
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Lax");
        expect(cookie).toContain("Secure");
        expect(cookie).toContain("Max-Age=2592000");
        // The password is compared, never echoed — not in the cookie and not anywhere else.
        expect(JSON.stringify(reply)).not.toContain(PASSWORD);
      }
    });

    it("sends a refused form back to the gate with entry=denied, and sets no cookie", async () => {
      for (const wrong of ["kq7m-x2rt-8bvn-pz4x", PASSWORD.toUpperCase(), "", TOKEN]) {
        const reply = await handleRequest(req("POST", "/api/enter", new URLSearchParams({ password: wrong }).toString(), FORM), withPassword(PASSWORD));
        expect(reply, wrong).toEqual({ status: 303, headers: { location: "/?entry=denied" } });
      }
    });

    it("answers a refused JSON post with 403, as the ticket path does", async () => {
      const reply = await handleRequest(req("POST", "/api/enter", JSON.stringify({ password: "kq7m-x2rt-8bvn-pz4x" }), JSON_BODY), withPassword(PASSWORD));
      expect(reply.status).toBe(403);
      expect(reply.headers).toBeUndefined();
      expect((reply.body as { error: string }).error).toMatch(/did not check out/);
    });

    it("refuses every password, the right one included, while DASHBOARD_PASSWORD is unset", async () => {
      for (const unset of [undefined, ""]) {
        const form = await handleRequest(req("POST", "/api/enter", new URLSearchParams({ password: PASSWORD }).toString(), FORM), withPassword(unset));
        expect(form).toEqual({ status: 303, headers: { location: "/?entry=denied" } });
        const json = await handleRequest(req("POST", "/api/enter", JSON.stringify({ password: PASSWORD }), JSON_BODY), withPassword(unset));
        expect(json.status).toBe(403);
        expect(json.headers).toBeUndefined();
      }
    });

    it("still fails closed with no DASHBOARD_TOKEN: a password cannot mint a cookie there is no token for", async () => {
      const reply = await handleRequest(
        req("POST", "/api/enter", new URLSearchParams({ password: PASSWORD }).toString(), FORM),
        { ...deployedCtx(demoState(), undefined, CONFIG), dashboardPassword: PASSWORD },
      );
      expect(reply).toEqual({ status: 503, body: { error: "not configured — set DASHBOARD_TOKEN on this app" } });
    });
  });

  /**
   * `GET /api/session`: what the gate reads before it draws anything. Ungated, cookie-less, and the
   * same verdict `dashboardAuth` reaches — so the screen and the server can never disagree about
   * whether the browser is in.
   */
  describe("/api/session tells the gate what it may offer", () => {
    const TOKEN = "a-long-generated-value";
    const studio = { studioUrl: "https://app.usenaive.ai", appId: "app_123" };

    it("is reachable signed out, sets no cookie, and names both doors when both exist", async () => {
      const ctx = { ...deployedCtx(demoState(), TOKEN, CONFIG), dashboardPassword: PASSWORD, ...studio };
      const reply = await handleRequest(req("GET", "/api/session"), ctx);
      expect(reply.headers).toBeUndefined();
      expect(reply).toEqual({
        status: 200,
        body: { authenticated: false, studio_url: "https://app.usenaive.ai/apps/app_123/open", password_enabled: true },
      });
      // The password itself is in no answer this server gives.
      expect(JSON.stringify(reply)).not.toContain(PASSWORD);
    });

    it("says signed in for the cookie the door set, and for the bearer", async () => {
      const ctx = { ...deployedCtx(demoState(), TOKEN, CONFIG), ...studio };
      const cookied = await handleRequest(req("GET", "/api/session", "", { cookie: `dashboard_session=${TOKEN}` }), ctx);
      expect(cookied.body).toMatchObject({ authenticated: true });
      const bearer = await handleRequest(req("GET", "/api/session", "", { authorization: `Bearer ${TOKEN}` }), ctx);
      expect(bearer.body).toMatchObject({ authenticated: true });
      const wrong = await handleRequest(req("GET", "/api/session", "", { cookie: "dashboard_session=nope" }), ctx);
      expect(wrong.status).toBe(200);
      expect(wrong.body).toMatchObject({ authenticated: false });
    });

    it("offers no studio link unless the platform set both NAIVE_STUDIO_URL and NAIVE_APP_ID, and no password unless one is set", async () => {
      for (const partial of [{}, { studioUrl: "https://app.usenaive.ai" }, { appId: "app_123" }]) {
        const reply = await handleRequest(req("GET", "/api/session"), { ...deployedCtx(demoState(), TOKEN, CONFIG), ...partial });
        expect(reply.body, JSON.stringify(partial)).toEqual({ authenticated: false, studio_url: null, password_enabled: false });
      }
      // A trailing slash on the studio's base does not double up in the link.
      const slashed = await handleRequest(req("GET", "/api/session"), { ...deployedCtx(demoState(), TOKEN, CONFIG), studioUrl: "https://app.usenaive.ai/", appId: "app_123" });
      expect(slashed.body).toMatchObject({ studio_url: "https://app.usenaive.ai/apps/app_123/open" });
    });

    it("is signed out on a deployment with no token at all, and signed in on a local request", async () => {
      const closed = await handleRequest(req("GET", "/api/session"), deployedCtx(demoState(), undefined, CONFIG));
      expect(closed).toEqual({ status: 200, body: { authenticated: false, studio_url: null, password_enabled: false } });
      const local = await handleRequest(req("GET", "/api/session"), ctxOver(demoState()));
      expect(local.body).toMatchObject({ authenticated: true });
    });

    it("answers GET only", async () => {
      expect((await handleRequest(req("POST", "/api/session"), deployedCtx(demoState(), TOKEN, CONFIG))).status).toBe(405);
    });

    it("leaves every other /api/* route gated exactly as before", async () => {
      const ctx = { ...deployedCtx(demoState(), TOKEN, CONFIG), dashboardPassword: PASSWORD, ...studio };
      for (const [method, path, body] of anyRoute) {
        const reply = await handleRequest(req(method, path, body), ctx);
        expect(reply.status, path).toBe(401);
        expect(reply.headers).toBeUndefined();
      }
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
