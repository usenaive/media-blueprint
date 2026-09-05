import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiSend, fetchAccounts, messageOf, replyText } from "./api";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("failure is reported, never disguised", () => {
  it("throws the server's own sentence, with its status", async () => {
    // The old contract answered a compiled-in fallback here, which is how two dashboards shipped
    // looking fully populated while every one of their `/api/*` routes 404'd.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "no such route" }, 404)));
    await expect(apiGet("/posts")).rejects.toMatchObject({ status: 404, message: "no such route" });
    expect(await apiGet("/posts").catch((e: unknown) => e)).toBeInstanceOf(ApiError);
  });

  it("quotes a refusal the platform made, not a guess about this server", async () => {
    // A proxied route refuses in the platform's own envelope — `{ error: { type, code, message } }`
    // — which fell through to "the dashboard server is unreachable": the wrong layer blamed, and
    // the one sentence that says what to do about a refused approval thrown away.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({ error: { type: "invalid_request", code: "not_found", message: "no pending tool call call_1" } }, 404),
      ),
    );
    await expect(apiGet("/sessions")).rejects.toMatchObject({
      status: 404,
      message: "no pending tool call call_1",
    });
  });

  it("says the server is unreachable when the fetch itself fails or the reply is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")));
    await expect(apiGet("/posts")).rejects.toMatchObject({ status: 0, message: "the dashboard server is unreachable" });

    // A 200 that is not JSON is the single-page fallback answering an API path: not data, and not
    // silence either — this is the exact shape the old fallback contract swallowed.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })));
    await expect(apiGet("/posts")).rejects.toMatchObject({ status: 200, message: "the dashboard server is unreachable" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502, headers: { "content-type": "text/html" } })));
    await expect(apiSend("PATCH", "/posts/post_1", { status: "approved" })).rejects.toMatchObject({
      status: 502,
      message: "the dashboard server is unreachable",
    });
  });

  it("messageOf turns anything thrown into one sentence a header slot can hold", () => {
    expect(messageOf(new ApiError(503, "not configured — set NAIVE_API_KEY"))).toBe("not configured — set NAIVE_API_KEY");
    expect(messageOf(new TypeError("boom"))).toBe("the dashboard server is unreachable");
  });
});

describe("wired mode", () => {
  it("returns the server's JSON, and sends a body only when there is one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json([{ id: "post_1" }]));
    vi.stubGlobal("fetch", fetchMock);
    expect(await apiGet("/posts")).toEqual([{ id: "post_1" }]);
    await apiSend("POST", "/posts/post_1/post-now");
    expect(fetchMock.mock.calls[1]![1]).not.toHaveProperty("body");
  });

  it("fetchAccounts keeps every network the org connected", async () => {
    // The old filter dropped anything outside four hard-coded names, so a connected account on any
    // other network simply did not exist as far as the dashboard was concerned.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      data: [
        { id: "acc_1", platform: "x", username: "@real" },
        { id: "acc_2", platform: "linkedin", display_name: "Stoic Daily" },
      ],
    })));
    expect(await fetchAccounts()).toEqual([
      { id: "acc_1", handle: "@real", platform: "x", state: "connected" },
      { id: "acc_2", handle: "Stoic Daily", platform: "linkedin", state: "connected" },
    ]);
  });
});

describe("replyText", () => {
  const frame = (data: unknown) => JSON.stringify({ seq: 3, type: "message.completed", data });

  it("renders the reply the harness actually emits", () => {
    // The harness stamps `role: "assistant"` on every assistant message. The screen used to append
    // only frames with NO role, so it dropped exactly the frames it existed to render and the
    // transcript stayed empty however much the agent said.
    expect(replyText(frame({ role: "assistant", content: "On it — clipping now." }))).toBe("On it — clipping now.");
  });

  it("still renders a reply that carries no role at all", () => {
    expect(replyText(frame({ content: "Done." }))).toBe("Done.");
  });

  it("skips the caller's own message and anything without prose", () => {
    expect(replyText(frame({ role: "user", content: "clip this" }))).toBeNull();
    expect(replyText(frame({ role: "assistant", content: "" }))).toBeNull();
    expect(replyText(frame({ role: "assistant" }))).toBeNull();
    expect(replyText("not json")).toBeNull();
  });
});

describe("the dashboard token", () => {
  const memory = (start?: string) => {
    const box = new Map(start === undefined ? [] : [["channel.dashboard-token", start]]);
    return {
      store: {
        getItem: (k: string) => box.get(k) ?? null,
        setItem: (k: string, v: string) => void box.set(k, v),
        removeItem: (k: string) => void box.delete(k),
      },
      box,
    };
  };
  const bearerOf = (call: unknown[]) => (call[1] as { headers: Record<string, string> }).headers.authorization;

  it("asks once, keeps it for the session, and sends it on every call", async () => {
    // Every `/api/*` route is bearer-gated now; a request without the header is a 401 the operator
    // can do nothing about, so the SPA has to carry it.
    const { store, box } = memory();
    const ask = vi.fn().mockReturnValue("  s3cret  ");
    vi.stubGlobal("sessionStorage", store);
    vi.stubGlobal("prompt", ask);
    const fetchMock = vi.fn().mockResolvedValue(json([]));
    vi.stubGlobal("fetch", fetchMock);

    await apiGet("/posts");
    await apiGet("/templates");

    expect(ask).toHaveBeenCalledTimes(1);
    expect(box.get("channel.dashboard-token")).toBe("s3cret");
    expect(bearerOf(fetchMock.mock.calls[0]!)).toBe("Bearer s3cret");
    expect(bearerOf(fetchMock.mock.calls[1]!)).toBe("Bearer s3cret");
  });

  it("forgets a token the server refused and asks again, once", async () => {
    const { store, box } = memory("stale");
    const ask = vi.fn().mockReturnValue("fresh");
    vi.stubGlobal("sessionStorage", store);
    vi.stubGlobal("prompt", ask);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "missing or invalid dashboard token" }, 401))
      .mockResolvedValueOnce(json([{ id: "post_1" }]));
    vi.stubGlobal("fetch", fetchMock);

    expect(await apiGet("/posts")).toEqual([{ id: "post_1" }]);
    expect(bearerOf(fetchMock.mock.calls[0]!)).toBe("Bearer stale");
    expect(bearerOf(fetchMock.mock.calls[1]!)).toBe("Bearer fresh");
    expect(box.get("channel.dashboard-token")).toBe("fresh");

    // A second 401 is an answer, not a typo: it surfaces, and the bad token is not kept.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "missing or invalid dashboard token" }, 401)));
    await expect(apiGet("/posts")).rejects.toMatchObject({ status: 401 });
    expect(box.has("channel.dashboard-token")).toBe(false);
  });
});
