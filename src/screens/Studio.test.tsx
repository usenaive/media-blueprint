// @vitest-environment jsdom
/**
 * The Studio: a plan's video beside the session that made it. It reads `GET /api/studio/:id`,
 * shows the current cut with its earlier versions, sends every message through `/revise` and
 * shows the server's refusal, and while the plan renders it keeps re-reading — at once when the
 * renderer files the video, and holds a finished job's file as a draft until then.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post, VideoProject } from "../data";
import { Approvals, postIdOf } from "./Approvals";
import { POLL_EVERY, Studio, elapsed, versionsOf, type StudioData } from "./Studio";
import { FACELESS_PROJECT_SEEDS } from "../../seed/projects";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sse = (text: string) =>
  new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  }), { status: 200 });

const frame = (type: string, seq: number, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ id: `evt_${seq}`, seq, type, data })}\n\n`;

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

const HOURS = 3_600_000;
const seed = FACELESS_PROJECT_SEEDS.find((p) => p.status === "rendered")!;
const rendered: VideoProject = {
  ...seed,
  statusAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  sessions: [{ id: "ses_1", role: "rendered", at: new Date(Date.now() - 2 * HOURS).toISOString() }],
  renders: [{ mediaUrl: "fil_old", at: new Date(Date.now() - 2 * HOURS).toISOString(), sessionId: "ses_0" }],
};
const post: Post = {
  id: seed.id,
  title: seed.title,
  caption: seed.caption!,
  mediaUrl: "fil_cur",
  platform: "youtube",
  account: "@dailystoic",
  status: "pending",
  stage: "rendered",
  agent: "producer",
  kind: "produced",
  projectId: seed.id,
};
const session = { id: "ses_1", status: "idle", stop_reason: "end_turn", created_at: rendered.statusAt };
const studio: StudioData = { project: rendered, post, session };

/** The wire: the studio read, the pane's session/log reads, a stream when one is asked for. */
function wire(answer: () => Response, extra: (url: string, init?: RequestInit) => Response | null = () => null) {
  return vi.fn((url: string, init?: RequestInit) => {
    const special = extra(url, init);
    if (special !== null) return Promise.resolve(special);
    if (url.startsWith("/api/studio/") && init?.method === undefined) return Promise.resolve(answer());
    const one = /^\/api\/chat\/([^/?]+)$/.exec(url);
    if (one) return Promise.resolve(json({ ...session, id: one[1] }));
    if (/\/events$/.test(url)) return Promise.resolve(json({ data: [] }));
    if (/\/stream/.test(url)) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(json({ error: `unexpected ${url}` }, 500));
  });
}

async function mount(fetchMock: ReturnType<typeof vi.fn>, id = seed.id) {
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/studio/${id}`]}>
        <Routes>
          <Route path="/studio/:id" element={<Studio />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const buttons = () => Array.from(host.querySelectorAll("button"));
const click = async (label: string) => {
  const button = buttons().find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!;
  await act(async () => button.click());
};
const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>("nav[aria-label=Drawer] [role=tab]")).map((t) => t.textContent?.trim());
const versions = () => Array.from(host.querySelectorAll<HTMLButtonElement>("[aria-label=Versions] [role=tab]"));
const players = () => Array.from(host.querySelectorAll("video")).map((v) => v.getAttribute("src"));
const studioReads = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter((c) => (c[0] as string) === `/api/studio/${seed.id}`).length;
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const type = async (text: string) => {
  const box = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Send");
};

describe("the Studio", () => {
  it("loads a plan by id: header chips, the bound session, and the current cut on the Video tab", async () => {
    const fetchMock = wire(() => json(studio));
    await mount(fetchMock);

    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/studio/${seed.id}`);
    const header = host.querySelector("header")!;
    expect(header.textContent).toContain(seed.title);
    expect(header.textContent).toContain("Generated");
    expect(header.textContent).toContain("Rendered");
    expect(header.textContent).toContain("youtube");
    expect(header.textContent).toContain("Idle");
    expect(header.textContent).toContain("ses_1");
    expect(header.querySelector("a[href='/projects']")).not.toBeNull();
    // Into the queue on the post's own tab, not the bare list.
    expect(header.querySelector("a[href='/posts?tab=pending']")?.textContent).toBe("Open post");
    expect(host.querySelector(".composer-under")!.textContent).toContain("producer · re-renders on your note");
    expect(host.querySelector(".composer-under")!.textContent).toContain("approve/publish stays yours");
    expect(host.querySelector("textarea")!.placeholder).toBe("Say what to change about this video…");

    expect(tabs()).toEqual(["Video", "Plan", "Post"]);
    expect(players()).toEqual(["/api/files/fil_cur"]);
    // Nothing publishes from here.
    expect(buttons().map((b) => b.textContent?.trim())).not.toContain("Post now");
  });

  it("lists every version — renders[] then the current — and plays the one clicked", async () => {
    await mount(wire(() => json(studio)));

    expect(versions().map((v) => v.textContent)).toEqual(["v1 · 2h ago", "v2 · 5m ago (current)"]);
    expect(versions().map((v) => v.getAttribute("aria-selected"))).toEqual(["false", "true"]);

    await act(async () => versions()[0]!.click());
    expect(players()).toEqual(["/api/files/fil_old"]);
    expect(versions().map((v) => v.getAttribute("aria-selected"))).toEqual(["true", "false"]);
  });

  it("words the composer by where the plan is: the planner edits a planned plan, the renderer folds a note into a render still out", async () => {
    const planned: VideoProject = { ...rendered, status: "planned", agent: "scriptwriter", sessions: [] };
    await mount(wire(() => json({ project: planned, post: null, session: null })));
    expect(host.querySelector("textarea")!.placeholder).toBe("Say what to change about this plan…");
    expect(host.querySelector(".composer-under")!.textContent).toBe("scriptwriter · edits the plan on your note — approve/publish stays yours");
    expect(host.querySelector(".absence")!.textContent).toContain("your first note opens one with the scriptwriter");
    expect(host.textContent).not.toContain("re-renders");

    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(wire(() => json({ project: { ...planned, agent: undefined }, post: null, session: null })));
    expect(host.querySelector(".composer-under")!.textContent).toContain("planner · edits the plan on your note");

    // A first render out: no revision opens, the note is folded into the render that is running.
    await act(async () => root.unmount());
    root = createRoot(host);
    const out: VideoProject = { ...rendered, status: "rendering", statusAt: new Date(Date.now() - 60_000).toISOString(), renders: undefined };
    await mount(wire(() => json({ project: out, post: { ...post, mediaUrl: undefined, stage: "rendering" }, session: { ...session, status: "running", stop_reason: null } })));
    expect(host.querySelector("textarea")!.placeholder).toBe("Say what to change about this render…");
    expect(host.querySelector(".composer-under")!.textContent).toBe("producer · folds your note into the render that is out — approve/publish stays yours");

    // A render out on the operator's note is a re-render, as a rendered plan's is.
    await act(async () => root.unmount());
    root = createRoot(host);
    const revising: VideoProject = { ...out, revision: { openedAt: out.statusAt, sessionId: "ses_1", note: "dusk" } };
    await mount(wire(() => json({ project: revising, post: { ...post, stage: "rendering" }, session })));
    expect(host.querySelector("textarea")!.placeholder).toBe("Say what to change about this video…");
    expect(host.querySelector(".composer-under")!.textContent).toBe("producer · re-renders on your note — approve/publish stays yours");
  });

  it("switches tabs: the plan's scenes, then the post with Approve and Reject and no publish", async () => {
    await mount(wire(() => json(studio)));

    await click("Plan");
    expect(host.textContent).toContain("Scenes");
    expect(host.textContent).toContain(seed.scenes![0]!.prompt);
    expect(players()).toEqual([]);

    await click("Post");
    const labels = buttons().map((b) => b.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(["Approve", "Reject"]));
    expect(labels).not.toContain("Post now");
    expect(host.textContent).toContain("@dailystoic");
    expect(host.textContent).toContain("rendered");
  });

  it("approves the post through PATCH, as the queue does, and the controls go away", async () => {
    const fetchMock = wire(
      () => json(studio),
      (_url, init) => (init?.method === "PATCH" ? json({ ...post, status: "approved" }) : null),
    );
    await mount(fetchMock);
    await click("Post");
    await click("Approve");

    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    expect(patch[0]).toBe(`/api/posts/${post.id}`);
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ status: "approved" });
    expect(buttons().map((b) => b.textContent?.trim())).not.toContain("Approve");
    expect(host.textContent).toContain("Approved");
    expect(host.querySelector("header a[href='/posts?tab=approved']")?.textContent).toBe("Open post");
  });

  it("offers Approve and Reject on a ready post too, as the queue does, and Reject names its reason", async () => {
    const ready: StudioData = { ...studio, post: { ...post, status: "ready" } };
    const fetchMock = wire(
      () => json(ready),
      (_url, init) => (init?.method === "PATCH" ? json({ ...post, ...JSON.parse(init.body as string) }) : null),
    );
    await mount(fetchMock);
    await click("Post");
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(expect.arrayContaining(["Approve", "Reject"]));

    await click("Reject");
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ status: "rejected", rejectedReason: "Rejected by you" });
    expect(host.textContent).toContain("Rejected by you");
    expect(buttons().map((b) => b.textContent?.trim())).not.toContain("Reject");
  });

  it("lets the operator take an approval back — Reject alone on an approved post — after which a revision goes through", async () => {
    let current: Post = { ...post, status: "approved" };
    const fetchMock = wire(
      () => json({ ...studio, post: current }),
      (_url, init) => {
        if (init?.method === "PATCH") {
          current = { ...current, ...JSON.parse(init.body as string) };
          return json(current);
        }
        if (init?.method === "POST") {
          return current.status === "approved"
            ? json({ error: "post is approved — reject it first; an approved video is the operator's word" }, 409)
            : json({ session: "ses_1", acceptedSeq: 7, opened: false }, 202);
        }
        return null;
      },
    );
    await mount(fetchMock);

    await type("Make scene 2 dusk");
    expect(Array.from(host.querySelectorAll(".chip-fail")).map((c) => c.textContent)[0]).toContain("reject it first");

    await click("Post");
    const labels = buttons().map((b) => b.textContent?.trim());
    expect(labels).toContain("Reject");
    expect(labels).not.toContain("Approve");
    expect(labels).not.toContain("Post now");
    await click("Reject");
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ status: "rejected", rejectedReason: "Rejected by you" });
    expect(host.textContent).toContain("Rejected");

    await click("Send");
    const revise = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    expect(revise).toHaveLength(2);
    expect(revise[1]![0]).toBe(`/api/studio/${seed.id}/revise`);
    expect(Array.from(host.querySelectorAll(".chip-fail")).map((c) => c.textContent)).not.toContainEqual(expect.stringContaining("reject it first"));
    expect(host.querySelectorAll(".bubble-you").length).toBe(1);
    expect(host.querySelector("textarea")!.value).toBe("");
  });

  it("says a rendered plan with no file on record is rendered, not unrendered", async () => {
    const fileless: StudioData = { ...studio, project: { ...rendered, renders: undefined }, post: { ...post, mediaUrl: undefined } };
    await mount(wire(() => json(fileless)));

    expect(host.querySelector("header")!.textContent).toContain("Rendered");
    expect(players()).toEqual([]);
    const absences = Array.from(host.querySelectorAll(".absence")).map((n) => n.textContent);
    expect(absences).toContainEqual(expect.stringContaining("Rendered, but no file is on record for this plan"));
    expect(host.textContent).not.toContain("has not been rendered");
  });

  it("folds the drawer to an icon rail and expands it again on the tab clicked", async () => {
    await mount(wire(() => json(studio)));

    await click("Fold the drawer");
    expect(tabs()).toEqual([]);
    expect(players()).toEqual([]);
    expect(host.querySelector("[role=separator]")).toBeNull();
    const rail = buttons().map((b) => b.getAttribute("aria-label"));
    expect(rail).toEqual(expect.arrayContaining(["Expand the drawer", "Video", "Plan", "Post"]));

    await click("Plan");
    expect(tabs()).toEqual(["Video", "Plan", "Post"]);
    expect(host.querySelector("nav[aria-label=Drawer] [aria-selected=true]")?.textContent?.trim()).toBe("Plan");
    expect(host.textContent).toContain("Scenes");
  });

  it("says so when no plan or post has that id", async () => {
    await mount(wire(() => json({ error: "no project or post proj_nope" }, 404)), "proj_nope");

    const absence = host.querySelector(".absence")!;
    expect(absence.textContent).toContain("No plan or post has the id");
    expect(absence.textContent).toContain("proj_nope");
    expect(absence.querySelector(".chip-fail")?.textContent).toBe("no project or post proj_nope");
    expect(host.querySelector("a[href='/projects']")).not.toBeNull();
  });

  it("shows a post with no plan behind it: a notice, the Post tab only, and the chat still sends", async () => {
    const alone: StudioData = { project: null, post: { ...post, projectId: undefined, mediaUrl: undefined }, session: null };
    const fetchMock = wire(
      () => json(alone),
      (_url, init) => (init?.method === "POST" ? json({ session: "ses_new", acceptedSeq: 1, opened: true }, 202) : null),
    );
    await mount(fetchMock);

    expect(host.textContent).toContain("This post has no plan behind it");
    expect(host.querySelector(".absence")!.textContent).toContain("the channel-manager hears your first note");
    expect(host.querySelector(".composer-under")!.textContent).toBe("channel-manager · edits the post on your note — approve/publish stays yours");
    expect(host.querySelector("textarea")!.placeholder).toBe("Say what to change about this post…");
    expect(tabs()).toEqual(["Post"]);
    expect(host.textContent).toContain(post.title);

    await type("Shorten the caption");
    const sent = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(sent[0]).toBe(`/api/studio/${seed.id}/revise`);
    expect(JSON.parse((sent[1] as RequestInit).body as string)).toEqual({ message: "Shorten the caption" });
    expect(host.querySelector("header")!.textContent).toContain("ses_new");
  });

  it("sends a revision through /revise, and a refusal shows the server's reason with the text restored", async () => {
    const fetchMock = wire(
      () => json(studio),
      (_url, init) => (init?.method === "POST" ? json({ error: "post is approved — reject it first; an approved video is the operator's word" }, 409) : null),
    );
    await mount(fetchMock);

    await type("Make scene 2 dusk");

    const refusals = Array.from(host.querySelectorAll(".chip-fail")).map((c) => c.textContent);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("reject it first");
    expect(host.querySelector("textarea")!.value).toBe("Make scene 2 dusk");
    expect(host.querySelectorAll(".bubble-you").length).toBe(0);
  });

  it("holds a finished job's file as a draft above the current cut until the plan files it", async () => {
    const running = { ...session, status: "running", stop_reason: null };
    const live = { ...studio, session: running };
    let streamed = false;
    const fetchMock = wire(
      () => json(live),
      (url) => {
        if (url === "/api/chat/ses_1") return json(running);
        if (!/\/stream/.test(url) || streamed) return null;
        streamed = true;
        return sse(frame("media.job.completed", 3, { kind: "video", job_id: "med_1", file_ids: ["fil_new"] }) + frame("session.idle", 4, { stop_reason: "end_turn" }));
      },
    );
    await mount(fetchMock);
    await act(async () => {
      await new Promise((wake) => setTimeout(wake, 20));
    });

    expect(host.textContent).toContain("New cut — not filed yet");
    expect(players()).toEqual(["/api/files/fil_new", "/api/files/fil_cur"]);
    expect(host.textContent).toContain("fil_new");
  });

  it("while rendering: pulses with the time so far, keeps re-reading every 4s, and re-reads at once when the renderer files the video", async () => {
    vi.useFakeTimers();
    const rendering: VideoProject = { ...rendered, status: "rendering", statusAt: new Date(Date.now() - 130_000).toISOString(), revision: { openedAt: new Date().toISOString(), sessionId: "ses_1", note: "make scene 2 dusk instead of dawn" } };
    let answer: StudioData = { ...studio, project: rendering, post: { ...post, stage: "rendering" } };
    let streamed = false;
    const fetchMock = wire(
      () => json(answer),
      (url) => {
        if (!/\/stream/.test(url) || streamed) return null;
        streamed = true;
        return sse(frame("tool.completed", 9, { tool_call_id: "tc_1", name: "channel.update_project", output: "ok", is_error: false }));
      },
    );
    await mount(fetchMock);
    await tick(50);

    expect(host.textContent).toContain("Rendering…");
    expect(host.textContent).toContain("2:10");
    expect(host.querySelector(".dot-run.animate-pulse")).not.toBeNull();
    expect(host.textContent).toContain("Revising");
    // The note is prose: clamped, never a wall.
    const note = Array.from(host.querySelectorAll("p")).find((p) => p.textContent === "make scene 2 dusk instead of dawn")!;
    expect(note.className).toContain("line-clamp-2");
    // The event re-read: the mount's, then the one the tool.completed asked for.
    expect(studioReads(fetchMock)).toBe(2);

    await tick(POLL_EVERY);
    expect(studioReads(fetchMock)).toBe(3);
    await tick(POLL_EVERY);
    expect(studioReads(fetchMock)).toBe(4);

    // The renderer files the cut: rendered again, a new current, and the polling stops.
    answer = { ...studio, project: { ...rendered, renders: [...rendered.renders!, { mediaUrl: "fil_cur", at: rendering.statusAt, sessionId: "ses_1" }] }, post: { ...post, mediaUrl: "fil_v3" } };
    await tick(POLL_EVERY);
    expect(studioReads(fetchMock)).toBe(5);
    expect(host.textContent).not.toContain("Rendering…");
    expect(players()).toEqual(["/api/files/fil_v3"]);
    expect(versions().length).toBe(3);
    await tick(POLL_EVERY * 2);
    expect(studioReads(fetchMock)).toBe(5);
  });
});

describe("versionsOf and elapsed", () => {
  it("orders renders[] before the post's current file, and only the current is marked", () => {
    expect(versionsOf(rendered, post).map((v) => [v.mediaUrl, v.current])).toEqual([["fil_old", false], ["fil_cur", true]]);
    expect(versionsOf({ ...rendered, renders: undefined }, null)).toEqual([]);
  });

  it("dates the current cut by when it landed, not by the revision that opened on it", () => {
    const opened = new Date().toISOString();
    const revising: VideoProject = {
      ...rendered,
      status: "rendering",
      statusAt: opened,
      revision: { openedAt: opened, sessionId: "ses_1", note: "dusk", replaces: { mediaUrl: "fil_cur", at: rendered.statusAt, sessionId: "ses_1" } },
    };
    expect(versionsOf(revising, post).at(-1)).toEqual({ mediaUrl: "fil_cur", at: rendered.statusAt, current: true });
    // A revision with nothing to replace (no file was on the post) falls back to the status change.
    expect(versionsOf({ ...revising, revision: { openedAt: opened, sessionId: "ses_1", note: "dusk" } }, post).at(-1)?.at).toBe(opened);
    expect(versionsOf(rendered, post).at(-1)?.at).toBe(rendered.statusAt);
  });

  it("says the time rendering as seconds, then minutes and seconds", () => {
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    expect(elapsed(new Date(t0).toISOString(), t0 + 42_000)).toBe("0:42");
    expect(elapsed(new Date(t0).toISOString(), t0 + 130_000)).toBe("2:10");
  });
});

describe("the way in from Approvals", () => {
  it("names the row a parked call is about, and nothing when it is about no row", () => {
    expect(postIdOf({ tool: "social.post", args: { content: "hi", post_id: "post_1" } })).toBe("post_1");
    expect(postIdOf({ tool: "channel.update_post", args: { id: "post_1" } })).toBe("post_1");
    expect(postIdOf({ tool: "channel.update_project", args: { id: "proj_1" } })).toBe("proj_1");
    expect(postIdOf({ tool: "social.post", args: { content: "hi" } })).toBeNull();
    expect(postIdOf({ tool: "request_tools", args: { id: "post_1" } })).toBeNull();
  });

  it("puts a quiet Open in Studio link on a card about a post, and none on one that is not", async () => {
    const row = (id: string, args: Record<string, unknown>) => ({
      id,
      agent_id: "agt_1",
      status: "idle",
      stop_reason: "awaiting_approval",
      created_at: "2026-01-01T00:00:00.000Z",
      pending_actions: [{ tool_call_id: `call_${id}`, name: "social.post", args }],
    });
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/sessions") return Promise.resolve(json({ data: [row("ses_a", { content: "hi", post_id: "post_1" }), row("ses_b", { content: "bye" })] }));
      if (url === "/api/agents") return Promise.resolve(json({ data: [{ id: "agt_1", name: "producer" }] }));
      return Promise.resolve(json({ data: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<Approvals />));

    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>("section.panel > header a"));
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Open in Studio", "/studio/post_1"]]);
  });
});
