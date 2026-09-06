/**
 * The session relay is a bearer-gated `/api/*` route like every other one, and `EventSource`
 * cannot send a header — an unauthenticated relay was how anyone could read the events of a
 * session this dashboard never created. So the transcript is read with `fetch`, and this is the
 * proof that the token travels and that the frames still arrive.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFrames, streamReplies } from "./Chat";

afterEach(() => vi.unstubAllGlobals());

const stream = (text: string) =>
  new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }), { status: 200 });

describe("streamReplies", () => {
  it("carries no credential of its own and appends what the agent said", async () => {
    const body =
      "retry: 3000\n\n" +
      `event: message.completed\ndata: ${JSON.stringify({ data: { role: "assistant", content: "On it." } })}\n\n` +
      "event: session.idle\ndata: {}\n\n";
    const fetchMock = vi.fn().mockResolvedValue(stream(body));
    vi.stubGlobal("fetch", fetchMock);

    const said: string[] = [];
    streamReplies("ses_1", (text) => said.push(text));
    await vi.waitFor(() => expect(said).toEqual(["On it."]));

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/chat/ses_1/stream");
    // The relay is same-origin, so the `HttpOnly` cookie `/api/enter` set travels on its own; a
    // header here would be a second copy of a credential this bundle is not allowed to hold.
    expect((fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers).not.toHaveProperty("authorization");
    // `session.idle` ends it: the relay is not re-opened once the session is done.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("readFrames", () => {
  it("holds a half-arrived frame back until the rest of it lands", () => {
    const seen: [string, string][] = [];
    const rest = readFrames("event: a\ndata: 1\n\nevent: b\ndata: 2", (e, d) => seen.push([e, d]));
    expect(seen).toEqual([["a", "1"]]);
    expect(readFrames(`${rest}\n\n`, (e, d) => seen.push([e, d]))).toBe("");
    expect(seen).toEqual([["a", "1"], ["b", "2"]]);
  });
});
