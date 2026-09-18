// @vitest-environment jsdom
/**
 * The screen over the `ChatPane`: a session arrived at from the rail is read back from its log,
 * a follow-up is queued on it, and the first send from `/chat` moves to the session it opened.
 * The relay reader and the reducer have their own tests under `src/chat/`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chat, sessionState } from "./Chat";

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

const logged = (log: readonly { type: string }[]) => stream(log.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""));

const LOG = [
  { seq: 1, type: "session.started", data: {} },
  { seq: 2, type: "message.completed", data: { role: "user", content: "Clip the interview" } },
  { seq: 3, type: "tool.call", data: { name: "video.clip" } },
  { seq: 4, type: "message.completed", data: { role: "assistant", content: "Three clips are ready.\n\nWant captions?" } },
  { seq: 5, type: "message.completed", data: { content: "" } },
];

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

const SESSION = { id: "ses_1", status: "idle", stop_reason: "end_turn", created_at: "2026-09-15T05:00:00Z", title: "Clip the interview" };

function Where() {
  return (
    <>
      <output data-where>{useLocation().pathname}</output>
      <Link to="/chat/ses_2" data-next>next</Link>
    </>
  );
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
      Promise.resolve(url === "/api/chat/ses_1" ? json(SESSION) : url === "/api/chat/ses_1/events" ? logged(LOG) : json({ error: url }, 404)),
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

  it("folds a long turn of either side to six lines with a Read more, and leaves a short one whole", async () => {
    const wall = "The plan for the week, in detail. ".repeat(30).trim();
    const log = [
      { seq: 1, type: "message.completed", data: { role: "user", content: wall } },
      { seq: 2, type: "message.completed", data: { role: "assistant", content: wall } },
      { seq: 3, type: "message.completed", data: { role: "assistant", content: "Short." } },
    ];
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url === "/api/chat/ses_1" ? json(SESSION) : url === "/api/chat/ses_1/events" ? logged(log) : json({ error: url }, 404)),
    );
    await mount("/chat/ses_1", fetchMock);
    const [yours, agent, short] = Array.from(host.querySelectorAll(".bubble"));
    expect(yours!.querySelector("p")!.className).toContain("line-clamp-6");
    expect(yours!.querySelector("p")!.textContent).toBe(wall);
    expect(yours!.querySelector("button")!.textContent).toBe("Read more");
    expect(yours!.className).toContain("bubble-you");
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
      if (url === "/api/chat/ses_1/events") return Promise.resolve(logged(LOG));
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

  it("takes a refused follow-up off the transcript and back into the composer", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/chat/ses_1") return Promise.resolve(json(SESSION));
      if (url === "/api/chat/ses_1/events") return Promise.resolve(logged(LOG));
      if (url === "/api/chat/ses_1/messages" && init?.method === "POST") return Promise.resolve(json({ error: "session is busy" }, 409));
      return Promise.resolve(json({ error: url }, 404));
    });
    await mount("/chat/ses_1", fetchMock);
    const before = bubbles();
    await type("Add captions");
    await vi.waitFor(() => expect(host.querySelector(".chip-fail")!.textContent).toContain("session is busy"));
    expect(bubbles()).toEqual(before);
    expect(host.querySelector("textarea")!.value).toBe("Add captions");
    expect(fetchMock.mock.calls.some((c) => /\/stream/.test(c[0] as string))).toBe(false);
  });

  it("drops the previous session's header while the next one loads", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/chat/ses_1") return Promise.resolve(json(SESSION));
      if (url === "/api/chat/ses_1/events") return Promise.resolve(logged(LOG));
      return Promise.resolve(json({ error: "no such session" }, 404));
    });
    await mount("/chat/ses_1", fetchMock);
    expect(host.querySelector("header .font-mono")!.textContent).toBe("ses_1");
    await act(async () => host.querySelector<HTMLAnchorElement>("[data-next]")!.click());
    expect(where()).toBe("/chat/ses_2");
    expect(host.querySelector("header")).toBeNull();
    expect(host.querySelector(".chip-fail")!.textContent).toContain("no such session");
  });

  it("shows a failed read as a chip, not as a line of text", async () => {
    await mount("/chat/ses_1", vi.fn(() => Promise.resolve(json({ error: "not configured — set NAIVE_API_KEY" }, 503))));
    const chip = host.querySelector(".chip-fail")!;
    expect(chip.textContent).toContain("not configured");
    expect(host.querySelector("textarea")).not.toBeNull();
  });
});
