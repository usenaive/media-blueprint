// @vitest-environment jsdom
/** Analytics on a channel with published rows: three metric tiles, the line, and the Posts card
 * with every published row in the range; an empty channel is a dashed absence, not an empty chart. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "../data";
import { Analytics } from "./Analytics";

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

async function mount(rows: Post[]) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(rows))));
  await act(async () => root.render(<Analytics />));
}

const posted: Post = {
  id: "post_3970",
  title: "The obstacle is the way",
  caption: "Ryan Holiday's favourite line, sourced.",
  platform: "youtube",
  account: "@dailystoic",
  status: "posted",
  kind: "multi",
  duration: "0:44",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  views: 48_211,
  likes: 5_804,
};

describe("the Analytics screen", () => {
  it("shows the three metric tiles, the line and the published row in the Posts card", async () => {
    await mount([posted, { ...posted, id: "post_pending", status: "pending", postedAt: undefined }]);

    const tiles = Array.from(host.querySelectorAll("button.tile"));
    expect(tiles.map((t) => t.querySelector(".tile-value")?.textContent)).toEqual(["48k", "5.8k", "1"]);
    // Tile labels wear the same micro label as every other in-card label, not a section eyebrow.
    expect(tiles.map((t) => t.querySelector(".prop-label")?.textContent)).toEqual(["Views", "Likes", "Posts published"]);
    expect(host.querySelector(".tile .eyebrow")).toBeNull();
    expect(tiles[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("svg[role=img]")?.getAttribute("aria-label")).toBe("Views per day");

    const cards = Array.from(host.querySelectorAll("section.panel h2.card-title")).map((n) => n.textContent);
    expect(cards).toEqual(["Posts"]);
    expect(host.querySelector(".tbl")?.textContent).toContain(posted.title);
    expect(host.querySelector(".tbl")?.textContent).not.toContain("post_pending");
  });

  it("says so, in a dashed absence, when nothing is published", async () => {
    await mount([{ ...posted, status: "pending", postedAt: undefined }]);
    expect(host.querySelector(".absence")?.textContent).toContain("Nothing published yet.");
    expect(host.querySelector("svg")).toBeNull();
  });
});
