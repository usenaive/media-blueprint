import { describe, expect, it } from "vitest";
import { SESSION_CREATE, configFromEnv, proxyFetch, sessionEvents, sessionList, sessionMessages, upstreamFor } from "./proxy";

describe("upstreamFor", () => {
  it("maps chat onto session create and the relay onto the session stream", () => {
    expect(upstreamFor("POST", "/api/chat", null)).toEqual({ method: "POST", path: "/v1/sessions" });
    expect(upstreamFor("GET", "/api/chat/ses_abc123/stream", null)).toEqual({
      method: "GET",
      path: "/v1/sessions/ses_abc123/stream",
      sse: true,
    });
  });

  it("maps a resumed session's log and follow-up onto the session's events and messages, carrying `after_seq`", () => {
    expect(upstreamFor("GET", "/api/chat/ses_abc123/events", null)).toEqual({
      method: "GET",
      path: "/v1/sessions/ses_abc123/events?limit=100",
    });
    expect(upstreamFor("GET", "/api/chat/ses_abc123/events", null, new URLSearchParams({ after_seq: "12", evil: "1" }))).toEqual({
      method: "GET",
      path: "/v1/sessions/ses_abc123/events?limit=100&after_seq=12",
    });
    expect(upstreamFor("GET", "/api/chat/ses_abc123/events", null, new URLSearchParams({ after_seq: "x" }))?.path).toBe(
      "/v1/sessions/ses_abc123/events?limit=100",
    );
    expect(upstreamFor("GET", "/api/chat/ses_abc123/stream", null, new URLSearchParams({ after_seq: "12" }))).toEqual({
      method: "GET",
      path: "/v1/sessions/ses_abc123/stream?after_seq=12",
      sse: true,
    });
    expect(upstreamFor("POST", "/api/chat/ses_abc123/messages", null)).toEqual({
      method: "POST",
      path: "/v1/sessions/ses_abc123/messages",
    });
    // The list and the single session are answered by `routes.ts` itself (titled), not passed through.
    expect(upstreamFor("GET", "/api/chat", null)).toBeNull();
    expect(upstreamFor("GET", "/api/chat/ses_abc123", null)).toBeNull();
    expect(upstreamFor("POST", "/api/chat/ses_abc123/events", null)).toBeNull();
    expect(upstreamFor("GET", "/api/chat/ses_abc123/messages", null)).toBeNull();
  });

  it("streams a filed video's bytes by its file id, and nothing shaped otherwise", () => {
    expect(upstreamFor("GET", "/api/files/fil_4pb4vm", null)).toEqual({
      method: "GET",
      path: "/v1/files/fil_4pb4vm?download=true",
      raw: true,
    });
    expect(upstreamFor("GET", "/api/files/..%2Fsecret", null)).toBeNull();
    expect(upstreamFor("DELETE", "/api/files/fil_4pb4vm", null)).toBeNull();
  });

  it("maps agents onto the org agent list, a full page at a time", () => {
    expect(upstreamFor("GET", "/api/agents", null)).toEqual({ method: "GET", path: "/v1/agents?limit=100" });
  });

  it("passes the session filters the platform knows through, and drops the rest", () => {
    const query = new URLSearchParams({ stop_reason: "awaiting_approval", agent_id: "agt_1", limit: "5", evil: "1" });
    expect(upstreamFor("GET", "/api/sessions", null, query)).toEqual({
      method: "GET",
      path: "/v1/sessions?limit=100&agent_id=agt_1&stop_reason=awaiting_approval",
    });
  });

  /**
   * The approval queue's two routes. Neither existed, so a session parked on `social.post` — which
   * every agent of every template is granted as `ask` — could be neither seen nor released from
   * this dashboard, only from a terminal holding the org key.
   */
  it("maps the session list, one tool confirmation and one answer onto the platform's own routes", () => {
    expect(upstreamFor("GET", "/api/sessions", null)).toEqual({ method: "GET", path: "/v1/sessions?limit=100" });
    expect(upstreamFor("POST", "/api/sessions/ses_abc123/tool_confirmations", null)).toEqual({
      method: "POST",
      path: "/v1/sessions/ses_abc123/tool_confirmations",
    });
    // A question (`ask_operator`, canonical-spec §7) is answered on its own route, not decided.
    expect(upstreamFor("POST", "/api/sessions/ses_abc123/answers", null)).toEqual({
      method: "POST",
      path: "/v1/sessions/ses_abc123/answers",
    });
    expect(upstreamFor("GET", "/api/sessions/ses_abc123/answers", null)).toBeNull();
    // Not a general session passthrough: nothing else under `/api/sessions` is routable.
    expect(upstreamFor("POST", "/api/sessions", null)).toBeNull();
    expect(upstreamFor("DELETE", "/api/sessions/ses_abc123", null)).toBeNull();
    expect(upstreamFor("POST", "/api/sessions/ses_abc123/cancel", null)).toBeNull();
  });

  it("maps social paths under the channel identity", () => {
    expect(upstreamFor("GET", "/api/social/accounts", "idn_1")).toEqual({
      method: "GET",
      path: "/v1/identities/idn_1/social/accounts",
    });
    expect(upstreamFor("POST", "/api/social/posts", "idn_1")).toEqual({
      method: "POST",
      path: "/v1/identities/idn_1/social/posts",
    });
    expect(upstreamFor("POST", "/api/social/portal", "idn_1")).toEqual({
      method: "POST",
      path: "/v1/identities/idn_1/social/portal",
    });
  });

  it("refuses social paths without an identity and unknown paths entirely", () => {
    expect(upstreamFor("GET", "/api/social/accounts", null)).toBeNull();
    expect(upstreamFor("GET", "/api/anything-else", "idn_1")).toBeNull();
    expect(upstreamFor("GET", "/api/social/../../v1/keys", "idn_1")).toBeNull();
  });
});

/**
 * The server walks the platform's sessions itself — to find the one running session of a seat, to
 * scan a renderer's recent sessions for the plan they wrote, to open or follow up the one bound
 * to a plan. Those are the same upstreams the browser's paths map onto, built from one place.
 */
describe("the session upstreams the server itself uses", () => {
  it("lists one agent's sessions, narrowed by status, a bounded page at a time", () => {
    expect(sessionList({ agent_id: "agt_1", status: "running" })).toEqual({ method: "GET", path: "/v1/sessions?limit=100&agent_id=agt_1&status=running" });
    expect(sessionList({ agent_id: "agt_1", limit: 20 })).toEqual({ method: "GET", path: "/v1/sessions?limit=20&agent_id=agt_1" });
    expect(sessionList({ agent_id: "agt 1&x=y", limit: 20 }).path).toBe("/v1/sessions?limit=20&agent_id=agt+1%26x%3Dy");
    // The browser's list is this same upstream, with the filters it may pass.
    expect(upstreamFor("GET", "/api/sessions", null, new URLSearchParams({ status: "running", agent_id: "agt_1" }))).toEqual(sessionList({ agent_id: "agt_1", status: "running" }));
  });

  it("opens a session, reads its log from a cursor and follows it up on the platform's own routes", () => {
    expect(SESSION_CREATE).toEqual({ method: "POST", path: "/v1/sessions" });
    expect(upstreamFor("POST", "/api/chat", null)).toEqual(SESSION_CREATE);
    expect(sessionEvents("ses_1")).toEqual({ method: "GET", path: "/v1/sessions/ses_1/events?limit=100" });
    expect(sessionEvents("ses_1", 7)).toEqual({ method: "GET", path: "/v1/sessions/ses_1/events?limit=100&after_seq=7" });
    expect(sessionMessages("ses_1")).toEqual(upstreamFor("POST", "/api/chat/ses_1/messages", null));
  });
});

describe("configFromEnv", () => {
  it("is null without a key — the server falls back to store-only mode", () => {
    expect(configFromEnv({})).toBeNull();
  });

  it("reads key, base url and identity, trimming the trailing slash", () => {
    expect(
      configFromEnv({ NAIVE_API_KEY: "k", NAIVE_API_URL: "http://up/", NAIVE_IDENTITY_ID: "idn_1" }),
    ).toEqual({ apiKey: "k", baseUrl: "http://up", identityId: "idn_1", project: "media" });
  });

  /**
   * Measured on staging: the install is filed under the customer's slug and the dashboard asked for
   * `project=media`, so the context lookup was a 404 on every deployed install. The platform writes
   * the install's own project as `NAIVE_PROJECT`; the declaration's name is only the fallback for a
   * laptop `naive up`, which files under it.
   */
  it("reads the install's project from NAIVE_PROJECT and falls back to the declaration's name", () => {
    expect(configFromEnv({ NAIVE_API_KEY: "k", NAIVE_PROJECT: "ws12-staging-faceless" })?.project).toBe("ws12-staging-faceless");
    expect(configFromEnv({ NAIVE_API_KEY: "k" })?.project).toBe("media");
  });
});

describe("proxyFetch", () => {
  const config = { apiKey: "sk-secret", baseUrl: "http://up", identityId: null, project: "media" };

  it("attaches the key upstream only; the relayed body never contains it", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    const res = await proxyFetch(config, { method: "GET", path: "/v1/agents" }, null, fetchImpl);
    expect(seen!.url).toBe("http://up/v1/agents");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-secret");
    expect(await res.text()).not.toContain("sk-secret");
  });

  it("posts a JSON body with the content type set", async () => {
    let init: RequestInit | undefined;
    const fetchImpl = (async (_url: unknown, i?: RequestInit) => {
      init = i;
      return new Response("{}", { status: 201 });
    }) as typeof fetch;

    await proxyFetch(config, { method: "POST", path: "/v1/sessions" }, '{"message":"hi"}', fetchImpl);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"message":"hi"}');
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
});
