// @vitest-environment jsdom
/**
 * The accounts list: one row per connected account with its network, its standing and when it was
 * connected; an honest absence when there are none; and the Connect action opening the platform's
 * own portal.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts, toAccountRows } from "./Accounts";

describe("toAccountRows", () => {
  it("names an account by its username, then display name, then id, and keeps its face and date", () => {
    expect(
      toAccountRows([
        { id: "sa_2", platform: "youtube", username: null, display_name: "Daily Stoic", connected_at: "2026-01-01T00:00:00.000Z" },
        { id: "sa_1", platform: "instagram", username: "dailystoic", avatar_url: "https://cdn.example/a.png" },
        { id: "sa_3", platform: "tiktok", username: null, display_name: null, avatar_url: null, connected_at: null },
      ]),
    ).toEqual([
      { id: "sa_1", platform: "instagram", handle: "dailystoic", state: "connected", avatarUrl: "https://cdn.example/a.png" },
      { id: "sa_3", platform: "tiktok", handle: "sa_3", state: "connected" },
      { id: "sa_2", platform: "youtube", handle: "Daily Stoic", state: "connected", connectedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });
});

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

async function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(<Accounts />));
}

const click = async (label: string) => {
  const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
  await act(async () => button.click());
};

describe("the Accounts screen", () => {
  it("lists each account with its network, its standing and when it was connected", async () => {
    const connectedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await mount(
      vi.fn().mockResolvedValueOnce(
        json({ data: [{ id: "sa_1", platform: "youtube", username: "dailystoic", connected_at: connectedAt }] }),
      ),
    );
    const row = host.querySelector(".list > *")!;
    expect(row.textContent).toContain("dailystoic");
    expect(row.textContent).toContain("youtube");
    expect(row.textContent).toContain("sa_1");
    expect(row.textContent).toContain("connected 3d ago");
    expect(row.querySelector(".chip-credit")?.textContent).toBe("connected");
  });

  it("draws the absence when nothing is connected, and opens the portal from the header", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ url: "https://portal.example/connect" }));
    await mount(fetchMock);
    expect(host.querySelector(".absence")?.textContent).toContain("No accounts connected yet");

    await click("Connect an account");

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/social/portal");
    expect(init.method).toBe("POST");
    expect(open).toHaveBeenCalledWith("https://portal.example/connect", "_blank", "noopener");
  });

  it("puts a failed read in the header as a chip, not as the list", async () => {
    await mount(vi.fn().mockResolvedValueOnce(json({ error: "no platform key" }, 401)));
    expect(host.querySelector(".chip-fail")?.textContent).toBe("no platform key");
    expect(host.querySelector(".absence")?.textContent).toBe("No accounts to show.");
  });
});
