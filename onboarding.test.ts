/**
 * ONBOARDING: WHAT A CUSTOMER HAS TO GET RIGHT BEFORE THE FIRST POST IS FILED.
 *
 * The owner's words: *"one of the onboarding questions for the template should be which platforms
 * to do it on, the user needs to connect them, and then it can actually operate on it."* Measured
 * before this file existed, none of that was true:
 *
 *   · `POST_PLATFORMS` admitted five text-only networks and excluded `youtube` and `instagram` —
 *     two of the three networks that actually take vertical video. A channel whose entire product
 *     is a 1080x1920 render could file for X and could not file for YouTube.
 *   · The target was a per-template constant (`platform: "tiktok"`), and the docstring said so:
 *     "an operator who wants another network edits this one line and runs `naive up`". A customer
 *     was never asked and could not answer.
 *   · So the store's fallback, the `create_post` tool description, and every row the crew filed
 *     named a network nobody had chosen and nobody had connected.
 *   · And the dashboard said nothing about it. The operator found out at publish time.
 *
 * Everything below is that path end to end: the set of networks, the question that picks one, the
 * wiring that carries the answer to a filed row, and the line that says whether the account behind
 * it is connected yet.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { POST_MEDIA_PLATFORMS, POST_PLATFORMS, type PostPlatform } from "./seed/posts.ts";
import { TEMPLATES } from "./templates/index.ts";
import {
  PLATFORM_ANSWER_KEY,
  PLATFORM_CHOICES,
  PLATFORM_QUESTION,
  labelOf,
  platformFromAnswers,
  platformOf,
} from "./templates/template.ts";
import { declaration } from "./naive.config.ts";
import { channelPlatform, forgetChannelPlatform } from "./server/channel.ts";
import { handleMcp } from "./server/mcp.ts";
import { openStoreOver, seedState } from "./server/store.ts";
import { connectNotice } from "./src/connect.ts";

const both = Object.values(TEMPLATES);

/** The networks this blueprint's product — one vertical video per post — can actually be published on. */
const VIDEO = ["instagram", "tiktok", "youtube"];
/** The networks the old list admitted, every one of which takes the caption and drops the video. */
const TEXT_ONLY = ["bluesky", "facebook", "linkedin", "mastodon", "threads", "x"];

describe("the networks this channel may target", () => {
  /**
   * The set is not a matter of taste. Every post this crew files IS a video: the producer renders
   * 1080x1920 and the clipper cuts one. A text network accepts the caption and silently drops the
   * work, which is a post that shipped nothing — and the platform's own video-capable set
   * (`SOCIAL_MEDIA_PLATFORMS`) is exactly these three.
   */
  it("is the three networks that take video, and youtube is one of them", () => {
    expect([...POST_PLATFORMS].sort()).toEqual(VIDEO);
    expect(POST_PLATFORMS as readonly string[]).toContain("youtube");
    for (const network of TEXT_ONLY) {
      expect(POST_PLATFORMS as readonly string[], network).not.toContain(network);
    }
  });

  /** All three publish media and refuse a bare caption, so a brief is undeliverable on any of them. */
  it("treats every one of them as a media network", () => {
    expect([...POST_MEDIA_PLATFORMS].sort()).toEqual(VIDEO);
  });
});

describe("the question that asks where the channel posts", () => {
  it("is asked by both templates, in the same shape as the questions beside it", () => {
    for (const template of both) {
      const keys = template.questions.map((q) => q.key);
      expect(keys, template.name).toContain(PLATFORM_ANSWER_KEY);
      expect(new Set(keys).size, template.name).toBe(template.questions.length);
      const question = template.questions.find((q) => q.key === PLATFORM_ANSWER_KEY)!;
      expect(question, template.name).toBe(PLATFORM_QUESTION);
      expect(question.type).toBe("choice");
    }
  });

  /**
   * THE BUDGET THIS QUESTION IS SPENT OUT OF, measured against the SDK this repo pins.
   *
   * The brief for this change said the tuple could simply be widened to four — that the platform
   * takes `z.array(QuestionFieldSchema)` unbounded. The schema does; `parseProject` does not.
   * `@usenaive-sdk/blueprints@0.4.0`, the published version `naive up` runs, refuses a fourth
   * whenever the project names a template, which this one always does. A declaration that asks
   * four does not install at all, so the question had to take a slot rather than add one.
   *
   * This test is the reason nobody has to re-derive that: it asks the real engine.
   */
  it("fits the three the engine will actually install, and a fourth is refused by name", async () => {
    for (const template of both) expect(template.questions, template.name).toHaveLength(3);
    const { defineProject } = await import("@usenaive-sdk/blueprints");
    const fourth = { key: "extra", label: "One more thing", type: "text" as const };
    const four = { ...declaration, questions: [...declaration.questions, fourth] };
    expect(() => defineProject(four)).toThrow(/asks 4 questions, but a template asks at most 3/);
    // And the declaration as it stands is one the engine accepts.
    expect(() => defineProject(declaration)).not.toThrow();
  });

  /** One option per network the channel can publish to, and nothing that resolves to nothing. */
  it("offers exactly the networks a post can be filed for", () => {
    expect(PLATFORM_QUESTION.options).toEqual(PLATFORM_CHOICES.map((choice) => choice.option));
    expect([...new Set(PLATFORM_CHOICES.map((c) => c.platform))].sort()).toEqual([...POST_PLATFORMS].sort());
    for (const option of PLATFORM_QUESTION.options ?? []) expect(platformOf(option), option).not.toBeNull();
    // A `choice` with `other: true` would let a customer type a network nothing can publish to.
    expect(PLATFORM_QUESTION.other).toBe(false);
  });

  /**
   * The help text is the only place a non-technical person is told that picking is not connecting.
   * A customer who picks YouTube and never connects an account has a queue that cannot publish.
   */
  it("says, in a customer's words, that they still have to connect the account", () => {
    expect(PLATFORM_QUESTION.help ?? "").toMatch(/connect/i);
    expect((PLATFORM_QUESTION.help ?? "").length).toBeGreaterThan(40);
    expect(PLATFORM_QUESTION.label).toMatch(/\S/);
  });

  /** `naive up` reads the declaration, not the template — the question has to reach it. */
  it("reaches `naive up`", () => {
    expect(declaration.questions.map((q) => q.key)).toContain(PLATFORM_ANSWER_KEY);
  });

  /**
   * A comment that contradicts the code is the bug this repo keeps re-learning. The old one said
   * "Exactly three (§4 of the plan)" and "the engine refuses a template with more than three" —
   * the count was right and the reason was a guess, so the next reader could not tell whether the
   * limit was the blueprint's taste or the platform's rule. It is the platform's, and the file now
   * quotes the refusal it was measured from.
   */
  it("says where the three-question limit actually comes from", () => {
    const source = readFileSync(new URL("./templates/template.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Exactly three \(§4 of the plan\)/);
    expect(source).toMatch(/a template asks at most 3 before anything is/);
    expect(source).toMatch(/@usenaive-sdk\/blueprints@0\.4\.0/);
  });

  /** Nothing was dropped to make room: the displaced question is asked in the first session. */
  it("asks what it displaced in the crew's first conversation instead", () => {
    for (const template of both) {
      const manager = template.agents.find((one) => one.name === "channel-manager")!;
      expect(manager.intake?.message, template.name).toMatch(/ask_operator/);
      expect(manager.intake?.message, template.name).toMatch(/setup form asks three questions/);
    }
    expect(TEMPLATES.faceless.agents[0]!.intake?.message).toMatch(/tone and who it is for/);
    expect(TEMPLATES.clipping.agents[0]!.intake?.message).toMatch(/who these clips are for/);
    // And what a template asks beside the platform question is still its own.
    expect(TEMPLATES.faceless.questions.map((q) => q.key)).toEqual(["niche", PLATFORM_ANSWER_KEY, "cadence"]);
    expect(TEMPLATES.clipping.questions.map((q) => q.key)).toEqual(["sources", PLATFORM_ANSWER_KEY, "cadence"]);
  });
});

describe("the answer, read back", () => {
  const answers = (value: unknown) => [{ key: PLATFORM_ANSWER_KEY, label: "Where", value }];

  it("turns what the customer picked into the network a post is filed for", () => {
    expect(platformFromAnswers(answers("YouTube Shorts"), "tiktok")).toBe("youtube");
    expect(platformFromAnswers(answers(["Instagram Reels"]), "tiktok")).toBe("instagram");
    // The raw id, and any casing, because an answer can be edited in the studio by hand.
    expect(platformFromAnswers(answers("  YouTube  "), "tiktok")).toBe("youtube");
    expect(platformFromAnswers(answers("TIKTOK"), "youtube")).toBe("tiktok");
  });

  it("keeps the sane default when there is no usable answer", () => {
    expect(platformFromAnswers(answers("Myspace"), "youtube")).toBe("youtube");
    expect(platformFromAnswers([], "youtube")).toBe("youtube");
    expect(platformFromAnswers(undefined, "youtube")).toBe("youtube");
    expect(platformFromAnswers(answers(""), "tiktok")).toBe("tiktok");
  });

  /** `GET /api/context` hands back the platform's whole context object, not a bare array. */
  it("reads the context object the platform actually returns", () => {
    const context = { template: "faceless", answers: answers("YouTube Shorts"), updated_at: "2026-09-10T00:00:00Z" };
    expect(platformFromAnswers(context, "tiktok")).toBe("youtube");
  });

  it("names each network the way the customer saw it named", () => {
    expect(labelOf("youtube")).toBe("YouTube Shorts");
    expect(labelOf("tiktok")).toBe("TikTok");
  });
});

/** The two hops `server/channel.ts` makes to read the answer off the applied install. */
const installFetch = (value: unknown) =>
  vi.fn(async (url: string) =>
    url.includes("/context")
      ? new Response(JSON.stringify({ template: "faceless", answers: [{ key: PLATFORM_ANSWER_KEY, label: "Where", value }], updated_at: "x" }))
      : new Response(JSON.stringify({ data: [{ id: "ins_1", status: "applied" }] })),
  ) as unknown as typeof fetch;

const CONFIG = { apiKey: "sk-test", baseUrl: "http://up", identityId: "idn_1", project: "media" };

describe("the answer reaching a filed post", () => {
  it("resolves the channel's network from the applied install", async () => {
    forgetChannelPlatform();
    // Not the template's own default, so a resolution that quietly did not happen cannot pass.
    expect(await channelPlatform(CONFIG, installFetch("TikTok"))).toBe("tiktok");
  });

  it("falls back to the template's own default when the platform cannot be asked", async () => {
    forgetChannelPlatform();
    const failing = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect(await channelPlatform(CONFIG, failing)).toBe(TEMPLATES.faceless.platform);
    forgetChannelPlatform();
    expect(await channelPlatform(null)).toBe(TEMPLATES.faceless.platform);
  });

  /**
   * The store's fallback is no longer a per-template literal: the customer's answer overrides it.
   * The answer here is deliberately NOT the template's own default — a test that picks the same
   * network the constant already names cannot tell the two apart, which is how a wiring change
   * gets mistaken for a working one.
   */
  it("stamps the chosen network on a row that names none", () => {
    expect(TEMPLATES.faceless.platform).not.toBe("tiktok");
    const store = openStoreOver(seedState(TEMPLATES.faceless), () => {}, TEMPLATES.faceless, "tiktok");
    expect(store.createPost({ caption: "No target named.", status: "pending" }).platform).toBe("tiktok");
    const unanswered = openStoreOver(seedState(TEMPLATES.faceless), () => {}, TEMPLATES.faceless);
    expect(unanswered.createPost({ caption: "No target named.", status: "pending" }).platform).toBe(
      TEMPLATES.faceless.platform,
    );
  });

  /**
   * And the deployed function hands the store that same answer, so the fallback the document is
   * written with is the customer's and not the running template's. `openDocument` is the only place
   * the deployed app builds a store (`server/api-entry.ts`).
   */
  it("hands the deployed document the same answer", async () => {
    const rows: Record<string, { state: unknown }[]> = {};
    const db = {
      async query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }> {
        if (text.startsWith("select")) return { rows: (rows["doc"] ?? []) as R[] };
        if (text.startsWith("insert")) rows["doc"] = [{ state: JSON.parse(values![1] as string) }];
        return { rows: [] as R[] };
      },
    };
    const { openDocument } = await import("./server/api-entry.ts");
    const document = await openDocument(db, "tiktok");
    expect(document.store.createPost({ caption: "No target named.", status: "pending" }).platform).toBe("tiktok");
    await document.rollback();
  });

  /**
   * End to end over `/mcp`, which is the only way a post is ever created: an agent that names no
   * platform files for the network the customer chose in the studio, and the tool it read before
   * filing said which network that is. A default nothing names is a default nothing chooses.
   */
  it("files an agent's untargeted post for the network the customer chose, and says so on the tool", async () => {
    forgetChannelPlatform();
    // The customer answered TikTok; the template's fallback is YouTube. A row that comes back
    // `youtube` is a row nobody's answer reached.
    expect(TEMPLATES.faceless.platform).toBe("youtube");
    const fetchImpl = installFetch("TikTok");
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const store = openStoreOver(seedState(TEMPLATES.faceless), () => {}, TEMPLATES.faceless);
      const rpc = (method: string, params?: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
      const filed = (await handleMcp(
        rpc("tools/call", { name: "create_post", arguments: { caption: "No target named." } }),
        store,
        CONFIG,
      )) as { result: { content: { text: string }[] } };
      expect(JSON.parse(filed.result.content[0]!.text).platform).toBe("tiktok");

      const listed = (await handleMcp(rpc("tools/list"), store, CONFIG)) as {
        result: { tools: { name: string; inputSchema: { properties: Record<string, { description: string }> } }[] };
      };
      const said = listed.result.tools.find((t) => t.name === "create_post")!.inputSchema.properties["platform"]!.description;
      expect(said).toMatch(/This channel posts to tiktok \(TikTok\)/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the line that says whether the account is connected", () => {
  const account = (platform: string) => ({ id: `acc_${platform}`, handle: `@channel`, platform, state: "connected" as const });

  it("names the network and says an account is still needed", () => {
    const notice = connectNotice({ platform: "youtube" as PostPlatform, accounts: [], error: null });
    expect(notice.tone).toBe("warn");
    expect(notice.text).toMatch(/YouTube/);
    expect(notice.text).toMatch(/connect/i);
    expect(notice.text).toMatch(/nothing here can publish/);
  });

  it("an account on another network is not an account on this one", () => {
    const notice = connectNotice({ platform: "youtube" as PostPlatform, accounts: [account("tiktok")], error: null });
    expect(notice.tone).toBe("warn");
  });

  it("goes quiet the moment the right account is connected", () => {
    const notice = connectNotice({ platform: "youtube" as PostPlatform, accounts: [account("youtube")], error: null });
    expect(notice.tone).toBe("ok");
    expect(notice.text).toMatch(/@channel/);
    expect(notice.text).toMatch(/YouTube/);
  });

  it("never claims a network is unconnected when the read simply failed", () => {
    expect(connectNotice({ platform: "youtube" as PostPlatform, accounts: null, error: null }).tone).toBe("unknown");
    expect(connectNotice({ platform: "youtube" as PostPlatform, accounts: null, error: "401" }).tone).toBe("unknown");
    expect(connectNotice({ platform: "youtube" as PostPlatform, accounts: null, error: "401" }).text).toMatch(/401/);
  });

  /** It has to be on a screen the operator opens before the first post, not only in a module. */
  it("is rendered on the screens the operator opens first", () => {
    for (const screen of ["Home.tsx", "Posts.tsx"]) {
      const source = readFileSync(new URL(`./src/screens/${screen}`, import.meta.url), "utf8");
      expect(source, screen).toMatch(/<ConnectLine \/>/);
    }
  });

  /**
   * AND IT HAS TO SURVIVE THE BUILD, which is the only version an operator ever sees.
   *
   * A component imported by a screen and a component compiled into `dist` are not the same claim —
   * this repo has been caught out by exactly that distinction before (`src/no-seed.test.ts`,
   * `templates/bundle.test.ts`). So the app is bundled from its real entry point and the sentence
   * is looked for in the emitted JavaScript, along with the two reads that make it true.
   */
  it("reaches the built dashboard, sentence and reads alike", async () => {
    const { build } = await import("esbuild");
    const result = await build({
      entryPoints: ["src/main.tsx"],
      absWorkingDir: new URL(".", import.meta.url).pathname,
      bundle: true,
      write: false,
      format: "esm",
      packages: "external",
      loader: { ".css": "empty" },
      logLevel: "silent",
    });
    const js = result.outputFiles.map((file) => file.text).join("\n");
    expect(js).toContain("nothing here can publish until you connect one");
    // The network comes from the setup answer and the accounts from the platform: a line that read
    // only one of them would be a line that cannot say "connected".
    expect(js).toContain("/context");
    expect(js).toContain("/social/accounts");
  }, 30_000);
});
