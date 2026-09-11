// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTEMPTED, CLOSED_TEXT, DENIED_TEXT, decide, Gate, TITLE, wasDenied, type Session } from "./Gate";

const STUDIO = "https://app.usenaive.ai/apps/app_123/open";
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
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** Mounts the gate over a `/api/session` answer and lets the fetch and both effects settle. */
async function mount(session: Session, go = vi.fn<(url: string) => void>(), framed?: boolean) {
  const fetchMock = vi.fn().mockResolvedValue(json(session));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(
      <Gate go={go} framed={framed}>
        <p data-testid="app">the app</p>
      </Gate>,
    );
  });
  return { fetchMock, go };
}

/** Unmounts and starts a fresh root, as a new page load would. */
async function remount() {
  await act(async () => root.unmount());
  root = createRoot(host);
}

describe("the gate's verdict", () => {
  it("is pure over the three facts it reads", () => {
    const out = (studio_url: string | null): Session => ({ authenticated: false, studio_url, password_enabled: true });
    expect(decide({ ...out(STUDIO), authenticated: true }, false, false)).toBe("app");
    expect(decide(out(STUDIO), false, false)).toBe("bounce");
    expect(decide(out(STUDIO), true, false)).toBe("gate");
    expect(decide(out(STUDIO), false, true)).toBe("gate");
    expect(decide(out(null), false, false)).toBe("gate");
    // Framed: never a bounce, whatever else is true.
    expect(decide(out(STUDIO), false, false, true)).toBe("gate");
    expect(decide({ ...out(STUDIO), authenticated: true }, false, false, true)).toBe("app");
    expect(wasDenied("?entry=denied")).toBe(true);
    expect(wasDenied("?entry=granted")).toBe(false);
    expect(wasDenied("")).toBe(false);
  });
});

describe("the gate", () => {
  it("asks /api/session first and renders nothing — not the app — until it answers", async () => {
    let answer: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(
        <Gate go={vi.fn()}>
          <p data-testid="app">the app</p>
        </Gate>,
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session");
    expect(host.innerHTML).toBe("");
    await act(async () => answer(json({ authenticated: true, studio_url: null, password_enabled: false })));
    expect(host.textContent).toBe("the app");
  });

  it("renders the app when signed in, and clears the spent bounce mark", async () => {
    window.sessionStorage.setItem(ATTEMPTED, "1");
    const { fetchMock, go } = await mount({ authenticated: true, studio_url: STUDIO, password_enabled: true });
    expect(host.textContent).toBe("the app");
    expect(host.querySelector("form")).toBeNull();
    expect(go).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(ATTEMPTED)).toBeNull();
    // The session call is the only one the gate itself makes.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounces to the studio exactly once per tab, and draws the gate on the second arrival", async () => {
    const signedOut: Session = { authenticated: false, studio_url: STUDIO, password_enabled: true };
    const { go } = await mount(signedOut);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(STUDIO);
    expect(window.sessionStorage.getItem(ATTEMPTED)).toBe("1");
    expect(host.textContent).toContain("Opening your dashboard");
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).not.toContain("the app");

    // The studio hands the browser back (or refuses); the tab remembers and does not go again.
    await remount();
    const second = await mount(signedOut);
    expect(second.go).not.toHaveBeenCalled();
    const link = host.querySelector<HTMLAnchorElement>("a.btn-primary");
    expect(link?.getAttribute("href")).toBe(STUDIO);
    expect(link?.getAttribute("target")).toBeNull();
    expect(link?.textContent).toBe("Open with Naive Studio");
    expect(host.textContent).toContain(TITLE);
    expect(host.textContent).not.toContain("private");
    expect(host.textContent).not.toContain("the app");
  });

  it("never bounces when framed: it draws the form at once, and its studio link opens the top window", async () => {
    const signedOut: Session = { authenticated: false, studio_url: STUDIO, password_enabled: true };
    const { go } = await mount(signedOut, vi.fn(), true);
    expect(go).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(ATTEMPTED)).toBeNull();
    expect(host.textContent).not.toContain("Opening your dashboard");
    expect(host.textContent).toContain(TITLE);
    const form = host.querySelector("form");
    expect(form?.getAttribute("action")).toBe("/api/enter");
    expect(form?.querySelector("input[type=password][name=password]")).not.toBeNull();
    const link = host.querySelector<HTMLAnchorElement>("a.btn-primary");
    expect(link?.getAttribute("href")).toBe(STUDIO);
    expect(link?.getAttribute("target")).toBe("_top");
    expect(link?.textContent).toBe("Open in the Studio");
    expect(host.textContent).not.toContain("the app");

    // A second framed load is the same: still no navigation.
    await remount();
    const again = await mount(signedOut, vi.fn(), true);
    expect(again.go).not.toHaveBeenCalled();
    expect(host.querySelector("form")).not.toBeNull();
  });

  it("renders the gate, not a blank frame, when merely touching sessionStorage throws (third-party storage blocked)", async () => {
    // Chrome Incognito and Brave refuse a cross-site frame all storage: the accessor itself throws
    // a SecurityError, while the partitioned cookie keeps working. The gate must survive that.
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
      configurable: true,
    });
    try {
      expect(() => window.sessionStorage).toThrow(DOMException);
      const signedOut: Session = { authenticated: false, studio_url: STUDIO, password_enabled: true };
      const { go } = await mount(signedOut, vi.fn(), true);
      expect(go).not.toHaveBeenCalled();
      expect(host.textContent).toContain(TITLE);
      expect(host.querySelector("form")?.getAttribute("action")).toBe("/api/enter");
      expect(host.querySelector<HTMLAnchorElement>("a.btn-primary")?.getAttribute("href")).toBe(STUDIO);

      // Top level, the same store counts as "already attempted": the doors, not a bounce loop.
      await remount();
      const top = await mount(signedOut);
      expect(top.go).not.toHaveBeenCalled();
      expect(host.querySelector("form")).not.toBeNull();
      expect(host.querySelector("a.btn-primary")).not.toBeNull();

      // Signed in, the app renders and the clear is swallowed too.
      await remount();
      await mount({ authenticated: true, studio_url: STUDIO, password_enabled: true });
      expect(host.textContent).toBe("the app");
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
      else delete (window as { sessionStorage?: Storage }).sessionStorage;
    }
  });

  it("reads its framing from the window when not told: a top-level jsdom document is not framed", async () => {
    expect(window.self).toBe(window.top);
    const { go } = await mount({ authenticated: false, studio_url: STUDIO, password_enabled: true });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("renders the framed app when signed in, just as at the top level", async () => {
    await mount({ authenticated: true, studio_url: STUDIO, password_enabled: true }, vi.fn(), true);
    expect(host.textContent).toBe("the app");
  });

  it("offers the password as a plain HTML post to /api/enter, with nothing of it in this bundle's hands", async () => {
    window.sessionStorage.setItem(ATTEMPTED, "1");
    await mount({ authenticated: false, studio_url: STUDIO, password_enabled: true });
    const form = host.querySelector("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/api/enter");
    expect(form?.getAttribute("onsubmit")).toBeNull();
    const input = form?.querySelector("input");
    expect(input?.getAttribute("type")).toBe("password");
    expect(input?.getAttribute("name")).toBe("password");
    expect(input?.getAttribute("autocomplete")).toBe("current-password");
    expect(form?.querySelector("button[type=submit]")).not.toBeNull();
    expect(host.textContent).not.toContain(DENIED_TEXT);
  });

  it("does not bounce on the way back from a refused password, and says so in the given words", async () => {
    window.history.replaceState(null, "", "/?entry=denied");
    const { go } = await mount({ authenticated: false, studio_url: STUDIO, password_enabled: true });
    expect(go).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(ATTEMPTED)).toBeNull();
    expect(host.textContent).toContain(DENIED_TEXT);
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector<HTMLAnchorElement>("a.btn-primary")?.getAttribute("href")).toBe(STUDIO);
  });

  it("shows only the door that exists: the form alone without a studio, the link alone without a password", async () => {
    await mount({ authenticated: false, studio_url: null, password_enabled: true });
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector("a.btn-primary")).toBeNull();
    expect(host.textContent).not.toContain(CLOSED_TEXT);

    await remount();
    window.sessionStorage.setItem(ATTEMPTED, "1");
    await mount({ authenticated: false, studio_url: STUDIO, password_enabled: false });
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("a.btn-primary")).not.toBeNull();
  });

  it("says the dashboard is opened from its studio when there is no door at all", async () => {
    const { go } = await mount({ authenticated: false, studio_url: null, password_enabled: false });
    expect(go).not.toHaveBeenCalled();
    expect(host.textContent).toContain(CLOSED_TEXT);
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).not.toContain("the app");
  });

  it("draws a gate with no doors, never the app, when the session call itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "no such route" }, 404)));
    await act(async () => {
      root.render(
        <Gate go={vi.fn()}>
          <p data-testid="app">the app</p>
        </Gate>,
      );
    });
    expect(host.textContent).toContain("no such route");
    expect(host.textContent).toContain(TITLE);
    expect(host.textContent).not.toContain("the app");
  });
});
