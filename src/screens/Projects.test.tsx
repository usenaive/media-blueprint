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
import { Projects } from "./Projects";
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
});
