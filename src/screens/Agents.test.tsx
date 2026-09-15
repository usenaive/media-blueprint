// @vitest-environment jsdom
/**
 * The roster card: what an agent runs on, what it may spend, what it may call, and what it has been
 * doing. It used to be four fields with none of that in them, while every one of these facts was
 * already on the wire the screen was reading — and then one long row that printed all of it at once.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agents, asksYou, historyOf, outcomeOf, runLine, toRoster, type Run } from "./Agents";

describe("toRoster", () => {
  it("carries the model and the budget the roster row already had on the wire", () => {
    const [agent] = toRoster([
      {
        id: "agt_1",
        name: "producer",
        description: "Produces original short videos.",
        model: "test/model",
        budget: { cap_micro_usd: 10_000_000, max_task_micro_usd: 2_000_000, period: "day" },
        tools: { configs: {} },
      },
    ]);
    expect(agent).toMatchObject({ model: "test/model", capMicroUsd: 10_000_000, taskMicroUsd: 2_000_000, period: "day" });
  });

  it("says which tools stop for the operator, and lists none it may not call", () => {
    const [agent] = toRoster([
      {
        id: "agt_1",
        name: "producer",
        tools: {
          configs: {
            "social.post": { enabled: true, permission: "ask" },
            "social.accounts": { enabled: true, permission: "allow" },
            bash: { enabled: false, permission: "deny" },
            browser: { enabled: true, permission: "deny" },
          },
        },
      },
    ]);
    // "may publish" and "may publish, with your approval" are different sentences; the roster
    // printed both the same, and printed denied built-ins as though they were granted.
    expect(agent!.tools).toEqual(["social.post (asks you)", "social.accounts"]);
    expect(agent!.tools.map(asksYou)).toEqual([true, false]);
  });
});

const run = (over: Partial<Run> & Pick<Run, "id">): Run => ({
  agent_id: "agt_1",
  status: "idle",
  stop_reason: "end_turn",
  created_at: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("an agent's history", () => {
  it("is that agent's own sessions, newest first", () => {
    const rows = historyOf(
      [
        run({ id: "ses_1", created_at: "2026-01-01T00:00:00.000Z" }),
        run({ id: "ses_2", created_at: "2026-03-01T00:00:00.000Z" }),
        run({ id: "ses_other", agent_id: "agt_2" }),
      ],
      "agt_1",
    );
    expect(rows.map((one) => one.id)).toEqual(["ses_2", "ses_1"]);
  });

  it("says how a run ended in the operator's words, and what it cost", () => {
    expect(runLine(run({ id: "ses_1", stop_reason: "awaiting_approval", consumed_micro_usd: 120_000 }))).toContain(
      "waiting for your approval · $0.12 spent",
    );
    // A stop reason this dashboard does not have a sentence for is printed as it stands rather
    // than dropped — the operator sees the platform's own word instead of nothing.
    expect(runLine(run({ id: "ses_1", stop_reason: "something_new" }))).toContain("something_new");
    expect(runLine(run({ id: "ses_1", stop_reason: null, status: "running" }))).toContain("running");
  });

  it("gives each ending a tone: done, parked on someone, stopped short, or still going", () => {
    expect(outcomeOf(run({ id: "s", stop_reason: "end_turn" }))).toEqual({ word: "finished", tone: "ok" });
    expect(outcomeOf(run({ id: "s", stop_reason: "awaiting_approval" }))).toEqual({ word: "waiting for your approval", tone: "wait" });
    // A question parks the run `awaiting_answer`; the roster says so in the operator's words, as
    // Approvals and Home do, never as the wire's own token.
    expect(outcomeOf(run({ id: "s", stop_reason: "awaiting_answer" }))).toEqual({ word: "waiting for your answer", tone: "wait" });
    expect(outcomeOf(run({ id: "s", stop_reason: "error" }))).toEqual({ word: "stopped on an error", tone: "fail" });
    expect(outcomeOf(run({ id: "s", stop_reason: null, status: "running" }))).toEqual({ word: "running", tone: "run" });
    expect(outcomeOf(run({ id: "s", stop_reason: null, status: "completed" }))).toEqual({ word: "finished", tone: "run" });
    expect(outcomeOf(run({ id: "s", stop_reason: null, status: "failed" }))).toEqual({ word: "failed", tone: "fail" });
    expect(outcomeOf(run({ id: "s", stop_reason: "something_new" }))).toEqual({ word: "something_new", tone: "run" });
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

async function mount(answers: Record<string, Response | Error>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const answer = answers[url];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? json({ error: "no route" }, 404));
    }),
  );
  await act(async () => root.render(<Agents />));
}

const producer = {
  id: "agt_1",
  name: "producer",
  description: "Produces original short videos for the channel, one a day.",
  model: "test/model",
  budget: { cap_micro_usd: 10_000_000, max_task_micro_usd: 2_000_000, period: "day" },
  tools: { configs: { "social.post": { enabled: true, permission: "ask" }, "social.accounts": { enabled: true } } },
};

describe("the Channel settings screen", () => {
  it("draws each agent as a card: facts, folded tools, and its last runs with the newest one's word as a chip", async () => {
    await mount({
      "/api/agents": json({ data: [producer] }),
      "/api/sessions": json({
        data: [
          run({ id: "ses_1", stop_reason: "end_turn", consumed_micro_usd: 50_000 }),
          run({ id: "ses_2", stop_reason: "awaiting_answer", created_at: "2026-02-01T00:00:00.000Z", consumed_micro_usd: 120_000 }),
        ],
      }),
    });

    const text = host.textContent ?? "";
    expect(text).toContain("producer");
    expect(text).toContain("agt_1");
    expect(text).toContain("Budget/day");
    expect(text).toContain("$10.00");
    expect(text).toContain("$2.00");

    // The model is a chip on the card's head, whole, not a truncated cell of the facts grid.
    const model = Array.from(host.querySelectorAll("header .chip")).find((chip) => chip.textContent === "test/model")!;
    expect(model.className).toContain("font-mono");
    expect(model.closest(".truncate")).toBeNull();
    expect(Array.from(host.querySelectorAll("dt")).map((dt) => dt.textContent)).not.toContain("Model");

    // The newest run's ending, on the card's head — and tinted for what it is.
    const waiting = Array.from(host.querySelectorAll(".chip")).find((chip) => chip.textContent === "waiting for your answer");
    expect(waiting?.className).toContain("chip-absent");
    expect(host.textContent).not.toContain("awaiting_answer");

    // The tools fold closed, summarised by their count, and the one that stops for the operator is told apart.
    const fold = Array.from(host.querySelectorAll("details")).find((d) => d.querySelector("summary")?.textContent === "Tools (2)")!;
    expect(fold.open).toBe(false);
    const asks = fold.querySelector(".chip-absent");
    expect(asks?.textContent).toBe("social.post (asks you)");
    expect(fold.querySelector(".chip-plain")?.textContent).toBe("social.accounts");

    // Both runs, newest first, each with its spend.
    const rows = Array.from(host.querySelectorAll("li")).map((li) => li.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("waiting for your answer");
    expect(rows[0]).toContain("$0.12");
    expect(rows[1]).toContain("finished");
    expect(rows[1]).toContain("$0.05");
  });

  it("says when the runs could not be read, rather than showing an agent with no history", async () => {
    await mount({ "/api/agents": json({ data: [producer] }), "/api/sessions": json({ error: "no key" }, 401) });
    expect(host.textContent).toContain("runs unread");
    expect(host.textContent).toContain("Its runs could not be read.");
  });

  it("keeps the switch-template explanation folded and shows the template's facts instead", async () => {
    await mount({ "/api/agents": json({ data: [] }) });
    const fold = Array.from(host.querySelectorAll("details")).find((d) => d.querySelector("summary")?.textContent === "How to switch template")!;
    expect(fold.open).toBe(false);
    expect(fold.textContent).toContain("naive up");
    expect(host.textContent).toContain("No agents in this organization yet");
  });

  it("puts a failed roster read in the header and draws the absence, not a bare sentence", async () => {
    await mount({ "/api/agents": json({ error: "no platform key" }, 401) });
    expect(host.querySelector(".chip-fail")?.textContent).toBe("no platform key");
    expect(host.querySelector(".absence")?.textContent).toBe("No roster to show.");
  });
});
