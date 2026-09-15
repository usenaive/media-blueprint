import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACELESS_SEEDS } from "../seed/posts";
import { CLIPPING_PROJECT_SEEDS, FACELESS_PROJECT_SEEDS } from "../seed/projects";
import { ACTIVE, TEMPLATES } from "../templates/index.ts";
import { emptyState, openStore, openStoreOver, seedState, type StoreState } from "./store";

const dirs: string[] = [];
const storeFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-store-"));
  dirs.push(dir);
  return join(dir, "store.json");
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("emptyState", () => {
  it("is what a fresh deployment starts from: no posts, no niche, the shipped presets", () => {
    // A new channel has published nothing and filed nothing. Seeding the deployed document would
    // present nine invented posts as the operator's own queue; the presets stay because they are
    // the blueprint's shipped catalogue, offered to the producer from its first turn.
    expect(emptyState().posts).toEqual([]);
    expect(emptyState().projects).toEqual([]);
    expect(emptyState().templates).toEqual(seedState().templates);
    expect(emptyState().templates.length).toBeGreaterThan(0);
  });

  it("holds no setup answers: those are the install's, read through the platform", () => {
    // The store used to carry an `onboarding` profile the dashboard asked for on a screen of its
    // own. The studio asks the template's questions before the crew exists, so a second copy here
    // could only ever disagree with the one the agents read via `project_context`.
    expect(Object.keys(emptyState())).toEqual(["posts", "projects", "templates"]);
    expect(Object.keys(seedState(TEMPLATES.clipping))).toEqual(["posts", "projects", "templates"]);
  });

  it("reads a document written before plans existed, and gives it an empty list of them", () => {
    // The deployed row is one JSONB document; the ones already out there have `posts` and
    // `templates` and nothing else. Opening one must not throw on `projects`, and the first plan
    // filed into it must persist alongside the posts it already holds.
    const legacy = { posts: FACELESS_SEEDS, templates: emptyState().templates } as unknown as StoreState;
    let written: StoreState | undefined;
    const store = openStoreOver(legacy, (next) => { written = next; }, TEMPLATES.faceless);
    expect(store.read().projects).toEqual([]);
    expect(written).toBeUndefined();
    const plan = store.createProject({ kind: "generation", title: "t", brief: "b", scenes: [{ prompt: "p", seconds: 3 }] });
    expect(written?.projects).toEqual([plan]);
    expect(written?.posts).toBe(legacy.posts);
  });
});

describe("the template's own state", () => {
  it("seeds the demo queue of the template that is running, not of the other one", () => {
    expect(seedState(TEMPLATES.faceless).posts).toEqual(FACELESS_SEEDS);
    expect(seedState(TEMPLATES.clipping).posts.every((post) => post.kind === "clip")).toBe(true);
    expect(seedState(TEMPLATES.clipping).posts.every((post) => post.agent === "clipper")).toBe(true);
    expect(seedState(TEMPLATES.faceless).projects).toEqual(FACELESS_PROJECT_SEEDS);
    expect(seedState(TEMPLATES.clipping).projects).toEqual(CLIPPING_PROJECT_SEEDS);
    expect(FACELESS_PROJECT_SEEDS.every((p) => p.kind === "generation" && (p.scenes?.length ?? 0) > 0)).toBe(true);
    expect(CLIPPING_PROJECT_SEEDS.every((p) => p.kind === "clipping" && (p.sources?.length ?? 0) > 0)).toBe(true);
  });

  it("records who filed a post, what for and what from — and invents none of the three", () => {
    // The row was stamped `agent: "mcp"`, `account: "unassigned"` and `duration: "—"` whatever the
    // caller said, so a real agent's post arrived in the queue naming the transport as its author
    // and a placeholder as its destination: nothing the operator approving it could act on.
    const store = openStoreOver(emptyState(), () => {});
    const signed = store.createPost({
      caption: "Rule two will sting.",
      agent: "producer",
      account: "@dailystoic",
      source: "Brief: three stoic rules, marble & ink",
      status: "pending",
    });
    expect(signed).toMatchObject({ agent: "producer", account: "@dailystoic", source: "Brief: three stoic rules, marble & ink" });

    const unsigned = store.createPost({ caption: "Anonymous.", status: "pending" });
    expect(unsigned.agent).toBeUndefined();
    expect(unsigned.account).toBeUndefined();
    expect(unsigned.duration).toBeUndefined();
    expect(unsigned).not.toHaveProperty("hue");
  });

  it("files a post with no kind stated as the kind this template makes", () => {
    // Hard-coded `clip` before: a faceless channel, which cuts nothing, filed every agent's work
    // as a clip.
    const filed = (template = ACTIVE) =>
      openStoreOver(emptyState(), () => {}, template).createPost({ caption: "One line.", status: "pending" });
    expect(filed(TEMPLATES.faceless).kind).toBe("produced");
    expect(filed(TEMPLATES.clipping).kind).toBe("clip");
  });
});

describe("openStore", () => {
  it("seeds posts and templates on first run", () => {
    const store = openStore(storeFile());
    expect(store.read().posts).toEqual(seedState(ACTIVE).posts);
    expect(store.read().templates.length).toBeGreaterThan(0);
  });

  it("persists the posts lifecycle across reopen", () => {
    const file = storeFile();
    // One template's demo queue by name: these row ids must keep meaning the same thing after a
    // template switch, because what is being tested here is the store, not the crew.
    const store = openStore(file, TEMPLATES.faceless);
    expect(store.updatePost("post_9f2a", { status: "approved" })?.status).toBe("approved");
    expect(store.updatePost("post_7d3c", { status: "rejected", rejectedReason: "too spicy" })?.rejectedReason).toBe("too spicy");
    const posted = store.updatePost("post_9f2a", { status: "posted" });
    // An ISO stamp, not a phrase: the analytics chart places the row on its day from this.
    expect(posted?.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const reopened = openStore(file, TEMPLATES.faceless);
    expect(reopened.read().posts.find((p) => p.id === "post_9f2a")?.status).toBe("posted");
    expect(reopened.read().posts.find((p) => p.id === "post_7d3c")?.rejectedReason).toBe("too spicy");
  });

  it("files a new post at the head of the queue and edits its caption in place", () => {
    const file = storeFile();
    const store = openStore(file);
    const post = store.createPost({ caption: "Rule two will sting.\n#stoicism", mediaUrl: "https://cdn.example/clip.mp4", status: "pending" });
    expect(post.id).toMatch(/^post_[0-9a-f]{4}$/);
    expect(post).toMatchObject({ title: "Rule two will sting.", status: "pending", mediaUrl: "https://cdn.example/clip.mp4" });
    // Filed with no destination: the network the running template says this channel posts to —
    // not a constant, which is how a channel of vertical video filed every row to a text network.
    expect(post.platform).toBe(ACTIVE.platform);
    expect(store.read().posts[0]).toBe(post);
    expect(store.updatePost(post.id, { caption: "Rule three, then." })).toMatchObject({ caption: "Rule three, then.", status: "pending" });
    expect(store.updatePost(post.id, { title: "Rule three" })).toMatchObject({ title: "Rule three", caption: "Rule three, then." });
    expect(openStore(file).read().posts[0]).toEqual(post);
    expect(store.createPost({ caption: "In the sky", platform: "instagram", status: "ready" }).platform).toBe("instagram");
  });

  it("carries a piece's stage from brief to rendered, apart from its status, and a note carries none", () => {
    const file = storeFile();
    const store = openStore(file);
    const note = store.createPost({ caption: "Hook style: short, plain, no questions.", status: "pending" });
    expect(note.stage).toBeUndefined();
    const brief = store.createPost({ caption: "Why the Stoics slept on the floor", status: "pending", stage: "brief" });
    expect(brief.stage).toBe("brief");
    expect(store.updatePost(brief.id, { caption: "Hook: ...\nScript: ...", stage: "scripted" })).toMatchObject({ stage: "scripted", status: "pending" });
    expect(store.updatePost(brief.id, { mediaUrl: "https://cdn.example/floor.mp4", stage: "rendered" })).toMatchObject({ stage: "rendered", status: "pending" });
    expect(store.updatePost(brief.id, { status: "approved" })).toMatchObject({ stage: "rendered", status: "approved" });
    const reopened = openStore(file).read().posts;
    expect(reopened.find((p) => p.id === brief.id)?.stage).toBe("rendered");
    // Each move stamps when it happened, so a claim a dead session left can be aged out; a note has none.
    expect(Date.parse(reopened.find((p) => p.id === brief.id)?.stageAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(reopened.find((p) => p.id === note.id)).not.toHaveProperty("stage");
    expect(reopened.find((p) => p.id === note.id)).not.toHaveProperty("stageAt");
    // The demo rows predate the field and stay readable without it.
    for (const seeded of reopened.filter((p) => p.id !== brief.id && p.id !== note.id)) expect(seeded.stage).toBeUndefined();
  });

  it("returns null for an unknown post", () => {
    expect(openStore(storeFile()).updatePost("post_nope", { status: "approved" })).toBeNull();
    expect(openStore(storeFile()).updateProject("proj_nope", { status: "dropped" })).toBeNull();
  });

  /**
   * THE PLAN AND THE ROW IT IS FOR. A generation plan is written on a brief and moves that brief
   * to scripted; its status is mirrored onto the row's stage as it is claimed, freed and finished,
   * so the Posts screen and the Projects screen never tell two stories about one piece.
   */
  it("writes a generation plan on its brief and mirrors the plan's life onto the row, across reopen", () => {
    const file = storeFile();
    const store = openStore(file, TEMPLATES.faceless);
    const brief = store.createPost({ caption: "Why the Stoics slept on the floor", status: "pending", stage: "brief", agent: "trend-scout" });
    const plan = store.createProject({
      kind: "generation", postId: brief.id, agent: "scriptwriter", title: "Sleep on the floor", brief: "Comfort is the trap.",
      styleTemplate: "Sunlit stoic", model: "alibaba/wan-3.0", caption: "Seneca slept on the floor. #stoicism",
      scenes: [{ prompt: "A stone floor at dawn", seconds: 4, voiceover: "He chose the floor.", text: "on purpose" }, { prompt: "A mattress pushed away", seconds: 5 }],
    });
    // One id from brief to plan to post: the plan IS the brief's id.
    expect(plan.id).toBe(brief.id);
    expect(plan).toMatchObject({ status: "planned", postId: brief.id, platform: brief.platform, agent: "scriptwriter" });
    expect(Date.parse(plan.createdAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(plan.statusAt).toBe(plan.createdAt);
    expect(store.read().projects[0]).toBe(plan);
    const row = () => store.read().posts.find((p) => p.id === brief.id);
    expect(row()).toMatchObject({ stage: "scripted", projectId: plan.id });

    expect(store.updateProject(plan.id, { status: "rendering" })?.status).toBe("rendering");
    expect(row()?.stage).toBe("rendering");
    expect(store.updateProject(plan.id, { status: "planned" })?.status).toBe("planned");
    expect(row()?.stage).toBe("scripted");
    // Editing the plan leaves its status and stamp alone.
    const { statusAt } = store.read().projects[0]!;
    expect(store.updateProject(plan.id, { title: "Floor, not bed", scenes: [{ prompt: "Only one shot", seconds: 6 }] })).toMatchObject({ title: "Floor, not bed", status: "planned", statusAt });
    expect(store.read().projects[0]?.scenes).toHaveLength(1);

    const posts = store.read().posts.length;
    store.updateProject(plan.id, { status: "rendering" });
    const done = store.updateProject(plan.id, { status: "rendered", mediaUrl: "https://cdn.example/floor.mp4", renderedBy: "producer" });
    expect(done?.status).toBe("rendered");
    expect(store.read().posts).toHaveLength(posts);
    expect(row()).toMatchObject({
      status: "pending", stage: "rendered", mediaUrl: "https://cdn.example/floor.mp4", agent: "producer",
      caption: "Seneca slept on the floor. #stoicism", title: "Seneca slept on the floor. #stoicism", projectId: plan.id,
    });

    const reopened = openStore(file, TEMPLATES.faceless).read();
    expect(reopened.projects.find((p) => p.id === plan.id)).toEqual(store.read().projects.find((p) => p.id === plan.id));
    expect(reopened.posts.find((p) => p.id === brief.id)?.projectId).toBe(plan.id);
  });

  it("files the post for a plan that has none when its render lands, and not before", () => {
    const store = openStoreOver(emptyState(), () => {}, TEMPLATES.clipping, "tiktok");
    const plan = store.createProject({
      kind: "clipping", agent: "scout", account: "@clips", title: "The gravel hill", brief: "Goggins on why the hill matters.",
      sources: [{ url: "https://www.youtube.com/watch?v=abc123", from: "12:04", to: "12:41", reason: "The line lands cold." }],
    });
    // No network named: the customer's own setup answer, as a post takes it.
    expect(plan.platform).toBe("tiktok");
    expect(plan.postId).toBeUndefined();
    expect(plan.model).toBeUndefined();
    store.updateProject(plan.id, { status: "rendering" });
    expect(store.read().posts).toEqual([]);
    const done = store.updateProject(plan.id, { status: "rendered", mediaUrl: "https://cdn.example/hill.mp4", renderedBy: "clipper" });
    expect(store.read().posts).toHaveLength(1);
    const filed = store.read().posts[0]!;
    expect(done?.postId).toBe(filed.id);
    // A plan with no brief hands its id to the post its render files.
    expect(filed.id).toBe(plan.id);
    expect(plan.id).toMatch(/^proj_[0-9a-f]{4}$/);
    expect(filed).toMatchObject({
      status: "pending", stage: "rendered", kind: "clip", platform: "tiktok", account: "@clips", agent: "clipper",
      mediaUrl: "https://cdn.example/hill.mp4", projectId: plan.id, source: `The gravel hill (${plan.id})`, title: "The gravel hill",
    });
    expect(filed.caption).toBe("The gravel hill\n\nGoggins on why the hill matters.");
  });
});

describe("the sessions a plan remembers, and the operator's revision", () => {
  const rendered = (store: ReturnType<typeof openStoreOver>) => {
    const plan = store.createProject({
      kind: "clipping", agent: "scout", title: "The gravel hill", brief: "Goggins on why the hill matters.",
      sources: [{ url: "https://www.youtube.com/watch?v=abc123", reason: "The line lands cold." }],
    });
    store.recordSession(plan.id, { id: "ses_render1", role: "rendered", at: "2026-01-01T07:00:00.000Z" });
    store.updateProject(plan.id, { status: "rendering" });
    store.updateProject(plan.id, { status: "rendered", mediaUrl: "fil_v1", renderedBy: "clipper" });
    return plan.id;
  };

  it("reads a document written before sessions existed, and gives every plan an empty list of them", () => {
    const legacy = { posts: [], projects: [{ ...FACELESS_PROJECT_SEEDS[0]!, sessions: undefined }], templates: [] } as unknown as StoreState;
    let written: StoreState | undefined;
    const store = openStoreOver(legacy, (next) => { written = next; }, TEMPLATES.faceless);
    expect(store.read().projects[0]?.sessions).toEqual([]);
    expect(written).toBeUndefined();
    expect(FACELESS_PROJECT_SEEDS.every((p) => Array.isArray(p.sessions))).toBe(true);
    expect(CLIPPING_PROJECT_SEEDS.every((p) => Array.isArray(p.sessions))).toBe(true);
  });

  it("records a session once, in order, and null for a plan it does not have", () => {
    const file = storeFile();
    const store = openStore(file, TEMPLATES.faceless);
    const id = store.read().projects[0]!.id;
    const planned = { id: "ses_plan", role: "planned" as const, at: "2026-01-01T06:30:00.000Z" };
    expect(store.recordSession(id, planned)?.sessions).toEqual([planned]);
    // The same session again — the Render button and the renderer's own claim both name it.
    expect(store.recordSession(id, { ...planned, role: "rendered", at: "2026-01-01T07:00:00.000Z" })?.sessions).toEqual([planned]);
    const render = { id: "ses_render", role: "rendered" as const, at: "2026-01-01T07:00:00.000Z" };
    expect(store.recordSession(id, render)?.sessions).toEqual([planned, render]);
    expect(store.recordSession("proj_nope", render)).toBeNull();
    expect(openStore(file, TEMPLATES.faceless).read().projects[0]?.sessions).toEqual([planned, render]);
  });

  it("opens a revision only on a rendered plan with none open, and takes the post back to the crew", () => {
    const store = openStoreOver(emptyState(), () => {}, TEMPLATES.clipping, "tiktok");
    const id = rendered(store);
    const post = () => store.read().posts.find((p) => p.id === id)!;
    store.updatePost(id, { status: "rejected", rejectedReason: "too long" });
    expect(post().status).toBe("rejected");

    const before = store.read().projects[0]!.statusAt;
    const opened = store.openRevision(id, "ses_render1", "cut it shorter")!;
    expect(opened).toMatchObject({ status: "rendering", revision: { sessionId: "ses_render1", note: "cut it shorter" } });
    expect(Date.parse(opened.revision!.openedAt)).toBeGreaterThanOrEqual(Date.parse(before));
    expect(post()).toMatchObject({ status: "pending", stage: "rendering", mediaUrl: "fil_v1" });
    expect(post()).not.toHaveProperty("rejectedReason");

    // A second one while this is open, and one on a plan that is not rendered: refused, untouched.
    expect(store.openRevision(id, "ses_other", "again")).toBeNull();
    expect(store.read().projects[0]?.revision?.sessionId).toBe("ses_render1");
    expect(store.openRevision("proj_nope", "ses_x", "n")).toBeNull();
    const planned = store.createProject({ kind: "clipping", title: "t", brief: "b", sources: [{ url: "https://x.example/v", reason: "r" }] });
    expect(store.openRevision(planned.id, "ses_x", "n")).toBeNull();
    expect(store.read().projects.find((p) => p.id === planned.id)?.status).toBe("planned");
  });

  it("refuses a revision on a plan whose post is approved or posted: that video is the operator's word", () => {
    for (const status of ["approved", "posted"] as const) {
      const store = openStoreOver(emptyState(), () => {}, TEMPLATES.clipping, "tiktok");
      const id = rendered(store);
      store.updatePost(id, { status });
      expect(store.openRevision(id, "ses_render1", "n")).toBeNull();
      expect(store.read().projects[0]).toMatchObject({ status: "rendered" });
      expect(store.read().projects[0]).not.toHaveProperty("revision");
      expect(store.read().posts[0]?.status).toBe(status);
    }
  });

  it("keeps the render a revision replaced, and files the new one on a post that stays pending", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T09:00:00.000Z"));
    const store = openStoreOver(emptyState(), () => {}, TEMPLATES.clipping, "tiktok");
    const id = rendered(store);
    store.openRevision(id, "ses_render1", "cut it shorter");
    // The revision went to a new session, recorded after it opened.
    const { revision, statusAt: first } = store.read().projects[0]!;
    expect(revision?.openedAt).toBe("2026-01-02T09:00:00.000Z");
    vi.setSystemTime(new Date("2026-01-02T09:00:01.000Z"));
    store.recordSession(id, { id: "ses_revise", role: "revised", at: new Date().toISOString() });

    const done = store.updateProject(id, { status: "rendered", mediaUrl: "fil_v2", renderedBy: "clipper" })!;
    expect(done.status).toBe("rendered");
    expect(done).not.toHaveProperty("revision");
    expect(done.renders).toEqual([{ mediaUrl: "fil_v1", at: first, sessionId: "ses_render1" }]);
    expect(done.sessions.map((s) => s.id)).toEqual(["ses_render1", "ses_revise"]);
    expect(store.read().posts[0]).toMatchObject({ status: "pending", stage: "rendered", mediaUrl: "fil_v2" });
    expect(store.read().posts).toHaveLength(1);

    // Revised again, this time on the session that made the last render: it is the prior render's session.
    vi.setSystemTime(new Date("2026-01-03T09:00:00.000Z"));
    store.openRevision(id, "ses_revise", "once more");
    const second = store.read().projects[0]!.statusAt;
    store.updateProject(id, { status: "rendered", mediaUrl: "fil_v3", renderedBy: "clipper" });
    expect(store.read().projects[0]?.renders).toEqual([
      { mediaUrl: "fil_v1", at: first, sessionId: "ses_render1" },
      { mediaUrl: "fil_v2", at: second, sessionId: "ses_revise" },
    ]);
    expect(store.read().posts[0]).toMatchObject({ status: "pending", mediaUrl: "fil_v3" });
    vi.useRealTimers();
  });
});

describe("the title a filed post carries", () => {
  /**
   * The title is derived, never given: `create_post` takes a caption and the row's title is cut
   * from it. A caption that opens on a blank line — a hook set off from the body, a leading
   * newline out of a model's own formatting — made that cut `""`, and the platform's social API
   * refuses an empty title (`title: z.string().trim().min(1)`), so the post could be approved and
   * never published. The first line with something on it is the title.
   */
  it("cuts the title from the first line that has something on it", () => {
    const store = openStoreOver(emptyState(), () => {});
    expect(store.createPost({ caption: "\nRule two will sting.\nAnd the rest.", status: "pending" }).title).toBe("Rule two will sting.");
    expect(store.createPost({ caption: "   \n\t\n  Amor fati.  ", status: "pending" }).title).toBe("Amor fati.");
    expect(store.createPost({ caption: "Straight in.\nsecond", status: "pending" }).title).toBe("Straight in.");
    expect(store.createPost({ caption: "\n" + "x".repeat(80), status: "pending" }).title).toBe("x".repeat(60));
  });
});
