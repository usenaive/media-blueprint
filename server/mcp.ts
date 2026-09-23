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
import { channelPlatform, channelPlatforms } from "./channel.ts";
import { notActivated, proxyFetch, upstreamFor, type ProxyConfig } from "./proxy.ts";
import type { Store } from "./store.ts";
import { POST_PLATFORMS, POST_STAGES, postStage, type PostPlatform, type PostStage } from "../seed/posts.ts";
import { PROJECT_KINDS, PROJECT_STATUSES, SCENE_BEATS, type ClipSource, type Fact, type ProjectKind, type ProjectSession, type ProjectStatus, type Scene, type Sound } from "../seed/projects.ts";
import { ACTIVE } from "../templates/index.ts";
import { labelOf, LENGTH_PHRASE, MAX_SECONDS, MIN_SECONDS, RENDERER, VIDEO_MODELS } from "../templates/template.ts";

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
const num = (description: string) => ({ type: "number", description }) as const;
/** `items` is an object schema for a list of rows, or `{ type: "string" }` for a list of lines. */
const arr = (description: string, items: ReturnType<typeof obj> | { type: "string" }) =>
  ({ type: "array", description, items }) as const;

const OPERATOR_ONLY = "Approving, rejecting and publishing are operator actions on the dashboard; no tool does them.";

/**
 * The sentence on `create_post` that tells the crew where this channel posts.
 *
 * One network: it is the default, said once. Several: every one is a target the crew should file
 * for, and the first is what an untargeted row becomes — said in that order, because an agent that
 * reads only "posts to youtube" files nothing for the TikTok the customer also ticked.
 */
const targetSentence = (channels: readonly PostPlatform[]): string => {
  const first = channels[0]!;
  const named = (platform: PostPlatform) => `${platform} (${labelOf(platform)})`;
  if (channels.length === 1) {
    return `This channel posts to ${named(first)}, which is what a post that names none becomes; name another only when the piece is genuinely for it.`;
  }
  const all = channels.map(named);
  const listed = `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
  return `This channel posts to ${listed}, and every finished piece is for all of them: file one post per network. A post that names none goes to ${named(first)}, the first the customer chose. Name a network outside these only when the piece is genuinely for it.`;
};

/**
 * THE TOOLS, WRITTEN FOR THE NETWORKS THIS CHANNEL ACTUALLY POSTS TO.
 *
 * The description of `create_post`'s `platform` names the channel's own targets, because a default
 * nothing tells the crew about is a default the crew never chooses against. That target used to be
 * a constant `"x"` in this file, then a constant on the running template; it is now the customer's
 * setup answer (`PLATFORM_QUESTION`, one network or several), resolved per request by
 * `server/channel.ts`. So the list is built rather than declared: the same agent, on two installs
 * that answered differently, reads two different sentences, which is the point.
 */
const STAGES = POST_STAGES.join("|");
const PROJECT_STATES = PROJECT_STATUSES.join("|");

/** How old a claim has to be before it is read as dead — the day the channel-manager's 08:00 sweep is briefed with. */
const DEAD_CLAIM_MS = 86_400_000;

/** One shot of a generation plan, as the tool takes it. */
const SCENE = obj({
  prompt: str("What the frame shows — the prompt generate_video renders, written inside the style template's look"),
  seconds: num("Running time of the shot, in seconds"),
  beat: str(`Which beat of the script this shot is doing: ${SCENE_BEATS.join("|")}. A piece runs them in that order; two beats may share a shot, one beat never spans two.`),
  voiceover: str("The narration said over it, as text. No narrator voices exist yet, so this is the line a voice will read."),
  text: str("Text on the frame — the hook, on the first scene"),
  model: str(`A video model for this shot when it differs from the project's: ${VIDEO_MODELS.join("|")}`),
}, ["prompt", "seconds"]);

/** One checkable claim of a generation plan, as the tool takes it. */
const FACT = obj({
  claim: str("The claim the script makes, in one line"),
  source: str("Where it came from — a URL, or the named work. A claim you could not source belongs out of the script."),
}, ["claim", "source"]);

/** How the piece sounds, as the tool takes it. */
const SOUND = obj({
  music: str("The music bed: genre, tempo, where it drops"),
  voice: str("Who the narration sounds like: person, pace, register"),
  sfx: arr("Sound design moments worth naming, in scene order", { type: "string" }),
}, []);

/** One source of a clipping plan, as the tool takes it. */
const SOURCE = obj({
  url: str("The source video's URL — a YouTube URL from a reference channel the context names"),
  from: str("Where the moment starts in the source, mm:ss or h:mm:ss"),
  to: str("Where it ends"),
  reason: str("Why this moment: the one idea in it and why it lands for this audience"),
}, ["url", "reason"]);

/** The plan's own fields, shared by `create_project` and `update_project`. */
const PLAN_FIELDS = {
  title: str("The piece, in a line"),
  brief: str("The reasoning: the idea, why now, why this audience — what the render is for. The operator reads this before anything is spent."),
  platform: str(`Where the piece is for: ${POST_PLATFORMS.join("|")}. Defaults to the brief row's network, else the channel's own.`),
  account: str("The connected account it is for, from list_accounts"),
  style_template: str("generation: the style template the scenes are written in, by name (list_style_templates)"),
  model: str(`generation: the video model the scenes render in, one of ${VIDEO_MODELS.join("|")}. Defaults to the first.`),
  scenes: arr(`generation: the shots in order — prompt, seconds, beat, voiceover, on-screen text. Required for a generation plan. The seconds must sum to ${LENGTH_PHRASE}, and the shots are rendered as ONE video, not joined: nothing here cuts between them, so the sum is what generate_video is asked for and each prompt is a shot inside that one generation.`, SCENE),
  sources: arr("clipping: the source videos and the moment in each — url, from, to, reason. Required for a clipping plan.", SOURCE),
  caption: str("The publishable caption, hashtags included; it goes on the post when the render lands"),
  hook: str("generation: the first line of the piece, verbatim — what is said and what is on the frame at 0:00. It is the one line that decides whether the rest is watched."),
  rejected_hooks: arr("generation: the hooks you wrote and did not keep, and why the kept one beat them", { type: "string" }),
  retention: str("generation: what holds the viewer past 0:03, and past 0:07. A piece with no answer here ends at 0:03."),
  cta: str("generation: the one action the close asks for. One, not three."),
  facts: arr("generation: the checkable claims the script rests on, each with where it came from. A claim you could not source belongs out of the script rather than in it unsourced.", FACT),
  sound: SOUND,
  reference_pattern: str("Which pattern of this channel's reference teardown the piece is an instance of. Leave unset when the context names no reference."),
  reference_frames: arr("The stills this piece is rendered against, as PUBLIC image URLs — not fil_ ids, which generate_video cannot fetch. The FIRST is used as the opening frame of the render, so choose one that is the shot you want to open on; the rest are carried for the operator and for a later render that can take more. A fil_ id is for LOOKING at with view_image, which is a different job.", { type: "string" }),
};

export const toolsFor = (channels: readonly PostPlatform[]) => [
  { name: "list_posts", description: `The post queue, optionally filtered by status and/or stage. ${OPERATOR_ONLY}`, inputSchema: obj({
    status: str("Optional filter: pending|ready|approved|posted|rejected"),
    stage: str(`Optional filter on how far a piece is: ${STAGES}. A row carrying neither a stage nor a video is a note, not a piece.`),
  }, []) },
  { name: "get_post", description: "One post by id.", inputSchema: obj({ id: str("Post id (post_…)") }, ["id"]) },
  { name: "create_post", description: `File a finished piece into the queue for the operator to review. Lands as pending unless status is ready. Say who you are, which account it is for and what it was made from — the operator approves the row, and an unsigned one tells them nothing. ${OPERATOR_ONLY}`, inputSchema: obj({
    caption: str("The caption, hashtags included"),
    media_url: str("URL of the finished clip or video — it is published with the post, and the operator watches it here before approving"),
    platform: str(`Where it should go: ${POST_PLATFORMS.join("|")}. ${targetSentence(channels)} These are the only networks this channel can publish to, and every one of them publishes video and refuses a bare caption.`),
    agent: str("Your own name, as the roster lists it — who filed this"),
    account: str("The connected account this is for, from list_accounts"),
    source: str("What it was made from: the brief, the source video, the style template"),
    stage: str(`How far along the piece is: ${STAGES}. Leave unset for a note (a plan, a report) that no seat takes further.`),
    status: str("pending (default) or ready"),
  }, ["caption"]) },
  { name: "update_post", description: `Fix the title, caption, media URL or target network of a pending or ready post, or move it to the next stage. To claim a row before working on it, move it to scripting or rendering with expected_stage set to the stage it should still be at: the call is refused if another session got there first, and a refusal means the row is not yours. Set expected_stage on the write that finishes the work as well, not only on the one that claims it. A row that already carries media has been rendered and cannot be moved back to a stage before rendered — that video was paid for. Approved and posted posts belong to the operator and cannot be edited. ${OPERATOR_ONLY}`, inputSchema: obj({
    id: str("Post id"), title: str("New title"), caption: str("New caption"), media_url: str("New media URL"),
    platform: str(`Retarget the post: ${POST_PLATFORMS.join("|")}`),
    stage: str(`The stage the piece has reached: ${STAGES}`),
    expected_stage: str(`The stage the row must still be at for this update to apply (${STAGES}); refused otherwise.`),
  }, ["id"]) },
  { name: "list_projects", description: `The video projects — the plan each piece is made from, before it is rendered or cut — optionally filtered by status and/or kind. A plan at planned is waiting for a producer or clipper; rendering is claimed; rendered has its video on a post. ${OPERATOR_ONLY}`, inputSchema: obj({
    status: str(`Optional filter: ${PROJECT_STATES}`),
    kind: str(`Optional filter: ${PROJECT_KINDS.join("|")}`),
  }, []) },
  { name: "get_project", description: "One video project by id, with its scenes or sources in full.", inputSchema: obj({ id: str("Project id (proj_…)") }, ["id"]) },
  { name: "create_project", description: `Write the plan a video is made from, before anyone spends on it. A generation plan is the whole piece decided before the money: the hook, the beats as scenes, what holds the viewer, the facts it rests on and where they came from, the sound, the look, the model and the caption. A clipping plan is the source videos, the moments in them and why each one. A generation plan's scenes run ${LENGTH_PHRASE} in total and are rendered as ONE video — nothing joins clips — so plan shots one continuous generation can carry. Name the brief row it was written from as post_id and that row moves to scripted with the plan on it; a plan with no row gets its post when the render lands. Sign it with your name as agent. ${OPERATOR_ONLY}`, inputSchema: obj({
    kind: str(`${PROJECT_KINDS.join("|")} — rendered from scenes with generate_video, or cut from a source with clip_video`),
    post_id: str("The brief row (post_…) this plan is for, when there is one"),
    agent: str("Your own name, as the roster lists it — who planned this"),
    ...PLAN_FIELDS,
  }, ["kind", "title", "brief"]) },
  { name: "update_project", description: `Fix a plan, or move it through its life: ${PROJECT_STATES}. To claim a plan before rendering or cutting it, set status rendering with expected_status planned: the call is refused if another session got there first, and a refusal means the plan is not yours. To finish, set status rendered with expected_status rendering and the video as media_url — the store puts it on the plan's post, creating the post when the plan has none, and it lands in the operator's queue as pending. A rendered plan is final: that render was paid for. dropped is for a plan that will not be made. ${OPERATOR_ONLY}`, inputSchema: obj({
    id: str("Project id"),
    status: str(`The status the plan has reached: ${PROJECT_STATES}`),
    expected_status: str(`The status the plan must still be at for this update to apply (${PROJECT_STATES}); refused otherwise.`),
    media_url: str("With status rendered: the URL of the finished video"),
    agent: str("With status rendered: your own name — who rendered or cut it; it is signed on the post"),
    ...PLAN_FIELDS,
  }, ["id"]) },
  { name: "list_style_templates", description: "The channel's style templates (name, prompt, reference image, trend note).", inputSchema: obj({}, []) },
  { name: "list_accounts", description: "The social accounts the channel posts to.", inputSchema: obj({}, []) },
] as const;

/**
 * The tool list under the running template's fallback target — the names, for any caller that needs
 * them without a request in hand. What a live `tools/list` answers is `toolsFor(the resolved one)`.
 */
export const TOOLS = toolsFor([ACTIVE.platform]);

/**
 * *** A PLAN'S SCENES, COMPILED INTO THE ONE PROMPT `generate_video` IS ACTUALLY GIVEN. ***
 *
 * Nothing on this platform joins video, so a multi-scene plan is not several renders assembled —
 * it is ONE generation whose prompt describes the shots in order. That compilation used to live in
 * prose, in the producer's brief and again in its cron ("the prompt is the scenes in order with
 * their seconds, voiceover, on-screen text and look"), which is to say it lived nowhere: two
 * paragraphs asking a model to do a formatting job, differently each night, with the result
 * unreadable by anyone afterwards.
 *
 * It is a function now, and the producer is told to call `get_project` and render exactly the
 * `render_prompt` that comes back with it. That is the whole of the change: the seat still decides
 * nothing about the plan, and now it cannot quietly drop a scene while summarising one.
 *
 * `seconds` is the sum, because the sum is the video's length. It is not enforced here — `scenesOf`
 * refuses a plan outside the format when it is filed, which is where a refusal is still free.
 */
export const scenesPrompt = (project: { scenes?: Scene[]; styleTemplate?: string; sound?: Sound }): string => {
  const scenes = project.scenes ?? [];
  // A planner's field is a phrase, not a sentence: `prompt` arrives with no full stop and a
  // `voiceover` usually arrives with one. Running this for real showed both — "…candlelight
  // On-screen text:" ran two clauses together, and `Voiceover: "…afraid of?".` closed a question
  // with a full stop. The prompt is read by a model as prose, so punctuation is content here.
  const stop = (text: string): string => {
    const said = text.trim();
    return /[.!?…]$/.test(said) ? said : `${said}.`;
  };
  const quoted = (label: string, text: string): string => {
    const said = text.trim();
    return `${label}: "${said}"${/[.!?…]$/.test(said) ? "" : "."}`;
  };
  const shots = scenes.map((scene, i) => {
    const parts = [`Shot ${i + 1}${scene.beat === undefined ? "" : ` (${scene.beat})`}, ${scene.seconds}s: ${stop(scene.prompt)}`];
    if (scene.text !== undefined) parts.push(quoted("On-screen text", scene.text));
    if (scene.voiceover !== undefined) parts.push(quoted("Voiceover", scene.voiceover));
    return parts.join(" ");
  });
  const total = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  const lines = [
    `One continuous vertical video, ${total} seconds in total, ${shots.length} shot${shots.length === 1 ? "" : "s"} in order.`,
    ...(project.styleTemplate === undefined ? [] : [`Look: ${project.styleTemplate}, held across every shot.`]),
    ...(project.sound?.music === undefined ? [] : [`Music: ${stop(project.sound.music)}`]),
    ...(project.sound?.voice === undefined ? [] : [`Narration voice: ${stop(project.sound.voice)}`]),
    ...(project.sound?.sfx === undefined ? [] : [`Sound design: ${stop(project.sound.sfx.join("; "))}`]),
    ...shots,
  ];
  return lines.join("\n");
};

class ToolError extends Error {}
const need = (params: Record<string, unknown>, key: string, at = ""): string => {
  const value = params[key];
  if (typeof value !== "string" || value === "") throw new ToolError(`${at}${key} is required`);
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

const oneOf = <T extends string>(params: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined => {
  const value = optional(params, key);
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new ToolError(`${key} must be one of ${allowed.join(", ")}`);
  return value as T;
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isHttpUrl = (value: string): boolean => {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
};

/**
 * The scenes a caller sent, each checked, or undefined when none were.
 *
 * *** THE LENGTH IS CHECKED HERE, WHICH IS THE ONE PLACE IT CANNOT BE IGNORED. *** It used to be
 * the words "under fifteen seconds in all" in three prompts, and a prompt is a request: a plan that
 * ran to fifty seconds was filed, queued and rendered, and the first sign of it was the bill. The
 * sum is the number `generate_video` is actually asked for — nothing joins clips, so the shots are
 * one generation — so a plan whose sum is outside the format is not a plan this channel can make,
 * and the refusal arrives while it is still free to fix.
 */
const scenesOf = (params: Record<string, unknown>): Scene[] | undefined => {
  if (params.scenes === undefined) return undefined;
  if (!Array.isArray(params.scenes) || params.scenes.length === 0) throw new ToolError("scenes must be a non-empty array");
  const scenes = params.scenes.map((raw, i): Scene => {
    if (!isRecord(raw)) throw new ToolError(`scenes[${i}] must be an object`);
    const seconds = raw.seconds;
    if (typeof seconds !== "number" || !(seconds > 0)) throw new ToolError(`scenes[${i}].seconds must be a positive number`);
    const model = oneOf(raw, "model", VIDEO_MODELS);
    const beat = oneOf(raw, "beat", SCENE_BEATS);
    const voiceover = optional(raw, "voiceover");
    const text = optional(raw, "text");
    return {
      prompt: need(raw, "prompt", `scenes[${i}].`),
      seconds,
      ...(beat === undefined ? {} : { beat }),
      ...(voiceover === undefined ? {} : { voiceover }),
      ...(text === undefined ? {} : { text }),
      ...(model === undefined ? {} : { model }),
    };
  });
  const total = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  if (total < MIN_SECONDS || total > MAX_SECONDS) {
    throw new ToolError(
      `the scenes run ${total}s in all, and a piece on this channel is ${LENGTH_PHRASE} — the shots are rendered as one video, so their seconds are its length. Re-cut the shots rather than dropping the beats.`,
    );
  }
  return scenes;
};

/** The facts a caller sent, each with its source, or undefined when none were. */
const factsOf = (params: Record<string, unknown>): Fact[] | undefined => {
  if (params.facts === undefined) return undefined;
  if (!Array.isArray(params.facts)) throw new ToolError("facts must be an array");
  return params.facts.map((raw, i): Fact => {
    if (!isRecord(raw)) throw new ToolError(`facts[${i}] must be an object`);
    // Both halves required, because half a fact is the thing this field exists to stop: a claim
    // with no source reads as checked and is not, which is worse than no claim at all.
    return { claim: need(raw, "claim", `facts[${i}].`), source: need(raw, "source", `facts[${i}].`) };
  });
};

/** A list of lines a caller sent — blanks dropped — or undefined when the key was absent. */
const linesOf = (params: Record<string, unknown>, key: string): string[] | undefined => {
  if (params[key] === undefined) return undefined;
  if (!Array.isArray(params[key])) throw new ToolError(`${key} must be an array of strings`);
  const lines = (params[key] as unknown[]).flatMap((one) => (typeof one === "string" && one.trim() !== "" ? [one.trim()] : []));
  return lines.length === 0 ? undefined : lines;
};

/** How the piece sounds, or undefined when the caller said nothing about it. */
const soundOf = (params: Record<string, unknown>): Sound | undefined => {
  const raw = params.sound;
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new ToolError("sound must be an object");
  const music = optional(raw, "music");
  const voice = optional(raw, "voice");
  const sfx = linesOf(raw, "sfx");
  const sound = {
    ...(music === undefined ? {} : { music }),
    ...(voice === undefined ? {} : { voice }),
    ...(sfx === undefined ? {} : { sfx }),
  };
  return Object.keys(sound).length === 0 ? undefined : sound;
};

/** The sources a caller sent, each checked, or undefined when none were. */
const sourcesOf = (params: Record<string, unknown>): ClipSource[] | undefined => {
  if (params.sources === undefined) return undefined;
  if (!Array.isArray(params.sources) || params.sources.length === 0) throw new ToolError("sources must be a non-empty array");
  return params.sources.map((raw, i): ClipSource => {
    if (!isRecord(raw)) throw new ToolError(`sources[${i}] must be an object`);
    const url = need(raw, "url", `sources[${i}].`);
    if (!isHttpUrl(url)) throw new ToolError(`sources[${i}].url must be an http(s) URL`);
    const from = optional(raw, "from");
    const to = optional(raw, "to");
    return { url, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), reason: need(raw, "reason", `sources[${i}].`) };
  });
};

/**
 * The plan fields beyond the shots, as a patch — spread by both project tools so the two cannot
 * drift apart the way a hand-written list of eight `...(x === undefined ? {} : { x })` lines in two
 * places would. Absent stays absent: an omitted key is not written, so a patch that says nothing
 * about the sound does not erase it.
 */
const planExtras = (plan: ReturnType<typeof planOf>) => ({
  ...(plan.hook === undefined ? {} : { hook: plan.hook }),
  ...(plan.rejectedHooks === undefined ? {} : { rejectedHooks: plan.rejectedHooks }),
  ...(plan.retention === undefined ? {} : { retention: plan.retention }),
  ...(plan.cta === undefined ? {} : { cta: plan.cta }),
  ...(plan.facts === undefined ? {} : { facts: plan.facts }),
  ...(plan.sound === undefined ? {} : { sound: plan.sound }),
  ...(plan.referencePattern === undefined ? {} : { referencePattern: plan.referencePattern }),
  ...(plan.referenceFrames === undefined ? {} : { referenceFrames: plan.referenceFrames }),
});

/** The plan fields both project tools take, checked; `kind` says which half is required. */
const planOf = (params: Record<string, unknown>) => ({
  title: optional(params, "title"),
  brief: optional(params, "brief"),
  platform: oneOf(params, "platform", POST_PLATFORMS),
  account: optional(params, "account"),
  styleTemplate: optional(params, "style_template"),
  model: oneOf(params, "model", VIDEO_MODELS),
  scenes: scenesOf(params),
  sources: sourcesOf(params),
  caption: optional(params, "caption"),
  hook: optional(params, "hook"),
  rejectedHooks: linesOf(params, "rejected_hooks"),
  retention: optional(params, "retention"),
  cta: optional(params, "cta"),
  facts: factsOf(params),
  sound: soundOf(params),
  referencePattern: optional(params, "reference_pattern"),
  referenceFrames: linesOf(params, "reference_frames"),
});

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
    // The one refusal that is an answer, and it is narrower than its status: a 400 is "social
    // publishing is not activated for this identity" (canonical-spec §27) only when the envelope
    // names `param: "identity"`. A 400 without it is the social provider refusing a workspace that
    // is already live — a read that failed over accounts that may well exist, not an empty list.
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!notActivated(res.status, body)) {
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

/**
 * The id of the one session of a seat that is running right now, or null. An MCP call carries no
 * session id and an agent cannot see its own, so a plan is bound to the session writing it by
 * inference — and only when the inference cannot be wrong: zero or several running, null.
 */
export type WhoIsRunning = (agentName: string) => Promise<string | null>;

const nobody: WhoIsRunning = async () => null;

/**
 * Best-effort: the write is the point, the binding is a convenience for the Studio. A lookup that
 * fails or finds no single session records nothing and never fails the tool call.
 */
async function bind(store: Store, whoIsRunning: WhoIsRunning, id: string, agent: string | undefined, role: ProjectSession["role"]): Promise<void> {
  if (agent === undefined) return;
  let session: string | null;
  try {
    session = await whoIsRunning(agent);
  } catch {
    return;
  }
  if (session !== null) store.recordSession(id, { id: session, role, at: new Date().toISOString() });
}

async function callTool(name: string, params: Record<string, unknown>, store: Store, config: ProxyConfig | null, whoIsRunning: WhoIsRunning): Promise<unknown> {
  switch (name) {
    case "list_posts": {
      const stage = stageOf(params);
      return store.read().posts.filter((p) =>
        // `postStage`, not `p.stage`: a row filed before the field existed reads at the stage its
        // own contents put it at, and the seat that lists for work has to see the same stage the
        // claim it makes next will compare against.
        (params.status === undefined || p.status === params.status) && (stage === undefined || postStage(p) === stage),
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
        // Named by the agent, else the first network the operator chose in setup. Resolved here
        // rather than left to the store's own fallback because only this layer can await the read,
        // and because the agent was just told, on the tool it called, which network that is.
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
      // Compared through `postStage` for the same reason `list_posts` filters through it: a row the
      // seat was shown at `rendered` has to be claimable as `rendered`, and a derivation used on
      // one side of that pair and not the other is a guard that refuses the caller it just invited.
      const expected = stageOf(params, "expected_stage");
      const current = postStage(post);
      if (expected !== undefined && current !== expected) {
        throw new ToolError(`post is at stage ${current ?? "none"}, not ${expected}; another session has it`);
      }
      // THE OTHER END OF THE CLAIM, AND THE ONLY THING THAT MAKES A REPLAY COST NOTHING.
      //
      // `expected_stage` guards the START of the render; nothing guarded its end, and no field
      // recorded that a render had been paid for. So the manager's 08:00 sweep, putting a claim a
      // dead session left behind back to `scripted`, was an instruction to render a second time —
      // ~$9.00 (`ONE_RENDER_MICRO_USD`) for a video the channel already owns. The media on the row
      // IS the record: a row that carries one has been through the paid step, so it cannot be moved
      // back to a stage that precedes it, by the sweep or by anything else. Forward is untouched —
      // the producer's own write lands `rendered` with the video attached in the same call.
      const stage = stageOf(params);
      const media = optional(params, "media_url") ?? post.mediaUrl;
      if (stage !== undefined && media !== undefined && POST_STAGES.indexOf(stage) < POST_STAGES.indexOf("rendered")) {
        throw new ToolError(
          `post already has media attached: it has been rendered and that render was paid for. It cannot go back to ${stage} — take it to rendered. A piece that genuinely has to be remade is a new row; rendering this one again spends the render twice.`,
        );
      }
      // The same invariant read the other way, and the cheapest way to lose a piece. `rendered` is
      // what a row with a render attached IS — it is the word `postStage` derives from the media —
      // so writing it onto a row that carries none makes the stage and the evidence it is derived
      // from say different things about one row. It also strands the piece: `update_post {id, stage:
      // "rendered"}` on a fresh brief is out of the scriptwriter's list and out of the producer's,
      // parked at a stage that says the work is done, in a queue that cannot publish it (`postNow`
      // refuses a row with no video). The stage set is otherwise a membership check and not a state
      // machine — brief straight to scripting or scripted is a legal skip, because a seat may write
      // its result without claiming first — and this is the one transition worth spelling out.
      if (stage === "rendered" && media === undefined) {
        throw new ToolError("a post reaches rendered by having its video attached: send media_url with this call, or leave the stage where it is");
      }
      return store.updatePost(id, {
        title: optional(params, "title"),
        caption: optional(params, "caption"),
        mediaUrl: optional(params, "media_url"),
        stage,
        ...(target === undefined ? {} : { platform: target as PostPlatform }),
      });
    }
    case "list_projects": {
      const status = oneOf(params, "status", PROJECT_STATUSES);
      const kind = oneOf(params, "kind", PROJECT_KINDS);
      return store.read().projects.filter((p) => (status === undefined || p.status === status) && (kind === undefined || p.kind === kind));
    }
    case "get_project": {
      const project = store.read().projects.find((p) => p.id === need(params, "id"));
      if (!project) throw new ToolError("no such project");
      // A generation plan is handed back WITH the prompt its shots compile to, so the seat that
      // renders it does not have to compose one out of prose and cannot drop a shot while doing so
      // (`scenesPrompt`). Derived on read, never stored: a plan edited after a read must not be
      // rendered from a prompt built before it.
      if (project.kind !== "generation" || project.scenes === undefined) return project;
      return {
        ...project,
        render_prompt: scenesPrompt(project),
        render_seconds: project.scenes.reduce((sum, s) => sum + s.seconds, 0),
        // Handed back beside the prompt so the renderer passes them straight to `generate_video`
        // as `image_urls` rather than deciding for itself whether a plan has a reference: the
        // seat's whole instruction is "render exactly what get_project gave you".
        ...(project.referenceFrames === undefined ? {} : { render_reference_images: project.referenceFrames }),
      };
    }
    case "create_project": {
      const kind: ProjectKind | undefined = oneOf(params, "kind", PROJECT_KINDS);
      if (kind === undefined) throw new ToolError(`kind must be one of ${PROJECT_KINDS.join(", ")}`);
      const plan = planOf(params);
      // A plan is the thing the render is made from, so a plan with nothing to render from is not
      // one: scenes for a generation plan, sources for a clipping plan, refused rather than filed.
      if (kind === "generation" && plan.scenes === undefined) throw new ToolError("a generation plan needs scenes: the shots generate_video renders, in order");
      if (kind === "clipping" && plan.sources === undefined) throw new ToolError("a clipping plan needs sources: the videos to cut from and the moment in each");
      // The hook is the line the piece lives or dies on, and it was the one thing a plan had no
      // field for. Required at CREATE only: a later `update_project` patches a plan that already
      // has one, and a clipping plan's hook is the moment it cut, which `sources[].reason` carries.
      if (kind === "generation" && plan.hook === undefined) {
        throw new ToolError("a generation plan needs a hook: the first line of the piece, verbatim — what is said and what is on the frame at 0:00");
      }
      const postId = optional(params, "post_id");
      const brief = postId === undefined ? undefined : store.read().posts.find((p) => p.id === postId);
      if (postId !== undefined) {
        if (!brief) throw new ToolError("no such post");
        if (brief.projectId !== undefined) throw new ToolError(`post ${postId} already has a plan (${brief.projectId}); update that one`);
        if (brief.mediaUrl !== undefined) throw new ToolError("post already has media attached: it has been rendered, and a plan for it now would render it twice");
        if (brief.status !== "pending" && brief.status !== "ready") throw new ToolError(`post is ${brief.status}; a plan is written on a pending or ready brief`);
      }
      const agent = optional(params, "agent");
      const filed = store.createProject({
        kind,
        title: need(params, "title"),
        brief: need(params, "brief"),
        // Named by the agent, else the brief row's network, else the first the operator chose in
        // setup — awaited here for the same reason `create_post` awaits it.
        platform: plan.platform ?? brief?.platform ?? (await channelPlatform(config)),
        ...(plan.account === undefined ? {} : { account: plan.account }),
        ...(agent === undefined ? {} : { agent }),
        ...(postId === undefined ? {} : { postId }),
        ...(plan.styleTemplate === undefined ? {} : { styleTemplate: plan.styleTemplate }),
        ...(kind === "generation" ? { model: plan.model ?? VIDEO_MODELS[0] } : {}),
        ...(plan.scenes === undefined ? {} : { scenes: plan.scenes }),
        ...(plan.sources === undefined ? {} : { sources: plan.sources }),
        ...(plan.caption === undefined ? {} : { caption: plan.caption }),
        ...planExtras(plan),
      });
      await bind(store, whoIsRunning, filed.id, agent, "planned");
      return filed;
    }
    case "update_project": {
      const id = need(params, "id");
      const project = store.read().projects.find((p) => p.id === id);
      if (!project) throw new ToolError("no such project");
      // The claim, atomic under the store's lock exactly as `update_post`'s is: one session's
      // `rendering` lands, the other's is refused before it spends anything.
      const expected = oneOf(params, "expected_status", PROJECT_STATUSES);
      if (expected !== undefined && project.status !== expected) {
        throw new ToolError(`project is ${project.status}, not ${expected}; another session has it`);
      }
      const status: ProjectStatus | undefined = oneOf(params, "status", PROJECT_STATUSES);
      const media = optional(params, "media_url");
      // `rendered` is where the money went; nothing moves a plan out of it, nothing renders it
      // again, and nothing reaches it without the video it paid for.
      if (project.status === "rendered" && (status !== undefined || media !== undefined)) {
        throw new ToolError("project is rendered and that render was paid for; it cannot go back or be rendered again. A piece that has to be remade is a new plan.");
      }
      // The operator's revision is a paid claim too: it is finished with the video, never freed —
      // unless the session holding it died with it. Nothing else clears a revision: the finishing
      // `rendered` write is its only normal exit, and a renderer dies for routine reasons (a blown
      // per-task ceiling has parked one on production), which wedged the plan at `rendering` for
      // good. So the 08:00 sweep's own rule reaches it: a claim more than a day old is dead, and
      // the manager's `planned` frees it — to `rendered` on the video the plan still has, never to
      // `planned`, which would buy that video a second time.
      if (project.revision !== undefined && status !== undefined && status !== "rendered") {
        if (status !== "planned" || Date.now() - Date.parse(project.revision.openedAt) <= DEAD_CLAIM_MS) {
          throw new ToolError("project is being revised on the operator's note; a revised plan goes forward only — finish it with status rendered and its media_url");
        }
        return store.closeRevision(id);
      }
      const post = project.postId === undefined ? undefined : store.read().posts.find((p) => p.id === project.postId);
      if (post?.status === "rejected" && (status === "rendering" || status === "rendered")) {
        throw new ToolError(`post ${post.id} was rejected (${post.rejectedReason ?? "no reason"}); its plan is not made`);
      }
      if (status === "rendered" && project.status !== "rendered" && media === undefined) {
        throw new ToolError("a plan reaches rendered by having its video attached: send media_url with this call");
      }
      if (project.status === "dropped" && status !== undefined && status !== "dropped" && status !== "planned") {
        throw new ToolError("project is dropped; put it back to planned first");
      }
      const plan = planOf(params);
      const agent = optional(params, "agent");
      const moved = store.updateProject(id, {
        ...(status === undefined ? {} : { status }),
        ...(status === "rendered" && media !== undefined ? { mediaUrl: media } : {}),
        ...(status === "rendered" && agent !== undefined ? { renderedBy: agent } : {}),
        ...(plan.title === undefined ? {} : { title: plan.title }),
        ...(plan.brief === undefined ? {} : { brief: plan.brief }),
        ...(plan.platform === undefined ? {} : { platform: plan.platform }),
        ...(plan.account === undefined ? {} : { account: plan.account }),
        ...(plan.styleTemplate === undefined ? {} : { styleTemplate: plan.styleTemplate }),
        ...(plan.model === undefined ? {} : { model: plan.model }),
        ...(plan.scenes === undefined ? {} : { scenes: plan.scenes }),
        ...(plan.sources === undefined ? {} : { sources: plan.sources }),
        ...(plan.caption === undefined ? {} : { caption: plan.caption }),
        ...planExtras(plan),
      });
      // The claim names no seat; the plan's kind does.
      if (moved !== null && (status === "rendering" || status === "rendered")) await bind(store, whoIsRunning, id, agent ?? RENDERER[project.kind], "rendered");
      return moved;
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
export async function handleMcp(raw: string, store: Store, config: ProxyConfig | null, whoIsRunning: WhoIsRunning = nobody): Promise<object | null> {
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
  // Built per request, because the sentence on `create_post` names the networks this install
  // actually posts to and two installs of the same template answer differently.
  if (msg.method === "tools/list") return rpcResult(msg.id, { tools: toolsFor(await channelPlatforms(config)) });
  if (msg.method === "tools/call") {
    const { name, arguments: args } = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    try {
      const result = await callTool(name ?? "", args ?? {}, store, config, whoIsRunning);
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
