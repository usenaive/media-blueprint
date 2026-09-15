// @vitest-environment jsdom
/**
 * The approval surface's two decisions: which calls are waiting, and how the arguments a person is
 * being asked to approve are put in front of them.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Approvals, argRows, keyOf, parked, trimmed, unanswered, wants, type WireSession } from "./Approvals";

const session = (over: Partial<WireSession> & Pick<WireSession, "id">): WireSession => ({
  agent_id: "agt_1",
  status: "idle",
  stop_reason: null,
  pending_actions: [],
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

const call = { tool_call_id: "call_1", name: "social.post", args: { content: "hello" } };

describe("parked", () => {
  it("lists a session because it holds a blocked call, not because of its status", () => {
    // A parked session is `idle` with `stop_reason: "awaiting_approval"` — keying off `status`
    // alone would list every finished session in the channel and miss nothing that matters.
    const rows = parked(
      [
        session({ id: "ses_1", status: "idle", stop_reason: "end_turn" }),
        session({ id: "ses_2", status: "idle", stop_reason: "awaiting_approval", pending_actions: [call] }),
        session({ id: "ses_3", status: "running" }),
      ],
      new Map([["agt_1", "producer"]]),
    );
    expect(rows).toEqual([
      {
        sessionId: "ses_2",
        agent: "producer",
        toolCallId: "call_1",
        tool: "social.post",
        args: { content: "hello" },
        since: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("names an agent the roster did not answer for by its id, and puts the oldest wait first", () => {
    const rows = parked(
      [
        session({ id: "ses_new", created_at: "2026-02-02T00:00:00.000Z", pending_actions: [call] }),
        session({
          id: "ses_old",
          created_at: "2026-01-01T00:00:00.000Z",
          pending_actions: [{ ...call, tool_call_id: "call_0" }],
        }),
      ],
      new Map(),
    );
    expect(rows.map((row) => row.sessionId)).toEqual(["ses_old", "ses_new"]);
    expect(rows[0]!.agent).toBe("agt_1");
  });

  it("carries every blocked call of one session, not just the first", () => {
    const rows = parked(
      [session({ id: "ses_1", pending_actions: [call, { ...call, tool_call_id: "call_2", name: "youtube.upload_video" }] })],
      new Map(),
    );
    expect(rows.map((row) => row.tool)).toEqual(["social.post", "youtube.upload_video"]);
  });
});

describe("argRows", () => {
  it("renders the arguments as prose under the agent's own key names", () => {
    expect(argRows({ content: "Rule two will sting.", platforms: ["x", "threads"] })).toEqual([
      { key: "content", label: "Content", text: "Rule two will sting.", media: [] },
      { key: "platforms", label: "Platforms", text: "x, threads", media: [], list: ["x", "threads"] },
    ]);
  });

  it("carries a nested object, and a list of them, as rows of their own beside the prose", () => {
    const [options] = argRows({ options: { schedule_at: "tomorrow", retries: 2 } });
    expect(options!.rows).toEqual([
      { key: "schedule_at", label: "Schedule at", text: "tomorrow", media: [] },
      { key: "retries", label: "Retries", text: "2", media: [] },
    ]);
    // One object in a list is that object's rows; several are numbered so their rows stay apart.
    const [tool] = argRows({ tools: [{ name: "generate_video", permission: "allow" }] });
    expect(tool!.rows?.map((row) => [row.label, row.text])).toEqual([["Name", "generate_video"], ["Permission", "allow"]]);
    const [tools] = argRows({ tools: [{ name: "generate_video" }, { name: "clip_video" }] });
    expect(tools!.rows?.map((row) => [row.label, row.rows?.map((inner) => inner.text)])).toEqual([["Tools 1", ["generate_video"]], ["Tools 2", ["clip_video"]]]);
    expect(argRows({ content: "hello" })[0]).not.toHaveProperty("rows");
  });

  it("pulls media URLs out so the thing being approved can be watched", () => {
    // The one argument that cannot be read as text: approving a publish whose video you have never
    // seen is the failure this whole surface exists to end.
    const rows = argRows({ media_urls: ["https://cdn.example/a.mp4"], url: "https://x.example/p.png" });
    expect(rows[0]).toEqual({ key: "media_urls", label: "Media urls", text: "", media: ["https://cdn.example/a.mp4"] });
    expect(rows[1]!.media).toEqual(["https://x.example/p.png"]);
  });

  it("flattens a nested object into labelled lines rather than a JSON dump", () => {
    expect(argRows({ options: { schedule_at: "tomorrow", retries: 2 } })[0]!.text).toBe(
      "Schedule at: tomorrow\nRetries: 2",
    );
  });

  it("has nothing to show for a call that takes no arguments", () => {
    expect(argRows({})).toEqual([]);
  });
});

describe("a question", () => {
  const question = {
    prompt: "I have no generate_video this turn. Which video model may I use?",
    fields: [{ key: "model", label: "Model", type: "choice" as const, options: ["alibaba/wan-3.0"], other: true }],
  };

  it("is carried as a question, so the card answers it rather than approving it", () => {
    // `ask_operator` parks `awaiting_answer` with a `kind: "question"` row (canonical-spec §7.1).
    const rows = parked(
      [session({
        id: "ses_q",
        stop_reason: "awaiting_answer",
        pending_actions: [{ kind: "question", tool_call_id: "tc_q", name: "ask_operator", args: question, question }],
      })],
      new Map(),
    );
    expect(rows[0]?.question).toEqual(question);
    expect(parked([session({ id: "ses_t", pending_actions: [{ kind: "tool", ...call }] })], new Map())[0]).not.toHaveProperty("question");
  });

  it("is answered trimmed and whole, so a blank field is refused here and not by the platform", () => {
    // The platform rejects a partial answer (§7.2); "   " must not round-trip a 400 for what the
    // screen could have said before sending.
    expect(trimmed(question.fields, { model: "  alibaba/wan-3.0 ", tags: ["a"] })).toEqual({ model: "alibaba/wan-3.0", tags: ["a"] });
    expect(unanswered(question.fields, trimmed(question.fields, { model: "   " }))).toEqual(["Model"]);
    expect(unanswered(question.fields, {})).toEqual(["Model"]);
    expect(unanswered(question.fields, { model: "alibaba/wan-3.0" })).toEqual([]);
  });

  it("drops a blank 'other' entry from a multi-choice, alone or beside a listed option", () => {
    // The free-text slot of a multi-select is one more array entry: `["   "]` is as unanswered as
    // `"   "`, and `["tiktok", "   "]` goes out as `["tiktok"]`. Listed options are kept verbatim.
    const other = [{ key: "where", label: "Where", type: "choice" as const, options: ["tiktok "], multiple: true, other: true }];
    expect(unanswered(other, trimmed(other, { where: ["   "] }))).toEqual(["Where"]);
    expect(trimmed(other, { where: ["tiktok ", "   "] })).toEqual({ where: ["tiktok "] });
    expect(trimmed(other, { where: ["tiktok ", " shorts "] })).toEqual({ where: ["tiktok ", "shorts"] });
  });

  it("keeps two sessions' identical calls apart, since the call id alone does not", () => {
    // `tool_call_id` is a hash of the name and arguments (§7.1): two producers asking the same
    // question share it, and a card keyed on it alone would answer both at once.
    expect(keyOf({ sessionId: "ses_a", toolCallId: "tc_1" })).not.toBe(keyOf({ sessionId: "ses_b", toolCallId: "tc_1" }));
  });
});

describe("wants", () => {
  it("says in one phrase what the agent is asking for", () => {
    expect(wants({ tool: "request_tools" })).toBe("asks to be granted tools");
    expect(wants({ tool: "social.post" })).toBe("asks to post");
    expect(wants({ tool: "youtube.upload_video" })).toBe("wants to run");
    expect(wants({ tool: "ask_operator", question: { prompt: "?", fields: [] } })).toBe("asks you a question");
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("the Approvals screen", () => {
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

  /** GET /sessions and GET /agents answer from the fixtures; every other call goes to `send`. */
  async function mount(sessions: WireSession[], send: ReturnType<typeof vi.fn> = vi.fn()) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/sessions") return Promise.resolve(json({ data: sessions }));
      if (url === "/api/agents") return Promise.resolve(json({ data: [{ id: "agt_1", name: "producer" }] }));
      return send(url, init) as Promise<Response>;
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<Approvals />));
    return send;
  }

  const texts = (selector: string) => Array.from(host.querySelectorAll(selector)).map((el) => el.textContent?.trim());
  const click = async (label: string) => {
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
    await act(async () => button.click());
  };

  it("draws a blocked call as a card: who asks, for what, its arguments as labelled rows, and the decision", async () => {
    const send = await mount([
      session({
        id: "ses_2",
        stop_reason: "awaiting_approval",
        pending_actions: [{ ...call, args: { content: "Rule two will sting.", platforms: ["x", "threads"], reason: "The queue is empty." } }],
      }),
    ]);
    send.mockResolvedValueOnce(json({ id: "ses_2" }, 202));

    const head = host.querySelector("section.panel > header")!;
    expect(head.textContent).toContain("producer");
    expect(head.textContent).toContain("asks to post");
    expect(head.querySelector(".chip.font-mono")?.textContent).toBe("social.post");
    expect(head.textContent).toContain("Waiting for you");
    expect(head.textContent).toContain("ses_2");

    // The arguments are rows under the agent's own key names, never one paragraph of "Key: value".
    expect(texts("dl dt")).toEqual(["Content", "Platforms"]);
    expect(texts("dl dd")[0]).toBe("Rule two will sting.");
    expect(texts("dl dd .chip")).toEqual(["x", "threads"]);
    expect(texts(".prop-label")).toEqual(["Arguments", "Reason"]);
    expect(host.textContent).toContain("The queue is empty.");
    expect(host.textContent).not.toContain("Reason: The queue is empty.");
    expect(texts("button")).toEqual(["Approve", "Reject"]);
    expect(host.textContent).toContain("Approve lets this one call run, exactly as written above.");

    await click("Approve");

    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sessions/ses_2/tool_confirmations");
    expect(JSON.parse(init.body as string)).toEqual({ tool_call_id: "call_1", decision: "allow" });
    expect(host.textContent).toContain("Approved. producer may now run social.post with these arguments");
    expect(texts("button")).toEqual([]);
  });

  it("plays a media argument in its row, with the label at the top edge of the player", async () => {
    await mount([
      session({
        id: "ses_m",
        pending_actions: [{ ...call, args: { content: "Rule two.", media_urls: ["https://cdn.example/a.mp4"] } }],
      }),
    ]);
    const rows = Array.from(host.querySelectorAll("dl > div"));
    const [content, media] = rows.map((row) => [row.querySelector("dt")!, row.querySelector("dd")!] as const);
    expect(media![0].textContent).toBe("Media urls");
    expect(media![1].querySelector("video")?.getAttribute("src")).toBe("https://cdn.example/a.mp4");
    expect(media!.map((el) => el.classList.contains("self-start"))).toEqual([true, true]);
    expect(content!.map((el) => el.classList.contains("self-start"))).toEqual([false, false]);
  });

  it("draws a tool request's nested arguments as rows of their own, and a refusal as a failed chip", async () => {
    const send = await mount([
      session({
        id: "ses_3",
        pending_actions: [{ tool_call_id: "call_r", name: "request_tools", args: { tools: [{ name: "generate_video", permission: "allow" }] } }],
      }),
    ]);
    send.mockResolvedValueOnce(json({ error: { message: "not yours to grant" } }, 403));

    expect(host.textContent).toContain("asks to be granted tools");
    expect(texts("dl dt")).toEqual(["Tools", "Name", "Permission"]);
    expect(host.textContent).not.toContain("Name: generate_video");

    await click("Reject");

    expect(host.querySelector("footer .chip-fail")?.textContent).toBe("Not sent");
    expect(host.textContent).toContain("Nothing was decided — not yours to grant");
    expect(host.querySelector("header .chip-fail")?.textContent).toBe("Not answered");
  });

  it("draws a question as its prompt over a labelled form, refuses a blank answer here, and sends a whole one", async () => {
    const question = {
      prompt: "I have no generate_video this turn. Which video model may I use?",
      fields: [
        { key: "model", label: "Model", type: "choice" as const, options: ["alibaba/wan-3.0"], other: false },
        { key: "why", label: "Why", type: "text" as const },
      ],
    };
    const send = await mount([
      session({
        id: "ses_q",
        stop_reason: "awaiting_answer",
        pending_actions: [{ kind: "question", tool_call_id: "tc_q", name: "ask_operator", args: {}, question }],
      }),
    ]);
    send.mockResolvedValueOnce(json({ id: "ses_q" }, 202));

    expect(host.textContent).toContain("asks you a question");
    expect(host.textContent).toContain(question.prompt);
    expect(texts(".prop-label")).toEqual(["Question", "Your answer", "Model", "Why"]);
    expect(texts("button")).toEqual(["alibaba/wan-3.0", "Answer"]);

    await click("Answer");
    expect(host.textContent).toContain("Nothing was sent — still unanswered: Model, Why.");
    expect(send).not.toHaveBeenCalled();

    await click("alibaba/wan-3.0");
    const why = host.querySelector<HTMLInputElement>("input.input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(why, "  it is pinned ");
      why.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Answer");

    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sessions/ses_q/answers");
    expect(JSON.parse(init.body as string)).toEqual({ tool_call_id: "tc_q", answers: { model: "alibaba/wan-3.0", why: "it is pinned" } });
    expect(host.textContent).toContain("Answered. producer picks up with your answer.");
  });

  it("says plainly when nothing is waiting, and when the sessions could not be read", async () => {
    await mount([session({ id: "ses_done", stop_reason: "end_turn" })]);
    expect(host.querySelector(".absence")?.textContent).toBe("Nothing is waiting on you.");
    expect(host.querySelector("section.panel")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ error: { message: "platform key missing" } }, 503))));
    await act(async () => root.render(<Approvals />));
    expect(host.querySelector("header .chip-fail")?.textContent).toBe("platform key missing");
    expect(host.querySelector(".absence")?.textContent).toContain("platform key missing");
  });
});
