// @vitest-environment jsdom
/**
 * The rail is the chat's index: the sessions, newest first, under a `New session` control — not
 * the agents, and not a `Chat` row. The counts on Posts and Approvals stay where they were.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./Shell";
import { FACELESS_SEEDS } from "../seed/posts";

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

const SESSIONS = [
  { id: "ses_new", status: "running", stop_reason: null, created_at: "2026-09-15T05:00:00Z", title: "Plan the week" },
  { id: "ses_ask", status: "idle", stop_reason: "awaiting_approval", created_at: "2026-09-14T05:00:00Z", title: "Clip the interview" },
  { id: "ses_old", status: "idle", stop_reason: "end_turn", created_at: "2026-09-13T05:00:00Z", title: "New session" },
];

const parked = { id: "ses_ask", agent_id: "agt_1", status: "idle", stop_reason: "awaiting_approval", pending_actions: [{ tool_call_id: "call_1", name: "social.post", args: {} }] };

const platform = (sessions: unknown[] | null) =>
  vi.fn((url: string) => {
    if (url === "/api/posts") return Promise.resolve(json(FACELESS_SEEDS));
    if (url === "/api/sessions") return Promise.resolve(json({ data: [parked], has_more: false }));
    if (url === "/api/chat") return Promise.resolve(sessions ? json({ data: sessions, has_more: false }) : json({ error: "not configured — set NAIVE_API_KEY" }, 503));
    return Promise.resolve(json({ error: url }, 404));
  });

async function mount(fetchMock: ReturnType<typeof vi.fn>, at = "/") {
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="*" element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  });
}

const rows = () => Array.from(host.querySelectorAll<HTMLAnchorElement>("nav a"));
const labels = () => rows().map((a) => a.textContent?.trim());

describe("the rail", () => {
  it("lists the sessions by title, newest first, under a New session control, and no Chat or Agents rows", async () => {
    await mount(platform(SESSIONS), "/chat/ses_ask");
    const texts = labels();
    expect(texts.some((t) => t === "Chat" || t === "Agents")).toBe(false);
    expect(host.textContent).not.toContain("Agents");
    expect(host.textContent).not.toContain("New brief");

    const fresh = host.querySelector<HTMLAnchorElement>('a[aria-label="New session"]')!;
    expect(fresh.getAttribute("href")).toBe("/chat");
    expect(fresh.className).toContain("rail-new");
    expect(fresh.textContent).toBe("New session");

    const sessions = rows().filter((a) => /^\/chat\/ses_/.test(a.getAttribute("href") ?? ""));
    expect(sessions.map((a) => a.getAttribute("href"))).toEqual(["/chat/ses_new", "/chat/ses_ask", "/chat/ses_old"]);
    expect(sessions.map((a) => a.querySelector("span.block")!.textContent)).toEqual(["Plan the week", "Clip the interview", "New session"]);
    // The id is on the link, never in the row's text.
    expect(sessions.every((a) => !/ses_/.test(a.textContent ?? ""))).toBe(true);
    expect(sessions.map((a) => a.querySelector(".dot")!.className)).toEqual(["dot dot-run", "dot dot-warn", "dot dot-idle"]);
    expect(sessions[1]!.getAttribute("aria-current")).toBe("page");
    expect(sessions[0]!.hasAttribute("aria-current")).toBe(false);
  });

  it("keeps the counts on Posts and Approvals, and the settings row", async () => {
    await mount(platform(SESSIONS));
    const pending = FACELESS_SEEDS.filter((p) => p.status === "pending").length;
    const posts = rows().find((a) => a.getAttribute("href") === "/posts")!;
    expect(posts.querySelector(".rail-count")!.textContent).toBe(String(pending));
    const approvals = rows().find((a) => a.getAttribute("href") === "/approvals")!;
    expect(approvals.querySelector(".rail-count")!.textContent).toBe("1");
    expect(rows().find((a) => a.textContent?.trim() === "Channel settings")!.getAttribute("href")).toBe("/agents");
    expect(labels().filter((t) => t && ["Home", "Posts", "Projects", "Approvals", "Analytics", "Accounts"].some((l) => t.startsWith(l)))).toHaveLength(6);
  });

  it("says quietly when there are none, keeps a failed read apart from an empty list, and caps the list at twenty", async () => {
    await mount(platform([]));
    expect(host.textContent).toContain("No sessions yet");
    expect(host.textContent).not.toContain("Sessions unavailable");
    expect(host.querySelector(".rail-frame .dot-fail")).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(platform(null));
    expect(host.textContent).toContain("Sessions unavailable");
    expect(host.textContent).not.toContain("No sessions yet");
    // A failed read wears the fail tone, so it cannot be mistaken for an empty list.
    const unavailable = host.querySelector(".rail-frame .dot-fail")!.parentElement!;
    expect(unavailable.textContent).toBe("Sessions unavailable");
    expect(unavailable.className).toContain("text-fail");
    await act(async () => root.unmount());
    root = createRoot(host);
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `ses_${i}`, status: "idle", stop_reason: "end_turn", created_at: "2026-09-01T00:00:00Z", title: `Session ${i}` }));
    await mount(platform(many));
    expect(rows().filter((a) => /^\/chat\/ses_/.test(a.getAttribute("href") ?? ""))).toHaveLength(20);
  });

  it("re-reads the list when the Chat screen says a session was opened", async () => {
    const fetchMock = platform(SESSIONS);
    await mount(fetchMock);
    const reads = () => fetchMock.mock.calls.filter((c) => c[0] === "/api/chat").length;
    const before = reads();
    await act(async () => {
      window.dispatchEvent(new Event("chat:sessions"));
    });
    expect(reads()).toBe(before + 1);
  });
});
