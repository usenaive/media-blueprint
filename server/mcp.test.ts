import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authError, handleMcp, TOOLS } from "./mcp";
import { openStore, type Store } from "./store";
import { TEMPLATES } from "../templates/index.ts";
import { POST_PLATFORMS } from "../seed/posts.ts";

const dirs: string[] = [];
const freshStore = (): Store => {
  const dir = mkdtempSync(join(tmpdir(), "fm-mcp-"));
  dirs.push(dir);
  // One template's demo queue by name: the row ids these tools are called with must keep meaning
  // the same thing after a template switch — `/mcp` is the machine's, shared by both crews.
  return openStore(join(dir, "store.json"), TEMPLATES.faceless);
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const rpc = (method: string, params?: unknown, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const call = (name: string, args: Record<string, unknown>) => rpc("tools/call", { name, arguments: args });
type CallResult = { result: { content: { text: string }[]; isError?: boolean } };
const text = <T>(answer: object): T => JSON.parse((answer as CallResult).result.content[0]!.text) as T;

describe("mcp auth", () => {
  it("refuses every request with a JSON-RPC error when no token was injected", () => {
    const refused = authError(null, "Bearer anything") as { jsonrpc: string; id: null; error: { code: number; message: string } };
    expect(refused.jsonrpc).toBe("2.0");
    expect(refused.error.code).toBe(-32001);
    expect(refused.error.message).toMatch(/VETTA_MCP_TOKEN is not set/);
  });

  it("accepts exactly the injected bearer and nothing else", () => {
    const token = "mcp_" + "a".repeat(48);
    expect(authError(token, `Bearer ${token}`)).toBeNull();
    expect(authError(token, `bearer ${token}`)).toBeNull();
    expect(authError(token, undefined)).toMatchObject({ error: { code: -32001, message: "missing or invalid bearer token" } });
    expect(authError(token, `Basic ${token}`)).not.toBeNull();
    expect(authError(token, `Bearer ${token.slice(0, -1)}`)).not.toBeNull();
    expect(authError(token, `Bearer ${token}x`)).not.toBeNull();
  });
});

describe("mcp protocol", () => {
  it("answers initialize with the tools capability", async () => {
    const answer = (await handleMcp(rpc("initialize"), freshStore(), null)) as {
      result: { capabilities: { tools: object }; serverInfo: { name: string } };
    };
    expect(answer.result.serverInfo.name).toBe("media");
    expect(answer.result.capabilities.tools).toEqual({});
  });

  it("lists the read-and-file tools and no approve/reject/post tool", async () => {
    const answer = (await handleMcp(rpc("tools/list"), freshStore(), null)) as { result: { tools: { name: string; description: string }[] } };
    const names = answer.result.tools.map((t) => t.name);
    expect(names).toEqual(["list_posts", "get_post", "create_post", "update_post", "list_style_templates", "list_accounts"]);
    expect(names).toEqual(TOOLS.map((t) => t.name));
    // The setup answers reach an agent through the platform's own `project_context` tool, not a
    // second copy served from this store.
    expect(names).not.toContain("get_onboarding");
    expect(names.some((n) => /approve|reject|post_now|publish/.test(n))).toBe(false);
    expect(answer.result.tools.find((t) => t.name === "create_post")?.description).toMatch(/operator actions on the dashboard/);
  });

  it("swallows notifications and rejects unknown methods and bad JSON", async () => {
    const store = freshStore();
    expect(await handleMcp(rpc("notifications/initialized"), store, null)).toBeNull();
    expect((await handleMcp(rpc("resources/list"), store, null)) as object).toMatchObject({ error: { code: -32601 } });
    expect((await handleMcp("not json", store, null)) as object).toMatchObject({ error: { code: -32700 } });
  });
});

describe("mcp tools", () => {
  it("create_post lands in the store as pending by default, ready on request, never anything else", async () => {
    const store = freshStore();
    const before = store.read().posts.length;
    const filed = text<{ id: string; status: string; caption: string }>(
      (await handleMcp(call("create_post", { caption: "Rule two will sting. #stoicism", media_url: "https://cdn.example/c.mp4" }), store, null))!,
    );
    expect(filed.status).toBe("pending");
    expect(store.read().posts).toHaveLength(before + 1);
    expect(store.read().posts.find((p) => p.id === filed.id)).toMatchObject({ status: "pending", mediaUrl: "https://cdn.example/c.mp4" });

    const ready = text<{ status: string }>((await handleMcp(call("create_post", { caption: "Ready one", status: "ready" }), store, null))!);
    expect(ready.status).toBe("ready");
    const approved = (await handleMcp(call("create_post", { caption: "Sneaky", status: "approved" }), store, null)) as CallResult;
    expect(approved.result.isError).toBe(true);
    expect(store.read().posts.some((p) => p.caption === "Sneaky")).toBe(false);
  });

  /**
   * #5 — the whole reason this channel could not post to TikTok, and it was entirely this repo's.
   *
   * MEASURED IN PRODUCTION, 2026-09-09: all nine rows the crew filed carried `"platform":"x"`. No
   * agent ever named a target, so every filing fell back to a constant in this file, and the
   * operator could not retarget the rows either.
   *
   * The target is the CUSTOMER'S now — `PLATFORM_QUESTION`, answered in the studio and resolved per
   * request by `server/channel.ts` — and the template's own `platform` is the fallback this test
   * exercises, because no config is passed here and so there is no install to read. An agent may
   * still name another network per post.
   */
  it("files for the channel's own network, and takes TikTok when an agent names it", async () => {
    const store = freshStore();
    const defaulted = text<{ platform: string }>(
      (await handleMcp(call("create_post", { caption: "No target named." }), store, null))!,
    );
    expect(defaulted.platform).toBe(TEMPLATES.faceless.platform);
    expect(defaulted.platform).toBe("youtube");

    const named = text<{ platform: string }>(
      (await handleMcp(
        call("create_post", { caption: "For TikTok.", platform: "tiktok", media_url: "https://cdn.example/v.mp4" }),
        store,
        null,
      ))!,
    );
    expect(named.platform).toBe("tiktok");
    expect(POST_PLATFORMS as readonly string[]).toContain("tiktok");

    // And the crew is told, on the tool itself, where this channel posts — a default nothing names
    // is a default nothing chooses.
    const listed = (await handleMcp(rpc("tools/list"), store, null)) as {
      result: { tools: { name: string; inputSchema: { properties: Record<string, { description: string }> } }[] };
    };
    expect(listed.result.tools.find((t) => t.name === "create_post")?.inputSchema.properties["platform"]?.description).toMatch(
      /This channel posts to youtube/,
    );
  });

  it("create_post carries the agent's signature through to the row the operator reads", async () => {
    // The tool took a caption and a media URL and nothing else, so the queue could not say who
    // filed a post, which account it was for, or what it was made from — the three things the
    // marketing queue shows on every row.
    const store = freshStore();
    const filed = text<{ id: string }>(
      (await handleMcp(
        call("create_post", {
          caption: "Rule two will sting.",
          agent: "producer",
          account: "@dailystoic",
          source: "Brief: three stoic rules",
        }),
        store,
        null,
      ))!,
    );
    expect(store.read().posts.find((p) => p.id === filed.id)).toMatchObject({
      agent: "producer",
      account: "@dailystoic",
      source: "Brief: three stoic rules",
    });
  });

  /**
   * The other half of #5. `postNow` refuses a row whose network this channel cannot reach with
   * "retarget the post first" — and nothing anywhere could retarget one: `update_post` took a
   * title, a caption and a media URL, `PATCH /api/posts/:id` takes a status, and no screen offers
   * the field. An instruction with no mechanism behind it is not an instruction.
   */
  it("update_post retargets a row, which is what `retarget the post first` asks for", async () => {
    const store = freshStore();
    const moved = text<{ platform: string }>(
      (await handleMcp(call("update_post", { id: "post_9f2a", platform: "tiktok" }), store, null))!,
    );
    expect(moved.platform).toBe("tiktok");
    expect(store.read().posts.find((p) => p.id === "post_9f2a")?.platform).toBe("tiktok");

    const refused = (await handleMcp(call("update_post", { id: "post_9f2a", platform: "myspace" }), store, null)) as CallResult;
    expect(refused.result.isError).toBe(true);
    expect(store.read().posts.find((p) => p.id === "post_9f2a")?.platform).toBe("tiktok");
  });

  it("update_post edits pending/ready posts and refuses approved and posted ones", async () => {
    const store = freshStore();
    const edited = text<{ caption: string; status: string }>(
      (await handleMcp(call("update_post", { id: "post_9f2a", caption: "Softer first line." }), store, null))!,
    );
    expect(edited).toMatchObject({ caption: "Softer first line.", status: "pending" });
    // The caption-editor's whole job on a cut: the scout's working title goes, the publishable one stays.
    const retitled = text<{ title: string; caption: string }>(
      (await handleMcp(call("update_post", { id: "post_9f2a", title: "Rule two will sting" }), store, null))!,
    );
    expect(retitled).toMatchObject({ title: "Rule two will sting", caption: "Softer first line." });
    for (const id of ["post_5b5e", "post_3970"]) {
      const refused = (await handleMcp(call("update_post", { id, caption: "nope" }), store, null)) as CallResult;
      expect(refused.result.isError).toBe(true);
      expect(refused.result.content[0]!.text).toMatch(/only pending or ready posts can be edited/);
      expect(store.read().posts.find((p) => p.id === id)?.caption).not.toBe("nope");
    }
  });

  /**
   * The chain's data: the scout files a `brief`, the writer moves it to `scripted`, the producer to
   * `rendered` — and each seat finds the rows the one before it left by stage, never by guessing at
   * a caption. A stage the queue does not know is refused, and a row filed with none is a note.
   */
  it("carries a piece brief → scripted → rendered, filters by stage, and refuses a stage it does not know", async () => {
    const store = freshStore();
    const brief = text<{ id: string; stage?: string }>(
      (await handleMcp(call("create_post", { caption: "Why comfort is a trap\nBrief: Seneca on ease.", agent: "trend-scout", stage: "brief" }), store, null))!,
    );
    expect(brief.stage).toBe("brief");
    const note = text<{ stage?: string }>((await handleMcp(call("create_post", { caption: "Channel plan", agent: "channel-manager" }), store, null))!);
    expect(note.stage).toBeUndefined();
    expect(text<{ id: string }[]>((await handleMcp(call("list_posts", { stage: "brief" }), store, null))!).map((p) => p.id)).toEqual([brief.id]);

    const scripted = text<{ stage?: string; caption: string }>(
      (await handleMcp(call("update_post", { id: brief.id, caption: "Hook: comfort is the trap.\n#stoicism", stage: "scripted" }), store, null))!,
    );
    expect(scripted).toMatchObject({ stage: "scripted", caption: "Hook: comfort is the trap.\n#stoicism" });
    expect(text<unknown[]>((await handleMcp(call("list_posts", { stage: "brief" }), store, null))!)).toEqual([]);

    const rendered = text<{ stage?: string; mediaUrl?: string }>(
      (await handleMcp(call("update_post", { id: brief.id, media_url: "https://cdn.example/comfort.mp4", stage: "rendered" }), store, null))!,
    );
    expect(rendered).toMatchObject({ stage: "rendered", mediaUrl: "https://cdn.example/comfort.mp4" });
    // The demo rows carry a running time and no `stage` of their own — they were written before the
    // field existed — so they read as rendered too (`postStage`). That is the derivation doing its
    // job, and the reason this is not a list of one.
    expect(text<{ id: string }[]>((await handleMcp(call("list_posts", { stage: "rendered", status: "pending" }), store, null))!).map((p) => p.id)).toEqual([brief.id, "post_9f2a", "post_8e1b"]);

    for (const bad of [call("create_post", { caption: "x", stage: "done" }), call("update_post", { id: brief.id, stage: "published" }), call("list_posts", { stage: "nope" })]) {
      const refused = (await handleMcp(bad, store, null)) as CallResult;
      expect(refused.result.isError).toBe(true);
      expect(refused.result.content[0]!.text).toMatch(/stage must be one of brief, scripting, scripted, rendering, rendered/);
    }
    expect(TOOLS.find((t) => t.name === "list_posts")?.inputSchema.properties).toHaveProperty("stage");
    expect(TOOLS.find((t) => t.name === "update_post")?.inputSchema.properties).toHaveProperty("stage");
  });

  /**
   * The claim. A stage records progress, not ownership: a handoff session and the cron that fires
   * beside it both list the same `brief`, and without this both would script it and both would
   * trigger a producer — two renders for one post. `expected_stage` makes the move to `scripting`
   * (or `rendering`) a compare-and-set under the store's lock: the first caller gets the row, the
   * second is refused and told so, and a claimed row is no longer in the `brief` list the cron reads.
   */
  it("lets one session claim a row with expected_stage and refuses the second", async () => {
    const store = freshStore();
    const brief = text<{ id: string }>(
      (await handleMcp(call("create_post", { caption: "Why the Stoics slept on the floor", agent: "trend-scout", stage: "brief" }), store, null))!,
    );
    const handoff = text<{ stage?: string; stageAt?: string }>(
      (await handleMcp(call("update_post", { id: brief.id, stage: "scripting", expected_stage: "brief" }), store, null))!,
    );
    expect(handoff.stage).toBe("scripting");
    const { stageAt } = handoff;
    expect(stageAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(text<unknown[]>((await handleMcp(call("list_posts", { stage: "brief" }), store, null))!)).toEqual([]);

    const cron = (await handleMcp(call("update_post", { id: brief.id, stage: "scripting", expected_stage: "brief" }), store, null)) as CallResult;
    expect(cron.result.isError).toBe(true);
    expect(cron.result.content[0]!.text).toMatch(/post is at stage scripting, not brief; another session has it/);
    expect(store.read().posts.find((p) => p.id === brief.id)).toMatchObject({ stage: "scripting", stageAt });

    // The winner's later writes still land, guarded or not; a wrong guard on a plain edit is refused too.
    expect(text<{ stage?: string }>((await handleMcp(call("update_post", { id: brief.id, caption: "Hook: the floor.", stage: "scripted", expected_stage: "scripting" }), store, null))!).stage).toBe("scripted");
    const stale = (await handleMcp(call("update_post", { id: brief.id, caption: "late", expected_stage: "brief" }), store, null)) as CallResult;
    expect(stale.result.isError).toBe(true);
    expect(store.read().posts.find((p) => p.id === brief.id)?.caption).toBe("Hook: the floor.");

    // A note has no stage to compare against, and a guard the queue does not know is refused as such.
    const note = text<{ id: string }>((await handleMcp(call("create_post", { caption: "Channel plan", agent: "channel-manager" }), store, null))!);
    const onNote = (await handleMcp(call("update_post", { id: note.id, stage: "scripting", expected_stage: "brief" }), store, null)) as CallResult;
    expect(onNote.result.content[0]!.text).toMatch(/post is at stage none, not brief/);
    const bad = (await handleMcp(call("update_post", { id: brief.id, expected_stage: "claimed" }), store, null)) as CallResult;
    expect(bad.result.content[0]!.text).toMatch(/expected_stage must be one of/);
    expect(TOOLS.find((t) => t.name === "update_post")?.inputSchema.properties).toHaveProperty("expected_stage");
  });

  /**
   * WHAT A ROW FILED BEFORE `stage` EXISTED READS AS.
   *
   * Both fallback crons find their work by stage and every claim compares against one, so on the
   * morning this ships every row already in the queue — filed by an agent that had no stage to give
   * — matched no filter and no `expected_stage`. Those rows were not idle, they were unreachable:
   * nothing in the pipeline could ever list one again, and the demo queue is the same case.
   *
   * `postStage` reads a stageless row off what it carries, and both places a stage is read go
   * through it, so the list a seat works from and the claim it makes next cannot give two answers
   * about one row. What it does NOT do is guess: a row carrying no finished piece is still a note,
   * because promoting one would put the crew's plans and reports in front of the paid render.
   */
  it("reads a pre-stage row at the stage its contents put it at, and leaves a note at none", async () => {
    const store = freshStore();
    // Exactly what `create_post` wrote before the field existed: a finished piece with its video
    // attached, and nothing on the row to say where it stands.
    const filed = text<{ id: string; stage?: string }>(
      (await handleMcp(call("create_post", { caption: "Amor fati in 40 seconds", media_url: "https://cdn.example/fati.mp4", agent: "producer" }), store, null))!,
    );
    expect(filed.stage).toBeUndefined();
    const note = text<{ id: string }>((await handleMcp(call("create_post", { caption: "Report skeleton", agent: "analyst", source: "report skeleton" }), store, null))!);

    const rendered = text<{ id: string }[]>((await handleMcp(call("list_posts", { stage: "rendered" }), store, null))!).map((p) => p.id);
    expect(rendered).toContain(filed.id);
    // The demo rows reach the same answer by the other piece of evidence: a running time is
    // something only a piece that exists has.
    expect(rendered).toContain("post_9f2a");
    expect(rendered).not.toContain(note.id);

    // And nothing is promoted into a stage a seat spends money on: the pre-render lists stay empty,
    // so neither cron picks up a note, a report or a finished piece as work to do.
    for (const stage of ["brief", "scripting", "scripted", "rendering"]) {
      expect(text<unknown[]>((await handleMcp(call("list_posts", { stage }), store, null))!), stage).toEqual([]);
    }

    // The claim reads the same row the same way: shown at rendered, it guards at rendered.
    const guarded = (await handleMcp(call("update_post", { id: filed.id, caption: "Love what happens. All of it.", expected_stage: "rendered" }), store, null))!;
    expect(text<{ caption: string }>(guarded).caption).toBe("Love what happens. All of it.");
    const wrongGuard = (await handleMcp(call("update_post", { id: filed.id, caption: "no", expected_stage: "scripted" }), store, null)) as CallResult;
    expect(wrongGuard.result.content[0]!.text).toMatch(/post is at stage rendered, not scripted/);
    // The note carries nothing, so it is at no stage on both sides — the same answer it gave before.
    const onNote = (await handleMcp(call("update_post", { id: note.id, expected_stage: "scripted" }), store, null)) as CallResult;
    expect(onNote.result.content[0]!.text).toMatch(/post is at stage none, not scripted/);
  });

  /**
   * THE REPLAY, AND WHAT IT WOULD HAVE COST.
   *
   * `expected_stage` guarded the START of the render and nothing guarded its end: no field recorded
   * that a render had been bought. So the manager's 08:00 sweep, putting a claim a dead session left
   * at `rendering` back to `scripted`, was an instruction to render the same piece a second time —
   * ~$3.32 (`ONE_RENDER_MICRO_USD`) of video the channel already owns — and a producer whose stale
   * completion write landed unguarded overwrote the render that replaced it.
   *
   * The media on the row is the receipt. A row that carries one cannot go back to a stage before
   * `rendered`, whoever asks: the sweep is refused, and so is the claim that would follow it.
   */
  it("refuses to send a row that already has media back to a stage before the render", async () => {
    const store = freshStore();
    const brief = text<{ id: string }>(
      (await handleMcp(call("create_post", { caption: "Why the Stoics slept on the floor", agent: "trend-scout", stage: "brief" }), store, null))!,
    );
    await handleMcp(call("update_post", { id: brief.id, caption: "Hook: the floor.", stage: "scripted", expected_stage: "brief" }), store, null);
    await handleMcp(call("update_post", { id: brief.id, stage: "rendering", expected_stage: "scripted" }), store, null);
    // The producer's own write, guarded at both ends now: the claim it made, and the render it paid for.
    const done = text<{ stage?: string; mediaUrl?: string }>(
      (await handleMcp(call("update_post", { id: brief.id, media_url: "https://cdn.example/floor.mp4", stage: "rendered", expected_stage: "rendering" }), store, null))!,
    );
    expect(done).toMatchObject({ stage: "rendered", mediaUrl: "https://cdn.example/floor.mp4" });

    // The sweep's reset, the claim a producer would make on the row it freed, and a reset all the
    // way to brief: every one of them ends in a render the channel has already bought.
    for (const back of [
      { stage: "scripted", expected_stage: "rendered" },
      { stage: "rendering", expected_stage: "rendered" },
      { stage: "brief" },
    ]) {
      const refused = (await handleMcp(call("update_post", { id: brief.id, ...back }), store, null)) as CallResult;
      expect(refused.result.isError, JSON.stringify(back)).toBe(true);
      expect(refused.result.content[0]!.text).toMatch(/already has media attached.*paid for/);
    }
    expect(store.read().posts.find((p) => p.id === brief.id)).toMatchObject({ stage: "rendered", mediaUrl: "https://cdn.example/floor.mp4" });

    // What is refused is the way back, not the work: the caption still gets fixed, and a row with no
    // media yet is still the sweep's to free.
    expect(text<{ caption: string }>((await handleMcp(call("update_post", { id: brief.id, caption: "Hook: the floor, revised." }), store, null))!).caption).toBe("Hook: the floor, revised.");
    const dead = text<{ id: string }>((await handleMcp(call("create_post", { caption: "A second piece", agent: "trend-scout", stage: "brief" }), store, null))!);
    await handleMcp(call("update_post", { id: dead.id, stage: "rendering" }), store, null);
    expect(text<{ stage?: string }>((await handleMcp(call("update_post", { id: dead.id, stage: "scripted", expected_stage: "rendering" }), store, null))!).stage).toBe("scripted");
  });

  /**
   * The stage set is a membership check and not a state machine: a seat may write `scripted` onto a
   * brief without claiming `scripting` first, and that skip is deliberate. `rendered` is the one
   * word that is not free, because it is the word `postStage` reads back off a row's media — so a
   * row can only be called rendered by the call that attaches the render. Written onto a brief it
   * used to be accepted, and the piece left the scriptwriter's list and the producer's at once, to
   * sit at a stage claiming work that was never done, in a queue that cannot publish it.
   */
  it("refuses to call a post rendered when no render is attached", async () => {
    const store = freshStore();
    const brief = text<{ id: string }>(
      (await handleMcp(call("create_post", { caption: "Seneca on ease", agent: "trend-scout", stage: "brief" }), store, null))!,
    );
    const claimed = (await handleMcp(call("update_post", { id: brief.id, stage: "rendered" }), store, null)) as CallResult;
    expect(claimed.result.isError).toBe(true);
    expect(claimed.result.content[0]!.text).toMatch(/reaches rendered by having its video attached/);
    expect(store.read().posts.find((p) => p.id === brief.id)?.stage).toBe("brief");
    // The call that attaches the video is the call that may say it, and the skips that cost nothing stay legal.
    expect(text<{ stage?: string }>((await handleMcp(call("update_post", { id: brief.id, caption: "Hook: ease is the trap.", stage: "scripted" }), store, null))!).stage).toBe("scripted");
    expect(text<{ stage?: string }>((await handleMcp(call("update_post", { id: brief.id, media_url: "https://cdn.example/ease.mp4", stage: "rendered" }), store, null))!).stage).toBe("rendered");
  });

  it("reads posts by status, templates and accounts from the store", async () => {
    const store = freshStore();
    expect(text<{ status: string }[]>((await handleMcp(call("list_posts", { status: "ready" }), store, null))!).every((p) => p.status === "ready")).toBe(true);
    expect(text<{ id: string }>((await handleMcp(call("get_post", { id: "post_9f2a" }), store, null))!).id).toBe("post_9f2a");
    expect(((await handleMcp(call("get_post", { id: "post_nope" }), store, null)) as CallResult).result.isError).toBe(true);
    expect(text<unknown[]>((await handleMcp(call("list_style_templates", {}), store, null))!).length).toBeGreaterThan(0);
    const accounts = text<{ platform: string; handle: string }[]>((await handleMcp(call("list_accounts", {}), store, null))!);
    expect(accounts).toContainEqual({ platform: "youtube", handle: "@dailystoic" });
  });

  it("answers list_accounts from the queue, not with an error, when the platform refuses (social not activated)", async () => {
    const store = freshStore();
    const config = { apiKey: "sk-secret", baseUrl: "http://up", identityId: "idn_1", project: "media" };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "validation_failed" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const answer = (await handleMcp(call("list_accounts", {}), store, config)) as CallResult;
      expect(answer.result.isError).not.toBe(true);
      expect(text<{ platform: string; handle: string }[]>(answer)).toContainEqual({ platform: "youtube", handle: "@dailystoic" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * "Fail soft" fell soft into invented data. `if (res.ok)` was the only success test, so a 401
   * from a revoked key, a 403 from a missing scope and a 500 from a broken upstream all fell
   * through to a list synthesised out of handles typed into the local queue — the agent was handed
   * accounts nobody had checked were connected. A customer reconnects an account that was fine, or
   * never learns publishing is broken. Only the platform's own "not activated yet" (400, the fresh
   * install's state) is an empty answer; everything else is "we could not ask" and says so.
   */
  it("says it could not ask, rather than inventing accounts, when the platform did not answer", async () => {
    for (const status of [401, 403, 500, 502]) {
      const store = freshStore();
      const config = { apiKey: "sk-secret", baseUrl: "http://up", identityId: "idn_1", project: "media" };
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "revoked" } }), { status })));
      try {
        const answer = (await handleMcp(call("list_accounts", {}), store, config)) as CallResult;
        expect(answer.result.isError).toBe(true);
        const said = answer.result.content[0]!.text;
        expect(said).toContain(String(status));
        expect(said).not.toContain("@dailystoic");
        expect(said).toMatch(/could not/i);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});
