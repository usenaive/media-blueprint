// @vitest-environment jsdom
/**
 * The Render button: a planned plan goes to its renderer through `POST /api/projects/:id/render`,
 * the screen says who has it and in which session, and the plan's row is not touched from here —
 * it moves to In progress when the renderer's own claim lands.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_EVERY, POLL_FOR, Projects } from "./Projects";
import { CLIPPING_PROJECT_SEEDS, FACELESS_PROJECT_SEEDS } from "../../seed/projects";

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
  vi.useRealTimers();
});

async function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>,
    );
  });
}

const buttons = () => Array.from(host.querySelectorAll("button")).map((b) => b.textContent?.trim());
const click = async (label: string) => {
  const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
  await act(async () => button.click());
};
const tab = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("[role=tab]")).find((t) => t.textContent?.startsWith(label))!;
const tabCount = (label: string) => Number(tab(label).querySelector("span")?.textContent);
const labels = () => Array.from(host.querySelectorAll("dt")).map((dt) => dt.textContent);
const card = () => host.querySelector("section.panel")!;
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("the Projects screen", () => {
  it("offers Render and Drop on a planned plan, prints its id, and sends the plan to its renderer", async () => {
    const planned = FACELESS_PROJECT_SEEDS.find((p) => p.status === "planned")!;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([planned]))
      .mockResolvedValueOnce(json({ project: planned.id, renderer: "producer", session: { id: "ses_1" } }, 202));
    await mount(fetchMock);

    expect(buttons()).toEqual(expect.arrayContaining(["Render", "Drop"]));
    expect(host.textContent).toContain(planned.id);
    expect(host.textContent).toContain(planned.title);

    await click("Render");

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${planned.id}/render`);
    expect(init.method).toBe("POST");
    expect(host.textContent).toContain("Sent to the producer");
    expect(host.textContent).toContain("ses_1");
    // Pressed once: the button is spent until the renderer's claim moves the row.
    expect(host.querySelector<HTMLButtonElement>("button.btn-primary")?.disabled).toBe(true);
    expect(host.textContent).toContain("Planned — waiting for a render");
  });

  it("names the clipper on a clipping plan, and shows the refusal when nobody can take it", async () => {
    const planned = CLIPPING_PROJECT_SEEDS.find((p) => p.status === "planned")!;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([planned]))
      .mockResolvedValueOnce(json({ error: "no clipper agent in this org — run naive up with the clipping template" }, 503));
    await mount(fetchMock);

    expect(host.querySelector("button.btn-primary")?.getAttribute("title")).toContain("clipper");

    await click("Render");

    expect(host.textContent).toContain("no clipper agent in this org");
    // Refused: the button is offered again.
    expect(host.querySelector<HTMLButtonElement>("button.btn-primary")?.disabled).toBe(false);
  });

  it("reads a generation plan as a card: facts, a clamped brief, a scene table and a closed caption", async () => {
    const planned = FACELESS_PROJECT_SEEDS.find((p) => p.status === "planned")!;
    await mount(vi.fn().mockResolvedValueOnce(json([planned])));

    expect(host.querySelectorAll("section.panel")).toHaveLength(1);
    expect(card().querySelector("h2.card-title")?.textContent).toBe(planned.title);
    expect(card().querySelector(".chip-absent")?.textContent).toBe("Planned — waiting for a render");
    expect(labels()).toEqual(["Platform", "Planned by", "Model", "Total seconds", "Style template", "Post"]);
    const seconds = planned.scenes!.reduce((sum, s) => sum + s.seconds, 0);
    expect(card().textContent).toContain(`${seconds}s`);
    expect(card().textContent).toContain(planned.model!);
    expect(card().textContent).toContain(planned.styleTemplate!);
    expect(card().textContent).toContain("no post yet");
    expect(card().textContent).toContain(planned.brief);

    // One row per scene under the head row, each with its seconds and prompt; no paragraph of them.
    const rows = Array.from(card().querySelectorAll("ol.list li")).slice(1);
    expect(rows).toHaveLength(planned.scenes!.length);
    planned.scenes!.forEach((scene, i) => {
      expect(rows[i]?.textContent).toContain(`${scene.seconds}s`);
      expect(rows[i]?.textContent).toContain(scene.prompt);
    });
    expect(card().textContent).toContain("Voiceover");

    const caption = card().querySelector<HTMLDetailsElement>("details")!;
    expect(caption.open).toBe(false);
    expect(caption.querySelector("summary")?.textContent).toBe("Caption");
    expect(caption.textContent).toContain(planned.caption!);
  });

  it("reads a clipping plan as its sources: the URL, the moment as a chip, and the reason", async () => {
    const planned = CLIPPING_PROJECT_SEEDS.find((p) => p.status === "planned")!;
    await mount(vi.fn().mockResolvedValueOnce(json([planned])));

    expect(labels()).toEqual(["Platform", "Planned by", "Sources", "Time range", "Post"]);
    const source = planned.sources![0]!;
    expect(card().querySelector("a[target=_blank]")?.getAttribute("href")).toBe(source.url);
    const chips = Array.from(card().querySelectorAll(".chip")).map((c) => c.textContent);
    expect(chips).toContain(`${source.from} → ${source.to}`);
    expect(chips).toContain("clipping");
    expect(card().textContent).toContain(source.reason);
  });

  it("tones the status chip by state, and offers Restore on a dropped plan", async () => {
    await mount(vi.fn().mockResolvedValueOnce(json([...FACELESS_PROJECT_SEEDS, ...CLIPPING_PROJECT_SEEDS])));

    expect(tabCount("Planned")).toBe(2);
    await act(async () => tab("In progress").click());
    expect(card().querySelector(".chip-plain .dot-run")).not.toBeNull();
    expect(card().textContent).toContain("Rendering");
    await act(async () => tab("Rendered").click());
    expect(card().querySelector(".chip-credit")?.textContent).toBe("Rendered");
    expect(card().querySelector("a[href='/posts']")?.textContent).toBe("post_9f2a");
    await act(async () => tab("Dropped").click());
    expect(card().querySelector(".chip-fail")?.textContent).toBe("Dropped");
    expect(buttons()).toContain("Restore");
  });

  it("says so when a group is empty, and when the plans could not be read", async () => {
    await mount(vi.fn().mockResolvedValueOnce(json([])));
    expect(host.querySelector(".absence")?.textContent).toContain("Nothing planned right now.");
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(vi.fn().mockResolvedValueOnce(json({ error: "the store is locked" }, 500)));
    expect(host.querySelector(".chip-fail")?.textContent).toBe("the store is locked");
    expect(host.querySelector(".absence")?.textContent).toContain("the store is locked");
  });

  it("keeps re-reading a sent plan through rendering until it is rendered, then stops", async () => {
    vi.useFakeTimers();
    const planned = FACELESS_PROJECT_SEEDS.find((p) => p.status === "planned")!;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([planned]))
      .mockResolvedValueOnce(json({ project: planned.id, renderer: "producer", session: { id: "ses_1" } }, 202))
      .mockResolvedValueOnce(json([{ ...planned, status: "rendering" }]))
      .mockResolvedValueOnce(json([{ ...planned, status: "rendering" }]))
      .mockResolvedValueOnce(json([{ ...planned, status: "rendered" }]));
    await mount(fetchMock);
    await click("Render");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await tick(POLL_EVERY);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/projects");
    expect(tabCount("In progress")).toBe(1);

    // Claimed, but not finished: the reads go on.
    await tick(POLL_EVERY);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await tick(POLL_EVERY);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(tabCount("Rendered")).toBe(1);

    // Rendered: nothing more to wait for.
    await tick(POLL_EVERY * 3);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("gives up re-reading a plan whose renderer never finishes", async () => {
    vi.useFakeTimers();
    const planned = FACELESS_PROJECT_SEEDS.find((p) => p.status === "planned")!;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([planned]))
      .mockResolvedValueOnce(json({ project: planned.id, renderer: "producer", session: { id: "ses_1" } }, 202))
      .mockImplementation(() => Promise.resolve(json([{ ...planned, status: "rendering" }])));
    await mount(fetchMock);
    await click("Render");

    await tick(POLL_FOR);
    const reads = fetchMock.mock.calls.length;
    expect(reads).toBeGreaterThan(2);
    await tick(POLL_EVERY * 3);
    expect(fetchMock).toHaveBeenCalledTimes(reads);
  });
});
