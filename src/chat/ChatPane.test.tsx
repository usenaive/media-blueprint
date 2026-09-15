// @vitest-environment jsdom
/**
 * The session relay is a cookie-gated `/api/*` route like every other one, and `EventSource`
 * cannot send a header — an unauthenticated relay was how anyone could read the events of a
 * session this dashboard never created. So the transcript is read with `fetch`, and this is the
 * proof that no credential is added and that the frames still arrive, in order, from `after_seq`.
 *
 * Below it, the pane itself: what a turn looks like while it is happening — the caret on the
 * bubble being written, the step rows, the thinking dots, the notes and the status line.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { ChatPane, argsSummary, followStream, isWall, placeholderFor } from "./ChatPane";
import type { WireEvent } from "./stream";

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
  vi.useRealTimers();
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

/** A relay held open: frames are pushed as the test goes, and closed when it says so. */
function relay() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start: (c) => (controller = c) }), { status: 200 });
  const encoder = new TextEncoder();
  return {
    response,
    push: (event: WireEvent) => controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)),
    close: () => controller.close(),
  };
}

const frame = (type: string, data: Record<string, unknown> = {}, seq = 0) => `event: ${type}\ndata: ${JSON.stringify({ seq, type, data })}\n\n`;

describe("followStream", () => {
  it("carries no credential of its own, hands every frame over and stops at session.idle", async () => {
    const body = "retry: 3000\n\n" + frame("message.delta", { content: "On" }, 1) + frame("message.completed", { role: "assistant", content: "On it." }, 2) + frame("session.idle", { stop_reason: "end_turn" }, 3);
    const fetchMock = vi.fn().mockResolvedValue(stream(body));
    vi.stubGlobal("fetch", fetchMock);

    const seen: string[] = [];
    const idle = vi.fn();
    followStream("ses_1", 0, (e) => seen.push(e.type), () => false, idle);
    await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(1));
    expect(seen).toEqual(["message.delta", "message.completed", "session.idle"]);

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/chat/ses_1/stream");
    // The relay is same-origin, so the `HttpOnly` cookie `/api/enter` set travels on its own; a
    // header here would be a second copy of a credential this bundle is not allowed to hold.
    expect((fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers).not.toHaveProperty("authorization");
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("picks the log up past what is already on screen, and continues from the last seq it saw", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(stream(frame("message.delta", { content: "a" }, 13))).mockResolvedValueOnce(stream(frame("session.idle", {}, 14)));
    vi.stubGlobal("fetch", fetchMock);
    const idle = vi.fn();
    followStream("ses_1", 12, () => {}, () => false, idle);
    await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/chat/ses_1/stream?after_seq=12", "/api/chat/ses_1/stream?after_seq=13"]);
  });

  it("re-opens after an idle while keepOpen holds, and not once it lets go", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn((_url: string) => Promise.resolve(stream(frame("session.idle", { stop_reason: "end_turn" }, 5))));
    vi.stubGlobal("fetch", fetchMock);
    let open = true;
    const idle = vi.fn();
    const stop = followStream("ses_1", 4, () => {}, () => open, idle);
    await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/chat/ses_1/stream?after_seq=5");
    open = false;
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    stop();
  });
});

describe("argsSummary", () => {
  it("names the keys worth a glance and never the prompt", () => {
    expect(argsSummary({ id: "post_8a93", status: "rendering", expected_status: "planned" })).toBe("id post_8a93 · status rendering");
    expect(argsSummary({ model: "veo-3", prompt: "a very long prompt ".repeat(20) })).toBe("model veo-3");
    expect(argsSummary({ title: "x".repeat(60) })).toBe(`title ${"x".repeat(47)}…`);
    expect(argsSummary({})).toBe("");
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

describe("placeholderFor", () => {
  it("follows the phase", () => {
    expect(placeholderFor({ kind: "idle" }, "Message channel-manager…")).toBe("Message channel-manager…");
    expect(placeholderFor({ kind: "thinking" }, "x")).toBe("Send to queue after this turn…");
    expect(placeholderFor({ kind: "tool", name: "generate_video" }, "x")).toBe("Send to queue after this turn…");
    expect(placeholderFor({ kind: "approval" }, "x")).toBe("Answer in Approvals, or say something else…");
    expect(placeholderFor({ kind: "rendering", job: { id: "med", kind: "video", startedAt: 0, fileIds: null, failed: false } }, "x")).toBe("x");
  });
});

const SESSION = { id: "ses_1", status: "idle", stop_reason: "end_turn", created_at: "2026-09-15T05:00:00Z", title: "Clip the interview" };
const T0 = Date.parse("2026-09-15T05:00:00Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

async function mount(props: Partial<Parameters<typeof ChatPane>[0]> = {}) {
  const send = props.send ?? vi.fn(() => Promise.resolve({ sessionId: "ses_1", acceptedSeq: 0 }));
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ChatPane sessionId="ses_1" send={send} {...props} />
      </MemoryRouter>,
    );
  });
}

const bubbles = () => Array.from(host.querySelectorAll(".bubble")).map((b) => [b.classList.contains("bubble-you"), b.textContent]);
const status = () => host.querySelector(".chat-status")?.textContent ?? null;
const placeholder = () => host.querySelector("textarea")!.placeholder;

async function type(text: string) {
  const box = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.click());
}

/** Serves the session row, its log and one held-open relay; anything else is a 404. */
function serve(session: Record<string, unknown>, log: WireEvent[], live = relay()) {
  const fetchMock = vi.fn((url: string) => {
    if (url === "/api/chat/ses_1") return Promise.resolve(json(session));
    if (url === "/api/chat/ses_1/events") return Promise.resolve(json({ data: log }));
    if (url.startsWith("/api/chat/ses_1/stream")) return Promise.resolve(live.response);
    return Promise.resolve(json({ error: url }, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, live };
}

describe("the ChatPane", () => {
  it("shows thinking dots and 'Thinking' while a turn is open, then writes the reply under a caret until it is done", async () => {
    const running = { ...SESSION, status: "running", stop_reason: null };
    const log: WireEvent[] = [{ seq: 1, type: "message.completed", data: { role: "user", content: "Clip the interview" }, created_at: at(0) }];
    const { fetchMock, live } = serve(running, log);
    const onEvent = vi.fn();
    await mount({ onEvent });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/chat/ses_1/stream?after_seq=1")).toBe(true));
    expect(bubbles()).toEqual([[true, "Clip the interview"]]);
    expect(host.querySelector(".thinking")).not.toBeNull();
    expect(status()).toContain("Thinking");
    expect(placeholder()).toBe("Send to queue after this turn…");

    await act(async () => live.push({ seq: 2, type: "session.running", data: {}, created_at: at(10) }));
    await act(async () => live.push({ seq: 3, type: "message.delta", data: { content: "Three clips" }, created_at: at(20) }));
    await vi.waitFor(() => expect(bubbles()).toEqual([[true, "Clip the interview"], [false, "Three clips"]]));
    expect(host.querySelector(".thinking")).toBeNull();
    expect(host.querySelector(".bubble-agent .caret")).not.toBeNull();
    expect(status()).toContain("Writing");

    await act(async () => live.push({ seq: 4, type: "message.delta", data: { content: " are ready." }, created_at: at(30) }));
    await act(async () => live.push({ seq: 5, type: "message.completed", data: { role: "assistant", content: "Three clips are ready." }, created_at: at(40) }));
    await act(async () => live.push({ seq: 6, type: "session.idle", data: { stop_reason: "end_turn" }, created_at: at(50) }));
    await vi.waitFor(() => expect(host.querySelector(".caret")).toBeNull());
    expect(bubbles()).toEqual([[true, "Clip the interview"], [false, "Three clips are ready."]]);
    expect(status()).toBeNull();
    expect(onEvent.mock.calls.map((c) => (c[0] as WireEvent).seq)).toEqual([2, 3, 4, 5, 6]);
    // Idle, not kept open: the relay is not re-opened.
    expect(fetchMock.mock.calls.filter((c) => /\/stream/.test(c[0] as string))).toHaveLength(1);
  });

  it("stacks tool steps on one rail with their duration, and folds the output behind a toggle", async () => {
    const log: WireEvent[] = [
      { seq: 1, type: "message.completed", data: { role: "user", content: "Render it" }, created_at: at(0) },
      { seq: 2, type: "tool.started", data: { tool_call_id: "tc_1", name: "channel.update_project", args: { id: "post_8a93", status: "rendering", expected_status: "planned" } }, created_at: at(1000) },
      { seq: 3, type: "tool.completed", data: { tool_call_id: "tc_1", name: "channel.update_project", output: '{"ok":true}', is_error: false }, created_at: at(1400) },
      { seq: 4, type: "tool.started", data: { tool_call_id: "tc_2", name: "generate_video", args: { model: "veo-3", prompt: "the whole prompt" } }, created_at: at(2000) },
      { seq: 5, type: "tool.completed", data: { tool_call_id: "tc_2", name: "generate_video", output: "quota exceeded", is_error: true }, created_at: at(254_000) },
      { seq: 6, type: "message.completed", data: { role: "assistant", content: "The render could not start." }, created_at: at(255_000) },
    ];
    serve({ ...SESSION, stop_reason: "end_turn" }, log);
    await mount();
    const rails = host.querySelectorAll(".steps");
    expect(rails).toHaveLength(1);
    const [first, second] = Array.from(rails[0]!.querySelectorAll(".step"));
    expect(first!.textContent).toContain("Ran channel.update_project · 0.4s");
    expect(first!.querySelector(".step-args")!.textContent).toBe("id post_8a93 · status rendering");
    expect(first!.querySelector(".dot")!.className).toContain("dot-ok");
    expect(first!.querySelector(".step-out")).toBeNull();
    expect(second!.textContent).toContain("Ran generate_video · 4m12s");
    expect(second!.querySelector(".step-args")!.textContent).toBe("model veo-3");
    expect(second!.textContent).not.toContain("the whole prompt");
    expect(second!.querySelector(".dot")!.className).toContain("dot-fail");

    const toggle = Array.from(first!.querySelectorAll("button")).find((b) => b.textContent === "Show output")!;
    await act(async () => toggle.click());
    expect(first!.querySelector(".step-out")!.textContent).toBe('{"ok":true}');
    expect(toggle.textContent).toBe("Hide output");
    await act(async () => toggle.click());
    expect(first!.querySelector(".step-out")).toBeNull();
    expect(bubbles()).toEqual([[true, "Render it"], [false, "The render could not start."]]);
  });

  it("shows a running step as 'Running …' with a spinning dot", async () => {
    const log: WireEvent[] = [
      { seq: 1, type: "session.running", data: {}, created_at: at(0) },
      { seq: 2, type: "tool.started", data: { tool_call_id: "tc_1", name: "generate_video", args: { model: "veo-3" } }, created_at: at(1000) },
    ];
    serve({ ...SESSION, status: "running", stop_reason: null }, log);
    await mount();
    const step = host.querySelector(".step")!;
    expect(step.textContent).toContain("Running generate_video…");
    expect(step.querySelector(".dot")!.className).toContain("dot-run");
    expect(step.querySelector("button")).toBeNull();
    expect(status()).toContain("Running generate_video");
    expect(host.querySelector(".thinking")).toBeNull();
  });

  it("notes a queued job and counts the render up while the session sleeps on it, keeping the relay open when asked", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(T0 + 130_000);
    const log: WireEvent[] = [
      { seq: 1, type: "message.completed", data: { role: "user", content: "Render it" }, created_at: at(0) },
      { seq: 2, type: "media.job.queued", data: { kind: "video", model: "veo-3", job_id: "med_1" }, created_at: at(0) },
      { seq: 3, type: "message.completed", data: { role: "assistant", content: "Started the job; you will be told." }, created_at: at(500) },
      { seq: 4, type: "session.idle", data: { stop_reason: "end_turn" }, created_at: at(600) },
    ];
    const { fetchMock, live } = serve(SESSION, log);
    await mount({ keepOpen: true });
    expect(host.querySelector(".note")!.textContent).toBe("Queued the video job");
    expect(status()).toContain("Rendering video · 2:10");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(status()).toContain("Rendering video · 2:11");
    // Idle, but kept open: the woken session's events stream in without a reload.
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/chat/ses_1/stream?after_seq=4")).toBe(true);
    await act(async () => live.push({ seq: 5, type: "media.job.completed", data: { kind: "video", job_id: "med_1", file_ids: ["fil_9"] }, created_at: at(131_000) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(Array.from(host.querySelectorAll(".note")).map((n) => n.textContent)).toEqual(["Queued the video job", "The video job finished — fil_9"]);
    expect(status()).toBeNull();
  });

  it("parks on an approval: an italic note linking to /approvals, the status line and the placeholder say so", async () => {
    const log: WireEvent[] = [
      { seq: 1, type: "message.completed", data: { role: "user", content: "Post it" }, created_at: at(0) },
      { seq: 2, type: "tool.confirm", data: { tool_call_id: "tc_1", name: "social.post", args: {}, kind: "tool" }, created_at: at(100) },
      { seq: 3, type: "session.idle", data: { stop_reason: "awaiting_approval" }, created_at: at(200) },
    ];
    serve({ ...SESSION, stop_reason: "awaiting_approval" }, log);
    await mount();
    const note = host.querySelector(".note")!;
    expect(note.textContent).toBe("Waiting for your approval of social.post — decide it in Approvals");
    expect(note.querySelector("a")!.getAttribute("href")).toBe("/approvals");
    expect(status()).toContain("Waiting for your approval");
    expect(placeholder()).toBe("Answer in Approvals, or say something else…");
  });

  it("shows a failed turn as a chip", async () => {
    serve({ ...SESSION, stop_reason: "error" }, []);
    await mount();
    expect(host.querySelector(".chat-status .chip-fail")!.textContent).toBe("Failed: the turn ended in an error");
  });

  it("puts the turn on screen at once, streams the reply from where it was accepted, and folds the echo of it", async () => {
    const { fetchMock, live } = serve(SESSION, [{ seq: 1, type: "message.completed", data: { role: "user", content: "Hi" }, created_at: at(0) }]);
    const send = vi.fn(() => Promise.resolve({ sessionId: "ses_1", acceptedSeq: 6 }));
    await mount({ send });
    await type("Add captions");
    expect(send).toHaveBeenCalledWith("Add captions");
    expect(bubbles().at(-1)).toEqual([true, "Add captions"]);
    expect(host.querySelector(".thinking")).not.toBeNull();
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/chat/ses_1/stream?after_seq=6")).toBe(true));
    await act(async () => live.push({ seq: 7, type: "message.completed", data: { role: "user", content: "Add captions" }, created_at: at(10) }));
    await vi.waitFor(() => expect(bubbles()).toEqual([[true, "Hi"], [true, "Add captions"]]));
  });

  it("takes a refused send off the transcript and back into the composer", async () => {
    const { fetchMock } = serve(SESSION, [{ seq: 1, type: "message.completed", data: { role: "user", content: "Hi" }, created_at: at(0) }]);
    const send = vi.fn(() => Promise.reject(new ApiError(409, "session is busy")));
    await mount({ send });
    await type("Add captions");
    await vi.waitFor(() => expect(host.querySelector(".chip-fail")!.textContent).toContain("session is busy"));
    expect(bubbles()).toEqual([[true, "Hi"]]);
    expect(host.querySelector("textarea")!.value).toBe("Add captions");
    expect(host.querySelector(".thinking")).toBeNull();
    expect(fetchMock.mock.calls.some((c) => /\/stream/.test(c[0] as string))).toBe(false);
  });

  it("with no session yet, is an empty transcript over the composer", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ error: "unexpected" }, 500))));
    await mount({ sessionId: null, placeholder: "Message channel-manager…" });
    expect(host.querySelector(".absence")!.textContent).toContain("Brief the channel-manager");
    expect(placeholder()).toBe("Message channel-manager…");
    expect(fetch).not.toHaveBeenCalled();
  });
});
