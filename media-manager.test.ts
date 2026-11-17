/**
 * The channel, the hosted app in `apps/media-manager`, as the host runs it: signed in through Naive's
 * ticket (`mintTicket` + `enter`, §29.10), reading the platform with the app's own key. The API is a
 * stubbed `fetch`; every response is the shape the API answers.
 */
import { mintTicket } from "@usenaive-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./apps/media-manager/api/enter.ts";
import { ALREADY_RUNNING as APP_ALREADY_RUNNING, EPISODES_SHOWN, FIRST_RUN_TITLES, overview } from "./apps/media-manager/api/index.ts";
import { ALREADY_RUNNING, EPISODE_TITLE, EPISODES_FOLDER, FIRST_POST_TITLE, FIRST_VIDEO_TITLE, REFERENCES_TITLE, TOPICS_TITLE } from "./templates/faceless.ts";
import { TEMPLATES } from "./templates/index.ts";

const ORIGIN = "https://media-manager.example";
const ENV = {
  DASHBOARD_TOKEN: "a-long-generated-dashboard-token",
  NAIVE_APP_ID: "app_1",
  NAIVE_STUDIO_URL: "https://studio.example/",
  NAIVE_API_URL: "https://api.example",
  NAIVE_API_KEY: "sk_live_media_manager",
  NAIVE_PROJECT: "my-channel",
};
const CEO = "agt_ceo";
const BOARD = "brd_ceo";

type Fixture = Record<string, unknown>;
type World = {
  answers?: Fixture;
  cards?: Fixture[];
  /** Each card's comments, by card id. */
  comments?: Record<string, Fixture[]>;
  /** Session ids waiting on the person. */
  questions?: string[];
  approvals?: string[];
  /** What `Episodes/` holds, newest first, and each file's words by id. */
  files?: Fixture[];
  texts?: Record<string, string>;
  characters?: Fixture[];
  retired?: Fixture[];
  /** A path that answers 500. */
  broken?: string;
};

let made = 0;
/** A board card. `at` orders them: the API's `created_at`. */
const card = (title: string, over: Fixture = {}): Fixture => {
  made += 1;
  return { id: `crd_${made}`, object: "board_card", board_id: BOARD, title, body: "", note: null, status: "todo", assignee: null, blocked_by: [], woken_session_id: null, created_at: `2026-11-16T00:00:${String(made).padStart(2, "0")}Z`, updated_at: "2026-11-16T09:00:00Z", ...over };
};
const comment = (body: string, at: string): Fixture => ({ id: `bcm_${at}`, object: "board_comment", card_id: "crd_x", author: "ses_1", body, created_at: at });
const filed = (id: string, name: string, folder: string, content_type = "image/png"): Fixture => ({ id, object: "file", name, folder, content_type, created_at: "2026-11-16T00:00:00Z" });
const list = (data: Fixture[], next_cursor: string | null = null) => Response.json({ data, has_more: next_cursor !== null, next_cursor });
const install = (answers: Fixture): Fixture => ({
  id: `bpi_${"0".repeat(26)}`,
  object: "blueprint_install",
  project: "my-channel",
  blueprint: "media",
  template: "faceless",
  revision: 1,
  artifact_version: "3.7.0",
  answers,
  source: "studio",
  report: null,
  status: "applied",
  failure: null,
  applied_at: "2026-10-01T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
});

/**
 * The first run as the board holds it, from the topics card to the first post: each card waits on the
 * one before it. `upTo` cards are done; the next is `doing` on `ses_now`.
 */
function firstRun(upTo: number, over: Partial<Record<"topic" | "script" | "pictures" | "video" | "post", Fixture>> = {}): Fixture[] {
  const steps = ["topic", "script", "pictures", "video", "post"] as const;
  const titles = [TOPICS_TITLE, EPISODE_TITLE, REFERENCES_TITLE, FIRST_VIDEO_TITLE, FIRST_POST_TITLE];
  const notes = ["TOPIC: Founder pivots mid-keynote\nNICHE: comedy", "SLUG: founder-pivots\nfil_script\n# Founder pivots mid-keynote", "STILLS: fil_still_1", "VIDEO: fil_video", "Posted pst_1"];
  const cards: Fixture[] = [];
  steps.forEach((step, at) => {
    const status = at < upTo ? "done" : at === upTo ? "doing" : "blocked";
    cards.push(card(titles[at]!, { status, note: at < upTo ? notes[at] : null, blocked_by: at === 0 ? [] : [cards[at - 1]!["id"]], woken_session_id: at === upTo ? "ses_now" : null, ...over[step] }));
  });
  return cards;
}

/** Stubs the API. Returns every request made. */
function api(world: World = {}) {
  const seen: Request[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push(request);
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === world.broken) return Response.json({ error: { type: "api_error", code: "internal_error", message: "the board is down", request_id: "req_1" } }, { status: 500 });
    if (path === "/v1/blueprints/installs") return list([install(world.answers ?? {})]);
    if (path === "/v1/me") return Response.json({ object: "identity", organization: { id: "org_1", name: "Co", mode: "live" } });
    if (path === "/v1/organizations/org_1") return Response.json({ id: "org_1", object: "organization", ceo_agent_id: CEO });
    if (path === `/v1/boards/${CEO}/cards`) {
      // Pages of 100, as the API answers them.
      const all = world.cards ?? [];
      const start = url.searchParams.get("after") === null ? 0 : all.findIndex((one) => one["id"] === url.searchParams.get("after")) + 1;
      const page = all.slice(start, start + Number(url.searchParams.get("limit")));
      return list(page, start + page.length < all.length ? String(page[page.length - 1]!["id"]) : null);
    }
    const comments = /^\/v1\/boards\/brd_ceo\/cards\/(crd_\w+)\/comments$/.exec(path);
    if (comments) return list(world.comments?.[comments[1]!] ?? []);
    if (path === "/v1/sessions") {
      const reason = url.searchParams.get("stop_reason");
      const ids = reason === "awaiting_answer" ? (world.questions ?? []) : reason === "awaiting_approval" ? (world.approvals ?? []) : [];
      return list(ids.map((id) => ({ id, object: "session", status: "idle", stop_reason: reason })));
    }
    if (path === "/v1/files") return list(world.files ?? []);
    const text = /^\/v1\/files\/(fil_\w+)$/.exec(path);
    if (text && url.searchParams.get("download") === "true" && world.texts?.[text[1]!] !== undefined) return new Response(world.texts[text[1]!]);
    if (path === "/v1/characters") return list(world.characters ?? []);
    const byId = /^\/v1\/characters\/(chr_\w+)$/.exec(path);
    if (byId) {
      const held = [...(world.characters ?? []), ...(world.retired ?? [])].find((one) => one["id"] === byId[1]);
      return held === undefined ? new Response("not found", { status: 404 }) : Response.json(held);
    }
    const minted = /^\/v1\/files\/(fil_\w+)\/url$/.exec(path);
    if (minted && request.method === "POST") {
      const id = minted[1]!;
      return Response.json({ object: "file_url", url: `https://api.example/v1/files/${id}/raw?sig=s`, expires_at: "2026-11-30T00:00:00Z" }, { status: 201 });
    }
    return new Response("not found", { status: 404 });
  });
  return seen;
}

/** A browser that opened the app from Naive: the ticket posted to /api/enter, its cookie sent back. */
async function signedIn(query = ""): Promise<Request> {
  const form = new FormData();
  form.set("ticket", await mintTicket(ENV.DASHBOARD_TOKEN, { sub: "usr_1", email: "ada@example.com", role: "owner", org: "org_1", app: "app_1", exp: Math.floor(Date.now() / 1000) + 120 }));
  vi.stubEnv("DASHBOARD_TOKEN", ENV.DASHBOARD_TOKEN);
  vi.stubEnv("NAIVE_APP_ID", ENV.NAIVE_APP_ID);
  const entered = await POST(new Request(`${ORIGIN}/api/enter`, { method: "POST", body: form }));
  return new Request(`${ORIGIN}/${query}`, { headers: { cookie: (entered.headers.get("set-cookie") ?? "").split(";")[0]! } });
}

const html = async (response: Response) => {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.text();
};
const home = async (world: World = {}, query = "") => {
  api(world);
  return html(await overview(await signedIn(query), ENV));
};
/** The episode cards, newest first, each as its HTML. */
const episodes = (page: string): string[] => page.split('<div class="ep">').slice(1);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the channel", () => {
  it("reads the board by the very titles the first run writes", () => {
    expect(FIRST_RUN_TITLES).toEqual({ topic: TOPICS_TITLE, script: EPISODE_TITLE, pictures: REFERENCES_TITLE, video: FIRST_VIDEO_TITLE, post: FIRST_POST_TITLE });
    expect(APP_ALREADY_RUNNING).toBe(ALREADY_RUNNING);
    expect(EPISODES_FOLDER).toBe("Episodes");
    const first = TEMPLATES.faceless.tasks.slice(0, 5).map((one) => one.title);
    expect(first).toEqual(Object.values(FIRST_RUN_TITLES));
  });

  it("sends a signed-out visitor back through the Studio, and says where to open it when it cannot", async () => {
    const seen = api();
    const out = await overview(new Request(`${ORIGIN}/`), ENV);
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("https://studio.example/apps/app_1/open");
    const { NAIVE_STUDIO_URL: _gone, ...noStudio } = ENV;
    const lost = await overview(new Request(`${ORIGIN}/`), noStudio);
    expect(lost.status).toBe(401);
    expect(await lost.text()).toContain("Open your channel from Naive.");
    expect(seen).toEqual([]);
  });

  it("names the channel by the words the person typed, with its cadence", async () => {
    const page = await home({ answers: { niche: "silicon valley comedy" }, cards: firstRun(0) });
    expect(page).toContain('<div class="kicker">3× a week</div><h1>Silicon Valley Comedy</h1>');
    expect(page).toContain("<title>Silicon Valley Comedy</title>");
    const blank = await home({ answers: { niche: "  ", cadence: "daily" } });
    expect(blank).toContain('<div class="kicker">daily</div><h1>Your channel</h1>');
  });

  it("opens on the first episode being made, after a Create new episode card that asks the CEO", async () => {
    const page = await home({ cards: firstRun(0, { topic: { status: "todo", woken_session_id: null } }) });
    expect(page).toContain('<h2 class="sec">Episodes</h2>');
    const grid = page.split('<div class="grid">')[1]!;
    expect(grid.indexOf("Create new episode")).toBeLessThan(grid.indexOf("Episode #1"));
    expect(page).toContain('<a class="ep" data-bridge href="?say=New%20episode%3A%20">');
    const [first, ...rest] = episodes(page);
    expect(rest).toEqual([]);
    expect(first).toContain('<span class="chip gen"><i></i>Generating</span>');
    expect(first).toContain('<div class="waitline">Finding 4 ideas…</div>');
    expect(first).toContain('<span class="title">Your first episode</span>');
  });

  it("says what the working card said last, skipping the crew's lines for itself", async () => {
    const cards = firstRun(1);
    const seen = api({
      cards,
      comments: { [String(cards[1]!["id"])]: [comment("Hook picked, writing the two scenes now.", "2026-11-16T10:02:00Z"), comment("IDEAS: 1) a 2) b", "2026-11-16T10:03:00Z"), comment("Reading your niche first.", "2026-11-16T10:01:00Z")] },
    });
    const first = episodes(await html(await overview(await signedIn(), ENV)))[0]!;
    expect(first).toContain('<div class="waitline">Hook picked, writing the two scenes now.</div>');
    expect(first).toContain('<span class="title">Founder pivots mid-keynote</span>');
    // Read off the card's own board.
    expect(seen.some((one) => new URL(one.url).pathname === `/v1/boards/${BOARD}/cards/${String(cards[1]!["id"])}/comments`)).toBe(true);
  });

  it("asks for the pick through the studio's sheet: Needs you, Pick a topic, a ?needs= link to the waiting session", async () => {
    const first = episodes(await home({ cards: firstRun(0), questions: ["ses_now"] }))[0]!;
    expect(first).toContain('<span class="chip you"><i></i>Needs you</span>');
    expect(first).toContain('<a class="pill" data-bridge href="?needs=ses_now">Pick a topic</a>');
    // A doing card whose session is not waiting is still being made.
    const working = episodes(await home({ cards: firstRun(0), questions: ["ses_other"] }))[0]!;
    expect(working).toContain("Generating");
    expect(working).not.toContain("?needs=");
  });

  it("shows the stills as they land, and asks for Pick pictures", async () => {
    const first = episodes(
      await home({ cards: firstRun(2), questions: ["ses_now"], files: [filed("fil_still_2", "b.png", "Episodes/founder-pivots"), filed("fil_still_1", "a.png", "Episodes/founder-pivots"), filed("fil_script", "founder-pivots.md", "Episodes", "text/markdown")] }),
    )[0]!;
    expect(first).toContain('<img src="https://api.example/v1/files/fil_still_1/raw?sig=s" alt="" loading="lazy">');
    expect(first).toContain('<span class="line">Pick pictures</span>');
    expect(first).toContain('<a class="pill" data-bridge href="?needs=ses_now">Pick pictures</a>');
  });

  it("says Start your team while the first video waits for a plan, with no link of its own", async () => {
    const cards = firstRun(3, { video: { status: "blocked", woken_session_id: null } });
    const first = episodes(await home({ cards }))[0]!;
    expect(first).toContain("Needs you");
    expect(first).toContain("Start your team");
    expect(first).not.toContain('class="pill"');
    // Only the first video waits for a plan: a later piece's blocked card is still being made.
    const plan = card("Plan: Later piece", { status: "done" });
    const stuck = episodes(await home({ cards: [plan, card("Render: Later piece", { status: "blocked", blocked_by: [plan["id"]] })] }))[0]!;
    expect(stuck).not.toContain("Start your team");
    expect(stuck).toContain("Making the video…");
  });

  it("says Post on the approval, and Connect on the first post's connect question", async () => {
    const files = [filed("fil_video", "final.mp4", "Episodes/founder-pivots", "video/mp4"), filed("fil_still_1", "a.png", "Episodes/founder-pivots")];
    const ready = episodes(await home({ cards: firstRun(4), approvals: ["ses_now"], files }))[0]!;
    expect(ready).toContain('<a class="pill" data-bridge href="?needs=ses_now">Post</a>');
    expect(ready).toContain('<video src="https://api.example/v1/files/fil_video/raw?sig=s#t=0.1" muted playsinline preload="metadata"></video>');
    const connect = episodes(await home({ cards: firstRun(4), questions: ["ses_now"], files }))[0]!;
    expect(connect).toContain('<span class="line">Connect to post</span>');
    expect(connect).toContain('<a class="pill" data-bridge href="?needs=ses_now">Connect</a>');
  });

  it("says Posted with the day, and a skipped connect asks the CEO to post it", async () => {
    const posted = episodes(await home({ cards: firstRun(5) }))[0]!;
    expect(posted).toContain('<span class="chip posted"><i></i>Posted</span>');
    expect(posted).toContain("Posted Nov 16");
    const skipped = episodes(await home({ cards: firstRun(5, { post: { note: "Not posted: no account yet. VIDEO: fil_video" } }) }))[0]!;
    expect(skipped).toContain("Needs you");
    expect(skipped).toContain(`<a class="pill" data-bridge href="?say=${encodeURIComponent("Connect an account and post Episode 1.")}">Connect</a>`);
  });

  it("says Stopped, with Ask CEO, when any of its cards stopped", async () => {
    const first = episodes(await home({ cards: firstRun(4, { video: { note: "STOPPED: the model was busy twice" } }) }))[0]!;
    expect(first).toContain('<span class="chip stopped"><i></i>Stopped</span>');
    expect(first).toContain(`href="?say=${encodeURIComponent("Episode 1 stopped. What happened?")}">Ask CEO</a>`);
  });

  it("draws no first episode on a channel that was already running", async () => {
    const cards = firstRun(1, { topic: { note: `${ALREADY_RUNNING}: this channel already makes videos.` } });
    expect(episodes(await home({ cards }))).toEqual([]);
  });

  it("follows each later piece from its Plan card to its Publish card, numbered oldest first and drawn newest first", async () => {
    const run = firstRun(5);
    const plan = card("Plan: Would you let AI run your standup?", { status: "done" });
    const render = card("Render: AI standup", { status: "doing", blocked_by: [plan["id"]], woken_session_id: "ses_render" });
    const study = card("Study three real channels", { blocked_by: [run[4]!["id"]] });
    const page = await home({ cards: [study, render, ...run, plan], comments: { [String(render["id"])]: [comment("SCENE 1 IMAGE fil_scene_1", "2026-11-16T11:00:00Z"), comment("Rendering scene 2 of 2.", "2026-11-16T11:05:00Z")] } });
    const [second, first] = episodes(page);
    expect(second).toContain("Episode #2");
    expect(second).toContain('<span class="title">Would you let AI run your standup?</span>');
    expect(second).toContain('<img src="https://api.example/v1/files/fil_scene_1/raw?sig=s"');
    expect(second).toContain('<span class="line">Rendering scene 2 of 2.</span>');
    expect(first).toContain("Episode #1");
    expect(first).toContain("Posted");
    // A week-one card is no episode.
    expect(episodes(page)).toHaveLength(2);
  });

  it(`draws at most ${EPISODES_SHOWN} episodes, reading every page of the board`, async () => {
    const plans = Array.from({ length: 150 }, (_, at) => card(`Plan: Piece ${at + 1}`, { status: "done" }));
    const seen = api({ cards: plans });
    const page = await html(await overview(await signedIn(), ENV));
    expect(episodes(page)).toHaveLength(EPISODES_SHOWN);
    expect(episodes(page)[0]).toContain("Episode #150");
    expect(seen.filter((one) => new URL(one.url).pathname === `/v1/boards/${CEO}/cards`)).toHaveLength(2);
  });

  it("opens an episode's page with its steps, its script and its stills", async () => {
    const cards = firstRun(3, { video: { status: "blocked", woken_session_id: null } });
    const files = [filed("fil_still_2", "b.png", "Episodes/founder-pivots"), filed("fil_still_1", "a.png", "Episodes/founder-pivots"), filed("fil_script", "founder-pivots.md", "Episodes", "text/markdown")];
    const page = await home({ cards, files, texts: { fil_script: "# Founder pivots mid-keynote\n\nScene 1 · 4 s. <A founder> on stage." } }, `?episode=${String(cards[0]!["id"])}`);
    expect(page).toContain('<a class="back" href="?">← Episodes</a>');
    expect(page).toContain("<h2>Founder pivots mid-keynote</h2>");
    expect(page).toContain('<li class="step done"><i></i>Topic</li><li class="step done"><i></i>Script</li><li class="step done"><i></i>Pictures</li><li class="step now"><i></i>Video · Start your team</li><li class="step "><i></i>Post</li>');
    expect(page).toContain("Scene 1 · 4 s. &lt;A founder&gt; on stage.");
    expect(page.indexOf("fil_still_1/raw")).toBeLessThan(page.indexOf("fil_still_2/raw"));
    expect(page).not.toContain('<h2 class="sec">Episodes</h2>');
  });

  it("writes nothing: every read is a GET, and the only other call mints a file's link", async () => {
    const cards = firstRun(2);
    const seen = api({ cards, questions: ["ses_now"], files: [filed("fil_still_1", "a.png", "Episodes/founder-pivots")] });
    await html(await overview(await signedIn(), ENV));
    for (const one of seen) {
      if (one.method !== "GET") expect([one.method, new URL(one.url).pathname]).toEqual(["POST", "/v1/files/fil_still_1/url"]);
      expect(one.headers.get("authorization")).toBe(`Bearer ${ENV.NAIVE_API_KEY}`);
    }
  });

  it("hands its links to the studio: naive:ready once, then naive:open for each marked link, to the studio's origin only", async () => {
    const page = await home({ cards: firstRun(0), questions: ["ses_now"] });
    const script = page.split("<script>")[1]!.split("</script>")[0]!;
    expect(script).toContain('const to="https://studio.example"');
    expect(script).toContain('parent.postMessage({type:"naive:ready"},to)');
    expect(script).toContain('event.target.closest("a[data-bridge]")');
    expect(script).toContain('parent.postMessage({type:"naive:open",href:link.getAttribute("href")},to)');
    // Every outward link is one of the two the studio allows; the rest stay in the app, on its home and an episode's page.
    const cards = firstRun(0);
    const opened = await home({ cards, questions: ["ses_now"] }, `?episode=${String(cards[0]!["id"])}`);
    for (const one of [page, opened]) {
      for (const [, href] of one.matchAll(/<a [^>]*href="([^"]*)"/g)) expect(href!, href).toMatch(/^\?(needs=|say=|episode=|$)/);
      expect(one).not.toContain('target="_blank"');
    }
    expect(opened).toContain('<a class="pill" data-bridge href="?needs=ses_now">Pick a topic</a>');
  });

  it("follows the system's dark mode, and draws no ring anywhere", async () => {
    const page = await home({ cards: firstRun(0) });
    expect(page).toContain("@media (prefers-color-scheme:dark)");
    const css = page.split("<style>")[1]!.split("</style>")[0]!;
    expect(css).toContain("a{color:inherit;text-decoration:none;outline:none}a:focus-visible{opacity:.6}");
    expect(css.match(/outline:(?!none)/g)).toBeNull();
    expect(css).not.toMatch(/box-shadow/);
  });

  it("says which read failed in its place and still draws the rest", async () => {
    const page = await home({ cards: firstRun(0), broken: `/v1/boards/${CEO}/cards` });
    expect(page).toContain("Couldn&#39;t read the board: the API answered 500");
    expect(page).toContain("Create new episode");
  });

  it("escapes what the crew wrote", async () => {
    const page = await home({ answers: { niche: `<b>x</b>` }, cards: firstRun(1, { topic: { note: `TOPIC: <script>alert("x")</script> & co` } }) });
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("<b>x");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
  });

  describe("a creator's channel", () => {
    const PRIYA = { id: "chr_priya", name: "Priya Raman", status: "ready", scope: "platform", persona: { niche: "Founder · build in public" }, sheet: ["/setup/characters/priya-raman.jpg"], source_images: [] };
    const MINE = { id: "chr_mine", name: "Lou", status: "ready", scope: "organization", persona: { niche: "Birdwatching" }, sheet: [], source_images: ["https://elsewhere.example/me.jpg", "fil_still_me"] };

    it("leads with the prebuilt creator's face, name and niche", async () => {
      const page = await home({ answers: { character: "Priya Raman" }, characters: [{ ...MINE, name: "Priya Raman" }, PRIYA] });
      const header = page.split('<header class="chead">')[1]!.split("</header>")[0]!;
      expect(header).toContain('src="https://studio.example/setup/characters/priya-raman.jpg"');
      expect(header).toContain("<h1>Priya Raman</h1>");
      expect(header).toContain("Founder · build in public");
    });

    it("finds a trained face by its setup answer, and never loads a link elsewhere as its picture", async () => {
      const page = await home({ answers: { character: "Upload your own photos" }, characters: [PRIYA, { ...MINE, id: "chr_bad", status: "failed", name: "Lost" }, MINE] });
      expect(page).toContain("<h1>Lou</h1>");
      expect(page).toContain('src="https://api.example/v1/files/fil_still_me/raw?sig=s"');
      expect(page).not.toContain("elsewhere.example");
    });

    it("keeps a channel installed before its creator was re-faced on the retired id it started with (ADR-1812)", async () => {
      const NEW = { ...PRIYA, id: "chr_bb1xr9kn5tav3nqbgq5w2p8g61", created_at: "2026-11-05T00:00:00Z" };
      const OLD = { ...PRIYA, id: "chr_0yxd67hvgwsz9xg8mrbbc1q33r", sheet: ["/setup/characters/retired/priya-raman.jpg"], created_at: "2026-09-01T00:00:00Z" };
      expect(await home({ answers: { character: "Priya Raman" }, characters: [NEW], retired: [OLD] })).toContain('src="https://studio.example/setup/characters/retired/priya-raman.jpg"');
    });

    it("picks the face trained since this channel was installed, not the org's first one", async () => {
      const OTHER = { ...MINE, id: "chr_other", name: "Kim", created_at: "2026-09-10T00:00:00Z" };
      const OURS = { ...MINE, created_at: "2026-10-01T00:20:00Z" };
      const page = await home({ answers: { character: "Upload your own photos" }, characters: [OTHER, OURS] });
      expect(page).toContain("<h1>Lou</h1>");
      expect(page).not.toContain("<h1>Kim</h1>");
    });

    it("says a face is still training", async () => {
      expect(await home({ answers: { character: "Upload your own photos" }, characters: [{ ...MINE, status: "training" }] })).toContain("Training · about 20 min");
    });

    it("says it can't read the creator in place, and still draws the channel", async () => {
      const page = await home({ answers: { character: "Priya Raman" }, broken: "/v1/characters" });
      expect(page).toContain("Couldn&#39;t read the creator");
      expect(page).toContain("<h1>Your channel</h1>");
    });
  });

  it("POST /api/enter turns the platform's ticket into a session", async () => {
    api();
    const request = await signedIn();
    expect(request.headers.get("cookie")).toMatch(/^__Host-naive_session=/);
    expect((await overview(request, ENV)).status).toBe(200);
    const form = new FormData();
    form.set("ticket", await mintTicket(ENV.DASHBOARD_TOKEN, { sub: "usr_1", email: null, role: "owner", org: "org_1", app: "app_2", exp: Math.floor(Date.now() / 1000) + 120 }));
    expect((await POST(new Request(`${ORIGIN}/api/enter`, { method: "POST", body: form }))).status).toBe(401);
  });
});
