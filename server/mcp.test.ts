import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authError, handleMcp, scenesPrompt, segmentRefusal, TOOLS } from "./mcp";
import { openStore, type Store } from "./store";
import { ACTIVE, TEMPLATES } from "../templates/index.ts";
import { lengthPhrase, MAX_RENDER_SECONDS, packSegments, rendersInSegments, segmentsOf, VIDEO_MODELS } from "../templates/template.ts";
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
  // The Long Form tests compile a second `/mcp` behind `NAIVE_TEMPLATE`; nothing else may see it.
  vi.unstubAllEnvs();
});

const rpc = (method: string, params?: unknown, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const call = (name: string, args: Record<string, unknown>) => rpc("tools/call", { name, arguments: args });
type CallResult = { result: { content: { text: string }[]; isError?: boolean } };
const text = <T>(answer: object): T => JSON.parse((answer as CallResult).result.content[0]!.text) as T;

/**
 * The smallest generation plan `create_project` accepts, for the tests that are about something
 * else. Two things make it the smallest: a `hook`, which a plan is now refused without, and shots
 * whose seconds land inside the format (`MIN_SECONDS`..`MAX_SECONDS`) — the scenes ARE the render,
 * so their sum is the video's length and is checked when the plan is filed rather than discovered
 * on the bill.
 */
/**
 * A legal generation plan on WHATEVER TEMPLATE IS RUNNING, which is why the first shot is derived.
 *
 * `create_project` length-checks the scenes against `ACTIVE.length`, so a fixture with fixed
 * seconds is only a legal piece on the template those seconds were written for — every test that
 * reuses it is then refused on the others, and the refusal surfaces as "not valid JSON" when the
 * test parses the error text as a plan. The piece runs `min + 3`: on `faceless` and `clipping`
 * that is the 8s + 10s it has always been.
 */
const PLAN = {
  hook: "He slept on the floor on purpose.",
  scenes: [
    { prompt: "A bare stone floor at dawn", seconds: ACTIVE.length.min - 7, beat: "hook" },
    { prompt: "A hand pushing a mattress away", seconds: 10, beat: "turn" },
  ],
};

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
    expect(names).toEqual([
      "list_posts", "get_post", "create_post", "update_post",
      "list_projects", "get_project", "create_project", "update_project",
      "list_style_templates", "list_accounts",
    ]);
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
   * ~$9.00 (`ONE_RENDER_MICRO_USD`) of video the channel already owns — and a producer whose stale
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

  /**
   * THE PLAN COMES BEFORE THE RENDER. A video project is the row the scriptwriter (or the clipping
   * scout) writes and the producer (or clipper) spends against; it is filed on the brief it came
   * from, and the brief moves to scripted by that write — the writer's work is the plan.
   */
  it("create_project files a generation plan on its brief, which moves to scripted with the plan on it", async () => {
    const store = freshStore();
    const brief = text<{ id: string }>(
      (await handleMcp(call("create_post", { caption: "Why the Stoics slept on the floor", agent: "trend-scout", stage: "brief" }), store, null))!,
    );
    // Derived from the running template's floor for the reason `PLAN` is: the write is
    // length-checked against `ACTIVE.length`. On `faceless` and `clipping` this is 6s + 12s.
    const hookSeconds = ACTIVE.length.min - 9;
    const scenes = [
      { prompt: "A bare stone floor at dawn, one thin blanket", seconds: hookSeconds, beat: "hook", voiceover: "Seneca slept on the floor on purpose.", text: "on purpose" },
      { prompt: "A hand pushing a soft mattress away", seconds: 12, beat: "turn", voiceover: "Comfort, he said, is the thing you should fear.", model: "bytedance/seedance-2.5" },
    ];
    const plan = text<{ id: string; kind: string; status: string; statusAt: string; postId?: string; model?: string; platform: string; scenes: unknown[]; agent?: string }>(
      (await handleMcp(call("create_project", {
        kind: "generation", post_id: brief.id, agent: "scriptwriter", title: "Sleep on the floor", brief: "Comfort is the trap.",
        style_template: "Sunlit stoic", scenes, caption: "Seneca slept on the floor. #stoicism",
        hook: "Seneca slept on the floor on purpose.",
        rejected_hooks: ["The richest man in Rome owned one blanket.", " "],
        retention: "The mattress shove at 0:06 is the visual turn; the reason lands at 0:12.",
        cta: "Read Letter 18.",
        facts: [{ claim: "Seneca practised poverty a few days a month", source: "Letters to Lucilius, 18" }],
        sound: { music: "Low drone, no drop", voice: "Unhurried, close-mic", sfx: ["Cloth shove on the mattress", ""] },
        reference_pattern: "cold open on the object",
      }), store, null))!,
    );
    // The model a plan takes when it names none is the FIRST pin, derived rather than spelled: the
    // default moved to Seedance 2.5 and a test naming the old one would have gone on passing while
    // every plan rendered with something else.
    expect(plan).toMatchObject({ kind: "generation", status: "planned", postId: brief.id, model: VIDEO_MODELS[0], agent: "scriptwriter", platform: TEMPLATES.faceless.platform });
    expect(plan.id).toBe(brief.id);
    expect(plan.statusAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(plan.scenes).toEqual(scenes);
    // The whole plan, not just its shots: every field the writer was briefed to fill lands on the
    // row, and the blank lines it may have sent are dropped rather than stored as empty strings.
    expect(plan).toMatchObject({
      hook: "Seneca slept on the floor on purpose.",
      rejectedHooks: ["The richest man in Rome owned one blanket."],
      retention: "The mattress shove at 0:06 is the visual turn; the reason lands at 0:12.",
      cta: "Read Letter 18.",
      facts: [{ claim: "Seneca practised poverty a few days a month", source: "Letters to Lucilius, 18" }],
      sound: { music: "Low drone, no drop", voice: "Unhurried, close-mic", sfx: ["Cloth shove on the mattress"] },
      referencePattern: "cold open on the object",
    });
    // `get_project` hands the renderer the prompt the shots compile to and their sum, so no seat
    // has to compose one out of prose — and cannot drop a shot while summarising.
    const read = text<{ id: string; render_prompt: string; render_seconds: number }>((await handleMcp(call("get_project", { id: plan.id }), store, null))!);
    expect(read.id).toBe(plan.id);
    expect(read.render_seconds).toBe(hookSeconds + 12);
    expect(read.render_prompt).toContain(`${hookSeconds + 12} seconds in total, 2 shots in order`);
    expect(read.render_prompt).toContain(`Shot 1 (hook), ${hookSeconds}s: A bare stone floor at dawn, one thin blanket`);
    expect(read.render_prompt).toContain('On-screen text: "on purpose".');
    expect(read.render_prompt).toContain("Shot 2 (turn), 12s:");
    expect(read.render_prompt).toContain("Look: Sunlit stoic");
    expect(read.render_prompt).toContain("Narration voice: Unhurried, close-mic");
    expect(text<{ id: string }[]>((await handleMcp(call("list_projects", { status: "planned", kind: "generation" }), store, null))!).map((p) => p.id)).toContain(plan.id);
    expect(text<{ id: string }[]>((await handleMcp(call("list_projects", { kind: "clipping" }), store, null))!).map((p) => p.id)).not.toContain(plan.id);

    // One plan per brief, and none on a row that is already rendered.
    const second = (await handleMcp(call("create_project", { kind: "generation", post_id: brief.id, title: "Again", brief: "x", hook: "h", scenes }), store, null)) as CallResult;
    expect(second.result.isError).toBe(true);
    expect(second.result.content[0]!.text).toMatch(/already has a plan/);
    const rendered = text<{ id: string }>((await handleMcp(call("create_post", { caption: "Done", media_url: "https://cdn.example/d.mp4" }), store, null))!);
    const onRendered = (await handleMcp(call("create_project", { kind: "generation", post_id: rendered.id, title: "Again", brief: "x", hook: "h", scenes }), store, null)) as CallResult;
    expect(onRendered.result.content[0]!.text).toMatch(/already has media attached/);
  });

  it("refuses a plan with nothing to make it from: no kind, no scenes, no sources, a bad scene, a bad url", async () => {
    const store = freshStore();
    const before = store.read().projects.length;
    const refused = async (args: Record<string, unknown>) => {
      const answer = (await handleMcp(call("create_project", args), store, null)) as CallResult;
      expect(answer.result.isError).toBe(true);
      return answer.result.content[0]!.text;
    };
    expect(await refused({ title: "t", brief: "b", scenes: [{ prompt: "p", seconds: 3 }] })).toMatch(/kind must be one of generation, clipping/);
    expect(await refused({ kind: "generation", title: "t", brief: "b" })).toMatch(/generation plan needs scenes/);
    expect(await refused({ kind: "clipping", title: "t", brief: "b" })).toMatch(/clipping plan needs sources/);
    expect(await refused({ kind: "generation", title: "t", brief: "b", scenes: [] })).toMatch(/scenes must be a non-empty array/);
    expect(await refused({ kind: "generation", title: "t", brief: "b", scenes: [{ prompt: "p", seconds: 0 }] })).toMatch(/scenes\[0\]\.seconds must be a positive number/);
    expect(await refused({ kind: "generation", title: "t", brief: "b", scenes: [{ seconds: 3 }] })).toMatch(/scenes\[0\]\.prompt/);
    expect(await refused({ kind: "generation", title: "t", brief: "b", scenes: [{ prompt: "p", seconds: 3 }], model: "openai/sora" })).toMatch(/model must be one of/);
    expect(await refused({ kind: "clipping", title: "t", brief: "b", sources: [{ url: "ftp://x", reason: "r" }] })).toMatch(/sources\[0\]\.url must be an http\(s\) URL/);
    expect(await refused({ kind: "clipping", title: "t", brief: "b", sources: [{ url: "https://youtu.be/x" }] })).toMatch(/sources\[0\]\.reason/);
    expect(await refused({ kind: "generation", post_id: "post_nope", title: "t", brief: "b", ...PLAN })).toMatch(/no such post/);
    expect(store.read().projects).toHaveLength(before);
  });

  /**
   * *** WHAT HAPPENS TO A PLAN WRITTEN BEFORE ANY OF THIS — the backward-compatibility contract. ***
   *
   * An install that upgrades carries plans with no `hook`, no `beat`, none of the seven new fields,
   * the old default model, and — because the old prompts demanded "under fifteen seconds in all" —
   * a scene list that is now BELOW the format's floor. All of it must keep working, because the
   * alternative is an upgrade that strands a queue.
   *
   * It does, with exactly one deliberate exception, pinned at the bottom: RE-WRITING a legacy plan's
   * scenes is refused, because the length check runs on the write. That is the right answer rather
   * than a grandfather clause — the channel's format is 15–30s now, so a piece being re-cut should
   * come out conforming — but it is a behaviour change and it belongs in a test rather than in
   * somebody's afternoon. The refusal names the remedy ("re-cut the shots"), and every patch that
   * does NOT touch scenes — the 08:00 sweep's caption and status fixes, the claim, the finish — is
   * untouched, which is what keeps a live queue moving through the upgrade.
   */
  it("keeps a plan written before any of this readable, patchable, claimable and renderable", async () => {
    const store = freshStore();
    const legacy = {
      id: "proj_old1", kind: "generation" as const, status: "planned" as const,
      statusAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      title: "Legacy 9s plan", brief: "written before any of this", platform: "youtube" as const,
      styleTemplate: "Marble & ink", model: "google/veo-3.1",
      scenes: [{ prompt: "a bust", seconds: 4 }, { prompt: "a table", seconds: 5 }],
      caption: "old caption", sessions: [],
    };
    store.read().projects.push(legacy);

    const read = text<Record<string, unknown>>((await handleMcp(call("get_project", { id: legacy.id }), store, null))!);
    expect(read.title).toBe("Legacy 9s plan");
    // Its model is preserved rather than rewritten to the new default, and nothing is invented on it.
    expect(read.model).toBe("google/veo-3.1");
    for (const added of ["hook", "retention", "cta", "facts", "sound", "referenceFrames", "referencePattern"]) {
      expect(read[added], added).toBeUndefined();
    }
    expect((read.scenes as { beat?: string }[]).every((one) => one.beat === undefined)).toBe(true);
    // A prompt is still compiled for it, at its own length — the read does not enforce the format.
    expect(read.render_seconds).toBe(9);
    expect(read.render_prompt).toContain("9 seconds in total, 2 shots in order");

    // Every patch that does not touch scenes still applies: this is the daily sweep and the claim.
    const swept = text<{ caption: string }>((await handleMcp(call("update_project", { id: legacy.id, caption: "fixed by the sweep" }), store, null))!);
    expect(swept.caption).toBe("fixed by the sweep");
    const claimed = text<{ status: string }>((await handleMcp(call("update_project", { id: legacy.id, status: "rendering", expected_status: "planned" }), store, null))!);
    expect(claimed.status).toBe("rendering");
    const done = text<{ status: string }>((await handleMcp(call("update_project", {
      id: legacy.id, status: "rendered", expected_status: "rendering", media_url: "https://cdn.example.test/old.mp4", agent: "producer",
    }), store, null))!);
    expect(done.status).toBe("rendered");

    // THE ONE EXCEPTION, and it is deliberate: re-cutting it must bring it into the format.
    store.openRevision(legacy.id, "ses_rev", "tighten it");
    const reWritten = (await handleMcp(call("update_project", { id: legacy.id, scenes: legacy.scenes }), store, null)) as CallResult;
    expect(reWritten.result.isError).toBe(true);
    expect(reWritten.result.content[0]!.text).toMatch(/the scenes run 9s in all[\s\S]*Re-cut the shots/);
  });

  /**
   * §16.2 / ADR-0758: a plan may name the stills it is rendered AGAINST, and `get_project` hands
   * them to the renderer beside the prompt. Describing a reference in words and hoping the model
   * rebuilds it is the lossy path; the provider takes reference images directly, so the seat's
   * instruction stays "render exactly what get_project gave you" and the decision stays on the plan.
   */
  it("carries a plan's reference stills through to the renderer's read", async () => {
    const store = freshStore();
    const filed = text<{ id: string }>((await handleMcp(call("create_project", {
      kind: "generation", title: "t", brief: "b", ...PLAN,
      reference_frames: ["fil_00000000000000000000000001", "https://cdn.example.test/still.jpg", "  "],
    }), store, null))!);
    // Blanks are dropped rather than stored, exactly as every other list field on a plan.
    const read = text<{ referenceFrames: string[]; render_reference_images: string[] }>(
      (await handleMcp(call("get_project", { id: filed.id }), store, null))!,
    );
    expect(read.referenceFrames).toEqual(["fil_00000000000000000000000001", "https://cdn.example.test/still.jpg"]);
    expect(read.render_reference_images).toEqual(read.referenceFrames);

    // A plan that names none carries no key at all — the renderer must not be handed an empty list
    // and left to wonder whether the reference was dropped or never given.
    const bare = text<{ id: string }>((await handleMcp(call("create_project", { kind: "generation", title: "t", brief: "b", ...PLAN }), store, null))!);
    const plain = text<Record<string, unknown>>((await handleMcp(call("get_project", { id: bare.id }), store, null))!);
    expect("render_reference_images" in plain).toBe(false);
  });

  /**
   * *** PUNCTUATION IS CONTENT IN A RENDER PROMPT, AND THIS WAS FOUND BY RUNNING IT. ***
   *
   * The unit tests asserted the prompt CONTAINED each shot and passed while the real output read
   * "…candlelight On-screen text:" — two clauses run together — and closed a question with a full
   * stop: `Voiceover: "…afraid of?".`. A planner's field is a phrase, not a sentence: `prompt`
   * arrives without a full stop and a `voiceover` usually arrives with one. The model reads this
   * as prose, so both are fixed at the join and held here.
   */
  it("punctuates the compiled prompt: one stop per clause, and never two", () => {
    const prompt = scenesPrompt({
      styleTemplate: "Marble & ink",
      sound: { music: "Low drone, no drop", voice: "Unhurried", sfx: ["Bowl on stone"] },
      scenes: [
        { prompt: "A marble bust, candlelight", seconds: 15, beat: "hook", text: "Rehearse losing it all.", voiceover: "Is this what I was afraid of?" },
      ],
    });
    // The shot's phrase gains the stop it did not carry, before the next clause begins.
    expect(prompt).toContain('Shot 1 (hook), 15s: A marble bust, candlelight. On-screen text:');
    // Text and voiceover already end in punctuation, so nothing is added after the quote.
    expect(prompt).toContain('On-screen text: "Rehearse losing it all." Voiceover: "Is this what I was afraid of?"');
    // Nowhere does a quote close onto a second stop, or a stop double up.
    expect(prompt).not.toMatch(/"\.|\.\.(?!\.)|\?\.|!\./);
    // A phrase with no punctuation of its own still gets exactly one.
    expect(prompt).toContain("Music: Low drone, no drop.");
    expect(prompt).toContain("Narration voice: Unhurried.");
    expect(prompt).toContain("Sound design: Bowl on stone.");
  });

  /**
   * *** THE LENGTH AND THE HOOK ARE REFUSED HERE, WHERE A REFUSAL IS STILL FREE. ***
   *
   * Both used to be words in a prompt — "under fifteen seconds in all", "hook in the first scene" —
   * and a prompt is a request. A plan that ran to fifty seconds was filed, queued, rendered, and the
   * first sign of it was the bill; a plan with no hook was simply a plan with no hook, and nothing
   * anywhere could tell. The scenes ARE the render, so their sum is the video's length, and the one
   * place that fact can be enforced is the write that files it.
   */
  it("refuses a plan outside the format's length, and a generation plan with no hook", async () => {
    const store = freshStore();
    const refused = async (args: Record<string, unknown>) => {
      const answer = (await handleMcp(call("create_project", args), store, null)) as CallResult;
      expect(answer.result.isError).toBe(true);
      return answer.result.content[0]!.text;
    };
    const shots = (...seconds: number[]) => seconds.map((s) => ({ prompt: "p", seconds: s }));
    // The numbers are the RUNNING template's, not Short Form's. They were written out while this
    // server enforced a module constant, so every template read 15–30 and the literals were true by
    // accident; now that it reads `ACTIVE.length`, a literal here is a test that only passes on
    // `faceless` — and the artifact publisher builds every template of this repo in one pass.
    const { min, max } = ACTIVE.length;
    const under = [Math.floor((min - 1) / 2), Math.ceil((min - 1) / 2)] as const;
    expect(await refused({ kind: "generation", title: "t", brief: "b", hook: "h", scenes: shots(...under) })).toMatch(
      new RegExp(`the scenes run ${min - 1}s in all, and a piece on this channel is ${lengthPhrase(ACTIVE.length)}`),
    );
    expect(await refused({ kind: "generation", title: "t", brief: "b", hook: "h", scenes: shots(max, 10) })).toMatch(
      new RegExp(`run ${max + 10}s in all`),
    );
    expect(await refused({ kind: "generation", title: "t", brief: "b", scenes: shots(min) })).toMatch(/generation plan needs a hook/);
    // The bounds are inclusive at both ends, and one scene is a legal piece: ">= 1 scene", not ">1".
    for (const seconds of [min, max]) {
      const ok = (await handleMcp(call("create_project", { kind: "generation", title: "t", brief: "b", hook: "h", scenes: shots(seconds) }), store, null)) as CallResult;
      expect(ok.result.isError).toBeUndefined();
    }
    // A clipping plan is cut, not generated, so the generation rules do not reach it.
    const cut = (await handleMcp(call("create_project", { kind: "clipping", title: "t", brief: "b", sources: [{ url: "https://youtu.be/x", reason: "r" }] }), store, null)) as CallResult;
    expect(cut.result.isError).toBeUndefined();
  });

  /**
   * *** THE WINDOW THIS SERVER ENFORCES IS THE RUNNING TEMPLATE'S, AND THE TEST ABOVE CANNOT SEE
   * THAT, WHICH IS WHY THIS ONE EXISTS. *** Those numbers are Short Form's and `ACTIVE` is Short
   * Form, so a module constant and a template field are indistinguishable there. They are not
   * indistinguishable in production: one `/mcp` serves whichever template is installed, and against
   * a constant a Long Form crew briefed for 60–180 seconds has every plan of its own length refused
   * by this server, in a refusal quoting a range nobody briefed it with.
   *
   * So the bounds are asserted against `ACTIVE.length` rather than against 15 and 30 — the same
   * assertion, derived from the one place the number now lives — and the refusal is held to
   * quoting that template's own phrase and no other.
   */
  it("refuses against the running template's own length, and quotes that template's range", async () => {
    const store = freshStore();
    const plan = async (seconds: number) =>
      (await handleMcp(
        call("create_project", { kind: "generation", title: "t", brief: "b", hook: "h", scenes: [{ prompt: "p", seconds }] }),
        store,
        null,
      )) as CallResult;

    for (const seconds of [ACTIVE.length.min, ACTIVE.length.max]) {
      expect((await plan(seconds)).result.isError, `${seconds}s`).toBeUndefined();
    }
    for (const seconds of [ACTIVE.length.min - 1, ACTIVE.length.max + 1]) {
      const refusal = await plan(seconds);
      expect(refusal.result.isError, `${seconds}s`).toBe(true);
      expect(refusal.result.content[0]!.text).toContain(lengthPhrase(ACTIVE.length));
    }
    // And the same phrase is what a planner is told before it files: the tool description and the
    // refusal cannot disagree, because both read the one window.
    const described = JSON.stringify(TOOLS.find((tool) => tool.name === "create_project"));
    expect(described).toContain(lengthPhrase(ACTIVE.length));
    for (const other of Object.values(TEMPLATES)) {
      if (other.length.min === ACTIVE.length.min && other.length.max === ACTIVE.length.max) continue;
      expect(described, other.name).not.toContain(lengthPhrase(other.length));
    }
  });

  /**
   * *** THE OTHER HALF OF "CAN THIS BE MADE", AND IT WAS A REQUEST RIGHT UP TO HERE. ***
   *
   * A legal sum says the piece is the right LENGTH. On a template that renders in segments it says
   * nothing about whether the producer can render it: one call takes `MAX_RENDER_SECONDS`, a
   * segment is cut at a shot change and never inside one, so the scenes' own seconds decide how
   * many calls the piece is. That constraint lived only in the tool description — which is exactly
   * where "under fifteen seconds in all" lived before the length check above was written, and a
   * description is a request.
   *
   * These are the three shapes this server accepted on Long Form and the producer could not make.
   * Each is filed, queued, and found by the producer with the row already claimed: the first two as
   * a seam through the middle of a shot, the third as a refusal after the early segments are bought
   * at ~$9 each. A valid plan is asserted beside them, because a check that refuses everything
   * would pass every one of these assertions.
   *
   * `ACTIVE` is read once when `templates/index.ts` is evaluated, so driving this server as a Long
   * Form install means a fresh module graph behind the publisher's own `NAIVE_TEMPLATE` override —
   * the same override `build-api.mjs` substitutes at build time. Nothing here asserts against a
   * literal that a template switch would make a lie: the cap, the ceiling and the window are read
   * from the template being driven.
   */
  it("refuses a Long Form plan its producer could not render, and accepts one it can", async () => {
    vi.resetModules();
    vi.stubEnv("NAIVE_TEMPLATE", "longform");
    const longform = await import("./mcp");
    const dir = mkdtempSync(join(tmpdir(), "fm-mcp-lf-"));
    dirs.push(dir);
    const store = openStore(join(dir, "store.json"), TEMPLATES.longform);
    const file = async (...seconds: number[]) => {
      const scenes = seconds.map((one, i) => ({ prompt: `shot ${i}`, seconds: one }));
      const answer = (await longform.handleMcp(call("create_project", { kind: "generation", title: "t", brief: "b", hook: "h", scenes }), store, null)) as CallResult;
      return { error: answer.result.isError === true, text: answer.result.content[0]!.text };
    };
    const { length } = TEMPLATES.longform;
    const ceiling = segmentsOf(length);
    const repeat = (times: number, seconds: number) => Array.from({ length: times }, () => seconds);

    // The three unrenderable shapes and the renderable one, ANSWERED TOGETHER rather than one
    // assertion at a time: each is a separate way to be unmakeable, and a check that caught only
    // the first would otherwise look like a pass until someone read the diff.
    const whole = [length.max];                      // one shot the whole piece
    const long = repeat(4, 45);                      // each shot longer than one call, summing exactly right
    const many = repeat(11, 16);                     // each shot well under the cap, eleven segments of it
    const fine = repeat(18, 10);                     // six segments filled exactly, which is the ceiling
    // The third shape is the one the sum can never catch: every scene legal, the total inside the
    // window, and the plan still unrenderable.
    expect(many.reduce((sum, one) => sum + one, 0)).toBeLessThanOrEqual(length.max);
    expect(many.every((one) => one <= MAX_RENDER_SECONDS)).toBe(true);

    const filed = {
      "one shot of the whole piece": (await file(...whole)).error,
      "four shots past the render cap": (await file(...long)).error,
      "eleven shots that pack into eleven segments": (await file(...many)).error,
      "eighteen shots that fill six": (await file(...fine)).error,
    };
    expect(filed).toEqual({
      "one shot of the whole piece": true,
      "four shots past the render cap": true,
      "eleven shots that pack into eleven segments": true,
      // Not "refuse everything": the ceiling is a ceiling, and a plan that reaches it exactly is fine.
      "eighteen shots that fill six": false,
    });
    expect(packSegments(fine)).toHaveLength(ceiling);

    // And the words, because the two failures have opposite fixes and the caller is a model: split
    // the shot, or re-cut the shots to fill the segments.
    expect((await file(...whole)).text).toMatch(new RegExp(`scenes\\[0\\] runs ${length.max}s, and one generate_video call takes ${MAX_RENDER_SECONDS}s`));
    expect((await file(...whole)).text).toMatch(/a seam through the middle of itself\. Split the shot/);
    expect((await file(...long)).text).toMatch(new RegExp(`scenes\\[0\\] runs 45s, and one generate_video call takes ${MAX_RENDER_SECONDS}s`));
    expect((await file(...many)).text).toMatch(new RegExp(`these 11 shots pack into 11 segments of up to ${MAX_RENDER_SECONDS}s and this channel renders at most ${ceiling}`));
    expect((await file(...many)).text).toMatch(/Re-cut the shots to fill the segments rather than dropping the beats/);

    // Twelve of those 16s shots is the same packing failure, but it never reaches the check: 192s is
    // outside the window, so the LENGTH refusal answers first. The two checks are ordered, not merged.
    const over = await file(...repeat(12, 16));
    expect(over.error).toBe(true);
    expect(over.text).toMatch(/the scenes run 192s in all/);
  });

  /**
   * *** AND IT COSTS THE SINGLE-CALL TEMPLATES NOTHING, WHICH IS THE POINT OF THE SEAT CHECK. ***
   *
   * `clipping` runs 15–60s, so dividing by the render cap says "two segments" — but that crew cuts
   * with `clip_video`, holds no `generate_video` and no producer at all, so a segment refusal would
   * be this server inventing a constraint out of arithmetic against a crew that never renders. The
   * description and the refusal read the one predicate, so neither can drift onto a template the
   * other is silent about.
   */
  it("says nothing about segments on a template whose piece is one call", () => {
    for (const template of Object.values(TEMPLATES)) {
      if (rendersInSegments(template)) continue;
      const described = JSON.stringify(TOOLS.find((tool) => tool.name === "create_project"));
      for (const shape of [[template.length.max], [template.length.min, 1], Array.from({ length: 20 }, () => 3)]) {
        expect(segmentRefusal(shape, template), `${template.name} ${shape.join("+")}`).toBeUndefined();
      }
      if (template.name === ACTIVE.name) expect(described).toContain("rendered as ONE video, not joined");
    }
    // Long Form is the one that does, so the assertion above is not vacuous.
    expect(Object.values(TEMPLATES).some((one) => rendersInSegments(one))).toBe(true);
  });

  /**
   * THE CLAIM, THEN THE RENDER, THEN THE POST. One session's `rendering` lands and the second is
   * refused before it spends; `rendered` needs the video it paid for and is final; and a clipping
   * plan, which has no brief row, gets its pending post from the finishing write itself.
   */
  it("lets one session claim a plan with expected_status, refuses the second, and files the post when the render lands", async () => {
    const store = freshStore();
    const plan = text<{ id: string; postId?: string }>(
      (await handleMcp(call("create_project", {
        kind: "clipping", agent: "scout", title: "The gravel hill", brief: "Goggins on why the hill matters.", platform: "tiktok", account: "@clips",
        sources: [{ url: "https://www.youtube.com/watch?v=abc123", from: "12:04", to: "12:41", reason: "The line lands cold and the room goes quiet." }],
      }), store, null))!,
    );
    expect(plan.postId).toBeUndefined();
    const claimed = text<{ status: string; statusAt: string }>(
      (await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned" }), store, null))!,
    );
    expect(claimed.status).toBe("rendering");
    const second = (await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned" }), store, null)) as CallResult;
    expect(second.result.isError).toBe(true);
    expect(second.result.content[0]!.text).toMatch(/project is rendering, not planned; another session has it/);
    expect(store.read().projects.find((p) => p.id === plan.id)).toMatchObject({ status: "rendering", statusAt: claimed.statusAt });

    // No video, no `rendered`.
    const early = (await handleMcp(call("update_project", { id: plan.id, status: "rendered", expected_status: "rendering" }), store, null)) as CallResult;
    expect(early.result.content[0]!.text).toMatch(/reaches rendered by having its video attached/);

    const posts = store.read().posts.length;
    const done = text<{ status: string; postId?: string }>(
      (await handleMcp(call("update_project", { id: plan.id, status: "rendered", expected_status: "rendering", media_url: "https://cdn.example/hill.mp4", agent: "clipper" }), store, null))!,
    );
    expect(done.status).toBe("rendered");
    expect(store.read().posts).toHaveLength(posts + 1);
    const filed = store.read().posts.find((p) => p.id === done.postId);
    expect(filed?.id).toBe(plan.id);
    expect(filed).toMatchObject({
      status: "pending", stage: "rendered", mediaUrl: "https://cdn.example/hill.mp4", platform: "tiktok", account: "@clips", agent: "clipper", projectId: plan.id,
    });
    expect(filed?.caption).toMatch(/The gravel hill/);

    // Paid for, so final: not back to planned, not dropped, not a second claim — and not a second
    // render, which would swap the video out from under a row the operator may have approved.
    for (const status of ["planned", "rendering", "dropped", "rendered"]) {
      const back = (await handleMcp(call("update_project", { id: plan.id, status, media_url: "https://cdn.example/other.mp4" }), store, null)) as CallResult;
      expect(back.result.isError, status).toBe(true);
      expect(back.result.content[0]!.text).toMatch(/cannot go back or be rendered again/);
    }
    const swap = (await handleMcp(call("update_project", { id: plan.id, media_url: "https://cdn.example/other.mp4" }), store, null)) as CallResult;
    expect(swap.result.isError).toBe(true);
    expect(filed?.mediaUrl).toBe("https://cdn.example/hill.mp4");
    // The words are still the planner's to fix.
    expect(text<{ title: string }>((await handleMcp(call("update_project", { id: plan.id, title: "The hill" }), store, null))!).title).toBe("The hill");
    const bad = (await handleMcp(call("update_project", { id: plan.id, expected_status: "claimed" }), store, null)) as CallResult;
    expect(bad.result.content[0]!.text).toMatch(/expected_status must be one of/);
    expect(((await handleMcp(call("update_project", { id: "proj_nope", status: "dropped" }), store, null)) as CallResult).result.content[0]!.text).toMatch(/no such project/);
    expect(TOOLS.find((t) => t.name === "update_project")?.inputSchema.properties).toHaveProperty("expected_status");
  });

  it("finishes a generation plan onto the brief it was written from, and mirrors claim and release on that row", async () => {
    const store = freshStore();
    const brief = text<{ id: string }>((await handleMcp(call("create_post", { caption: "Draft caption", agent: "trend-scout", stage: "brief" }), store, null))!);
    const plan = text<{ id: string }>(
      (await handleMcp(call("create_project", { kind: "generation", post_id: brief.id, title: "Floor", brief: "b", ...PLAN, caption: "Final caption. #stoicism" }), store, null))!,
    );
    const row = () => store.read().posts.find((p) => p.id === brief.id);
    await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned" }), store, null);
    expect(row()?.stage).toBe("rendering");
    // The manager's sweep frees a dead claim: the plan goes back to planned and the row to scripted.
    await handleMcp(call("update_project", { id: plan.id, status: "planned", expected_status: "rendering" }), store, null);
    expect(row()?.stage).toBe("scripted");
    await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned" }), store, null);
    const posts = store.read().posts.length;
    await handleMcp(call("update_project", { id: plan.id, status: "rendered", expected_status: "rendering", media_url: "https://cdn.example/floor.mp4", agent: "producer" }), store, null);
    expect(store.read().posts).toHaveLength(posts);
    expect(row()).toMatchObject({ status: "pending", stage: "rendered", mediaUrl: "https://cdn.example/floor.mp4", caption: "Final caption. #stoicism", title: "Final caption. #stoicism", agent: "producer", projectId: plan.id });
    // A dropped plan can only come back to planned.
    const dropped = text<{ id: string }>((await handleMcp(call("create_project", { kind: "generation", title: "Drop me", brief: "b", ...PLAN }), store, null))!);
    await handleMcp(call("update_project", { id: dropped.id, status: "dropped" }), store, null);
    const claim = (await handleMcp(call("update_project", { id: dropped.id, status: "rendering" }), store, null)) as CallResult;
    expect(claim.result.content[0]!.text).toMatch(/project is dropped; put it back to planned first/);
    expect(text<{ status: string }>((await handleMcp(call("update_project", { id: dropped.id, status: "planned" }), store, null))!).status).toBe("planned");
  });

  /**
   * *** A REVISION EDITS SHOTS, AND THE NEXT RENDER IS THE EDITED ONES. ***
   *
   * The operator's note is the one way a rendered plan renders again, and on a multi-shot plan the
   * note is almost always about ONE shot — "shot 3 should be slower", "lose the text on the hook".
   * So the loop that has to work is: edit the scenes with `update_project`, re-read, and get back a
   * `render_prompt` built from what the plan says NOW. The prompt is derived on read for exactly
   * this reason — one cached at render time would re-render the piece the operator asked to change.
   *
   * The length guard still applies to the edit: a revision that pushes the piece outside the format
   * is refused while it is still free, not discovered on the second bill.
   */
  it("re-renders a revised multi-shot plan from the edited scenes, and still holds the format", async () => {
    const store = freshStore();
    // The shot lengths are derived from the running template's floor, not written out: this test
    // is about the revision loop, but the write it goes through is length-checked against
    // `ACTIVE.length`, so fixed seconds would make it a test that only passes on one template.
    // The first shot absorbs the difference; the piece runs `min + 6`, and `min + 9` once revised.
    const { min, max } = ACTIVE.length;
    const plan = text<{ id: string }>((await handleMcp(call("create_project", {
      kind: "generation", title: "Four beats", brief: "b", hook: "h", style_template: "Marble & ink",
      scenes: [
        { beat: "hook", seconds: min - 9, prompt: "a marble bust, candlelight", text: "Rehearse losing it all." },
        { beat: "setup", seconds: 6, prompt: "a bare table, one bowl" },
        { beat: "turn", seconds: 6, prompt: "the bowl in hard side light" },
        { beat: "payoff", seconds: 3, prompt: "the bust again, wider" },
      ],
    }), store, null))!);
    await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned" }), store, null);
    await handleMcp(call("update_project", { id: plan.id, status: "rendered", expected_status: "rendering", media_url: "fil_v1", agent: "producer" }), store, null);
    store.openRevision(plan.id, "ses_rev", "shot 3 is too quick, and drop the on-screen text");

    // The renderer applies the operator's note to the SCENES. A whole-array write, because that is
    // what the tool takes — the seat re-sends the plan's shots with the one it was asked to change.
    const edited = text<{ scenes: { seconds: number }[] }>((await handleMcp(call("update_project", {
      id: plan.id,
      scenes: [
        { beat: "hook", seconds: min - 9, prompt: "a marble bust, candlelight" },
        { beat: "setup", seconds: 6, prompt: "a bare table, one bowl" },
        { beat: "turn", seconds: 9, prompt: "the bowl in hard side light, held longer" },
        { beat: "payoff", seconds: 3, prompt: "the bust again, wider" },
      ],
    }), store, null))!);
    expect(edited.scenes.map((one) => one.seconds)).toEqual([min - 9, 6, 9, 3]);

    // Re-read: the prompt is the EDITED piece, at its new length, with the dropped text gone.
    const read = text<{ render_prompt: string; render_seconds: number }>((await handleMcp(call("get_project", { id: plan.id }), store, null))!);
    expect(read.render_seconds).toBe(min + 9);
    expect(read.render_prompt).toContain(`${min + 9} seconds in total, 4 shots in order`);
    expect(read.render_prompt).toContain("Shot 3 (turn), 9s: the bowl in hard side light, held longer.");
    expect(read.render_prompt).not.toContain("On-screen text");

    // The second render lands and supersedes the first, and the revision is spent.
    const done = text<{ status: string; renders: { mediaUrl: string }[] }>((await handleMcp(call("update_project", {
      id: plan.id, status: "rendered", expected_status: "rendering", media_url: "fil_v2", agent: "producer",
    }), store, null))!);
    expect(done).toMatchObject({ status: "rendered", renders: [{ mediaUrl: "fil_v1" }] });
    expect(done).not.toHaveProperty("revision");

    // And an edit that takes the piece outside the format is refused while it is still free.
    store.openRevision(plan.id, "ses_rev2", "make it a minute");
    const tooLong = (await handleMcp(call("update_project", {
      id: plan.id, scenes: [{ beat: "hook", seconds: max + 1, prompt: "one very long shot" }],
    }), store, null)) as CallResult;
    expect(tooLong.result.isError).toBe(true);
    expect(tooLong.result.content[0]!.text).toMatch(new RegExp(`the scenes run ${max + 1}s in all`));
  });

  it("refuses the sweep's write on a plan the operator is revising: a revised plan goes forward only", async () => {
    const store = freshStore();
    const brief = text<{ id: string }>((await handleMcp(call("create_post", { caption: "Draft caption", agent: "trend-scout", stage: "brief" }), store, null))!);
    const plan = text<{ id: string }>(
      (await handleMcp(call("create_project", { kind: "generation", post_id: brief.id, title: "Floor", brief: "b", ...PLAN }), store, null))!,
    );
    await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned" }), store, null);
    await handleMcp(call("update_project", { id: plan.id, status: "rendered", expected_status: "rendering", media_url: "fil_v1", agent: "producer" }), store, null);
    expect(store.openRevision(plan.id, "ses_rev", "tighter")).toMatchObject({ status: "rendering" });
    const opened = structuredClone(store.read().projects.find((p) => p.id === plan.id)!);

    // The manager's sweep cannot take a live revision for a dead claim: it is the operator's, paid for.
    for (const status of ["planned", "dropped", "rendering"]) {
      const swept = (await handleMcp(call("update_project", { id: plan.id, status, expected_status: "rendering" }), store, null)) as CallResult;
      expect(swept.result.isError, status).toBe(true);
      expect(swept.result.content[0]!.text).toMatch(/a revised plan goes forward only/);
    }
    expect(store.read().projects.find((p) => p.id === plan.id)).toEqual(opened);
    expect(store.read().posts.find((p) => p.id === brief.id)).toMatchObject({ stage: "rendering", mediaUrl: "fil_v1" });

    // The renderer's finish is the one way through, and the plan is revisable again after it.
    const done = text<{ status: string; renders: unknown[] }>(
      (await handleMcp(call("update_project", { id: plan.id, status: "rendered", expected_status: "rendering", media_url: "fil_v2", agent: "producer" }), store, null))!,
    );
    expect(done).toMatchObject({ status: "rendered", renders: [{ mediaUrl: "fil_v1" }] });
    expect(done).not.toHaveProperty("revision");
    expect(store.openRevision(plan.id, "ses_rev2", "again")).not.toBeNull();
  });

  /**
   * *** THE WAY OUT OF A WEDGED REVISION. ***
   *
   * The finishing `rendered` write is a revision's only exit in normal operation — no route, no
   * other tool and no timeout clears one — so a renderer that died holding a revision (blowing the
   * $20 per-task ceiling does it; production has parked a session that way) left the plan at
   * `rendering` with every door shut: the posts and projects routes 409, `/revise` 409s, and this
   * tool refused the 08:00 sweep. After a day the sweep's own rule for a dead claim reaches it —
   * and frees it to `rendered` on the cut the plan already has, never to `planned`, which would buy
   * that cut a second time.
   */
  it("frees a revision the sweep finds a day old, back to the cut the plan has", async () => {
    const store = freshStore();
    const brief = text<{ id: string }>((await handleMcp(call("create_post", { caption: "Draft caption", agent: "trend-scout", stage: "brief" }), store, null))!);
    const plan = text<{ id: string }>(
      (await handleMcp(call("create_project", { kind: "generation", post_id: brief.id, title: "Floor", brief: "b", ...PLAN }), store, null))!,
    );
    await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned" }), store, null);
    await handleMcp(call("update_project", { id: plan.id, status: "rendered", expected_status: "rendering", media_url: "fil_v1", agent: "producer" }), store, null);
    store.openRevision(plan.id, "ses_rev", "tighter");
    // The renderer died with it. Nothing ages a claim but time, so the claim is aged on the document.
    store.read().projects.find((p) => p.id === plan.id)!.revision!.openedAt = new Date(Date.now() - 25 * 3_600_000).toISOString();

    const freed = text<{ status: string }>((await handleMcp(call("update_project", { id: plan.id, status: "planned", expected_status: "rendering" }), store, null))!);
    expect(freed.status).toBe("rendered");
    expect(freed).not.toHaveProperty("revision");
    // The video the channel paid for is still the post's, and the row is back for a verdict.
    expect(store.read().posts.find((p) => p.id === brief.id)).toMatchObject({ stage: "rendered", mediaUrl: "fil_v1", status: "pending" });
    // Unwedged: the operator can ask for another cut.
    expect(store.openRevision(plan.id, "ses_rev2", "again")).not.toBeNull();
  });

  it("retargets the brief with its plan while the row is the crew's, and keeps an approved row where the operator put it", async () => {
    const store = freshStore();
    const brief = text<{ id: string }>((await handleMcp(call("create_post", { caption: "Draft", agent: "trend-scout", stage: "brief" }), store, null))!);
    const plan = text<{ id: string }>(
      (await handleMcp(call("create_project", { kind: "generation", post_id: brief.id, title: "T", brief: "b", ...PLAN }), store, null))!,
    );
    const row = () => store.read().posts.find((p) => p.id === brief.id);
    await handleMcp(call("update_project", { id: plan.id, platform: "tiktok", account: "@clips" }), store, null);
    expect(row()).toMatchObject({ platform: "tiktok", account: "@clips" });
    store.updatePost(brief.id, { status: "approved" });
    await handleMcp(call("update_project", { id: plan.id, platform: "youtube" }), store, null);
    expect(row()?.platform).toBe("tiktok");
  });

  it("drops the plan when its brief is rejected, and writes no plan on a rejected brief", async () => {
    const store = freshStore();
    const brief = text<{ id: string }>((await handleMcp(call("create_post", { caption: "Draft", agent: "trend-scout", stage: "brief" }), store, null))!);
    const plan = text<{ id: string }>(
      (await handleMcp(call("create_project", { kind: "generation", post_id: brief.id, title: "T", brief: "b", ...PLAN }), store, null))!,
    );
    await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned" }), store, null);
    // The operator rejects the scripted brief before the 07:00 run lands: the plan goes with it,
    // and the render that was in flight has nowhere to land.
    store.updatePost(brief.id, { status: "rejected", rejectedReason: "Off-niche" });
    expect(store.read().projects.find((p) => p.id === plan.id)?.status).toBe("dropped");
    const claim = (await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned" }), store, null)) as CallResult;
    expect(claim.result.isError).toBe(true);
    store.updateProject(plan.id, { status: "planned" });
    const finish = (await handleMcp(call("update_project", { id: plan.id, status: "rendered", media_url: "https://cdn.example/x.mp4" }), store, null)) as CallResult;
    expect(finish.result.content[0]!.text).toMatch(/was rejected \(Off-niche\); its plan is not made/);
    expect(store.read().posts.find((p) => p.id === brief.id)?.mediaUrl).toBeUndefined();

    const other = text<{ id: string }>((await handleMcp(call("create_post", { caption: "Other", agent: "trend-scout", stage: "brief" }), store, null))!);
    store.updatePost(other.id, { status: "rejected" });
    const late = (await handleMcp(call("create_project", { kind: "generation", post_id: other.id, title: "T", brief: "b", ...PLAN }), store, null)) as CallResult;
    expect(late.result.content[0]!.text).toMatch(/post is rejected; a plan is written on a pending or ready brief/);
    // A rendered plan stays rendered when its post is rejected: the money is spent, the record stands.
    const cut = text<{ id: string; postId: string }>(
      (await handleMcp(call("create_project", { kind: "clipping", title: "C", brief: "b", sources: [{ url: "https://youtu.be/x", reason: "r" }] }), store, null))!,
    );
    const done = text<{ postId: string }>((await handleMcp(call("update_project", { id: cut.id, status: "rendered", media_url: "https://cdn.example/c.mp4" }), store, null))!);
    store.updatePost(done.postId, { status: "rejected" });
    expect(store.read().projects.find((p) => p.id === cut.id)?.status).toBe("rendered");
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
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "validation_failed", param: "identity" } }), { status: 400 }));
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
   * never learns publishing is broken. Only the platform's own "not activated yet" (a 400 naming
   * `param: "identity"`, the fresh install's state) is an empty answer; everything else — a 400
   * from a provider refusing a live workspace included — is "we could not ask" and says so.
   */
  it("says it could not ask, rather than inventing accounts, when the platform did not answer", async () => {
    for (const status of [400, 401, 403, 500, 502]) {
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

/**
 * THE SESSION THAT MADE IT. An MCP call carries no session id, so the plan is bound to the seat's
 * one running session — and only then. The write always lands: the binding is for the Studio,
 * and a lookup that fails or cannot be sure records nothing rather than guessing.
 */
describe("binding a plan to the session writing it", () => {
  const sources = [{ url: "https://www.youtube.com/watch?v=abc123", from: "12:04", to: "12:41", reason: "The line lands cold." }];
  const file = (store: Store, who: (agent: string) => Promise<string | null>) =>
    handleMcp(call("create_project", { kind: "clipping", agent: "scout", title: "The hill", brief: "Why the hill.", sources }), store, null, who);

  it("records the one running session of the named seat on the plan's writes, once", async () => {
    const store = freshStore();
    const asked: string[] = [];
    const who = async (agent: string) => { asked.push(agent); return agent === "scout" ? "ses_scout" : "ses_clipper"; };
    const plan = text<{ id: string; sessions: unknown[] }>((await file(store, who))!);
    expect(asked).toEqual(["scout"]);
    expect(plan.sessions).toEqual([{ id: "ses_scout", role: "planned", at: expect.any(String) }]);

    await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned", agent: "clipper" }), store, null, who);
    await handleMcp(call("update_project", { id: plan.id, status: "rendered", expected_status: "rendering", media_url: "fil_1", agent: "clipper" }), store, null, who);
    // An edit is not a move: nobody is asked for it.
    await handleMcp(call("update_project", { id: plan.id, title: "The gravel hill", agent: "scout" }), store, null, who);
    expect(asked).toEqual(["scout", "clipper", "clipper"]);
    expect(store.read().projects.find((p) => p.id === plan.id)?.sessions.map((s) => [s.id, s.role])).toEqual([["ses_scout", "planned"], ["ses_clipper", "rendered"]]);
  });

  it("binds a claim that names no agent to the plan's renderer seat", async () => {
    // The renderers' briefs claim with `status rendering, expected_status planned` and no `agent`:
    // the seat is the plan's kind — clipper for a clipping plan, producer for a generation one.
    const asked: string[] = [];
    const who = async (agent: string) => { asked.push(agent); return `ses_${agent}`; };
    const store = freshStore();
    const clip = text<{ id: string }>((await file(store, who))!);
    await handleMcp(call("update_project", { id: clip.id, status: "rendering", expected_status: "planned" }), store, null, who);
    const made = text<{ id: string }>(
      (await handleMcp(call("create_project", { kind: "generation", agent: "scriptwriter", title: "Floor", brief: "b", ...PLAN }), store, null, who))!,
    );
    await handleMcp(call("update_project", { id: made.id, status: "rendering", expected_status: "planned" }), store, null, who);
    expect(asked).toEqual(["scout", "clipper", "scriptwriter", "producer"]);
    const sessions = (id: string) => store.read().projects.find((p) => p.id === id)?.sessions.map((s) => [s.id, s.role]);
    expect(sessions(clip.id)).toEqual([["ses_scout", "planned"], ["ses_clipper", "rendered"]]);
    expect(sessions(made.id)).toEqual([["ses_scriptwriter", "planned"], ["ses_producer", "rendered"]]);
    // A finish that names its seat is asked for as named.
    await handleMcp(call("update_project", { id: clip.id, status: "rendered", expected_status: "rendering", media_url: "fil_1", agent: "editor" }), store, null, who);
    expect(asked.at(-1)).toBe("editor");
  });

  it("records nothing when the seat has no running session, several, is not named, or the lookup fails — and the write still lands", async () => {
    for (const who of [async () => null, async () => { throw new Error("upstream down"); }]) {
      const store = freshStore();
      const plan = text<{ id: string; status: string; sessions: unknown[] }>((await file(store, who))!);
      expect(plan.status).toBe("planned");
      expect(plan.sessions).toEqual([]);
      const claimed = text<{ status: string; sessions: unknown[] }>(
        (await handleMcp(call("update_project", { id: plan.id, status: "rendering", expected_status: "planned", agent: "clipper" }), store, null, who))!,
      );
      expect(claimed).toMatchObject({ status: "rendering", sessions: [] });
    }
    const store = freshStore();
    const who = vi.fn(async () => "ses_x");
    const unsigned = text<{ id: string; sessions: unknown[] }>(
      (await handleMcp(call("create_project", { kind: "clipping", title: "The hill", brief: "Why.", sources }), store, null, who))!,
    );
    expect(who).not.toHaveBeenCalled();
    expect(unsigned.sessions).toEqual([]);
    // A refused write asks nobody.
    await handleMcp(call("update_project", { id: unsigned.id, status: "rendered", expected_status: "planned", agent: "clipper" }), store, null, who);
    expect(who).not.toHaveBeenCalled();
    // Without a lookup at all — the local demo — the tools work as before.
    expect(text<{ sessions: unknown[] }>((await handleMcp(call("update_project", { id: unsigned.id, status: "rendering", agent: "clipper" }), store, null))!).sessions).toEqual([]);
  });
});
