/**
 * The channel: the company's home screen, a hosted app the template ships as source (vetta-mono
 * ADR-1482/1483) and declares `home: true` (channel-first SPEC §3). The studio frames it full-screen
 * and draws every decision itself, so this page only shows. It reads, with the app's own read key
 * (`NAIVE_API_KEY`, the read preset, §29.7):
 *
 *   · the header: the creator's face and name on a channel that has one (AI Influencer), else the
 *     channel's own words, the niche the person typed;
 *   · the episodes, newest first, after a "Create new episode" card. An episode is a chain of board
 *     cards — the first run's topics → script → pictures → video → post, or a later Plan → Render →
 *     Publish — and each reads as Generating, Needs you, Posted or Stopped;
 *   · one episode's page (`?episode=<its first card>`): its steps, its script and its stills.
 *
 * It writes nothing. Its only actions are two links the studio opens (SPEC §3 "Bridge"):
 * `?needs=<ses_ id>` opens that waiting question or approval in the studio's sheet, and
 * `?say=<words>` opens Ask CEO with the words in the box, unsent. A framed app cannot navigate the
 * studio, so a click posts `{ type: "naive:open", href }` to it; the page posts `naive:ready` once.
 *
 * One file with no relative imports: the host compiles each function on its own. Agents may pull,
 * change and deploy it like any app.
 */
import { naive, signInUrl, viewer, type AppEnv } from "@usenaive-sdk/app";

type Read<T> = { ok: true; value: T } | { ok: false; error: string };
/** A file's short-lived address by its `fil_` id. */
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
/** A card on the company board, as `GET /v1/boards/:id/cards` lists it (§28.6). */
export type Card = {
  id: string;
  board_id: string;
  title: string;
  body: string;
  note: string | null;
  status: "todo" | "doing" | "blocked" | "done";
  blocked_by: string[];
  woken_session_id?: string | null;
  created_at: string;
  updated_at: string;
};
type Comment = { body: string; created_at: string };
/** A file under `Episodes/`, as `GET /v1/files` lists it. */
type EpisodeFile = { id: string; name: string; content_type: string; folder?: string | null };
/** What a waiting session waits on: a question (`awaiting_answer`) or an approval (`awaiting_approval`). */
type Parked = ReadonlyMap<string, "question" | "approval">;

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

/**
 * The first run's card titles and its closing words, as `templates/faceless.ts` writes them (a test
 * holds the two files to one another): this page reads the board by them.
 */
export const FIRST_RUN_TITLES = {
  topic: "Offer four ideas for the first video",
  script: "Write the first episode's script",
  pictures: "Make the reference pictures",
  video: "Make the first video",
  post: "Publish the first video",
} as const;
export const ALREADY_RUNNING = "ALREADY RUNNING";
const EPISODES_FOLDER = "Episodes";

/** The cadence a company that never said one runs at (`@vetta/core` `DEFAULT_CADENCE`). */
const DEFAULT_CADENCE = "3× a week";
/** Board pages of 100 (the API's most); the store answers at most 500 cards. */
const BOARD_PAGES = 5;
/** The newest episodes drawn. Each may read one card's comments and mint one file link. */
export const EPISODES_SHOWN = 12;
/** The newest `Episodes/` files read for the first run's stills, video and script. */
const EPISODE_FILES = 100;
const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

export const GET = (request: Request) => overview(request, process.env);

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

async function read<T>(what: string, run: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: `Couldn't read ${what}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const failed = (read: Read<unknown>): string => (read.ok ? "" : `<p class="error">${escape(read.error)}</p>`);

async function rest(env: AppEnv, path: string): Promise<Response> {
  const response = await fetch(`${env["NAIVE_API_URL"]?.replace(/\/+$/, "")}${path}`, { headers: { authorization: `Bearer ${env["NAIVE_API_KEY"]}` } });
  if (!response.ok) throw Object.assign(new Error(`the API answered ${response.status}`), { status: response.status });
  return response;
}

async function json<T>(env: AppEnv, path: string): Promise<T> {
  return (await (await rest(env, path)).json()) as T;
}

const studioOf = (env: AppEnv): string | null => env["NAIVE_STUDIO_URL"]?.replace(/\/+$/, "") || null;

// ---------- reads ----------

type Answers = Readonly<Record<string, unknown>>;
type Setup = { answers: Answers; installedAt: string | null };

const setupOf = async (env: AppEnv): Promise<Setup> => {
  const install = (await naive(env).apps.installs.list({ project: env["NAIVE_PROJECT"] })).data[0] as { answers?: Answers; created_at?: unknown } | undefined;
  return { answers: install?.answers ?? {}, installedAt: typeof install?.created_at === "string" ? install.created_at : null };
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

async function creatorFor(env: AppEnv, answer: string, installedAt: string | null): Promise<Creator | null> {
  const found = creatorOf((await json<{ data: Creator[] }>(env, "/v1/characters?limit=100")).data, answer, installedAt);
  return found.retired === null ? found.creator : json<Creator>(env, `/v1/characters/${encodeURIComponent(found.retired)}`);
}

/** The company board: the CEO's, where the template seeds its cards (§31.11). */
async function boardOf(env: AppEnv): Promise<Card[]> {
  const me = await json<{ organization: { id: string } | null }>(env, "/v1/me");
  if (me.organization === null) throw new Error("the key names no company");
  const org = await json<{ ceo_agent_id?: string | null }>(env, `/v1/organizations/${encodeURIComponent(me.organization.id)}`);
  if (!org.ceo_agent_id) return [];
  const cards: Card[] = [];
  let after: string | null = null;
  for (let pages = 0; pages < BOARD_PAGES; pages += 1) {
    const page: { data: Card[]; next_cursor: string | null } = await json(env, `/v1/boards/${encodeURIComponent(org.ceo_agent_id)}/cards?limit=100${after === null ? "" : `&after=${encodeURIComponent(after)}`}`);
    cards.push(...page.data);
    if (page.next_cursor === null) break;
    after = page.next_cursor;
  }
  return cards;
}

/** The sessions waiting on the person, as the studio's own rail reads them (vetta-mono `@vetta/core` attention.ts). */
async function parkedOf(env: AppEnv): Promise<Parked> {
  const [questions, approvals] = await Promise.all(
    (["awaiting_answer", "awaiting_approval"] as const).map((reason) => json<{ data: { id: string }[] }>(env, `/v1/sessions?status=idle&stop_reason=${reason}&limit=100`)),
  );
  return new Map([...questions!.data.map((one) => [one.id, "question"] as const), ...approvals!.data.map((one) => [one.id, "approval"] as const)]);
}

const episodeFiles = async (env: AppEnv): Promise<EpisodeFile[]> =>
  (await json<{ data: EpisodeFile[] }>(env, `/v1/files?folder=${EPISODES_FOLDER}&subfolders=true&order=desc&limit=${EPISODE_FILES}`)).data;

async function commentsOf(env: AppEnv, card: Card): Promise<Comment[]> {
  return (await json<{ data: Comment[] }>(env, `/v1/boards/${encodeURIComponent(card.board_id)}/cards/${encodeURIComponent(card.id)}/comments?limit=100`)).data;
}

/** A script's words, read with the app's own key (`?download=true`). */
async function fileText(env: AppEnv, id: string): Promise<string> {
  return (await rest(env, `/v1/files/${encodeURIComponent(id)}?download=true`)).text();
}

/** A failed link leaves its picture blank rather than failing the page. */
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

// ---------- episodes ----------

type Step = keyof typeof FIRST_RUN_TITLES;
/** An episode's steps in order: the first run's five, or a later piece's three. */
const stepsOf = (head: Card): Step[] => (head.title === FIRST_RUN_TITLES.topic ? ["topic", "script", "pictures", "video", "post"] : ["script", "video", "post"]);
const STEP_BY_TITLE = new Map<string, Step>(Object.entries(FIRST_RUN_TITLES).map(([step, title]) => [title, step as Step]));

/** Which step of an episode a card is: by the first run's titles, or a later piece's "Plan:", "Render:" and "Publish:". */
const stepOf = (card: Card): Step | null =>
  STEP_BY_TITLE.get(card.title) ?? (card.title.startsWith("Plan: ") ? "script" : card.title.startsWith("Render: ") ? "video" : card.title.startsWith("Publish: ") ? "post" : null);
const isHead = (card: Card): boolean => card.title === FIRST_RUN_TITLES.topic || card.title.startsWith("Plan: ");

/** The cards that follow a head: each the one card of a known step that waits on the last. */
function chainFrom(head: Card, cards: readonly Card[]): Card[] {
  const chain = [head];
  for (;;) {
    const last = chain[chain.length - 1]!;
    const next = cards.find((one) => one.blocked_by.includes(last.id) && stepOf(one) !== null && !isHead(one) && !chain.includes(one));
    if (next === undefined) return chain;
    chain.push(next);
  }
}

export type Label = "Generating" | "Needs you" | "Posted" | "Stopped";
/** A link the studio opens. `bridge` marks it for the click handler, which hands it to the studio. */
type Action = { text: string; href: string };
export type Episode = {
  number: number;
  head: Card;
  chain: Card[];
  title: string;
  /** The first run's `Episodes/<slug>`; a later piece files nowhere this page reads. */
  slug: string | null;
  label: Label;
  line: string;
  action: Action | null;
  /** The card working now, while it is `doing`: its newest comment is the Generating line. */
  working: Card | null;
};

const say = (words: string): string => `?say=${encodeURIComponent(words)}`;
const needs = (session: string): string => `?needs=${encodeURIComponent(session)}`;
const firstLine = (text: string | null): string => (text ?? "").trim().split("\n")[0]!.trim();
const noteStarts = (card: Card, word: string): boolean => (card.note ?? "").trimStart().startsWith(word);

const WORKING: Record<Step, string> = {
  topic: "Finding 4 ideas…",
  script: "Writing the script…",
  pictures: "Drawing the pictures…",
  video: "Making the video…",
  post: "Getting it ready to post…",
};

/** The one thing an episode waits on, its line and its link, read off its cards and the waiting sessions. */
function stateOf(number: number, chain: readonly Card[], parked: Parked): Pick<Episode, "label" | "line" | "action" | "working"> {
  const stopped = chain.find((one) => noteStarts(one, "STOPPED"));
  if (stopped !== undefined) return { label: "Stopped", line: "The team stopped", action: { text: "Ask CEO", href: say(`Episode ${number} stopped. What happened?`) }, working: null };
  const post = chain.find((one) => stepOf(one) === "post");
  if (post?.status === "done") {
    if (noteStarts(post, "Not posted")) return { label: "Needs you", line: "Connect to post", action: { text: "Connect", href: say(`Connect an account and post Episode ${number}.`) }, working: null };
    return { label: "Posted", line: `Posted ${WHEN.format(Date.parse(post.updated_at))}`, action: null, working: null };
  }
  const now = chain.find((one) => one.status !== "done");
  if (now === undefined) {
    // Every card so far is done and the next is not filed yet: the seat that closed the last files it.
    const steps = stepsOf(chain[0]!);
    return { label: "Generating", line: WORKING[steps[steps.indexOf(stepOf(chain[chain.length - 1]!)!) + 1] ?? "post"], action: null, working: null };
  }
  const step = stepOf(now)!;
  const waits = now.woken_session_id ? parked.get(now.woken_session_id) : undefined;
  if (now.status === "doing" && waits !== undefined) {
    const href = needs(now.woken_session_id!);
    if (step === "topic") return { label: "Needs you", line: "Pick a topic", action: { text: "Pick a topic", href }, working: null };
    if (step === "pictures") return { label: "Needs you", line: "Pick pictures", action: { text: "Pick pictures", href }, working: null };
    if (step === "post") return waits === "approval" ? { label: "Needs you", line: "Ready to post", action: { text: "Post", href }, working: null } : { label: "Needs you", line: "Connect to post", action: { text: "Connect", href }, working: null };
    return { label: "Needs you", line: "The team has a question", action: { text: "Answer", href }, working: null };
  }
  // The first video waits for a plan (`needs_plan`): blocked, with the cards before it done. The studio's own Start opens the plan.
  if (now.title === FIRST_RUN_TITLES.video && now.status === "blocked") {
    return { label: "Needs you", line: "Start your team", action: null, working: null };
  }
  return { label: "Generating", line: WORKING[step], action: null, working: now.status === "doing" ? now : null };
}

/** Every episode on the board, numbered oldest first, newest first. A first run that closed on ALREADY RUNNING is none. */
export function episodesOf(cards: readonly Card[], parked: Parked): Episode[] {
  const heads = cards
    .filter(isHead)
    .filter((head) => !noteStarts(head, ALREADY_RUNNING))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return heads
    .map((head, at) => {
      const chain = chainFrom(head, cards);
      const firstRun = head.title === FIRST_RUN_TITLES.topic;
      const script = chain.find((one) => stepOf(one) === "script");
      const topic = firstRun ? /^TOPIC:\s*(.+)$/m.exec(head.note ?? "")?.[1]?.trim() : head.title.slice("Plan: ".length).trim();
      return {
        number: at + 1,
        head,
        chain,
        title: topic || "Your first episode",
        slug: firstRun ? (/^SLUG:\s*(\S+)/m.exec(script?.note ?? "")?.[1] ?? null) : null,
        ...stateOf(at + 1, chain, parked),
      };
    })
    .reverse();
}

/**
 * The working card's newest line for the person: the crew comments one short line a step
 * (`FIRST_VIDEO_RULE`), beside lines for itself in capitals ("IDEAS:", "STILL 2 fil_…"), skipped here.
 */
export function progressLine(comments: readonly Comment[]): string | null {
  const said = [...comments]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((one) => firstLine(one.body))
    .find((line) => line !== "" && !/^[A-Z]{3,}\b/.test(line));
  if (said === undefined) return null;
  return said.length > 90 ? `${said.slice(0, 89).trimEnd()}…` : said;
}

/** An episode's folder, the first run's: its stills, newest last, and its finished video. */
const folderOf = (files: readonly EpisodeFile[], slug: string | null) => {
  const inside = slug === null ? [] : files.filter((file) => file.folder === `${EPISODES_FOLDER}/${slug}`).reverse();
  return { stills: inside.filter((file) => file.content_type.startsWith("image/")).map((file) => file.id), video: inside.find((file) => file.content_type.startsWith("video/"))?.id ?? null };
};

/** What an episode's card shows: its finished video, else its first still, else the later piece's first scene image. */
function coverOf(episode: Episode, files: readonly EpisodeFile[], comments: readonly Comment[]): { id: string; video: boolean } | null {
  const folder = folderOf(files, episode.slug);
  if (folder.video !== null) return { id: folder.video, video: true };
  if (folder.stills[0] !== undefined) return { id: folder.stills[0], video: false };
  const scene = comments.map((one) => /^SCENE \d+ IMAGE (fil_\w+)/.exec(one.body.trim())?.[1]).find((id) => id !== undefined);
  return scene === undefined ? null : { id: scene, video: false };
}

// ---------- drawing ----------

function picture(url: string | undefined, video: boolean): string {
  if (url === undefined) return "";
  // `#t=` paints the first frame where a browser would otherwise leave a loaded video blank.
  return video ? `<video src="${escape(url)}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${escape(url)}" alt="" loading="lazy">`;
}

const CHIP: Record<Label, string> = { Generating: "gen", "Needs you": "you", Posted: "posted", Stopped: "stopped" };
const chip = (label: Label): string => `<span class="chip ${CHIP[label]}"><i></i>${label}</span>`;
const pill = (action: Action | null): string => (action === null ? "" : `<a class="pill" data-bridge href="${escape(action.href)}">${escape(action.text)}</a>`);

/** "silicon valley comedy" → "Silicon Valley Comedy": the channel is named by the words the person typed. */
const titled = (words: string): string => words.trim().replace(/(^|\s)(\p{Ll})/gu, (_all, space: string, letter: string) => space + letter.toUpperCase());

type Header = { name: string; kicker: string; face: string | undefined };

/** A prebuilt's first sheet still is a path on the studio; a trained face's first photo is a stored file. Any other link is never loaded. */
function faceOf(creator: Creator, env: AppEnv, links: Links): string | undefined {
  const path = creator.sheet.find((one) => one.startsWith("/") && !one.startsWith("//"));
  const studio = studioOf(env);
  if (path !== undefined && studio !== null) return `${studio}${path}`;
  const file = creator.source_images.find((one) => one.startsWith("fil_"));
  return file === undefined ? undefined : links.get(file);
}

function headerOf(setup: Read<Setup>, creator: Read<Creator | null>, env: AppEnv, links: Links, cover: string | undefined): Header {
  if (creator.ok && creator.value !== null) {
    const one = creator.value;
    return { name: one.name, kicker: one.status === "training" ? "Training · about 20 min" : (one.persona?.niche ?? ""), face: faceOf(one, env, links) };
  }
  const answers = setup.ok ? setup.value.answers : {};
  const niche = typeof answers["niche"] === "string" && answers["niche"].trim() !== "" ? answers["niche"] : null;
  const cadence = typeof answers["cadence"] === "string" && answers["cadence"].trim() !== "" ? answers["cadence"] : DEFAULT_CADENCE;
  return { name: niche === null ? "Your channel" : titled(niche), kicker: cadence, face: cover };
}

const header = (head: Header): string =>
  `<header class="chead">${head.face === undefined ? `<div class="av"></div>` : `<img class="av" src="${escape(head.face)}" alt="">`}<div><div class="kicker">${escape(head.kicker)}</div><h1>${escape(head.name)}</h1></div></header>`;

const NEW_EPISODE = `<a class="ep" data-bridge href="${escape(say("New episode: "))}"><div class="shot new"><span class="plus">+</span></div><div class="foot"><span class="title">Create new episode</span><span class="line">Tell the CEO what it's about</span></div></a>`;

function card(episode: Episode, cover: { url: string | undefined; video: boolean }, line: string): string {
  const shot = cover.url === undefined ? `<div class="waitline">${escape(line)}</div>` : picture(cover.url, cover.video);
  return `<div class="ep"><a class="open" href="?episode=${encodeURIComponent(episode.head.id)}"><div class="shot">${shot}${chip(episode.label)}</div><div class="foot"><span class="num">Episode #${episode.number}</span><span class="title">${escape(episode.title)}</span>${cover.url === undefined ? "" : `<span class="line">${escape(line)}</span>`}</div></a>${episode.action === null ? "" : `<div class="act">${pill(episode.action)}</div>`}</div>`;
}

const STEP_NAMES: Record<Step, string> = { topic: "Topic", script: "Script", pictures: "Pictures", video: "Video", post: "Post" };

/** One episode's page: its steps from its cards, then its script and stills, the first run's. */
function episodePage(episode: Episode, line: string, script: Read<string> | null, stills: readonly (string | undefined)[]): string {
  const steps = stepsOf(episode.head);
  const now = episode.chain.find((one) => one.status !== "done");
  const rows = steps
    .map((step) => {
      const held = episode.chain.find((one) => stepOf(one) === step);
      const state = held?.status === "done" ? "done" : held !== undefined && held === now ? "now" : "";
      return `<li class="step ${state}"><i></i>${STEP_NAMES[step]}${state === "now" ? ` · ${escape(line)}` : ""}</li>`;
    })
    .join("");
  const pictures = stills.filter((url) => url !== undefined).map((url) => `<li>${picture(url, false)}</li>`).join("");
  const words = script === null ? "" : script.ok ? (script.value.trim() === "" ? "" : `<pre class="script">${escape(script.value.trim())}</pre>`) : failed(script);
  return `<a class="back" href="?">← Episodes</a><div class="page"><div><span class="num">Episode #${episode.number}</span> ${chip(episode.label)}<h2>${escape(episode.title)}</h2><ol class="steps">${rows}</ol>${episode.action === null ? "" : `<div class="act">${pill(episode.action)}</div>`}</div><div>${pictures === "" ? "" : `<ul class="stills">${pictures}</ul>`}${words}</div></div>`;
}

/**
 * THE BRIDGE (SPEC §3): one `naive:ready` to the studio, then each marked link handed to it as
 * `naive:open` instead of followed. Outside a frame there is no studio to hand it to, so it is followed.
 */
const bridge = (origin: string): string =>
  `<script>(()=>{if(parent===window)return;const to=${JSON.stringify(origin)};parent.postMessage({type:"naive:ready"},to);document.addEventListener("click",(event)=>{const link=event.target.closest("a[data-bridge]");if(!link)return;event.preventDefault();parent.postMessage({type:"naive:open",href:link.getAttribute("href")},to);});})();</script>`;

const page = (status: number, title: string, body: string, env: AppEnv): Response => {
  const studio = studioOf(env);
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>${CSS}</style></head><body><main>${body}</main>${bridge(studio === null ? "*" : new URL(studio).origin)}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
};

/** The page. Signed out, it sends the visitor back through Naive, which signs them in. */
export async function overview(request: Request, env: AppEnv): Promise<Response> {
  if ((await viewer(request, env)) === null) {
    const back = signInUrl(env);
    if (back === null) return page(401, "Your channel", `<p>Open your channel from Naive.</p>`, env);
    return new Response(null, { status: 303, headers: { location: back, "cache-control": "no-store" } });
  }
  const [setup, board, parked, files] = await Promise.all([
    read("the channel's setup", () => setupOf(env)),
    read("the board", () => boardOf(env)),
    read("what waits on you", () => parkedOf(env)),
    read("the episodes' files", () => episodeFiles(env)),
  ]);
  const answer = setup.ok ? setup.value.answers["character"] : undefined;
  const creator: Read<Creator | null> =
    typeof answer === "string" && setup.ok ? await read("the creator", () => creatorFor(env, answer, setup.value.installedAt)) : { ok: true, value: null };
  const all = board.ok ? episodesOf(board.value, parked.ok ? parked.value : new Map()) : [];
  const fileList = files.ok ? files.value : [];
  const opened = new URL(request.url).searchParams.get("episode");
  const one = opened === null ? undefined : all.find((episode) => episode.head.id === opened);
  const shown = one === undefined ? all.slice(0, EPISODES_SHOWN) : [one];

  // The working card's comments: the Generating line, and a later piece's scene image.
  const comments = new Map(
    await Promise.all(
      shown.map(async (episode) => [episode.head.id, episode.working === null ? [] : await commentsOf(env, episode.working).catch((): Comment[] => [])] as const),
    ),
  );
  const covers = new Map(shown.map((episode) => [episode.head.id, coverOf(episode, fileList, comments.get(episode.head.id)!)] as const));
  const stills = one === undefined ? [] : folderOf(fileList, one.slug).stills;
  const scriptFile = one?.slug ? fileList.find((file) => file.folder === EPISODES_FOLDER && file.name === `${one.slug}.md`) : undefined;
  const [links, script] = await Promise.all([
    linksFor(env, [
      ...[...covers.values()].flatMap((cover) => (cover === null ? [] : [cover.id])),
      ...stills,
      ...(creator.ok && creator.value !== null && creator.value.sheet.length === 0 ? creator.value.source_images.filter((id) => id.startsWith("fil_")).slice(0, 1) : []),
    ]),
    scriptFile === undefined ? null : read("the script", () => fileText(env, scriptFile.id)),
  ]);
  const lineOf = (episode: Episode) => progressLine(comments.get(episode.head.id)!) ?? episode.line;
  const coverUrl = (episode: Episode) => {
    const cover = covers.get(episode.head.id);
    return { url: cover ? links.get(cover.id) : undefined, video: cover?.video ?? false };
  };
  // The channel's face, with no creator: the newest episode's still.
  const still = shown.map((episode) => coverUrl(episode)).find((cover) => cover.url !== undefined && !cover.video)?.url;
  const head = headerOf(setup, creator, env, links, still);
  const errors = [setup, creator, board, parked, files].map(failed).join("");

  if (one !== undefined) {
    return page(200, `${one.title} · ${head.name}`, `${header(head)}${errors}${episodePage(one, lineOf(one), script, stills.map((id) => links.get(id)))}`, env);
  }
  const cards = shown.map((episode) => card(episode, coverUrl(episode), lineOf(episode))).join("");
  return page(200, head.name, `${header(head)}${errors}<h2 class="sec">Episodes</h2><div class="grid">${NEW_EPISODE}${cards}</div>`, env);
}

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--ink:#111114;--soft:#6e6e6e;--body:#555;--well:#f2f2f2;--line:rgba(0,0,0,.1);--wait:#0a66ff;--done:#1fa846;--bad:#a40000;--glass:rgba(255,255,255,.92)}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0c;--ink:#f4f4f5;--soft:#9c9ca3;--body:#c4c4c8;--well:#1a1a1d;--line:rgba(255,255,255,.12);--wait:#4d8dff;--done:#3cc464;--bad:#ff7a7a;--glass:rgba(20,20,22,.88)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:400 14px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1040px;margin:0 auto;padding:28px 16px 40px}
a{color:inherit;text-decoration:none;outline:none}a:focus-visible{opacity:.6}
.error{color:var(--bad);margin:8px 0}
.chead{display:flex;align-items:center;gap:14px}
.av{width:56px;height:56px;border-radius:50%;object-fit:cover;object-position:50% 22%;background:var(--well);flex:none}
.kicker{font-size:12px;color:var(--soft)}h1{font-size:22px;font-weight:600;margin:1px 0 0;letter-spacing:-.01em}
.sec{font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--soft);margin:32px 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
.ep{display:flex;flex-direction:column;min-width:0}.ep .open{display:flex;flex-direction:column}
.shot{position:relative;aspect-ratio:9/13;background:var(--well);border-radius:14px;overflow:hidden}
.shot img,.shot video{width:100%;height:100%;object-fit:cover;display:block}
.waitline{position:absolute;inset:0;display:grid;place-items:center;padding:18px;text-align:center;color:var(--soft);font-size:13px;line-height:1.4}
.new{display:grid;place-items:center}.plus{width:44px;height:44px;border-radius:50%;background:var(--bg);display:grid;place-items:center;font-size:22px}
a.ep:hover .new,a.ep:focus-visible .new{filter:brightness(.95)}
.chip{position:absolute;top:10px;left:10px;height:26px;padding:0 10px;border-radius:999px;background:var(--glass);font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:6px}
.page .chip{position:static;vertical-align:middle}
.chip i{width:7px;height:7px;border-radius:50%;background:var(--soft);display:inline-block}
.chip.gen i{animation:pulse 1.2s ease-in-out infinite}
.chip.you{background:var(--wait);color:#fff}.chip.you i{background:#fff}
.chip.posted i{background:var(--done)}.chip.stopped i{background:var(--bad)}
@keyframes pulse{50%{opacity:.25}}@media (prefers-reduced-motion:reduce){.chip.gen i{animation:none}}
.foot{padding:10px 2px 4px;display:flex;flex-direction:column;gap:2px}
.num{font-size:12px;color:var(--soft)}.title{font-size:14px;font-weight:500;line-height:1.3}.line{font-size:12px;color:var(--soft)}
.act{display:flex;justify-content:flex-end;margin-top:6px}
.pill{height:30px;padding:0 14px;border-radius:999px;background:var(--ink);color:var(--bg);font-size:13px;font-weight:500;display:inline-flex;align-items:center;white-space:nowrap}
.pill:hover,.pill:focus-visible{opacity:.8}
.back{font-size:14px;color:var(--soft);margin-top:22px;display:inline-block}
.page{display:grid;grid-template-columns:1fr 320px;gap:32px;margin-top:20px}
.page h2{font-size:26px;font-weight:600;margin:6px 0 6px;letter-spacing:-.01em}
.steps{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:8px}
.step{display:flex;gap:10px;align-items:center;font-size:14px;color:var(--soft)}
.step i{width:18px;height:18px;border-radius:50%;background:var(--well);flex:none}
.step.done{color:var(--ink)}.step.done i{background:var(--ink)}
.step.now{color:var(--ink);font-weight:500}.step.now i{background:var(--wait)}
.stills{list-style:none;padding:0;margin:0 0 16px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.stills img{width:100%;aspect-ratio:9/14;object-fit:cover;border-radius:10px;display:block;background:var(--well)}
.script{margin:0;background:var(--well);border-radius:14px;padding:12px 16px;font:inherit;font-size:13px;line-height:1.5;color:var(--body);white-space:pre-wrap;overflow-wrap:anywhere}
@media (max-width:640px){.grid{grid-template-columns:1fr 1fr;gap:10px}.page{grid-template-columns:1fr;gap:16px}.av{width:44px;height:44px}h1{font-size:19px}.sec{margin:20px 0 10px}}
`;
