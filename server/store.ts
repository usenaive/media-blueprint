/**
 * The dashboard's local file store: posts and style templates persist as one
 * JSON file under `data/`. Deliberately the least
 * storage that works — the upgrade path is the platform app database
 * (`POST /v1/apps/:id/db/query`), noted in the README.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLIPPING_SEEDS, FACELESS_SEEDS, type Post, type PostPlatform, type PostStage, type PostStatus } from "../seed/posts.ts";
import { STYLE_TEMPLATE_SEEDS, type StyleTemplateSeed } from "../seed/style-templates.ts";
import { ACTIVE, type MediaTemplate, type TemplateName } from "../templates/index.ts";

/** The demo rows of each template; a deployment starts empty, so these are `pnpm serve` only. */
const SEEDS: Record<TemplateName, Post[]> = { faceless: FACELESS_SEEDS, clipping: CLIPPING_SEEDS };

/**
 * The setup answers are deliberately NOT here. The studio asks them once, before the crew exists
 * (`questions` in `naive.config.ts`), the platform holds them on the install, and both the agents
 * (`project_context`) and the dashboard (`GET /api/context`) read them from there.
 */
export interface StoreState {
  posts: Post[];
  /** The style-template catalogue (`seed/style-templates.ts`), not the blueprint's templates. */
  templates: StyleTemplateSeed[];
}

/**
 * What an agent files over MCP.
 *
 * `agent`, `account` and `source` are what make a filed row legible to the operator who has to
 * approve it. Without them a real agent's post arrived as "by mcp · unassigned" — the transport's
 * name where the author belongs and a placeholder where the destination belongs — while the
 * screenshot that sold the queue showed a named agent posting to a named account. They are
 * optional because the agent may genuinely not know one yet, and an unknown is now said rather
 * than filled in with a word that reads like an answer.
 */
export interface NewPostInput {
  caption: string;
  mediaUrl?: string;
  platform?: PostPlatform;
  /** The agent's own name, as the roster lists it. */
  agent?: string;
  /** The connected account this is for — a handle from `list_accounts`. */
  account?: string;
  /** What it was made from: the brief, the source video, the style template. */
  source?: string;
  /** Where in the pipeline this row starts — `brief` for a topic filed for the next seat; unset for a note. */
  stage?: PostStage;
  status: Extract<PostStatus, "pending" | "ready">;
}

export interface Store {
  read(): StoreState;
  createPost(input: NewPostInput): Post;
  updatePost(id: string, patch: Partial<Pick<Post, "status" | "rejectedReason" | "title" | "caption" | "mediaUrl" | "platform" | "stage">>): Post | null;
}

const seedState = (template: MediaTemplate = ACTIVE): StoreState => ({
  posts: structuredClone(SEEDS[template.name]),
  templates: [...STYLE_TEMPLATE_SEEDS],
});

/**
 * What a fresh **deployed** document is created with: no posts, no niche. An empty queue is the
 * truth about a new channel; seeded rows would present fabricated work as the operator's own.
 * The style templates stay — they are the blueprint's shipped catalogue of presets, offered to the
 * producer agent from the first turn, not rows pretending to be anyone's work.
 */
const emptyState = (): StoreState => ({
  posts: [],
  templates: [...STYLE_TEMPLATE_SEEDS],
});

/** `seedState` is the local file store's first run only (`pnpm serve`); `emptyState` is the deployment. */
export { emptyState, seedState };

/** Opens (and on first run seeds) the JSON store at `file`, with the running template's demo rows. */
export function openStore(file: string, template: MediaTemplate = ACTIVE): Store {
  let state: StoreState;
  try {
    state = JSON.parse(readFileSync(file, "utf8")) as StoreState;
  } catch {
    state = seedState(template);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
  }
  return openStoreOver(state, (next) => writeFileSync(file, JSON.stringify(next, null, 2)), template);
}

/**
 * The store's behaviour over a state already in hand, with persistence injected. The file store
 * above is one caller; the deployed app's `api/mcp` is the other — a serverless request has no
 * durable disk, so it loads the document from the app database, runs exactly this logic, and writes
 * it back. One implementation is why `pnpm serve` and the deployment behave identically.
 */
/**
 * The row's title, cut from the caption the agent wrote — the tool takes no title of its own.
 *
 * The cut used to be `caption.split("\n")[0]`, which is `""` for a caption that opens on a blank
 * line: a hook set off from its body, or a model's own leading newline. The platform's social API
 * takes an optional title and refuses an empty one, so those rows could be approved and never
 * published. The first line with something on it is the title; a caption with nothing on any line
 * has no title to cut, and the publish route lets the platform cut its own from the content.
 */
const titleFrom = (caption: string): string =>
  (caption.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? "").slice(0, 60);

export function openStoreOver(
  state: StoreState,
  persist: (state: StoreState) => void,
  template: MediaTemplate = ACTIVE,
): Store {
  const save = () => persist(state);

  return {
    read: () => state,
    createPost(input) {
      const post: Post = {
        id: `post_${randomBytes(2).toString("hex")}`,
        title: titleFrom(input.caption),
        caption: input.caption,
        ...(input.mediaUrl === undefined ? {} : { mediaUrl: input.mediaUrl }),
        // No platform named: the network this template declares the channel posts to. It was the
        // constant `"x"`, which is how a channel of vertical video filed nine posts to a text
        // network — the target is the channel's, not this file's (`templates/template.ts`).
        platform: input.platform ?? template.platform,
        // Only what the caller actually said. The row used to be stamped `agent: "mcp"`,
        // `account: "unassigned"` and `duration: "—"` whatever it knew, so every agent-filed post
        // printed the transport's name, a placeholder handle and an em dash where its running time
        // goes. An absent field is left absent and the screen names it as unknown.
        ...(input.agent === undefined ? {} : { agent: input.agent }),
        ...(input.account === undefined ? {} : { account: input.account }),
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.stage === undefined ? {} : { stage: input.stage, stageAt: new Date().toISOString() }),
        // The kind is the template's first, not a constant: a `faceless` channel files what its
        // producer made, a `clipping` channel files a cut. The row is read by the same screens.
        kind: template.kinds[0].id,
        status: input.status,
      };
      state.posts.unshift(post);
      save();
      return post;
    },
    updatePost(id, patch) {
      const post = state.posts.find((p) => p.id === id);
      if (!post) return null;
      if (patch.title !== undefined) post.title = patch.title;
      if (patch.caption !== undefined) post.caption = patch.caption;
      if (patch.mediaUrl !== undefined) post.mediaUrl = patch.mediaUrl;
      // Retargeting. `postNow` refuses a row it cannot publish with "retarget the post first", and
      // until this line there was nowhere in the dashboard or in `/mcp` that could do it.
      if (patch.platform !== undefined) post.platform = patch.platform;
      if (patch.stage !== undefined) {
        post.stage = patch.stage;
        post.stageAt = new Date().toISOString();
      }
      if (patch.status !== undefined) post.status = patch.status;
      if (patch.status === "posted") {
        post.postedAt = "just now";
        post.views ??= 0;
        post.likes ??= 0;
      }
      if (patch.status === "rejected") post.rejectedReason = patch.rejectedReason ?? "Rejected by you";
      save();
      return post;
    },
  };
}
