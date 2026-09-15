// @vitest-environment jsdom
/** The shared primitives every screen composes its cards from: a brief opens on request and a
 * time reads as how long ago rather than as a timestamp. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Clamp, Facts, ago, clock } from "./kit";

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
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** jsdom lays nothing out; this is the clamped box reporting what a browser's would. */
const laidOut = (scrollHeight: number, clientHeight: number) => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
};

describe("Clamp", () => {
  it("clamps a long text and opens it on Read more", () => {
    const text = "word ".repeat(120).trim();
    act(() => root.render(<Clamp text={text} lines={2} />));
    const p = host.querySelector("p")!;
    expect(p.className).toContain("line-clamp-2");
    const toggle = host.querySelector("button")!;
    expect(toggle.textContent).toBe("Read more");
    act(() => toggle.click());
    expect(host.querySelector("p")!.className).not.toContain("line-clamp");
    expect(host.querySelector("button")!.textContent).toBe("Show less");
  });

  it("offers no toggle on a text that fits", () => {
    act(() => root.render(<Clamp text="One line." />));
    expect(host.querySelector("button")).toBeNull();
  });

  it("offers Read more when the box clips, however short the text, and not when it does not", () => {
    // A narrow column clips a prompt the length guess calls short — the reader had no way in.
    laidOut(60, 40);
    act(() => root.render(<Clamp text="Marble & ink: cool greys, one ink line, subtle grain." lines={2} />));
    expect(host.querySelector("button")?.textContent).toBe("Read more");
    act(() => host.querySelector("button")!.click());
    expect(host.querySelector("p")!.className).not.toContain("line-clamp");
    expect(host.querySelector("button")?.textContent).toBe("Show less");

    act(() => root.unmount());
    root = createRoot(host);
    laidOut(40, 40);
    act(() => root.render(<Clamp text={"word ".repeat(120).trim()} lines={2} />));
    expect(host.querySelector("button")).toBeNull();
  });
});

describe("Facts", () => {
  it("lays each label over its value", () => {
    act(() => root.render(<Facts items={[["Model", "wan-3.0"], ["Length", "20 s"]]} cols={2} />));
    expect(Array.from(host.querySelectorAll("dt")).map((n) => n.textContent)).toEqual(["Model", "Length"]);
    expect(Array.from(host.querySelectorAll("dd")).map((n) => n.textContent)).toEqual(["wan-3.0", "20 s"]);
  });
});

describe("ago", () => {
  const now = Date.parse("2026-09-15T12:00:00Z");
  it("reads as minutes, hours and days", () => {
    expect(ago("2026-09-15T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-09-15T11:45:00Z", now)).toBe("15m ago");
    expect(ago("2026-09-15T09:00:00Z", now)).toBe("3h ago");
    expect(ago("2026-09-12T12:00:00Z", now)).toBe("3d ago");
    expect(ago(undefined, now)).toBe("");
  });
});

describe("clock", () => {
  it("counts minutes and zero-padded seconds, never below zero", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(42_000)).toBe("0:42");
    expect(clock(130_400)).toBe("2:10");
    expect(clock(-5_000)).toBe("0:00");
  });
});
