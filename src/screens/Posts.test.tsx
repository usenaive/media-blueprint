// @vitest-environment jsdom
/**
 * The queue as cards: a pending row shows its caption clamped, its facts labelled, its plan as a
 * link into Projects, and the two calls it needs from a person — and Approve still moves it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "../data";
import { Posts } from "./Posts";
import { ACTIVE } from "../../templates";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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

const LONG = "A caption long enough to need the clamp. ".repeat(8).trim();

const pending: Post = {
  id: "post_9f2a",
  title: "3 stoic rules nobody follows",
  caption: LONG,
  platform: "youtube",
  account: "@dailystoic",
  status: "pending",
  agent: "producer",
  kind: "produced",
  duration: "0:41",
  projectId: "proj_1",
};

/** The queue answers with the rows; the connect line's two reads answer with nothing. */
const wire = (rows: Post[], onSend?: (url: string, init: RequestInit) => Response) =>
  vi.fn((url: string, init?: RequestInit) => {
    if (init?.method !== undefined && onSend) return Promise.resolve(onSend(url, init));
    if (url === "/api/posts") return Promise.resolve(json(rows));
    return Promise.resolve(json({ data: [] }));
  });

async function mount(fetchMock: ReturnType<typeof vi.fn>, at = "/posts") {
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <Posts />
      </MemoryRouter>,
    );
  });
}

const buttons = () => Array.from(host.querySelectorAll("button")).map((b) => b.textContent?.trim());
const click = async (label: string) => {
  const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
  await act(async () => button.click());
};

describe("the Posts screen", () => {
  it("draws a pending row as a card: clamped caption, labelled facts, plan link, Approve and Reject", async () => {
    await mount(wire([pending]));

    const card = host.querySelector("section.panel")!;
    expect(card.querySelector("h2.card-title")?.textContent).toBe(pending.title);
    // The title opens the Studio on the plan behind the row.
    expect(card.querySelector("h2.card-title a")?.getAttribute("href")).toBe("/studio/proj_1");
    expect(card.textContent).toContain("Pending review");
    expect(card.textContent).toContain("youtube");

    const caption = card.querySelector("p")!;
    expect(caption.textContent).toBe(LONG);
    expect(caption.className).toContain("line-clamp-2");
    expect(buttons()).toEqual(expect.arrayContaining(["Read more", "Approve", "Reject"]));

    const labels = Array.from(card.querySelectorAll("dt")).map((n) => n.textContent);
    expect(labels).toEqual(["Filed by", "Kind", "Account", "Plan"]);
    const plan = card.querySelector<HTMLAnchorElement>("dd a")!;
    expect(plan.textContent).toBe("plan proj_1");
    expect(plan.getAttribute("href")).toBe("/projects");
    // And a visible way in, beside the calls: the title's underline alone was easy to miss.
    const studio = card.querySelector<HTMLAnchorElement>("header a.btn")!;
    expect(studio.textContent?.trim()).toBe("Open in Studio");
    expect(studio.getAttribute("href")).toBe("/studio/proj_1");
    expect(studio.className).toContain("btn-ghost");
  });

  it("approves a row through PATCH and moves it out of Pending", async () => {
    const fetchMock = wire([pending], () => json({ ...pending, status: "approved" }));
    await mount(fetchMock);

    await click("Approve");

    const sent = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")!;
    expect(sent[0]).toBe(`/api/posts/${pending.id}`);
    expect(JSON.parse((sent[1] as RequestInit).body as string)).toEqual({ status: "approved" });
    expect(host.querySelector("section.panel")).toBeNull();
    expect(host.querySelector(".absence")?.textContent).toContain("Nothing pending right now.");
  });

  it("rejects a row with its reason named, as the Studio does, so 'Rejected because' reads the same on both", async () => {
    const fetchMock = wire([pending], (_url, init) => json({ ...pending, ...JSON.parse(init.body as string) }));
    await mount(fetchMock);
    await click("Reject");
    const sent = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse((sent[1] as RequestInit).body as string)).toEqual({ status: "rejected", rejectedReason: "Rejected by you" });
  });

  it("opens on the tab the link names — the Studio's 'Open post' lands on the post's own tab — and on Pending otherwise", async () => {
    const approved: Post = { ...pending, id: "post_ok", status: "approved" };
    await mount(wire([pending, approved]), "/posts?tab=approved");
    expect(host.querySelector("[role=tab][aria-selected=true]")?.textContent).toContain("Approved");
    expect(host.querySelector("h2.card-title")?.textContent).toBe(approved.title);
    expect(buttons()).toEqual(expect.arrayContaining(["Post now"]));
    expect(host.querySelector<HTMLAnchorElement>("header a.btn")?.getAttribute("href")).toBe("/studio/proj_1");

    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(wire([pending]), "/posts?tab=nonsense");
    expect(host.querySelector("[role=tab][aria-selected=true]")?.textContent).toContain("Pending");
  });

  it("names a missing account and plan as missing, and says so with a dashed absence when a tab is empty", async () => {
    const bare: Post = { ...pending, id: "post_bare", account: undefined, projectId: undefined };
    await mount(wire([bare]));

    const chips = Array.from(host.querySelectorAll("dd .chip-absent")).map((n) => n.textContent);
    expect(chips).toEqual(["none chosen", "no plan"]);
    // No plan: the Studio opens on the post itself.
    expect(host.querySelector("h2.card-title a")?.getAttribute("href")).toBe("/studio/post_bare");

    const tab = Array.from(host.querySelectorAll<HTMLButtonElement>("[role=tab]")).find((b) => b.textContent?.startsWith("Rejected"))!;
    await act(async () => tab.click());
    expect(host.querySelector(".absence")?.textContent).toContain("Nothing rejected right now.");
  });

  it("labels a rejected row's reason in the fail tone", async () => {
    const rejected: Post = { ...pending, id: "post_no", status: "rejected", rejectedReason: "The hook restates the title." };
    await mount(wire([rejected]));
    const tab = Array.from(host.querySelectorAll<HTMLButtonElement>("[role=tab]")).find((b) => b.textContent?.startsWith("Rejected"))!;
    await act(async () => tab.click());
    const label = Array.from(host.querySelectorAll(".prop-label")).find((n) => n.textContent === "Rejected because")!;
    expect(label.className).toContain("text-fail");
    expect(host.textContent).toContain("The hook restates the title.");
  });
});
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
async function mountOver(posts: Response) {
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
    await mountOver(json([BRIEF]));
    const buttons = [...strip().querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttons.filter((label) => label.includes("Reject"))).toHaveLength(1);
    expect(buttons.some((label) => label.includes("Approve"))).toBe(false);
  });

  it("moves the row to rejected, by id, when Reject is pressed", async () => {
    const fetchMock = await mountOver(json([BRIEF]));
    const reject = [...strip().querySelectorAll("button")].find((b) => b.textContent?.includes("Reject"));
    await act(async () => reject?.click());

    const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect(url).toBe("/api/posts/post_brief");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "rejected", rejectedReason: "Rejected by you" });
  });

  it("is not listed as a piece, having no video on it", async () => {
    await mountOver(json([BRIEF]));
    expect(host.querySelector(".list")).toBeNull();
  });
});

describe("a queue that could not be read", () => {
  it("says so, rather than reporting an empty channel", async () => {
    // The empty-state arms are ordered: a failed read is not "nothing pending", and the copy that
    // invites the operator to brief the crew would be advice about a queue nobody has seen.
    await mountOver(json({ error: "the dashboard server is unreachable" }, 502));
    expect(host.textContent).toContain("The queue could not be read");
    expect(host.textContent).toContain("the dashboard server is unreachable");
    expect(host.textContent).not.toContain("Nothing pending right now");
    expect(host.textContent).not.toContain(ACTIVE.words.queueEmpty);
  });

  it("keeps the invitation for a queue that really is empty", async () => {
    await mountOver(json([]));
    expect(host.textContent).toContain("Nothing pending right now");
    expect(host.textContent).toContain(ACTIVE.words.queueEmpty);
  });
});
