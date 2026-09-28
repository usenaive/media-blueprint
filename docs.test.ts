/**
 * The README and `docs/how-it-works.md` describe the data only: no figure or name in them may
 * disagree with the declarations. The numbers are read out of `templates/`, never kept by hand.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMPLATES, type MediaTemplate, type TemplateName } from "./templates/index.ts";

const README = readFileSync(new URL("./README.md", import.meta.url), "utf8");
const HOW = readFileSync(new URL("./docs/how-it-works.md", import.meta.url), "utf8");
const usd = (micro: number) => micro / 1_000_000;
const dollars = (cell: string) => [...cell.matchAll(/\$([\d.]+)/g)].map((m) => Number(m[1]));
const ceiling = (template: MediaTemplate, seat: string) => template.agents.find((one) => one.name === seat)?.budget.max_task_micro_usd ?? 0;

describe("the README", () => {
  /** Each crew table row: the seat, its timers' budgets, and the day-one cards it owes, in order. */
  it("prints each seat's timers and day-one cards as the declarations hold them", () => {
    let current: MediaTemplate | undefined;
    let rows = 0;
    for (const line of README.split("\n")) {
      if (line.startsWith("#")) {
        const heading = /^#{2,3} +`(faceless|clipping|longform)`/.exec(line.trim());
        current = heading ? TEMPLATES[heading[1] as TemplateName] : undefined;
      }
      const cells = line.split("|").map((cell) => cell.trim());
      const named = /^`([\w-]+)`$/.exec(cells[1] ?? "");
      const agent = current?.agents.find((one) => one.name === named?.[1]);
      if (current === undefined || agent === undefined || cells.length < 6) continue;
      rows += 1;
      expect([current.name, agent.name, dollars(cells[3]!)]).toEqual([current.name, agent.name, (agent.schedules ?? []).map((one) => usd(one.budget_micro_usd))]);
      expect([current.name, agent.name, [...cells[4]!.matchAll(/`([\w-]+)`/g)].map((m) => m[1])]).toEqual([
        current.name,
        agent.name,
        current.tasks.filter((task) => task.assignee === agent.name).map((task) => task.key),
      ]);
    }
    expect(rows).toBe(15);
  });

  /**
   * Day one's ceiling: one per-task ceiling per seeded card, plus one per card of the first piece's
   * chain after the head's — a card carries no budget of its own, the woken session runs on its
   * seat's ceiling.
   */
  it("prints a day-one ceiling of one per-task ceiling per card", () => {
    const dayOne = (template: MediaTemplate) =>
      template.tasks.reduce((sum, task) => sum + ceiling(template, task.assignee!), 0) +
      template.pipeline.slice(1).reduce((sum, seat) => sum + ceiling(template, seat), 0);
    const said = /\(\$([\d.]+) on `faceless`, \$([\d.]+) on `longform`, \$([\d.]+) on `clipping`\)/.exec(README);
    expect(said).not.toBeNull();
    expect([Number(said![1]), Number(said![2]), Number(said![3])]).toEqual([
      usd(dayOne(TEMPLATES.faceless)),
      usd(dayOne(TEMPLATES.longform)),
      usd(dayOne(TEMPLATES.clipping)),
    ]);
  });
});

describe("the docs", () => {
  /** Nothing in them may send a reader to a surface that is gone. */
  it("name no dashboard, Post now, channel tool or app build", () => {
    for (const [name, text] of [["README.md", README], ["docs/how-it-works.md", HOW]] as const) {
      for (const gone of [/dashboard/i, /Post now/i, /\bchannel\.[a-z_]+/, /pnpm (dev|serve|build)/, /DASHBOARD_/, /(?<![\w/])(server|src)\//, /\/mcp\b/]) {
        expect(text, `${name} ${gone}`).not.toMatch(gone);
      }
    }
  });
});
