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
import { CLIPPING_PROJECT_SEEDS, FACELESS_PROJECT_SEEDS, type ProjectSession, type ProjectStatus, type VideoProject } from "../seed/projects.ts";
import { STYLE_TEMPLATE_SEEDS, type StyleTemplateSeed } from "../seed/style-templates.ts";
import { ACTIVE, type MediaTemplate, type TemplateName } from "../templates/index.ts";

/** The demo rows of each template; a deployment starts empty, so these are `pnpm serve` only. */
const SEEDS: Record<TemplateName, Post[]> = { faceless: FACELESS_SEEDS, clipping: CLIPPING_SEEDS };
const PROJECT_SEEDS: Record<TemplateName, VideoProject[]> = { faceless: FACELESS_PROJECT_SEEDS, clipping: CLIPPING_PROJECT_SEEDS };

/**
 * The setup answers are deliberately NOT here. The studio asks them once, before the crew exists
 * (`questions` in `naive.config.ts`), the platform holds them on the install, and both the agents
 * (`project_context`) and the dashboard (`GET /api/context`) read them from there.
 */
export interface StoreState {
  posts: Post[];
  /** The plans the posts are made from (`seed/projects.ts`). */
  projects: VideoProject[];
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

/**
 * What a planning seat files as a video project: everything about the piece that is decided
 * before the paid step. The plan's `kind` says which seat makes it and with what — a generation
 * plan carries scenes for `generate_video`, a clipping plan carries sources for `clip_video` —
 * and `postId` ties it to the brief row it was written from, when there is one.
 */
export type NewProjectInput = Pick<VideoProject, "kind" | "title" | "brief"> &
  Partial<Pick<VideoProject, "platform" | "account" | "agent" | "postId" | "styleTemplate" | "model" | "scenes" | "sources" | "caption">>;

/**
 * What may change on a plan. `status` is the lifecycle (`PROJECT_STATUSES`); a move to `rendered`
 * carries `mediaUrl`, the render itself, which the store puts on the plan's post — creating the
 * post when the plan has none — so the one write that ends a render also files it for review.
 */
export type ProjectPatch = Partial<
  Pick<VideoProject, "status" | "title" | "brief" | "account" | "platform" | "styleTemplate" | "model" | "scenes" | "sources" | "caption">
> & { mediaUrl?: string; renderedBy?: string };

export interface Store {
  read(): StoreState;
  createPost(input: NewPostInput): Post;
  updatePost(id: string, patch: Partial<Pick<Post, "status" | "rejectedReason" | "title" | "caption" | "mediaUrl" | "platform" | "stage">>): Post | null;
  createProject(input: NewProjectInput): VideoProject;
  updateProject(id: string, patch: ProjectPatch): VideoProject | null;
  /** Binds a session to a plan; a session already on it is left as first recorded. Null for no such plan. */
  recordSession(id: string, session: ProjectSession): VideoProject | null;
  /**
   * THE OPERATOR'S REVISION: the one move that takes a rendered plan back to `rendering`, under the
   * same lock as the claim. Null when there is no such plan, it is not rendered, a revision is
   * already open, or its post is approved or posted — an approved video is the operator's word.
   */
  openRevision(id: string, sessionId: string, note: string): VideoProject | null;
}

const seedState = (template: MediaTemplate = ACTIVE): StoreState => ({
  posts: structuredClone(SEEDS[template.name]),
  projects: structuredClone(PROJECT_SEEDS[template.name]),
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
  projects: [],
  templates: [...STYLE_TEMPLATE_SEEDS],
});

/** `seedState` is the local file store's first run only (`pnpm serve`); `emptyState` is the deployment. */
export { emptyState, seedState };

/** Opens (and on first run seeds) the JSON store at `file`, with the running template's demo rows. */
export function openStore(file: string, template: MediaTemplate = ACTIVE, defaultPlatform?: PostPlatform): Store {
  let state: StoreState;
  try {
    state = JSON.parse(readFileSync(file, "utf8")) as StoreState;
  } catch {
    state = seedState(template);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
  }
  return openStoreOver(state, (next) => writeFileSync(file, JSON.stringify(next, null, 2)), template, defaultPlatform);
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
  /**
   * WHERE THIS CHANNEL POSTS, as the customer answered it in the studio — the network stamped on
   * a row whose caller named none. Resolved from the applied install by `server/channel.ts` and
   * passed in, because reading it is a pair of upstream calls and this file is synchronous.
   *
   * Omitted, the stamp falls back to `template.platform`, which is where the answer used to be
   * decided outright: a per-template literal, before that a literal in `server/mcp.ts` reading
   * `"x"`, which is how a channel of vertical video filed nine text-network posts. It is a
   * fallback now and only a fallback — an install with no answer, or one whose context could not
   * be read this second, still files somewhere sane.
   */
  defaultPlatform?: PostPlatform,
): Store {
  // A document written before plans existed has no `projects`; it gains an empty list here,
  // in memory, and the first write that follows persists it. `save` is not called for this alone.
  state.projects ??= [];
  for (const project of state.projects) project.sessions ??= [];
  const save = () => persist(state);
  const now = () => new Date().toISOString();

  const setStage = (post: Post | undefined, stage: PostStage) => {
    if (post === undefined || post.stage === stage) return;
    post.stage = stage;
    post.stageAt = now();
  };
  const setStatus = (project: VideoProject, status: ProjectStatus) => {
    project.status = status;
    project.statusAt = now();
  };

  const createPost = (input: NewPostInput, id = `post_${randomBytes(2).toString("hex")}`): Post => {
    const post: Post = {
      id,
      title: titleFrom(input.caption),
      caption: input.caption,
      ...(input.mediaUrl === undefined ? {} : { mediaUrl: input.mediaUrl }),
      // Named by the caller, else the customer's own setup answer, else the template's fallback.
      // The target is the channel owner's — it is not this file's and it is no longer a literal.
      platform: input.platform ?? defaultPlatform ?? template.platform,
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
  };

  return {
    read: () => state,
    createPost,
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
        post.postedAt = new Date().toISOString();
        post.views ??= 0;
        post.likes ??= 0;
      }
      if (patch.status === "rejected") {
        post.rejectedReason = patch.rejectedReason ?? "Rejected by you";
        // Rejecting a brief drops the plan written on it, so no producer picks it up at 07:00.
        const plan = post.projectId === undefined ? undefined : state.projects.find((p) => p.id === post.projectId);
        if (plan !== undefined && plan.status !== "rendered") setStatus(plan, "dropped");
      }
      save();
      return post;
    },
    createProject(input) {
      const brief = input.postId === undefined ? undefined : state.posts.find((p) => p.id === input.postId);
      // ONE ID FROM BRIEF TO PLAN TO POST. A plan written on a brief is the brief's id; a plan with
      // no brief gives its id to the post its render files (below). The operator follows one id
      // across Posts and Projects, and a producer told to render `X` claims exactly `X`.
      // A brief holds one plan (`server/mcp.ts` refuses a second), so the id is never taken.
      const id = brief?.id ?? `proj_${randomBytes(2).toString("hex")}`;
      const project: VideoProject = {
        id,
        kind: input.kind,
        status: "planned",
        statusAt: now(),
        createdAt: now(),
        title: input.title,
        brief: input.brief,
        // The plan is for the row it was written from, where there is one, else for the network
        // the caller named, else the customer's own answer — the same fallback a post takes.
        platform: input.platform ?? brief?.platform ?? defaultPlatform ?? template.platform,
        ...(input.account === undefined ? {} : { account: input.account }),
        ...(input.agent === undefined ? {} : { agent: input.agent }),
        ...(brief === undefined ? {} : { postId: brief.id }),
        ...(input.styleTemplate === undefined ? {} : { styleTemplate: input.styleTemplate }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.scenes === undefined ? {} : { scenes: input.scenes }),
        ...(input.sources === undefined ? {} : { sources: input.sources }),
        ...(input.caption === undefined ? {} : { caption: input.caption }),
        sessions: [],
      };
      state.projects.unshift(project);
      // A brief with a plan on it is scripted: the writer's work is the plan, and the producer's
      // queue reads the plan, not the caption.
      if (brief !== undefined) {
        brief.projectId = project.id;
        setStage(brief, "scripted");
      }
      save();
      return project;
    },
    updateProject(id, patch) {
      const project = state.projects.find((p) => p.id === id);
      if (!project) return null;
      const before = project.statusAt;
      if (patch.title !== undefined) project.title = patch.title;
      if (patch.brief !== undefined) project.brief = patch.brief;
      if (patch.account !== undefined) project.account = patch.account;
      if (patch.platform !== undefined) project.platform = patch.platform;
      if (patch.styleTemplate !== undefined) project.styleTemplate = patch.styleTemplate;
      if (patch.model !== undefined) project.model = patch.model;
      if (patch.scenes !== undefined) project.scenes = patch.scenes;
      if (patch.sources !== undefined) project.sources = patch.sources;
      if (patch.caption !== undefined) project.caption = patch.caption;
      const post = project.postId === undefined ? undefined : state.posts.find((p) => p.id === project.postId);
      // The plan and its row publish to the same place, so retargeting the plan retargets the row
      // while the row is still the crew's (pending or ready); an approved row is the operator's.
      if (post !== undefined && (post.status === "pending" || post.status === "ready")) {
        if (patch.platform !== undefined) post.platform = patch.platform;
        if (patch.account !== undefined) post.account = patch.account;
      }
      if (patch.status !== undefined && patch.status !== project.status) {
        setStatus(project, patch.status);
        // The post mirrors the plan: claimed is `rendering`, freed is `scripted`, done is `rendered`.
        if (patch.status === "rendering") setStage(post, "rendering");
        if (patch.status === "planned") setStage(post, "scripted");
      }
      if (patch.status === "rendered" && patch.mediaUrl !== undefined) {
        if (post === undefined) {
          // A plan with no brief row — a clipping scout's, or a plan written from Chat — gets its
          // post here, so the render is filed for review by the same write that records it.
          const filed = createPost(
            {
              caption: project.caption ?? `${project.title}\n\n${project.brief}`,
              mediaUrl: patch.mediaUrl,
              platform: project.platform,
              ...(project.account === undefined ? {} : { account: project.account }),
              ...(patch.renderedBy === undefined ? {} : { agent: patch.renderedBy }),
              source: `${project.title} (${project.id})`,
              stage: "rendered",
              status: "pending",
            },
            project.id,
          );
          filed.projectId = project.id;
          project.postId = filed.id;
        } else {
          // A revised render supersedes the file the post carried: that render was paid for too,
          // so it is kept, with the session that made it, rather than overwritten.
          if (project.revision !== undefined && post.mediaUrl !== undefined) {
            const opened = project.revision.openedAt;
            const prior = [...project.sessions].reverse().find((s) => s.role !== "planned" && s.at < opened);
            project.renders = [...(project.renders ?? []), { mediaUrl: post.mediaUrl, at: before, ...(prior === undefined ? {} : { sessionId: prior.id }) }];
          }
          post.mediaUrl = patch.mediaUrl;
          if (project.caption !== undefined) {
            post.caption = project.caption;
            post.title = titleFrom(project.caption);
          }
          if (patch.renderedBy !== undefined) post.agent = patch.renderedBy;
          setStage(post, "rendered");
        }
        delete project.revision;
      }
      save();
      return project;
    },
    recordSession(id, session) {
      const project = state.projects.find((p) => p.id === id);
      if (!project) return null;
      if (project.sessions.some((s) => s.id === session.id)) return project;
      project.sessions.push(session);
      save();
      return project;
    },
    openRevision(id, sessionId, note) {
      const project = state.projects.find((p) => p.id === id);
      if (!project || project.status !== "rendered" || project.revision !== undefined) return null;
      const post = project.postId === undefined ? undefined : state.posts.find((p) => p.id === project.postId);
      if (post?.status === "approved" || post?.status === "posted") return null;
      project.revision = { openedAt: now(), sessionId, note };
      setStatus(project, "rendering");
      if (post !== undefined) {
        setStage(post, "rendering");
        // Back to the crew's queue: the operator asked for another take, so the old verdict is spent.
        if (post.status === "ready" || post.status === "rejected") {
          post.status = "pending";
          delete post.rejectedReason;
        }
      }
      save();
      return project;
    },
  };
}
