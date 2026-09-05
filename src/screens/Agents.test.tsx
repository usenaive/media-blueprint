/**
 * The roster row: what an agent runs on, what it may spend, what it may call, and what it has been
 * doing. It used to be four fields with none of that in them, while every one of these facts was
 * already on the wire the screen was reading.
 */
import { describe, expect, it } from "vitest";
import { historyOf, runLine, toRoster, type Run } from "./Agents";

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
  });
});

describe("an agent's history", () => {
  const run = (over: Partial<Run> & Pick<Run, "id">): Run => ({
    agent_id: "agt_1",
    status: "idle",
    stop_reason: "end_turn",
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  });

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
});
