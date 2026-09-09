import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FACELESS_SEEDS } from "../seed/posts";
import { ACTIVE, TEMPLATES } from "../templates/index.ts";
import { emptyState, openStore, openStoreOver, seedState } from "./store";

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
    expect(emptyState().templates).toEqual(seedState().templates);
    expect(emptyState().templates.length).toBeGreaterThan(0);
  });

  it("holds no setup answers: those are the install's, read through the platform", () => {
    // The store used to carry an `onboarding` profile the dashboard asked for on a screen of its
    // own. The studio asks the template's questions before the crew exists, so a second copy here
    // could only ever disagree with the one the agents read via `project_context`.
    expect(Object.keys(emptyState())).toEqual(["posts", "templates"]);
    expect(Object.keys(seedState(TEMPLATES.clipping))).toEqual(["posts", "templates"]);
  });
});

describe("the template's own state", () => {
  it("seeds the demo queue of the template that is running, not of the other one", () => {
    expect(seedState(TEMPLATES.faceless).posts).toEqual(FACELESS_SEEDS);
    expect(seedState(TEMPLATES.clipping).posts.every((post) => post.kind === "clip")).toBe(true);
    expect(seedState(TEMPLATES.clipping).posts.every((post) => post.agent === "clipper")).toBe(true);
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
    expect(posted?.postedAt).toBe("just now");

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
    // Filed with no destination: a network this channel can actually publish to, never one the
    // platform's social API would refuse when the operator finally presses "Post now".
    expect(post.platform).toBe("x");
    expect(store.read().posts[0]).toBe(post);
    expect(store.updatePost(post.id, { caption: "Rule three, then." })).toMatchObject({ caption: "Rule three, then.", status: "pending" });
    expect(openStore(file).read().posts[0]).toEqual(post);
    expect(store.createPost({ caption: "In the sky", platform: "bluesky", status: "ready" }).platform).toBe("bluesky");
  });

  it("returns null for an unknown post", () => {
    expect(openStore(storeFile()).updatePost("post_nope", { status: "approved" })).toBeNull();
  });
});
