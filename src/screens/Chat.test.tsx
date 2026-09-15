// @vitest-environment jsdom
/**
 * The session relay is a bearer-gated `/api/*` route like every other one, and `EventSource`
 * cannot send a header — an unauthenticated relay was how anyone could read the events of a
 * session this dashboard never created. So the transcript is read with `fetch`, and this is the
 * proof that the token travels and that the frames still arrive.
 *
 * Below it, the screen itself: a session arrived at from the rail is read back from its log, a
 * follow-up is queued on it, and the first send from `/chat` moves to the session it opened.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chat, isWall, readFrames, sessionState, streamReplies, turnsFrom } from "./Chat";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

  it("picks the log up past what is already on screen, and says when it is over", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stream("event: session.idle\ndata: {}\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    const ended = vi.fn();
    streamReplies("ses_1", () => {}, 12, ended);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/chat/ses_1/stream?after_seq=12");
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

const LOG = [
  { seq: 1, type: "session.started", data: {} },
  { seq: 2, type: "message.completed", data: { role: "user", content: "Clip the interview" } },
  { seq: 3, type: "tool.call", data: { name: "video.clip" } },
  { seq: 4, type: "message.completed", data: { role: "assistant", content: "Three clips are ready.\n\nWant captions?" } },
  { seq: 5, type: "message.completed", data: { content: "" } },
];

describe("turnsFrom", () => {
  it("keeps both sides of the conversation, in order, and nothing that was not said", () => {
    expect(turnsFrom(LOG)).toEqual([
      { you: true, text: "Clip the interview" },
      { you: false, text: "Three clips are ready.\n\nWant captions?" },
    ]);
  });
});

describe("sessionState", () => {
  it("warns only where a person is waited on", () => {
    expect(sessionState({ status: "running", stop_reason: null }).dot).toBe("dot-run");
    expect(sessionState({ status: "idle", stop_reason: "awaiting_approval" }).dot).toBe("dot-warn");
    expect(sessionState({ status: "idle", stop_reason: "awaiting_answer" }).dot).toBe("dot-warn");
    expect(sessionState({ status: "idle", stop_reason: "awaiting_input" }).dot).toBe("dot-warn");
    expect(sessionState({ status: "idle", stop_reason: "end_turn" })).toEqual({ label: "Idle", dot: "dot-idle", chip: "chip-plain" });
    expect(sessionState({ status: "idle", stop_reason: "error" }).chip).toBe("chip-fail");
  });
});

describe("isWall", () => {
  it("is a reply past six lines' worth of text, or past six paragraphs", () => {
    expect(isWall("Three clips are ready.")).toBe(false);
    expect(isWall("word ".repeat(140))).toBe(true);
    expect(isWall(Array.from({ length: 7 }, (_, i) => `Step ${i}`).join("\n"))).toBe(true);
    expect(isWall(Array.from({ length: 6 }, (_, i) => `Step ${i}`).join("\n"))).toBe(false);
  });
});

const SESSION = { id: "ses_1", status: "idle", stop_reason: "end_turn", created_at: "2026-09-15T05:00:00Z", title: "Clip the interview" };

function Where() {
  return <output data-where>{useLocation().pathname}</output>;
}

async function mount(path: string, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/chat/:sessionId?" element={<Chat />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const bubbles = () => Array.from(host.querySelectorAll(".bubble")).map((b) => [b.classList.contains("bubble-you"), b.textContent]);
const where = () => host.querySelector("[data-where]")!.textContent;

async function type(text: string) {
  const box = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click());
}

describe("the Chat screen", () => {
  it("reads a session back from its log, both sides in their own bubbles, under its header", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url === "/api/chat/ses_1" ? json(SESSION) : url === "/api/chat/ses_1/events" ? json({ data: LOG }) : json({ error: url }, 404)),
    );
    await mount("/chat/ses_1", fetchMock);
    expect(bubbles()).toEqual([
      [true, "Clip the interview"],
      [false, "Three clips are ready.\n\nWant captions?"],
    ]);
    const head = host.querySelector("header")!;
    expect(head.textContent).toContain("Clip the interview");
    expect(head.querySelector(".chip")!.textContent).toBe("Idle");
    expect(head.querySelector(".font-mono")!.textContent).toBe("ses_1");
    // An idle session is not streamed: nothing is running to answer.
    expect(fetchMock.mock.calls.some((c) => /\/stream/.test(c[0] as string))).toBe(false);
  });

  it("folds a long agent reply to six lines with a Read more, and leaves a long message of yours whole", async () => {
    const wall = "The plan for the week, in detail. ".repeat(30).trim();
    const log = [
      { seq: 1, type: "message.completed", data: { role: "user", content: wall } },
      { seq: 2, type: "message.completed", data: { role: "assistant", content: wall } },
      { seq: 3, type: "message.completed", data: { role: "assistant", content: "Short." } },
    ];
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url === "/api/chat/ses_1" ? json(SESSION) : url === "/api/chat/ses_1/events" ? json({ data: log }) : json({ error: url }, 404)),
    );
    await mount("/chat/ses_1", fetchMock);
    const [yours, agent, short] = Array.from(host.querySelectorAll(".bubble"));
    expect(yours!.querySelector("p")).toBeNull();
    expect(yours!.textContent).toBe(wall);
    expect(agent!.querySelector("p")!.className).toContain("line-clamp-6");
    expect(agent!.querySelector("p")!.textContent).toBe(wall);
    expect(agent!.querySelector("button")!.textContent).toBe("Read more");
    expect(short!.querySelector("p")).toBeNull();

    await act(async () => agent!.querySelector("button")!.click());
    expect(agent!.querySelector("p")!.className).not.toContain("line-clamp-6");
  });

  it("queues a follow-up on the open session and shows it at once", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/chat/ses_1") return Promise.resolve(json(SESSION));
      if (url === "/api/chat/ses_1/events") return Promise.resolve(json({ data: LOG }));
      if (url === "/api/chat/ses_1/messages" && init?.method === "POST") return Promise.resolve(json({ session_id: "ses_1", status: "running", accepted_seq: 6 }, 202));
      if (url.startsWith("/api/chat/ses_1/stream")) return Promise.resolve(stream("event: session.idle\ndata: {}\n\n"));
      return Promise.resolve(json({ error: url }, 404));
    });
    await mount("/chat/ses_1", fetchMock);
    await type("Yes, captions please");
    expect(bubbles().at(-1)).toEqual([true, "Yes, captions please"]);
    const sent = fetchMock.mock.calls.find((c) => c[0] === "/api/chat/ses_1/messages")!;
    expect(JSON.parse((sent[1] as RequestInit).body as string)).toEqual({ message: "Yes, captions please" });
    // The reply is streamed from where the send was accepted, not from the top of the log.
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/chat/ses_1/stream?after_seq=6")).toBe(true));
    expect(where()).toBe("/chat/ses_1");
  });

  it("opens a session on the first send and moves to it, keeping what was just said", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/chat" && init?.method === "POST") return Promise.resolve(json({ id: "ses_9", status: "running" }, 202));
      if (url.startsWith("/api/chat/ses_9/stream")) return Promise.resolve(stream("event: session.idle\ndata: {}\n\n"));
      if (url === "/api/chat/ses_9") return Promise.resolve(json({ ...SESSION, id: "ses_9", title: "Plan the week" }));
      return Promise.resolve(json({ error: url }, 404));
    });
    const changed = vi.fn();
    window.addEventListener("chat:sessions", changed);
    await mount("/chat", fetchMock);
    expect(host.querySelector(".absence")!.textContent).toContain("Brief the channel-manager");
    await type("Plan the week");
    await vi.waitFor(() => expect(where()).toBe("/chat/ses_9"));
    expect(bubbles()).toEqual([[true, "Plan the week"]]);
    expect(host.querySelector("header .font-mono")!.textContent).toBe("ses_9");
    // The log is not read back for a session this screen just opened; the stream is followed from the top.
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/chat/ses_9/events")).toBe(false);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/chat/ses_9/stream")).toBe(true));
    expect(changed).toHaveBeenCalled();
    window.removeEventListener("chat:sessions", changed);
  });

  it("shows a failed read as a chip, not as a line of text", async () => {
    await mount("/chat/ses_1", vi.fn(() => Promise.resolve(json({ error: "not configured — set NAIVE_API_KEY" }, 503))));
    const chip = host.querySelector(".chip-fail")!;
    expect(chip.textContent).toContain("not configured");
    expect(host.querySelector("textarea")).not.toBeNull();
  });
});
