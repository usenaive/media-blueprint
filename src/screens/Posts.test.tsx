// @vitest-environment jsdom
/**
 * The queue's two load-bearing affordances, neither of which is a pure helper, so neither was
 * covered by anything: the one call a brief still needs from a person, and what the screen says
 * when it could not read the queue at all.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Posts } from "./Posts";
import type { Post } from "../data";
import { ACTIVE } from "../../templates";

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

/** A brief: filed, staged, and with no video on it yet — the rows the production strip lists. */
const BRIEF: Post = {
  id: "post_brief",
  title: "3 stoic rules nobody follows",
  caption: "Rule two will sting.",
  platform: "youtube",
  agent: "producer",
  kind: "produced",
  stage: "brief",
  status: "pending",
};

/**
 * Mounts the queue over one `/posts` answer. The connect line reads two routes of its own; they
 * answer empty here, because nothing in this file is about them.
 */
async function mount(posts: Response) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/posts") && init?.method === undefined) return Promise.resolve(posts);
    if (url.startsWith("/api/posts")) return Promise.resolve(json({ ...BRIEF, status: "rejected", rejectedReason: "Rejected by you" }));
    if (url === "/api/context") return Promise.resolve(json({}));
    return Promise.resolve(json({ data: [] }));
  });
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Posts />
      </MemoryRouter>,
    );
  });
  return fetchMock;
}

const strip = (): HTMLElement => {
  const found = host.querySelector("details");
  if (found === null) throw new Error("the production strip did not render");
  return found;
};

describe("a brief in production", () => {
  /**
   * *** THE ONLY KILL SWITCH BEFORE THE PAID STEP. ***
   *
   * The producer renders what is filed on its own schedule and a render is ~$3.32
   * (`ONE_RENDER_MICRO_USD`), so a brief that is off-brand or legally risky has to be stoppable
   * while it is still a brief. There is deliberately no Approve beside it: a brief is not a piece
   * to clear, and approving one stranded the row in a status no seat picks up.
   */
  it("offers Reject and only Reject", async () => {
    await mount(json([BRIEF]));
    const buttons = [...strip().querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttons.filter((label) => label.includes("Reject"))).toHaveLength(1);
    expect(buttons.some((label) => label.includes("Approve"))).toBe(false);
  });

  it("moves the row to rejected, by id, when Reject is pressed", async () => {
    const fetchMock = await mount(json([BRIEF]));
    const reject = [...strip().querySelectorAll("button")].find((b) => b.textContent?.includes("Reject"));
    await act(async () => reject?.click());

    const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect(url).toBe("/api/posts/post_brief");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "rejected" });
  });

  it("is not listed as a piece, having no video on it", async () => {
    await mount(json([BRIEF]));
    expect(host.querySelector(".list")).toBeNull();
  });
});

describe("a queue that could not be read", () => {
  it("says so, rather than reporting an empty channel", async () => {
    // The empty-state arms are ordered: a failed read is not "nothing pending", and the copy that
    // invites the operator to brief the crew would be advice about a queue nobody has seen.
    await mount(json({ error: "the dashboard server is unreachable" }, 502));
    expect(host.textContent).toContain("The queue could not be read");
    expect(host.textContent).toContain("the dashboard server is unreachable");
    expect(host.textContent).not.toContain("Nothing pending right now");
    expect(host.textContent).not.toContain(ACTIVE.words.queueEmpty);
  });

  it("keeps the invitation for a queue that really is empty", async () => {
    await mount(json([]));
    expect(host.textContent).toContain("Nothing pending right now");
    expect(host.textContent).toContain(ACTIVE.words.queueEmpty);
  });
});
