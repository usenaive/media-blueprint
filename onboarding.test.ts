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
 * Everything below is that path end to end: the set of networks, the question that picks one or
 * several, the wiring that carries the answer to a filed row, and the line that says whether the
 * account behind each is connected yet.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { POST_MEDIA_PLATFORMS, POST_PLATFORMS, type PostPlatform } from "./seed/posts.ts";
import { TEMPLATES } from "./templates/index.ts";
import {
  PLATFORM_ANSWER_KEY,
  PLATFORM_CHOICES,
  PLATFORM_QUESTION,
  REFERENCE_ANSWER_KEY,
  REFERENCE_QUESTION,
  labelOf,
  labelsOf,
  platformFromAnswers,
  platformsFromAnswers,
  platformOf,
  referencesFromAnswers,
  referenceKindOf,
  referencesOf,
} from "./templates/template.ts";
import { declaration } from "./naive.config.ts";
import { channelPlatform, channelPlatforms, forgetChannelPlatform } from "./server/channel.ts";
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
  it("fits what the engine will actually install, and a fifth is refused by name", async () => {
    // Three REQUIRED per template, and `faceless` spends the fourth slot on the optional reference.
    for (const template of both) {
      expect(template.questions.filter((q) => q.optional !== true), template.name).toHaveLength(3);
      expect(template.questions.length, template.name).toBeLessThanOrEqual(4);
    }
    const { defineProject } = await import("@usenaive-sdk/blueprints");
    const extra = { key: "extra", label: "One more thing", type: "text" as const };
    const over = { ...declaration, questions: [...declaration.questions, extra, extra] };
    expect(() => defineProject(over)).toThrow(/asks \d+ questions, but a template asks at most 4/);
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
   * A channel of vertical video posts the same render to more than one network, so the question
   * takes several picks: the studio renders `multiple: true` as checkboxes and stores the answer
   * as an array of the option strings, in the customer's order.
   */
  it("lets the customer pick more than one network", () => {
    expect(PLATFORM_QUESTION.multiple).toBe(true);
    expect(PLATFORM_QUESTION.help ?? "").toMatch(/apps/);
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
  it("says where the question limit actually comes from, and against which engine", () => {
    const source = readFileSync(new URL("./templates/template.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Exactly three \(§4 of the plan\)/);
    expect(source).toMatch(/a template asks at most 4 before anything is/);
    // The version the quote was measured against must be the one this repo pins, or the quote is
    // a claim about an engine nobody here runs.
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    const pinned = pkg.devDependencies["@usenaive-sdk/blueprints"]!.replace(/^[^\d]*/, "");
    expect(source).toContain(`@usenaive-sdk/blueprints@${pinned}`);
  });

  /**
   * Nothing was dropped to make room: the displaced question is asked in the manager's first
   * session, which is now the session the board wakes it into on the `channel-plan` card — and it
   * is the head of the chain, so it is asked before the seat that waits on it is started at all.
   */
  it("asks what it displaced in the crew's first conversation instead", () => {
    for (const template of both) {
      const plan = template.tasks.find((one) => one.key === "channel-plan")!;
      expect(plan.assignee, template.name).toBe("channel-manager");
      expect(plan.blocked_by ?? [], template.name).toEqual([]);
      expect(plan.body, template.name).toMatch(/ask_operator/);
      expect(plan.body, template.name).toMatch(/setup form asks four questions/);
    }
    expect(TEMPLATES.faceless.tasks[0]!.body).toMatch(/tone and who it is for/);
    expect(TEMPLATES.clipping.tasks[0]!.body).toMatch(/who these clips are for/);
    // And what a template asks beside the platform question is still its own.
    expect(TEMPLATES.faceless.questions.map((q) => q.key)).toEqual(["niche", PLATFORM_ANSWER_KEY, "reference", "cadence"]);
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
    expect(labelsOf(["youtube"])).toBe("YouTube Shorts");
    expect(labelsOf(["youtube", "tiktok"])).toBe("YouTube Shorts and TikTok");
    expect(labelsOf(["youtube", "tiktok", "instagram"])).toBe("YouTube Shorts, TikTok and Instagram Reels");
  });

  describe("as the whole list the customer picked", () => {
    it("keeps every recognised pick, in the customer's order", () => {
      expect(platformsFromAnswers(answers(["TikTok", "YouTube Shorts"]), "instagram")).toEqual(["tiktok", "youtube"]);
      expect(platformsFromAnswers(answers(["Instagram Reels", "youtube", "TikTok"]), "youtube")).toEqual(["instagram", "youtube", "tiktok"]);
      // A single string is a list of one, so an answer saved before the question took several still reads.
      expect(platformsFromAnswers(answers("YouTube Shorts"), "tiktok")).toEqual(["youtube"]);
    });

    it("names each network once, however it was spelled", () => {
      expect(platformsFromAnswers(answers(["TikTok", "tiktok", " TIKTOK ", "YouTube Shorts"]), "instagram")).toEqual(["tiktok", "youtube"]);
    });

    it("drops what it cannot publish to and keeps the rest", () => {
      expect(platformsFromAnswers(answers(["Myspace", "TikTok", "", 42, "Instagram Reels"]), "youtube")).toEqual(["tiktok", "instagram"]);
    });

    it("falls back to the caller's one default when nothing usable was picked", () => {
      expect(platformsFromAnswers(answers(["Myspace", "X"]), "youtube")).toEqual(["youtube"]);
      expect(platformsFromAnswers(answers([]), "tiktok")).toEqual(["tiktok"]);
      expect(platformsFromAnswers([], "youtube")).toEqual(["youtube"]);
      expect(platformsFromAnswers(undefined, "instagram")).toEqual(["instagram"]);
      expect(platformsFromAnswers({ template: "faceless", answers: "nope" }, "tiktok")).toEqual(["tiktok"]);
    });

    /** The single-valued reader is the head of the list, so the two can never name a different default. */
    it("is what the single-valued reader takes the first of", () => {
      const picked = answers(["Instagram Reels", "TikTok"]);
      expect(platformFromAnswers(picked, "youtube")).toBe(platformsFromAnswers(picked, "youtube")[0]);
      expect(platformFromAnswers(picked, "youtube")).toBe("instagram");
    });
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

  it("resolves every network the customer picked, first pick first", async () => {
    forgetChannelPlatform();
    expect(await channelPlatforms(CONFIG, installFetch(["TikTok", "Instagram Reels"]))).toEqual(["tiktok", "instagram"]);
    // The same read, memoised: the single-valued resolution is the head of that list.
    expect(await channelPlatform(CONFIG, installFetch(["TikTok", "Instagram Reels"]))).toBe("tiktok");
  });

  it("falls back to the template's own default when the platform cannot be asked", async () => {
    forgetChannelPlatform();
    const failing = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    expect(await channelPlatform(CONFIG, failing)).toBe(TEMPLATES.faceless.platform);
    forgetChannelPlatform();
    expect(await channelPlatform(null)).toBe(TEMPLATES.faceless.platform);
    expect(await channelPlatforms(null)).toEqual([TEMPLATES.faceless.platform]);
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

  /**
   * A customer who ticked three networks has a channel that posts to three. The tool has to say all
   * of them — an agent told only about the first files nothing for the other two — and it has to say
   * which one an untargeted row lands on, because that is still one network and it is the first.
   */
  it("names every chosen network on the tool, and files an untargeted post for the first", async () => {
    forgetChannelPlatform();
    const fetchImpl = installFetch(["Instagram Reels", "TikTok", "YouTube Shorts"]);
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const store = openStoreOver(seedState(TEMPLATES.faceless), () => {}, TEMPLATES.faceless);
      const rpc = (method: string, params?: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
      const listed = (await handleMcp(rpc("tools/list"), store, CONFIG)) as {
        result: { tools: { name: string; inputSchema: { properties: Record<string, { description: string }> } }[] };
      };
      const said = listed.result.tools.find((t) => t.name === "create_post")!.inputSchema.properties["platform"]!.description;
      expect(said).toMatch(/This channel posts to instagram \(Instagram Reels\), tiktok \(TikTok\) and youtube \(YouTube Shorts\)/);
      expect(said).toMatch(/one post per network/);
      expect(said).toMatch(/A post that names none goes to instagram \(Instagram Reels\), the first the customer chose/);

      const filed = (await handleMcp(
        rpc("tools/call", { name: "create_post", arguments: { caption: "No target named." } }),
        store,
        CONFIG,
      )) as { result: { content: { text: string }[] } };
      expect(JSON.parse(filed.result.content[0]!.text).platform).toBe("instagram");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the line that says whether the account is connected", () => {
  const account = (platform: string) => ({ id: `acc_${platform}`, handle: `@channel`, platform, state: "connected" as const });

  const youtube = ["youtube" as PostPlatform];

  it("names the network and says an account is still needed", () => {
    const notice = connectNotice({ platforms: youtube, accounts: [], error: null });
    expect(notice.tone).toBe("warn");
    expect(notice.text).toMatch(/YouTube/);
    expect(notice.text).toMatch(/connect/i);
    expect(notice.text).toMatch(/nothing here can publish/);
  });

  it("an account on another network is not an account on this one", () => {
    const notice = connectNotice({ platforms: youtube, accounts: [account("tiktok")], error: null });
    expect(notice.tone).toBe("warn");
  });

  it("goes quiet the moment the right account is connected", () => {
    const notice = connectNotice({ platforms: youtube, accounts: [account("youtube")], error: null });
    expect(notice.tone).toBe("ok");
    expect(notice.text).toMatch(/@channel/);
    expect(notice.text).toMatch(/YouTube/);
  });

  it("never claims a network is unconnected when the read simply failed", () => {
    expect(connectNotice({ platforms: youtube, accounts: null, error: null }).tone).toBe("unknown");
    expect(connectNotice({ platforms: youtube, accounts: null, error: "401" }).tone).toBe("unknown");
    expect(connectNotice({ platforms: youtube, accounts: null, error: "401" }).text).toMatch(/401/);
  });

  /**
   * Several networks, one line. A YouTube account connected says nothing about the TikTok the
   * customer also ticked, so the line covers each pick and says which are connected and which are
   * not — a line that named only the first would let the second fill a queue silently.
   */
  describe("when the customer picked more than one network", () => {
    const three = ["youtube", "tiktok", "instagram"] as PostPlatform[];

    it("names every network while the accounts are still being read", () => {
      const notice = connectNotice({ platforms: three, accounts: null, error: null });
      expect(notice.tone).toBe("unknown");
      expect(notice.text).toMatch(/YouTube Shorts, TikTok and Instagram Reels/);
    });

    it("warns about each network with no account, and says which ones are fine", () => {
      const notice = connectNotice({ platforms: three, accounts: [account("tiktok")], error: null });
      expect(notice.tone).toBe("warn");
      expect(notice.text).toMatch(/posts to YouTube Shorts, TikTok and Instagram Reels/);
      expect(notice.text).toMatch(/no YouTube Shorts or Instagram Reels account is connected yet/);
      expect(notice.text).toMatch(/nothing here can publish there until you connect them on Accounts/);
      expect(notice.text).toMatch(/Connected: TikTok as @channel/);
    });

    it("tells an expired connection apart from a missing one", () => {
      const expired = { ...account("tiktok"), state: "expired" as const };
      const notice = connectNotice({ platforms: ["youtube", "tiktok"] as PostPlatform[], accounts: [account("youtube"), expired], error: null });
      expect(notice.tone).toBe("warn");
      expect(notice.text).toMatch(/the TikTok connection has expired/);
      expect(notice.text).not.toMatch(/no .* account is connected yet/);
      expect(notice.text).toMatch(/until you connect it on Accounts/);
      expect(notice.text).toMatch(/Connected: YouTube Shorts as @channel/);
    });

    it("goes quiet only when every network has a live account", () => {
      const partial = connectNotice({ platforms: three, accounts: [account("youtube"), account("tiktok")], error: null });
      expect(partial.tone).toBe("warn");
      const all = connectNotice({ platforms: three, accounts: three.map(account), error: null });
      expect(all.tone).toBe("ok");
      expect(all.text).toMatch(/YouTube Shorts as @channel; TikTok as @channel; Instagram Reels as @channel/);
    });
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

/**
 * THE FOURTH QUESTION — the one a person may leave blank, and the whole reason the engine's cap
 * moved from three to four (ADR-0751).
 *
 * Everything here is really one property: an install that answered nothing must behave exactly as
 * this template did before the question existed. That is what makes an optional question safe to
 * hang a board card, two blockers and five prompts off — and it is the property that quietly breaks
 * first, because the interesting path is the answered one and nobody re-reads the other.
 */
describe("the question that asks what to model the channel on", () => {
  it("is optional, is free text, and is asked only by the template that can act on it", () => {
    expect(REFERENCE_QUESTION.optional).toBe(true);
    // Free text, because there is no list of channels to offer and the answer is a URL or a handle.
    expect(REFERENCE_QUESTION.type).toBe("text");
    expect(REFERENCE_QUESTION.key).toBe(REFERENCE_ANSWER_KEY);
    // The help is the only place a person is told what giving one actually does.
    expect(REFERENCE_QUESTION.help ?? "").toMatch(/studied|measured|blank/i);
    expect((REFERENCE_QUESTION.help ?? "").length).toBeGreaterThan(40);

    expect(TEMPLATES.faceless.questions).toContain(REFERENCE_QUESTION);
    // `clipping` does not take it: its `sources` question already names channels, and means
    // something stronger — cut from these and nowhere else.
    expect(TEMPLATES.clipping.questions).not.toContain(REFERENCE_QUESTION);
    expect(TEMPLATES.clipping.questions.map((q) => q.key)).toContain("sources");
  });

  /** It sits third, so the form reads as what the channel is, where it goes, what it is like, how often. */
  it("is asked after the network and before the cadence", () => {
    expect(TEMPLATES.faceless.questions.map((q) => q.key)).toEqual(["niche", PLATFORM_ANSWER_KEY, REFERENCE_ANSWER_KEY, "cadence"]);
  });

  /** `naive up` reads the declaration, not the template — the question has to reach it. */
  it("reaches `naive up` as the one optional question", () => {
    expect(declaration.questions.map((q) => q.key)).toContain(REFERENCE_ANSWER_KEY);
    expect(declaration.questions.filter((q) => q.optional === true).map((q) => q.key)).toEqual([REFERENCE_ANSWER_KEY]);
  });

  describe("the answer, read back", () => {
    const ctx = (value: unknown) => ({ answers: [{ key: REFERENCE_ANSWER_KEY, label: "Model on", value }] });

    it("reads one reference per line, in the customer's order, each once", () => {
      expect(referencesFromAnswers(ctx("https://youtube.com/@a\n@b\nhttps://youtube.com/@a"))).toEqual([
        "https://youtube.com/@a",
        "@b",
      ]);
      // Surrounding space is the customer's typing, not an answer.
      expect(referencesFromAnswers(ctx("  @only  "))).toEqual(["@only"]);
      // It takes the bare answers array too, the way `platformsFromAnswers` does — the server reads
      // the context body and the browser is handed the same object.
      expect(referencesFromAnswers(ctx("@x").answers)).toEqual(["@x"]);
    });

    /**
     * *** THE UNANSWERED PATH, WHICH IS THE ONE THAT HAS TO KEEP WORKING. *** An optional question
     * left blank is ABSENT from `project_context` — the platform lists only answered ones — so the
     * shapes below are all the ways "no reference" actually arrives, and every one of them is the
     * same empty list rather than a crash, a `[""]`, or a reference nobody named.
     */
    it("says there is no reference for every shape an unanswered question arrives in", () => {
      for (const nothing of [ctx(""), ctx("   "), ctx("\n \n"), ctx(undefined), ctx(7), ctx([]), { answers: [] }, {}, null, undefined, "not a context"]) {
        expect(referencesFromAnswers(nothing), JSON.stringify(nothing) ?? "undefined").toEqual([]);
      }
    });

    /**
     * It does NOT require a URL. A customer may write `@mrballen` or `Veritasium`, and a seat with
     * `web_search` finds either — refusing them would turn the most natural kind of answer into no
     * answer at all, which on an optional question means silently getting nothing.
     */
    it("keeps a handle or a name, not just a URL", () => {
      expect(referencesFromAnswers(ctx("Veritasium"))).toEqual(["Veritasium"]);
    });
  });

  /**
   * *** THE THREE KINDS ARE NOT EQUAL, AND THE STUDY BRANCHES ON WHICH ONE IT GOT. *** A still can
   * be opened with `view_image` and written from; a `fil_` id is the same thing without needing a
   * public URL; a link is TEXT ONLY, because nothing samples frames out of a video. Getting this
   * classification wrong is how the crew treats a link as though it had seen the video (ADR-0752).
   */
  it("tells a still from a file id from a link", () => {
    expect(referenceKindOf("https://cdn.example.test/still-01.jpg")).toBe("image");
    expect(referenceKindOf("https://cdn.example.test/f.PNG?v=2")).toBe("image");
    expect(referenceKindOf("fil_00000000000000000000000001")).toBe("file");
    expect(referenceKindOf("https://www.tiktok.com/@z3lkw/video/7681830866623991072")).toBe("link");
    expect(referenceKindOf("@mrballen")).toBe("link");
    // A page whose path merely contains the word is still a page.
    expect(referenceKindOf("https://example.test/images/gallery")).toBe("link");
  });

  it("classifies a mixed answer in the customer's order", () => {
    const ctx = { answers: [{ key: REFERENCE_ANSWER_KEY, label: "Model on", value: "https://www.tiktok.com/@z3lkw/video/768\nhttps://cdn.example.test/a.jpg\nfil_00000000000000000000000002" }] };
    expect(referencesOf(ctx)).toEqual([
      { kind: "link", value: "https://www.tiktok.com/@z3lkw/video/768" },
      { kind: "image", value: "https://cdn.example.test/a.jpg" },
      { kind: "file", value: "fil_00000000000000000000000002" },
    ]);
    expect(referencesOf({ answers: [] })).toEqual([]);
  });

  /**
   * The card is what turns the answer into something the crew can work from, and its two blockers
   * are what make the answer reach the channel's voice and look rather than just sitting in the
   * context. It must NOT be blocked itself, and it must NOT ask the operator anything: `ask_operator`
   * parks the session, and two cards wait behind this one.
   */
  it("is studied once on day one, before the cards that decide how the channel sounds and looks", () => {
    const tasks = TEMPLATES.faceless.tasks;
    const study = tasks.find((one) => one.key === "reference-study")!;
    expect(study.assignee).toBe("scriptwriter");
    expect(study.blocked_by ?? []).toEqual([]);
    expect(study.body).not.toMatch(/ask_operator/);
    // Both halves: what to do with a reference, and what to do with none.
    expect(study.body).toMatch(/If it names no reference/);
    expect(study.body).toMatch(/reference teardown/);
    // *** IT LOOKS, RATHER THAN READING ABOUT. *** This card named `clip_video` — a CLIPPING tool
    // whose output is transcript-derived text — and the crew planned the wrong genre from a
    // caption (ADR-0752). The tool that actually opens a picture is `view_image`, and the card
    // must say what to do when there is nothing to open rather than guessing confidently.
    expect(study.body).toMatch(/view_image/);
    expect(study.body).not.toMatch(/clip_video/);
    expect(study.body).toMatch(/saw no frames/);
    for (const key of ["hook-style", "look"]) {
      expect(tasks.find((one) => one.key === key)!.blocked_by, key).toContain("reference-study");
    }
    // And the seat that studies it holds the tool that can actually look at one.
    const writer = TEMPLATES.faceless.agents.find((a) => a.name === "scriptwriter")!;
    expect(writer.tools?.configs["view_image"]).toMatchObject({ enabled: true });
    // No other faceless seat is granted it: it is a day-one cost, not a standing one.
    for (const agent of TEMPLATES.faceless.agents.filter((a) => a.name !== "scriptwriter")) {
      expect(agent.tools?.configs["view_image"]?.enabled ?? false, agent.name).not.toBe(true);
    }
    // And no seat gets a browser for it. A page screenshot is not worth a content agent that can
    // navigate and act on any site — `templates.test.ts` holds every seat of both templates to it.
    for (const agent of TEMPLATES.faceless.agents) {
      expect(agent.tools?.configs["browser"]?.enabled ?? false, agent.name).not.toBe(true);
    }
  });
});
