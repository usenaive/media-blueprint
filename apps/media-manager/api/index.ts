/**
 * Media manager: the channel's one page, a hosted app the template ships as source (vetta-mono
 * ADR-1482/1483). It replaces the mini app of 2.x and reads the same things the platform's mini-app
 * sources read, with the app's own read key (`NAIVE_API_KEY`, minted with the read preset, §29.7):
 *
 *   · the creator, on a channel that has one (AI Influencer): their face, name and niche, with a way to them in Naive;
 *   · Connect an account, only while nothing has gone out and no account is connected;
 *   · References, only while there are some: each episode's script under `Episodes/`, with its stills;
 *   · the numbers: views over the last seven days with their change, posts this week against the
 *     cadence, and what the company spent;
 *   · Waiting on you, only while something does: each post links to its chat in Naive, where it is decided;
 *   · Scheduled, only while something is: one sideways row, soonest first;
 *   · Stills and clips, only for a creator with some: the newest things rendered as them;
 *   · Posted: a picture grid, newest first, each with its views or "Didn't post";
 *   · Styles, on a faceless channel: other channels' looks, looping, each opening a player with one
 *     "Recreate this style".
 *
 * One file with no relative imports: the host compiles each function on its own. Agents may pull,
 * change and deploy it like any app.
 */
import { naive, signInUrl, viewer, type AppEnv } from "@usenaive-sdk/app";

type Client = ReturnType<typeof naive>;
type Post = Awaited<ReturnType<Client["social"]["listPosts"]>>["data"][number];
type Read<T> = { ok: true; value: T } | { ok: false; error: string };
/** A file's short-lived address by its `fil_` id. A stored post carries ids, never `media_urls` (§27.1). */
type Links = ReadonlyMap<string, string>;
/** The fields of `GET /v1/characters` this page draws. The client this app is built on has no `characters` yet. */
type Creator = {
  id: string;
  name: string;
  status: string;
  scope?: string;
  persona: { niche?: string | null } | null;
  sheet: string[];
  source_images: string[];
  created_at?: string;
};

/**
 * The prebuilt creators that were re-faced under new ids (vetta-mono ADR-1812), by name: the earlier id a
 * channel installed before the new face was seeded keeps. It is off the characters list but still read by id.
 */
const RETIRED_CREATORS: Readonly<Record<string, string>> = {
  "Priya Raman": "chr_0yxd67hvgwsz9xg8mrbbc1q33r",
  "Maya Elusing": "chr_25ptp43961zfpgg5a5jbz4d38z",
  "Hank Delgado": "chr_kxynfvnew54p253d24zq1h1457",
  "Ava Lindqvist": "chr_t6afyfc7ztb6a6jnj04sdj2x1t",
};

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
/** The cadence a company that never said one runs at (`@vetta/core` `DEFAULT_CADENCE`). */
const DEFAULT_CADENCE = "3× a week";
/** Ledger pages of 100 debits read for "Spent"; past this the tile says "at least". */
const LEDGER_PAGES = 20;
/** Each tile on the page mints one file link when it opens, so the page draws a bounded number of them. */
const POSTED_SHOWN = 12;
const RENDERS_SHOWN = 12;
/** Every link is a signed read and an audit row, so a long queue signs its first few and the rest wait their turn. */
const LINKED_SHOWN = 12;
/** The newest episode files and stills the References strip reads; the scripts are read for their STILLS line. */
const EPISODE_FILES = 40;
const EPISODES_SHOWN = 3;
/** Identities asked for an account, only while nothing has gone out. */
const IDENTITIES_ASKED = 10;
/** The clock every posting slot is stated in (`CHANNEL_TIMEZONE` in `templates/template.ts`). */
const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });

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

/**
 * Only `scheduled` asks the provider first (§27.1, at most five due posts a read, each once in five
 * minutes). That read is the one that settles a post into posted or failed, so a refused post never
 * sits in Scheduled, and nothing else on the page needs to ask again.
 */
const posts = (env: AppEnv, status: Post["status"]) =>
  read(`${status} posts`, async () => (await naive(env).social.listPosts({ status, limit: 50, reconcile: status === "scheduled" })).data);

async function rest<T>(env: AppEnv, path: string): Promise<T> {
  const response = await fetch(`${env["NAIVE_API_URL"]?.replace(/\/+$/, "")}${path}`, { headers: { authorization: `Bearer ${env["NAIVE_API_KEY"]}` } });
  if (!response.ok) throw Object.assign(new Error(`the API answered ${response.status}`), { status: response.status });
  return (await response.json()) as T;
}

type Spent = { micro: number; complete: boolean };

/** Debits are negative on the ledger; spend is their size. `complete` is false when debits were left unread. */
async function spentSince(env: AppEnv, from: string): Promise<Spent> {
  const client = naive(env);
  let micro = 0;
  let after: string | undefined;
  for (let pages = 0; pages < LEDGER_PAGES; pages += 1) {
    const { data, next_cursor } = await client.credits.ledger({ type: "debit", from, limit: 100, ...(after === undefined ? {} : { after }) });
    for (const entry of data) micro += Math.abs(entry.amount_micro_usd);
    if (next_cursor === null) return { micro, complete: true };
    after = next_cursor;
  }
  return { micro, complete: false };
}

type Answers = Readonly<Record<string, unknown>>;
/** The channel's setup answers, its template, and when it was installed (`null` when the API didn't say). */
type Setup = { answers: Answers; template: string | null; installedAt: string | null };

const setupOf = async (env: AppEnv): Promise<Setup> => {
  const install = (await naive(env).apps.installs.list({ project: env["NAIVE_PROJECT"] })).data[0] as { answers?: Answers; template?: unknown; created_at?: unknown } | undefined;
  return {
    answers: install?.answers ?? {},
    template: typeof install?.template === "string" ? install.template : null,
    installedAt: typeof install?.created_at === "string" ? install.created_at : null,
  };
};

const madeAt = (one: Creator): number => (one.created_at === undefined ? Number.NaN : Date.parse(one.created_at));

/**
 * Who a setup's `character` answer means. A prebuilt creator is theirs by name, unless the channel was
 * installed before that face was seeded: then it is the retired id it started on (`retired`). Characters are
 * the org's, not the company's, so a trained face is the first one made since this channel was installed,
 * and only with no such face the org's first ready one.
 */
const creatorOf = (all: readonly Creator[], answer: string, installedAt: string | null): { creator: Creator | null; retired: string | null } => {
  const prebuilt = all.find((one) => one.scope === "platform" && one.name === answer);
  if (prebuilt !== undefined) {
    const earlier = RETIRED_CREATORS[answer];
    const before = installedAt !== null && Date.parse(installedAt) < madeAt(prebuilt);
    return earlier !== undefined && earlier !== prebuilt.id && before ? { creator: null, retired: earlier } : { creator: prebuilt, retired: null };
  }
  const own = all.filter((one) => one.scope !== "platform" && one.status !== "failed");
  const since = installedAt === null ? [] : own.filter((one) => madeAt(one) >= Date.parse(installedAt)).sort((a, b) => madeAt(a) - madeAt(b));
  return { creator: since[0] ?? own.find((one) => one.status === "ready") ?? own[0] ?? null, retired: null };
};

/** The creator a channel's answer means, reading a retired prebuilt creator by its id. */
async function creatorFor(env: AppEnv, answer: string, installedAt: string | null): Promise<Creator | null> {
  const found = creatorOf((await rest<{ data: Creator[] }>(env, "/v1/characters?limit=100")).data, answer, installedAt);
  return found.retired === null ? found.creator : rest<Creator>(env, `/v1/characters/${encodeURIComponent(found.retired)}`);
}

/**
 * The cadence the tile counts against, or `null` when this page can't know it. A creator's channel asks
 * none and the operator can change it in chat, on the board, so its tile is a count: better than a wrong goal.
 */
function cadenceOf(answers: Answers): string | null {
  const said = answers["cadence"];
  if (typeof said === "string" && said.trim() !== "") return said;
  return typeof answers["character"] === "string" ? null : DEFAULT_CADENCE;
}

/** Whether any identity holds an account. An identity that never activated social is a 4xx, which means no. */
async function hasAccount(env: AppEnv): Promise<boolean> {
  const { data } = await rest<{ data: { id: string }[] }>(env, `/v1/identities?limit=${IDENTITIES_ASKED}`);
  for (const identity of data) {
    try {
      if ((await rest<{ data: unknown[] }>(env, `/v1/identities/${encodeURIComponent(identity.id)}/social/accounts`)).data.length > 0) return true;
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      if (typeof status !== "number" || status >= 500) throw error;
    }
  }
  return false;
}

/** A failed link leaves its tile blank rather than failing the page. */
async function linksFor(env: AppEnv, ids: readonly string[]): Promise<Links> {
  const client = naive(env);
  const found = await Promise.all(
    [...new Set(ids)].map(async (id) => {
      try {
        return [id, (await client.files.url(id)).url] as const;
      } catch {
        return null;
      }
    }),
  );
  return new Map(found.filter((one) => one !== null));
}

const compact = (n: number): string => {
  const short = (x: number) => (x < 10 ? x.toFixed(1).replace(/\.0$/, "") : String(Math.round(x)));
  return n >= 1_000_000 ? `${short(n / 1_000_000)}M` : n >= 1_000 ? `${short(n / 1_000)}k` : String(n);
};

const viewsOf = (post: Post): number | null => (typeof post.metrics?.["views"] === "number" ? Math.round(post.metrics["views"]) : null);
const at = (value: string | null): number => (value === null ? NaN : Date.parse(value));
const when = (value: string | null): string => (value === null || Number.isNaN(Date.parse(value)) ? "" : WHEN.format(Date.parse(value)));

const failed = (read: Read<unknown>): string => (read.ok ? "" : `<p class="error">${escape(read.error)}</p>`);

function picture(url: string | undefined): string {
  if (url === undefined) return `<div class="thumb"></div>`;
  // `#t=` paints the first frame where a browser would otherwise leave a loaded video blank.
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url)
    ? `<video class="thumb" src="${escape(url)}#t=0.1" muted playsinline preload="metadata"></video>`
    : `<img class="thumb" src="${escape(url)}" alt="" loading="lazy">`;
}

const thumb = (post: Post, links: Links): string => picture(post.media_urls[0] ?? links.get(post.file_ids[0] ?? ""));

const networks = (post: Post): string => `<span class="muted">${escape(post.platforms.join(" · "))}</span>`;
const caption = (post: Post): string => `<p class="caption">${escape(post.content ?? "")}</p>`;

function decideLink(post: Post, env: AppEnv): string {
  const studio = env["NAIVE_STUDIO_URL"]?.replace(/\/+$/, "");
  if (!studio || !post.agent_id || !post.session_id) return "";
  const href = `${studio}/agents/${encodeURIComponent(post.agent_id)}/sessions/${encodeURIComponent(post.session_id)}`;
  return `<a href="${escape(href)}" target="_blank" rel="noopener">Decide in Naive ↗</a>`;
}

function numbers(posted: Read<Post[]>, spent: Read<Spent>, cadence: Read<string | null>, now: number): string {
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
    const goal = cadence.ok && cadence.value !== null ? perWeek(cadence.value) : null;
    week = `<strong>${count}</strong>${goal === null ? "" : `<span class="muted">of ${goal}</span>`}${failed(cadence)}`;
  }
  const money = spent.ok
    ? `${spent.value.complete ? "" : `<span class="muted">at least</span>`}<strong>$${(spent.value.micro / 1e6).toFixed(2)}</strong>`
    : failed(spent);
  const tile = (label: string, body: string) => `<div class="tile"><span class="label">${label}</span>${body}</div>`;
  return `<section class="numbers">${tile("Views", views)}${tile("Posts this week", week)}${tile("Spent", money)}</section>`;
}

const studioOf = (env: AppEnv): string | null => env["NAIVE_STUDIO_URL"]?.replace(/\/+$/, "") || null;

/** A prebuilt's first sheet still is a path on the studio; a trained face's first photo is a stored file. Any other link is never loaded. */
function faceOf(creator: Creator, env: AppEnv, links: Links): string | undefined {
  const path = creator.sheet.find((one) => one.startsWith("/") && !one.startsWith("//"));
  const studio = studioOf(env);
  if (path !== undefined && studio !== null) return `${studio}${path}`;
  const file = creator.source_images.find((one) => one.startsWith("fil_"));
  return file === undefined ? undefined : links.get(file);
}

function head(creator: Read<Creator | null>, env: AppEnv, links: Links): string {
  if (!creator.ok || creator.value === null) return `<h1>Media manager</h1>${failed(creator)}`;
  const one = creator.value;
  const face = faceOf(one, env, links);
  const line = one.status === "training" ? "Training · about 20 min" : (one.persona?.niche ?? "");
  const studio = studioOf(env);
  const manage = studio === null ? "" : `<a href="${escape(`${studio}/orchestrator?pane=characters&character=${encodeURIComponent(one.id)}`)}" target="_blank" rel="noopener">Manage in Naive ↗</a>`;
  return `<header class="creator">${face === undefined ? `<div class="face"></div>` : `<img class="face" src="${escape(face)}" alt="">`}<div class="who"><h1>${escape(one.name)}</h1><span class="muted">${escape(line)}</span></div>${manage}</header>`;
}

/**
 * The channel manager asks on a connect card in the chat, so that is where this points. A framed app
 * cannot open that card or navigate the studio (its frame has no top navigation), so the fallback is
 * the studio's Connections in a new tab.
 */
function connect(account: Read<boolean> | null, env: AppEnv): string {
  if (account === null || (account.ok && account.value)) return "";
  if (!account.ok) return failed(account);
  const studio = studioOf(env);
  const open = studio === null ? "" : `<a href="${escape(`${studio}/connections`)}" target="_blank" rel="noopener">Connections ↗</a>`;
  return `<section class="connect"><div><span class="title">Connect an account</span><span class="muted">Tap Connect on the card in your chat. Nothing posts until one is connected.</span></div>${open}</section>`;
}

/** A file under `Episodes/`, as `GET /v1/files` lists it. */
type EpisodeFile = { id: string; name: string; content_type: string; folder?: string | null; created_at?: string };
/** One episode: its script's title, the stills it picked (`STILLS:`), and every still in its folder. */
type Episode = { title: string; picked: string[]; stills: string[] };

const isScript = (file: EpisodeFile): boolean => /\.md$/i.test(file.name);
const isStill = (file: EpisodeFile): boolean => file.content_type.startsWith("image/");

/** A script's words, read with the app's own key (`?download=true`): only its title and STILLS line are used. */
async function scriptText(env: AppEnv, id: string): Promise<string> {
  const response = await fetch(`${env["NAIVE_API_URL"]?.replace(/\/+$/, "")}/v1/files/${encodeURIComponent(id)}?download=true`, { headers: { authorization: `Bearer ${env["NAIVE_API_KEY"]}` } });
  if (!response.ok) throw new Error(`the API answered ${response.status}`);
  return response.text();
}

/**
 * The episodes the crew filed: `Episodes/<topic>.md` and its stills in `Episodes/<topic>/`. A script is
 * filed again once its stills are picked, so the newest of a name is the episode. Newest first.
 */
async function episodesOf(env: AppEnv): Promise<Episode[]> {
  const files = (await rest<{ data: EpisodeFile[] }>(env, `/v1/files?folder=Episodes&subfolders=true&order=desc&limit=${EPISODE_FILES}`)).data;
  const scripts = new Map<string, EpisodeFile>();
  for (const file of files.filter(isScript)) if (!scripts.has(file.name)) scripts.set(file.name, file);
  return Promise.all(
    [...scripts.values()].slice(0, EPISODES_SHOWN).map(async (script) => {
      const topic = script.name.replace(/\.md$/i, "");
      const text = await scriptText(env, script.id).catch(() => "");
      const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || topic;
      const picked = /^STILLS:(.*)$/m.exec(text)?.[1]?.match(/fil_\w+/g) ?? [];
      const stills = files.filter((file) => isStill(file) && file.folder === `Episodes/${topic}`).map((file) => file.id);
      return { title, picked, stills };
    }),
  );
}

/** The picked stills first and whole; the rest dimmed until a pick names them. */
function references(episodes: Read<Episode[]>, links: Links): string {
  if (episodes.ok && episodes.value.length === 0) return "";
  const rows = episodes.ok
    ? episodes.value
        .map((one) => {
          const order = [...one.picked, ...one.stills.filter((id) => !one.picked.includes(id))];
          const dim = (id: string) => (one.picked.length > 0 && !one.picked.includes(id) ? " dim" : "");
          const cards = order.map((id) => `<li class="card${dim(id)}">${picture(links.get(id))}</li>`).join("");
          const said = one.picked.length > 0 ? `${one.picked.length} picked` : one.stills.length > 0 ? "Pick in your chat" : "Script ready";
          return `<div class="episode"><p><span class="title">${escape(one.title)}</span> <span class="muted">${said}</span></p><ul class="strip">${cards}</ul></div>`;
        })
        .join("")
    : "";
  return `<section><h2>References</h2>${failed(episodes)}${rows}</section>`;
}

/**
 * OTHER CHANNELS' LOOKS (owner, 2026-11-16: "lots of inspiration underneath", the way a faceless studio
 * shows what it made). Each is a template of this blueprint built on `faceless`. The clips and posters
 * are the site's own style files, linked rather than shipped, so the app carries none of their bytes.
 */
export const STYLE_MEDIA = "https://usenaive.ai/styles";
export const STYLES: readonly { template: string; title: string; niche: string }[] = [
  { template: "history", title: "History in Color", niche: "History" },
  { template: "ufc", title: "UFC Fights", niche: "Sports" },
  { template: "animal-feast", title: "Animals Eating", niche: "Animals" },
  { template: "cat-stories", title: "Cat Stories", niche: "Stories" },
  { template: "fruit-drama", title: "Fruit Drama", niche: "Drama" },
  { template: "glass-food", title: "Glass Food", niche: "ASMR" },
  { template: "food-slime", title: "Food to Slime", niche: "ASMR" },
  { template: "dancing-animals", title: "Dancing Animals", niche: "Animals" },
  { template: "roadster", title: "Impossible Roadster", niche: "Cars" },
  { template: "cartoons-irl", title: "Cartoons IRL", niche: "Cartoons" },
  { template: "comics", title: "Comics", niche: "Stories" },
  { template: "would-you-choose", title: "Would You Choose", niche: "Games" },
  { template: "empires", title: "Empires", niche: "History" },
  { template: "channel-cloning", title: "Channel Cloning", niche: "Any niche" },
];

/**
 * Tapped, a style opens in a player here, in the panel, with one action. Recreate cannot fill the CEO's
 * box from inside a frame, so it opens the style's setup in Naive: a new channel in that look.
 */
function styles(setup: Read<Setup>, env: AppEnv): string {
  const template = setup.ok ? setup.value.template : null;
  const studio = studioOf(env);
  if (studio === null || (template !== "faceless" && !STYLES.some((one) => one.template === template))) return "";
  const shown = STYLES.filter((one) => one.template !== template);
  const tiles = shown
    .map(
      (one) =>
        `<li><button class="style" type="button" data-open="style-${one.template}"><video src="${STYLE_MEDIA}/${one.template}.mp4" poster="${STYLE_MEDIA}/${one.template}.jpg" muted loop playsinline preload="none"></video><span class="title">${escape(one.title)}</span><span class="muted">${escape(one.niche)}</span></button></li>`,
    )
    .join("");
  const players = shown
    .map((one) => {
      const recreate = `${studio}/setup?${new URLSearchParams({ blueprint: "media", template: one.template })}`;
      return `<dialog id="style-${one.template}" class="player"><video src="${STYLE_MEDIA}/${one.template}.mp4" poster="${STYLE_MEDIA}/${one.template}.jpg" controls playsinline loop preload="none"></video><div class="who"><span class="title">${escape(one.title)}</span><span class="muted">${escape(one.niche)}</span></div><a class="recreate" href="${escape(recreate)}" target="_blank" rel="noopener">Recreate this style</a><form method="dialog"><button class="close" type="submit">Close</button></form></dialog>`;
    })
    .join("");
  return `<section><h2>Styles</h2><ul class="styles">${tiles}</ul>${players}<script>${STYLE_SCRIPT}</script></section>`;
}

/** Play what is on screen, open a style's player with its sound, and stop it when it closes. */
const STYLE_SCRIPT = `(()=>{const seen=new IntersectionObserver((all)=>{for(const one of all){if(one.isIntersecting)one.target.play().catch(()=>{});else one.target.pause();}});for(const clip of document.querySelectorAll(".style video"))seen.observe(clip);for(const tile of document.querySelectorAll(".style"))tile.addEventListener("click",()=>{const box=document.getElementById(tile.dataset.open);box.showModal();box.querySelector("video").play().catch(()=>{});});for(const box of document.querySelectorAll(".player")){box.addEventListener("close",()=>box.querySelector("video").pause());box.addEventListener("click",(event)=>{if(event.target===box)box.close();});}})();`;

function renders(files: Read<{ id: string }[]> | null, links: Links): string {
  if (files === null || (files.ok && files.value.length === 0)) return "";
  const cards = files.ok
    ? files.value
        .map((file) => {
          const url = links.get(file.id);
          return `<li class="card">${url === undefined ? picture(undefined) : `<a href="${escape(url)}" target="_blank" rel="noopener">${picture(url)}</a>`}</li>`;
        })
        .join("")
    : "";
  return `<section><h2>Stills and clips</h2>${failed(files)}<ul class="strip">${cards}</ul></section>`;
}

function waiting(pending: Read<Post[]>, env: AppEnv, links: Links): string {
  if (pending.ok && pending.value.length === 0) return "";
  const rows = pending.ok
    ? pending.value
        .map((post) => `<li class="row">${thumb(post, links)}<div>${caption(post)}${networks(post)}</div><div class="act"><span class="badge">Needs you</span>${decideLink(post, env)}</div></li>`)
        .join("")
    : "";
  return `<section><h2>Waiting on you</h2>${failed(pending)}<ul class="rows">${rows}</ul></section>`;
}

function scheduled(next: Read<Post[]>, links: Links): string {
  if (next.ok && next.value.length === 0) return "";
  const cards = next.ok
    ? [...next.value]
        .sort((a, b) => at(a.scheduled_at) - at(b.scheduled_at))
        .map((post) => `<li class="card">${thumb(post, links)}<time>${escape(when(post.scheduled_at))}</time>${networks(post)}${caption(post)}</li>`)
        .join("")
    : "";
  return `<section><h2>Scheduled</h2>${failed(next)}<ul class="strip">${cards}</ul></section>`;
}

/** The Posted tiles: newest first, as many as the page draws. */
const postedShown = (posted: Read<Post[]>, failedPosts: Read<Post[]>): Post[] =>
  [...(posted.ok ? posted.value : []), ...(failedPosts.ok ? failedPosts.value : [])]
    .sort((a, b) => at(b.posted_at ?? b.created_at) - at(a.posted_at ?? a.created_at))
    .slice(0, POSTED_SHOWN);

function postedGrid(posted: Read<Post[]>, failedPosts: Read<Post[]>, links: Links): string {
  const out = postedShown(posted, failedPosts);
  const tiles = out
    .map((post) => {
      const seen = viewsOf(post);
      const result = post.status === "failed" ? `<span class="bad">Didn't post</span>` : `<span>${seen === null ? "" : `${compact(seen)} views`}</span>`;
      const open = post.url ? `<a href="${escape(post.url)}" target="_blank" rel="noopener">Open ↗</a>` : "";
      return `<li class="card">${thumb(post, links)}<time>${escape(when(post.posted_at ?? post.created_at))}</time>${networks(post)}${result}${open}</li>`;
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
  // First, as this is the read that settles a post: the ones after it see what it settled.
  const next = await posts(env, "scheduled");
  const [pending, posted, failedPosts, spent, setup] = await Promise.all([
    posts(env, "pending"),
    posts(env, "posted"),
    posts(env, "failed"),
    read("spend", () => spentSince(env, new Date(now - WEEK).toISOString())),
    read("the channel's setup", () => setupOf(env)),
  ]);
  const answer = setup.ok ? setup.value.answers["character"] : undefined;
  const creator: Read<Creator | null> =
    typeof answer === "string" && setup.ok
      ? await read("the creator", () => creatorFor(env, answer, setup.value.installedAt))
      : { ok: true, value: null };
  const nothingYet = [next, pending, posted].every((one) => one.ok && one.value.length === 0);
  const [made, account, episodes] = await Promise.all([
    creator.ok && creator.value !== null
      ? read("the creator's renders", async () => (await rest<{ data: { id: string }[] }>(env, `/v1/files?character=${encodeURIComponent(creator.value!.id)}&order=desc&limit=${RENDERS_SHOWN}`)).data)
      : null,
    nothingYet ? read("the connected accounts", () => hasAccount(env)) : null,
    read("the episodes", () => episodesOf(env)),
  ]);
  const links = await linksFor(env, [
    ...[...(pending.ok ? pending.value.slice(0, LINKED_SHOWN) : []), ...(next.ok ? next.value.slice(0, LINKED_SHOWN) : []), ...postedShown(posted, failedPosts)].flatMap((post) => (post.media_urls[0] === undefined && post.file_ids[0] !== undefined ? [post.file_ids[0]] : [])),
    ...(made?.ok ? made.value.map((file) => file.id) : []),
    ...(episodes.ok ? episodes.value.flatMap((one) => [...one.picked, ...one.stills]) : []),
    ...(creator.ok && creator.value !== null && creator.value.sheet.length === 0 ? creator.value.source_images.filter((one) => one.startsWith("fil_")).slice(0, 1) : []),
  ]);
  const cadence: Read<string | null> = setup.ok ? { ok: true, value: cadenceOf(setup.value.answers) } : setup;
  return page(
    200,
    `<main>${head(creator, env, links)}${connect(account, env)}${references(episodes, links)}${numbers(posted, spent, cadence, now)}${waiting(pending, env, links)}${scheduled(next, links)}${renders(made, links)}${postedGrid(posted, failedPosts, links)}${styles(setup, env)}</main>`,
  );
}

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--ink:#111;--soft:#6b6b70;--well:#f4f4f5;--line:#e8e8ea;--bad:#a40000;--chip:#111;--chip-ink:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0c;--ink:#f4f4f5;--soft:#9c9ca3;--well:#1a1a1d;--line:#26262a;--bad:#ff7a7a;--chip:#f4f4f5;--chip-ink:#111}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:400 14px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px}h1{font-size:24px;font-weight:300;margin:0}main>h1{margin-bottom:16px}h2{font-size:15px;font-weight:400;margin:28px 0 10px}
a{color:inherit;outline:none}a:focus-visible{opacity:.6}.muted{color:var(--soft)}.error,.bad{color:var(--bad)}
.creator{display:flex;align-items:center;gap:14px;margin-bottom:20px}.face{width:64px;height:64px;border-radius:50%;object-fit:cover;object-position:top;background:var(--well);flex:none}
.who{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.connect{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--well);border-radius:14px;padding:14px;margin-bottom:12px}
.connect div{display:flex;flex-direction:column;gap:2px}
.numbers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.tile{background:var(--well);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:4px}
.tile strong{font-size:24px;font-weight:300}.label{color:var(--soft);font-size:12px}
ul{list-style:none;margin:0;padding:0}.rows .row{display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--line);padding:10px 0}
.rows .row>div:nth-child(2){flex:1;min-width:0}.act{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.badge{background:var(--chip);color:var(--chip-ink);border-radius:999px;padding:2px 8px;font-size:12px}
.caption{margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.strip{display:flex;gap:12px;overflow-x:auto}.strip .card{flex:0 0 150px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.card{display:flex;flex-direction:column;gap:4px}time{color:var(--soft);font-size:12px}
.thumb{width:72px;aspect-ratio:9/16;object-fit:cover;background:var(--well);border-radius:10px;display:block}
.card .thumb{width:100%}
.episode{margin-bottom:16px}.episode p{margin:0 0 8px}.card.dim{opacity:.45}.connect a{white-space:nowrap}
.styles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
button{font:inherit;color:inherit;outline:none;cursor:pointer}
.style{display:flex;flex-direction:column;gap:4px;width:100%;padding:0;border:0;background:none;text-align:left}
.style video{width:100%;aspect-ratio:9/16;object-fit:cover;background:var(--well);border-radius:10px;display:block;transition:filter .15s}
.style:hover video,.style:focus-visible video{filter:brightness(.8)}
.player{border:0;border-radius:16px;padding:12px;background:var(--bg);color:var(--ink);width:min(360px,calc(100vw - 32px));outline:none}
.player::backdrop{background:rgba(0,0,0,.6)}
.player video{width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:10px;display:block;background:#000}
.player .who{margin:10px 0}
.recreate{display:block;text-align:center;background:var(--chip);color:var(--chip-ink);border-radius:999px;padding:10px;text-decoration:none}
.recreate:focus-visible{opacity:.8}
.close{width:100%;margin-top:6px;padding:8px;border:0;border-radius:999px;background:none;color:var(--soft)}
.close:hover,.close:focus-visible{background:var(--well);color:var(--ink)}
@media (max-width:560px){.numbers{grid-template-columns:1fr}.styles{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
