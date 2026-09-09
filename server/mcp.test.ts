import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authError, handleMcp, TOOLS } from "./mcp";
import { openStore, type Store } from "./store";
import { TEMPLATES } from "../templates/index.ts";

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

  it("reads posts by status, templates and accounts from the store", async () => {
    const store = freshStore();
    expect(text<{ status: string }[]>((await handleMcp(call("list_posts", { status: "ready" }), store, null))!).every((p) => p.status === "ready")).toBe(true);
    expect(text<{ id: string }>((await handleMcp(call("get_post", { id: "post_9f2a" }), store, null))!).id).toBe("post_9f2a");
    expect(((await handleMcp(call("get_post", { id: "post_nope" }), store, null)) as CallResult).result.isError).toBe(true);
    expect(text<unknown[]>((await handleMcp(call("list_style_templates", {}), store, null))!).length).toBeGreaterThan(0);
    const accounts = text<{ platform: string; handle: string }[]>((await handleMcp(call("list_accounts", {}), store, null))!);
    expect(accounts).toContainEqual({ platform: "x", handle: "@dailystoic" });
  });

  it("answers list_accounts from the queue, not with an error, when the platform refuses (social not activated)", async () => {
    const store = freshStore();
    const config = { apiKey: "sk-secret", baseUrl: "http://up", identityId: "idn_1", project: "media" };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "validation_failed" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const answer = (await handleMcp(call("list_accounts", {}), store, config)) as CallResult;
      expect(answer.result.isError).not.toBe(true);
      expect(text<{ platform: string; handle: string }[]>(answer)).toContainEqual({ platform: "x", handle: "@dailystoic" });
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
