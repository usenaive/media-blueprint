/**
 * Media manager: the channel's one page, a hosted app the template ships as source (vetta-mono
 * ADR-1482/1483). It replaces the mini app of 2.x and reads the same things the platform's mini-app
 * sources read, with the app's own read key (`NAIVE_API_KEY`, minted with the read preset, §29.7):
 *
 *   · the numbers: views over the last seven days with their change, posts this week against the
 *     cadence, and what the company spent;
 *   · Waiting on you, only while something does: each post links to its chat in Naive, where it is decided;
 *   · Scheduled, only while something is: one sideways row, soonest first;
 *   · Posted: a picture grid, newest first, each with its views or "Didn't post".
 *
 * One file with no relative imports: the host compiles each function on its own. Agents may pull,
 * change and deploy it like any app.
 */
import { naive, signInUrl, viewer, type AppEnv } from "@usenaive-sdk/app";

type Client = ReturnType<typeof naive>;
type Post = Awaited<ReturnType<Client["social"]["listPosts"]>>["data"][number];
type Read<T> = { ok: true; value: T } | { ok: false; error: string };

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
/** The cadence a company that never said one runs at (`@vetta/core` `DEFAULT_CADENCE`). */
const DEFAULT_CADENCE = "3× a week";
const LEDGER_PAGES = 5;

export const GET = (request: Request) => overview(request, process.env, Date.now());

/** Ported verbatim from `@vetta/core` `sources.ts`: a weekly post count, or `null` when unreadable. */
function perWeek(cadence: string): number | null {
  const said = cadence.trim().toLowerCase();
  if (said === "daily" || said === "every day") return 7;
  if (said === "weekly" || said === "once a week") return 1;
  if (said === "twice a week") return 2;
  const count = /^(\d+)\s*(?:×|x|times)\s*(?:a|per)\s*week$/.exec(said);
  return count ? Number(count[1]) : null;
}

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

const page = (status: number, body: string): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Media manager</title><style>${CSS}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

async function read<T>(what: string, run: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: `Couldn't read ${what}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const posts = (env: AppEnv, status: Post["status"]) =>
  read(`${status} posts`, async () => (await naive(env).social.listPosts({ status, limit: 50, reconcile: false })).data);

/** Debits are negative on the ledger; spend is their size. */
async function spentSince(env: AppEnv, from: string): Promise<number> {
  const client = naive(env);
  let total = 0;
  let after: string | undefined;
  for (let pages = 0; pages < LEDGER_PAGES; pages += 1) {
    const { data, next_cursor } = await client.credits.ledger({ type: "debit", from, limit: 100, ...(after === undefined ? {} : { after }) });
    for (const entry of data) total += Math.abs(entry.amount_micro_usd);
    if (next_cursor === null) break;
    after = next_cursor;
  }
  return total;
}

async function cadenceOf(env: AppEnv): Promise<string> {
  const { data } = await naive(env).apps.installs.list({ project: env["NAIVE_PROJECT"] });
  const said = data[0]?.answers["cadence"];
  return typeof said === "string" && said.trim() !== "" ? said : DEFAULT_CADENCE;
}

const compact = (n: number): string => {
  const short = (x: number) => (x < 10 ? x.toFixed(1).replace(/\.0$/, "") : String(Math.round(x)));
  return n >= 1_000_000 ? `${short(n / 1_000_000)}M` : n >= 1_000 ? `${short(n / 1_000)}k` : String(n);
};

const viewsOf = (post: Post): number | null => (typeof post.metrics?.["views"] === "number" ? Math.round(post.metrics["views"]) : null);
const at = (value: string | null): number => (value === null ? NaN : Date.parse(value));

const failed = (read: Read<unknown>): string => (read.ok ? "" : `<p class="error">${escape(read.error)}</p>`);

function thumb(post: Post): string {
  const url = post.media_urls[0];
  if (url === undefined) return `<div class="thumb"></div>`;
  return /\.(mp4|mov|webm)(\?|#|$)/i.test(url)
    ? `<video class="thumb" src="${escape(url)}" muted playsinline preload="metadata"></video>`
    : `<img class="thumb" src="${escape(url)}" alt="">`;
}

const networks = (post: Post): string => `<span class="muted">${escape(post.platforms.join(" · "))}</span>`;
const caption = (post: Post): string => `<p class="caption">${escape(post.content ?? "")}</p>`;

function decideLink(post: Post, env: AppEnv): string {
  const studio = env["NAIVE_STUDIO_URL"]?.replace(/\/+$/, "");
  if (!studio || !post.agent_id || !post.session_id) return "";
  const href = `${studio}/agents/${encodeURIComponent(post.agent_id)}/sessions/${encodeURIComponent(post.session_id)}`;
  return `<a href="${escape(href)}" target="_blank" rel="noopener">Decide in Naive ↗</a>`;
}

function numbers(posted: Read<Post[]>, spent: Read<number>, cadence: Read<string>, now: number): string {
  let views = failed(posted);
  let week = failed(posted);
  if (posted.ok) {
    const sum = (from: number, to: number) =>
      posted.value.reduce((total, post) => {
        const when = at(post.posted_at);
        const seen = viewsOf(post);
        return when >= from && when < to && seen !== null ? total + seen : total;
      }, 0);
    const current = sum(now - WEEK, Infinity);
    const before = sum(now - 2 * WEEK, now - WEEK);
    const change = before === 0 ? "" : `<span class="muted">${current >= before ? "+" : "−"}${Math.abs(Math.round(((current - before) / before) * 100))}%</span>`;
    views = `<strong>${compact(current)}</strong>${change}`;

    const today = new Date(now);
    const monday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    const count = posted.value.filter((post) => at(post.posted_at) >= monday).length;
    const goal = cadence.ok ? perWeek(cadence.value) : null;
    week = `<strong>${count}</strong>${goal === null ? "" : `<span class="muted">of ${goal}</span>`}${failed(cadence)}`;
  }
  const money = spent.ok ? `<strong>$${(spent.value / 1e6).toFixed(2)}</strong>` : failed(spent);
  const tile = (label: string, body: string) => `<div class="tile"><span class="label">${label}</span>${body}</div>`;
  return `<section class="numbers">${tile("Views", views)}${tile("Posts this week", week)}${tile("Spent", money)}</section>`;
}

function waiting(pending: Read<Post[]>, env: AppEnv): string {
  if (pending.ok && pending.value.length === 0) return "";
  const rows = pending.ok
    ? pending.value
        .map((post) => `<li class="row">${thumb(post)}<div>${caption(post)}${networks(post)}</div><div class="act"><span class="badge">Needs you</span>${decideLink(post, env)}</div></li>`)
        .join("")
    : "";
  return `<section><h2>Waiting on you</h2>${failed(pending)}<ul class="rows">${rows}</ul></section>`;
}

function scheduled(next: Read<Post[]>): string {
  if (next.ok && next.value.length === 0) return "";
  const cards = next.ok
    ? [...next.value]
        .sort((a, b) => at(a.scheduled_at) - at(b.scheduled_at))
        .map((post) => `<li class="card">${thumb(post)}<time>${escape(post.scheduled_at ?? "")}</time>${networks(post)}${caption(post)}</li>`)
        .join("")
    : "";
  return `<section><h2>Scheduled</h2>${failed(next)}<ul class="strip">${cards}</ul></section>`;
}

function postedGrid(posted: Read<Post[]>, failedPosts: Read<Post[]>): string {
  const out = [...(posted.ok ? posted.value : []), ...(failedPosts.ok ? failedPosts.value : [])].sort(
    (a, b) => at(b.posted_at ?? b.created_at) - at(a.posted_at ?? a.created_at),
  );
  const tiles = out
    .map((post) => {
      const seen = viewsOf(post);
      const result = post.status === "failed" ? `<span class="bad">Didn't post</span>` : `<span>${seen === null ? "" : `${compact(seen)} views`}</span>`;
      const open = post.url ? `<a href="${escape(post.url)}" target="_blank" rel="noopener">Open ↗</a>` : "";
      return `<li class="card">${thumb(post)}${networks(post)}${result}${open}</li>`;
    })
    .join("");
  const empty = out.length === 0 && posted.ok && failedPosts.ok ? `<p class="muted">Nothing posted yet.</p>` : "";
  return `<section><h2>Posted</h2>${failed(posted)}${failed(failedPosts)}${empty}<ul class="grid">${tiles}</ul></section>`;
}

/** The page, for `now`. Signed out, it sends the visitor back through Naive, which signs them in. */
export async function overview(request: Request, env: AppEnv, now: number): Promise<Response> {
  if ((await viewer(request, env)) === null) {
    const back = signInUrl(env);
    if (back === null) return page(401, `<main><p>Open Media manager from Naive.</p></main>`);
    return new Response(null, { status: 303, headers: { location: back, "cache-control": "no-store" } });
  }
  const [pending, next, posted, failedPosts, spent, cadence] = await Promise.all([
    posts(env, "pending"),
    posts(env, "scheduled"),
    posts(env, "posted"),
    posts(env, "failed"),
    read("spend", () => spentSince(env, new Date(now - WEEK).toISOString())),
    read("the cadence", () => cadenceOf(env)),
  ]);
  return page(
    200,
    `<main><h1>Media manager</h1>${numbers(posted, spent, cadence, now)}${waiting(pending, env)}${scheduled(next)}${postedGrid(posted, failedPosts)}</main>`,
  );
}

const CSS = `
*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font:14px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px}h1{font-size:20px;margin:0 0 16px}h2{font-size:15px;margin:28px 0 10px}
a{color:#111}.muted{color:#666}.error{color:#a40000}.bad{color:#a40000}
.numbers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.tile{border:1px solid #e5e5e5;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:4px}
.tile strong{font-size:24px}.label{color:#666;font-size:12px}
ul{list-style:none;margin:0;padding:0}.rows .row{display:flex;gap:12px;align-items:center;border-bottom:1px solid #eee;padding:10px 0}
.rows .row>div:nth-child(2){flex:1;min-width:0}.act{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.badge{background:#111;color:#fff;border-radius:999px;padding:2px 8px;font-size:12px}
.caption{margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.strip{display:flex;gap:12px;overflow-x:auto}.strip .card{flex:0 0 180px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.card{display:flex;flex-direction:column;gap:4px}
.thumb{width:72px;aspect-ratio:9/16;object-fit:cover;background:#f2f2f2;border-radius:8px;display:block}
.card .thumb{width:100%}
@media (max-width:560px){.numbers{grid-template-columns:1fr}}
`;
