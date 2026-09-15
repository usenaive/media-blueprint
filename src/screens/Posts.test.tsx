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

async function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(
      <MemoryRouter>
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

  it("names a missing account and plan as missing, and says so with a dashed absence when a tab is empty", async () => {
    const bare: Post = { ...pending, id: "post_bare", account: undefined, projectId: undefined };
    await mount(wire([bare]));

    const chips = Array.from(host.querySelectorAll("dd .chip-absent")).map((n) => n.textContent);
    expect(chips).toEqual(["none chosen", "no plan"]);

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
