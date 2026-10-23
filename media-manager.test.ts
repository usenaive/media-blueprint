/**
 * Media manager, the hosted app in `apps/media-manager`, as the host runs it: signed in through
 * Naive's ticket (`mintTicket` + `enter`, §29.10), reading the platform with the app's own key. The
 * API is a stubbed `fetch`; every response is the shape the SDK parses.
 */
import { mintTicket } from "@usenaive-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./apps/media-manager/api/enter.ts";
import { overview } from "./apps/media-manager/api/index.ts";

const ORIGIN = "https://media-manager.example";
const ENV = {
  DASHBOARD_TOKEN: "a-long-generated-dashboard-token",
  NAIVE_APP_ID: "app_1",
  NAIVE_STUDIO_URL: "https://studio.example/",
  NAIVE_API_URL: "https://api.example",
  NAIVE_API_KEY: "sk_live_media_manager",
  NAIVE_PROJECT: "my-channel",
};
/** Wednesday 2026-10-21 12:00 UTC: Monday 00:00 UTC is 2026-10-19. */
const NOW = Date.parse("2026-10-21T12:00:00Z");
const ULID = "0".repeat(26);
const AGENT = `agt_${ULID}`;
const SESSION = `ses_${ULID}`;

type Fixture = Record<string, unknown>;
const post = (over: Fixture): Fixture => ({
  object: "post",
  id: "pst_1",
  status: "posted",
  identity_id: null,
  agent_id: null,
  session_id: null,
  tool_call_id: null,
  content: null,
  platforms: ["tiktok"],
  file_ids: [],
  media_urls: [],
  visibility: null,
  scheduled_at: null,
  posted_at: null,
  url: null,
  error: null,
  metrics: null,
  measured_at: null,
  duplicate_of: null,
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});
const debit = (micro: number): Fixture => ({
  id: `led_${ULID}`,
  type: "debit",
  amount_micro_usd: -micro,
  balance_after_micro_usd: 10_000_000,
  actor: { type: "system", id: "billing" },
  session_id: null,
  agent_id: null,
  deployment_id: null,
  line_items: [],
  created_at: "2026-10-20T00:00:00Z",
});
const install = (answers: Fixture): Fixture => ({
  id: `bpi_${ULID}`,
  object: "blueprint_install",
  project: "my-channel",
  blueprint: "media",
  template: "faceless",
  revision: 1,
  artifact_version: "3.0.0",
  answers,
  source: "studio",
  report: null,
  status: "applied",
  failure: null,
  applied_at: "2026-10-01T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
});
const list = (data: Fixture[], next_cursor: string | null = null) => Response.json({ data, has_more: next_cursor !== null, next_cursor });

/** The channel as the API holds it: one post waiting, two scheduled, three posted, one failed. */
const CHANNEL = {
  pending: [
    post({ id: "pst_wait", status: "pending", content: "Cats on a skateboard", agent_id: AGENT, session_id: SESSION, platforms: ["tiktok", "youtube"], media_urls: ["https://cdn.example/wait.mp4"] }),
  ],
  scheduled: [
    post({ id: "pst_later", status: "scheduled", content: "Later one", scheduled_at: "2026-10-24T09:00:00Z", media_urls: ["https://cdn.example/later.png"] }),
    post({ id: "pst_soon", status: "scheduled", content: "Soon one", scheduled_at: "2026-10-22T09:00:00Z" }),
  ],
  posted: [
    // This week (since Monday) and in the last 7×24 h.
    post({ id: "pst_a", posted_at: "2026-10-20T10:00:00Z", metrics: { views: 30_000 }, url: "https://tiktok.example/a", media_urls: ["https://cdn.example/a.mp4"] }),
    // In the last 7×24 h, before Monday.
    post({ id: "pst_b", posted_at: "2026-10-16T10:00:00Z", metrics: { views: 8_000.4 } }),
    // In the 7×24 h before that.
    post({ id: "pst_c", posted_at: "2026-10-10T10:00:00Z", metrics: { views: 19_000 } }),
  ],
  failed: [post({ id: "pst_x", status: "failed", error: "token expired", created_at: "2026-10-18T00:00:00Z" })],
} as Record<string, Fixture[]>;

/** Stubs the API; `broken` names a path that answers with an error. Returns every request made. */
function api(channel: Record<string, Fixture[]> = CHANNEL, answers: Fixture = { cadence: "daily" }, broken?: string) {
  const seen: Request[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push(request);
    const url = new URL(request.url);
    if (url.pathname === broken) {
      return Response.json({ error: { type: "api_error", code: "internal_error", message: "the ledger is down", request_id: "req_1" } }, { status: 500 });
    }
    if (url.pathname === "/v1/posts") return list(channel[url.searchParams.get("status")!] ?? []);
    if (url.pathname === "/v1/credits/ledger") {
      return url.searchParams.get("after") === "cur_2" ? list([debit(250_000)]) : list([debit(1_250_000), debit(500_000)], "cur_2");
    }
    if (url.pathname === "/v1/blueprints/installs") return list([install(answers)]);
    return new Response("not found", { status: 404 });
  });
  return seen;
}

/** A browser that opened the app from Naive: the ticket posted to /api/enter, its cookie sent back. */
async function signedIn(): Promise<Request> {
  const form = new FormData();
  form.set("ticket", await mintTicket(ENV.DASHBOARD_TOKEN, { sub: "usr_1", email: "ada@example.com", role: "owner", org: "org_1", app: "app_1", exp: Math.floor(Date.now() / 1000) + 120 }));
  vi.stubEnv("DASHBOARD_TOKEN", ENV.DASHBOARD_TOKEN);
  vi.stubEnv("NAIVE_APP_ID", ENV.NAIVE_APP_ID);
  const entered = await POST(new Request(`${ORIGIN}/api/enter`, { method: "POST", body: form }));
  return new Request(`${ORIGIN}/`, { headers: { cookie: (entered.headers.get("set-cookie") ?? "").split(";")[0]! } });
}

const html = async (response: Response) => {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.text();
};

/** The text of one titled section, or `undefined` when it is not drawn. */
const section = (page: string, title: string) => page.split("<section").find((part) => part.includes(`<h2>${title}</h2>`));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Media manager", () => {
  it("sends a signed-out visitor back through the Studio, and says where to open it when it cannot", async () => {
    const seen = api();
    const out = await overview(new Request(`${ORIGIN}/`), ENV, NOW);
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("https://studio.example/apps/app_1/open");
    const { NAIVE_STUDIO_URL: _gone, ...noStudio } = ENV;
    const lost = await overview(new Request(`${ORIGIN}/`), noStudio, NOW);
    expect(lost.status).toBe(401);
    expect(await lost.text()).toContain("Open Media manager from Naive.");
    // Nothing is read for someone nobody signed in.
    expect(seen).toEqual([]);
  });

  it("draws views, posts this week and spend, then Waiting on you, Scheduled and Posted, from the app's own key", async () => {
    const seen = api();
    const page = await html(await overview(await signedIn(), ENV, NOW));
    const numbers = page.split('<section class="numbers">')[1]!.split("</section>")[0]!;
    // 30 000 + round(8 000.4) in the last 7×24 h, against 19 000 the week before.
    expect(numbers).toContain("<strong>38k</strong>");
    expect(numbers).toContain("+100%");
    // One posted since Monday 00:00 UTC, against "daily".
    expect(numbers).toMatch(/Posts this week<\/span><strong>1<\/strong><span class="muted">of 7<\/span>/);
    // Two ledger pages of debits, followed by their cursor.
    expect(numbers).toContain("<strong>$2.00</strong>");
    expect(page.indexOf("<h2>Waiting on you</h2>")).toBeLessThan(page.indexOf("<h2>Scheduled</h2>"));
    expect(page.indexOf("<h2>Scheduled</h2>")).toBeLessThan(page.indexOf("<h2>Posted</h2>"));
    expect(section(page, "Waiting on you")).toContain("Needs you");
    expect(section(page, "Waiting on you")).toContain('<video class="thumb" src="https://cdn.example/wait.mp4" muted playsinline preload="metadata">');
    const scheduled = section(page, "Scheduled")!;
    expect(scheduled.indexOf("Soon one")).toBeLessThan(scheduled.indexOf("Later one"));
    expect(scheduled).toContain('<img class="thumb" src="https://cdn.example/later.png"');
    const posted = section(page, "Posted")!;
    expect(posted).toContain("30k views");
    expect(posted).toContain("Didn't post");
    expect(posted).toContain('<a href="https://tiktok.example/a" target="_blank" rel="noopener">Open ↗</a>');
    // Newest first: the failed post (created 10-18) sits between a (10-20) and b (10-16).
    expect(posted.indexOf("30k")).toBeLessThan(posted.indexOf("Didn't post"));
    expect(posted.indexOf("Didn't post")).toBeLessThan(posted.indexOf("8k"));
    // Every read is the app's own key, unreconciled, at most 50 per status.
    for (const request of seen) expect(request.headers.get("authorization")).toBe("Bearer sk_live_media_manager");
    const statuses = seen.filter((one) => new URL(one.url).pathname === "/v1/posts").map((one) => new URL(one.url).searchParams);
    expect(statuses.map((one) => one.get("status")).sort()).toEqual(["failed", "pending", "posted", "scheduled"]);
    for (const query of statuses) expect([query.get("limit"), query.get("reconcile")]).toEqual(["50", "false"]);
    const ledger = seen.filter((one) => new URL(one.url).pathname === "/v1/credits/ledger").map((one) => new URL(one.url).searchParams);
    expect(ledger.map((one) => [one.get("type"), one.get("from"), one.get("after")])).toEqual([
      ["debit", "2026-10-14T12:00:00.000Z", null],
      ["debit", "2026-10-14T12:00:00.000Z", "cur_2"],
    ]);
    const installs = seen.find((one) => new URL(one.url).pathname === "/v1/blueprints/installs")!;
    expect(new URL(installs.url).searchParams.get("project")).toBe("my-channel");
  });

  it("hides Waiting on you and Scheduled while empty and says nothing has posted yet", async () => {
    api({}, {});
    const page = await html(await overview(await signedIn(), ENV, NOW));
    expect(page).not.toContain("Waiting on you");
    expect(page).not.toContain("<h2>Scheduled</h2>");
    expect(section(page, "Posted")).toContain("Nothing posted yet.");
    // No cadence answered: the default "3× a week".
    expect(page).toMatch(/Posts this week<\/span><strong>0<\/strong><span class="muted">of 3<\/span>/);
  });

  it("links a waiting post to its chat in Naive, where it is decided", async () => {
    api({ pending: [...CHANNEL.pending!, post({ id: "pst_orphan", status: "pending", content: "No chat" })] });
    const waiting = section(await html(await overview(await signedIn(), ENV, NOW)), "Waiting on you")!;
    expect(waiting).toContain(`<a href="https://studio.example/agents/${AGENT}/sessions/${SESSION}" target="_blank" rel="noopener">Decide in Naive ↗</a>`);
    // A post with no chat to decide it in carries no link.
    expect(waiting.match(/Decide in Naive/g)).toHaveLength(1);
  });

  it("reads every debit up to 20 pages, and says \"at least\" when the week has more", async () => {
    const pageOf = (after: string | null) => (after === null ? 0 : Number(after.slice(4)));
    const stub = (pages: number) => {
      const seen = api();
      const posts = globalThis.fetch;
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(new Request(input, init).url);
        if (url.pathname !== "/v1/credits/ledger") return posts(input, init);
        seen.push(new Request(input, init));
        const n = pageOf(url.searchParams.get("after"));
        return list([debit(1_000_000)], n + 1 < pages ? `cur_${n + 1}` : null);
      });
      return seen;
    };
    const ledgerReads = (seen: Request[]) => seen.filter((one) => new URL(one.url).pathname === "/v1/credits/ledger").length;
    const spentTile = (page: string) => page.split('<span class="label">Spent</span>')[1]!.split("</div>")[0]!;

    // A busy week that ends on page 12: all of it is summed, with no "at least".
    let seen = stub(12);
    let tile = spentTile(await html(await overview(await signedIn(), ENV, NOW)));
    expect(tile).toBe("<strong>$12.00</strong>");
    expect(ledgerReads(seen)).toBe(12);

    // More than 20 pages: the 20 read are summed and the tile says the real figure is higher.
    seen = stub(25);
    tile = spentTile(await html(await overview(await signedIn(), ENV, NOW)));
    expect(tile).toBe('<span class="muted">at least</span><strong>$20.00</strong>');
    expect(ledgerReads(seen)).toBe(20);
  });

  it("says which read failed in its place and still draws the rest", async () => {
    api(CHANNEL, { cadence: "daily" }, "/v1/credits/ledger");
    const page = await html(await overview(await signedIn(), ENV, NOW));
    expect(page).toContain("Couldn&#39;t read spend: the ledger is down");
    expect(page).toContain("<strong>38k</strong>");
    expect(section(page, "Posted")).toContain("Open ↗");
    expect(section(page, "Waiting on you")).toContain("Needs you");
  });

  it("escapes what the crew wrote", async () => {
    api({ pending: [post({ status: "pending", content: `<script>alert("x")</script> & co`, platforms: ["<b>tiktok</b>"] })] });
    const page = await html(await overview(await signedIn(), ENV, NOW));
    expect(page).not.toContain("<script>");
    expect(page).not.toContain("<b>tiktok");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
  });

  it("POST /api/enter turns the platform's ticket into a session", async () => {
    api();
    const request = await signedIn();
    expect(request.headers.get("cookie")).toMatch(/^__Host-naive_session=/);
    expect((await overview(request, ENV, NOW)).status).toBe(200);
    // A ticket for another app is refused.
    const form = new FormData();
    form.set("ticket", await mintTicket(ENV.DASHBOARD_TOKEN, { sub: "usr_1", email: null, role: "owner", org: "org_1", app: "app_2", exp: Math.floor(Date.now() / 1000) + 120 }));
    expect((await POST(new Request(`${ORIGIN}/api/enter`, { method: "POST", body: form }))).status).toBe(401);
  });
});
