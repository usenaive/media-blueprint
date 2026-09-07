/**
 * The two templates this blueprint carries, as data.
 *
 * Everything that differs between a faceless channel and a clipping one is asserted here, because
 * that is where the difference is allowed to live: the screens, the routes, the store and `/mcp`
 * are the blueprint's and are shared. What may never differ is the way out — every agent of every
 * template publishes only through the operator's queue.
 */
import { describe, expect, it } from "vitest";
import { ACTIVE, CHANNEL_IDENTITY, CHANNEL_TIMEZONE, TEMPLATES } from "./index.ts";
import { ONE_RENDER_MICRO_USD } from "./template.ts";
import type { MediaTemplate } from "./template.ts";

const both = Object.values(TEMPLATES);
const agentNames = (template: MediaTemplate) => template.agents.map((agent) => agent.name);
const toolsetOf = (template: MediaTemplate, name: string) =>
  template.agents.find((agent) => agent.name === name)?.tools;

/**
 * The platform's own rule for one tool (`canonical-spec §6`): `enabled:false` denies, an explicit
 * permission wins, and a name the toolset never mentions takes the default. Written out here
 * because the whole connections grant turns on what the LAST clause answers.
 */
const permissionFor = (template: MediaTemplate, agent: string, tool: string): string => {
  const toolset = toolsetOf(template, agent);
  const config = toolset?.configs[tool];
  if (config?.enabled === false) return "deny";
  return config?.permission ?? toolset?.default_config.permission ?? "deny";
};

/** What an agent may actually call: the names that are not denied. */
const toolsOf = (template: MediaTemplate, name: string) =>
  Object.entries(toolsetOf(template, name)?.configs ?? {})
    .filter(([, config]) => config.enabled !== false && config.permission !== "deny")
    .map(([tool]) => tool);

describe("the crews", () => {
  it("shares the channel manager and differs only in the specialist", () => {
    expect(agentNames(TEMPLATES.faceless)).toEqual(["producer", "channel-manager"]);
    expect(agentNames(TEMPLATES.clipping)).toEqual(["clipper", "channel-manager"]);
  });

  it("gives the producer generation tools and the clipper a cutting one, and neither the other's", () => {
    expect(toolsOf(TEMPLATES.faceless, "producer")).toEqual(
      expect.arrayContaining(["generate_video", "generate_image"]),
    );
    expect(toolsOf(TEMPLATES.faceless, "producer")).not.toContain("clip_video");
    expect(toolsOf(TEMPLATES.clipping, "clipper")).toContain("clip_video");
    expect(toolsOf(TEMPLATES.clipping, "clipper")).not.toContain("generate_video");
  });

  /**
   * The producer's first real action on a live install was `generate_video`, and it was refused:
   * "name a video model — no default can be derived". Video models publish no price, so the
   * catalogue-derived default the tool falls back to does not exist for them, and only a pin here
   * supplies one. Without it the nightly producer cron fails every night with nobody watching.
   */
  it("pins a video model on every agent that may render, so the first call has a default", () => {
    for (const template of both) {
      for (const agent of template.agents) {
        const config = agent.tools?.configs["generate_video"];
        if (config?.enabled !== true) continue;
        const models = (config.config as { models?: unknown })?.models;
        expect(Array.isArray(models) && models.length > 0).toBe(true);
        expect(typeof (models as string[])[0]).toBe("string");
      }
    }
  });

  /** The pin narrows; it must not silently narrow a tool the crew was never granted. */
  it("pins nothing on a crew that does not render", () => {
    expect(TEMPLATES.clipping.agents.find((a) => a.name === "clipper")?.tools?.configs["generate_video"])
      .toEqual({ enabled: false, permission: "deny" });
  });

  it("files each agent's work through the dashboard queue, under the same gate", () => {
    for (const template of both) {
      for (const agent of template.agents) {
        expect(agent.system).toMatch(/never publish it yourself/);
        expect(agent.tools?.configs["channel.create_post"]).toEqual({ enabled: true, permission: "allow" });
        // No template may hand its crew an approve, reject or publish tool on the dashboard.
        expect(Object.keys(agent.tools?.configs ?? {}).some((name) => /^channel\.(approve|reject|post)/.test(name))).toBe(false);
      }
    }
  });

  it("grants no agent of either template a publish path that skips the operator", () => {
    for (const template of both) {
      for (const agent of template.agents) {
        // `ask` (canonical-spec §6) parks the turn `awaiting_approval` with the call in
        // `pending_actions`; `allow` would publish straight past the operator.
        expect(agent.tools?.configs["social.post"]).toEqual({ enabled: true, permission: "ask" });
        const allowed = Object.entries(agent.tools?.configs ?? {})
          .filter(([, config]) => config.permission === "allow")
          .map(([name]) => name);
        expect(allowed.filter((name) => name.startsWith("social."))).toEqual(["social.accounts"]);
      }
    }
  });

  /**
   * The connections grant. A connected account contributes `<connector>.<operation>` tools whose
   * namespace comes from the org's live connections, so no blueprint can name them in `configs` —
   * under a `deny` default every agent of this channel was offered exactly none of them, which is
   * the whole publishing story this dashboard sells. The default is the only lever that reaches an
   * unnameable name, and `ask` is what makes reaching it safe.
   */
  it("lets an agent act through a connected account, and only with the operator's yes", () => {
    for (const template of both) {
      for (const agent of template.agents) {
        expect(permissionFor(template, agent.name, "youtube.upload_video")).toBe("ask");
        expect(permissionFor(template, agent.name, "instagram.create_post")).toBe("ask");
        // And the default widens nothing that CAN be named: every built-in this crew was not
        // granted is denied by name, sandbox included — so no session provisions a machine either.
        for (const sandbox of ["bash", "read", "write", "edit", "ls", "find"]) {
          expect(permissionFor(template, agent.name, sandbox)).toBe("deny");
        }
        expect(permissionFor(template, agent.name, "browser")).toBe("deny");
      }
    }
  });

  /**
   * The other half of the same grant, and the one without which the toolset above is decoration:
   * connection tools resolve `session → agent → identity → connected accounts`, so an agent holding
   * no identity is offered none however its permissions read.
   */
  it("gives every agent the channel persona the connected accounts hang off", () => {
    for (const template of both) {
      for (const agent of template.agents) expect(agent.identity).toBe(CHANNEL_IDENTITY);
    }
  });

  it("tells each agent to sign what it files, so an operator can read the row", () => {
    // A filed post used to arrive as "by mcp / unassigned" with no media: the queue's own screenshot
    // promises a named agent, a named account and a video, and nothing asked the agent for them.
    for (const template of both) {
      for (const agent of template.agents) {
        expect(agent.system).toMatch(/`agent`/);
        expect(agent.system).toMatch(/`account`/);
        expect(agent.system).toMatch(/`media_url`/);
        expect(agent.system).toMatch(/`source`/);
      }
    }
  });
});

/**
 * The crons — the difference between a channel and a chat window.
 *
 * Neither template declared a single schedule, so nothing this crew does ever started by itself:
 * a provisioned channel sat there until a human opened Chat, which is the opposite of the product
 * the README sells. The cadence is asserted here rather than the exact wording of a fire, because
 * the cadence is the promise; and the shape of a cron string is asserted because `naive up` matches
 * live deployments to declarations BY EXACT CRON TEXT — "0 8 * * 1" and "0 08 * * 1" are a delete
 * plus a create, not a patch.
 */
describe("the channel's clock", () => {
  /** Which agent of each template makes the pieces. The manager is shared; this one is not. */
  const SPECIALIST: Record<string, string> = { faceless: "producer", clipping: "clipper" };

  const schedulesOf = (template: MediaTemplate, name: string) =>
    template.agents.find((agent) => agent.name === name)?.schedules ?? [];
  const everySchedule = both.flatMap((template) =>
    template.agents.flatMap((agent) => agent.schedules ?? []),
  );

  /**
   * Every fire this repo declares: one on each specialist and three on each manager. Called by the
   * tests below that assert a property of each schedule, because a `for` loop over a template that
   * declares none passes — which is exactly the state this whole block exists to keep out.
   */
  const everyFireCounted = () => expect(everySchedule).toHaveLength(8);

  const fields = (cron: string) => cron.split(" ");
  const hourOf = (cron: string) => Number(fields(cron)[1]);
  /** Fires every day: no day-of-month, month or day-of-week restriction. */
  const isDaily = (cron: string) => {
    const [, , dom, month, dow] = fields(cron);
    return dom === "*" && month === "*" && dow === "*";
  };
  /** Fires once a week: every month, any day-of-month, one named weekday. */
  const isWeekly = (cron: string) => {
    const [, , dom, month, dow] = fields(cron);
    return dom === "*" && month === "*" && /^[0-6]$/.test(dow ?? "");
  };

  it("gives every agent of every template a cron, so the channel works with nobody watching", () => {
    // Counted per agent so a failure names the one that fires at nothing.
    const counts = both.flatMap((template) =>
      template.agents.map(
        (agent) => [`${template.name}/${agent.name}`, (agent.schedules ?? []).length] as const,
      ),
    );
    expect(counts).toHaveLength(4);
    expect(counts.filter(([, count]) => count === 0)).toEqual([]);
  });

  it("makes the next piece daily, on whichever agent this template's pieces come from", () => {
    for (const template of both) {
      const crons = schedulesOf(template, SPECIALIST[template.name]!).map((one) => one.cron);
      expect(crons).toHaveLength(1);
      expect(crons.every(isDaily)).toBe(true);
    }
  });

  it("plans the week weekly, and runs the queue and the comments daily, on the channel manager", () => {
    for (const template of both) {
      const manager = schedulesOf(template, "channel-manager");
      expect(manager).toHaveLength(3);
      expect(manager.filter((one) => isWeekly(one.cron))).toHaveLength(1);
      expect(manager.filter((one) => isDaily(one.cron))).toHaveLength(2);
      // The weekly one is the plan; the daily pair is the queue and the comments.
      expect(manager.find((one) => isWeekly(one.cron))?.input).toMatch(/plan/i);
      const daily = manager.filter((one) => isDaily(one.cron)).map((one) => one.input);
      expect(daily.filter((input) => /queue/i.test(input))).toHaveLength(1);
      expect(daily.filter((input) => /comment/i.test(input))).toHaveLength(1);
    }
  });

  it("files the day's piece before the manager sweeps the queue it lands in", () => {
    for (const template of both) {
      const piece = schedulesOf(template, SPECIALIST[template.name]!)[0]!;
      const sweep = schedulesOf(template, "channel-manager").find(
        (one) => isDaily(one.cron) && /queue/i.test(one.input),
      )!;
      expect(hourOf(piece.cron)).toBeLessThan(hourOf(sweep.cron));
    }
  });

  /**
   * An omitted `timezone` is not "the channel's local time", it is UTC — a fire in the middle of
   * somebody's night that also drifts an hour twice a year against the audience it was tuned for.
   */
  it("states a real timezone on every fire instead of taking the API's UTC default", () => {
    everyFireCounted();
    for (const one of everySchedule) expect(one.timezone).toBe(CHANNEL_TIMEZONE);
    // A zone the platform would reject is a zone `Intl` cannot resolve either.
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: CHANNEL_TIMEZONE }).format()).not.toThrow();
    expect(CHANNEL_TIMEZONE).toMatch(/^[A-Za-z_]+\/[A-Za-z_+\-0-9/]+$/);
  });

  /**
   * The other half of the connections grant, on the unattended path. A fire with no identity speaks
   * as nobody and its session resolves `session → agent → identity → connected accounts` to zero
   * accounts — a cron that exists to feed the accounts and cannot reach one of them.
   */
  it("runs every fire as the channel persona, so a cron can reach the connected accounts", () => {
    everyFireCounted();
    for (const one of everySchedule) expect(one.identity).toBe(CHANNEL_IDENTITY);
  });

  /**
   * The sharp edge, asserted. Schedules are the one place in `naive up` where OMISSION DELETES:
   * a declared agent's schedules are owned as a complete set and matched to live rows by exact cron
   * string, so a duplicate is refused outright and a re-spelling (`08` for `8`) silently drops the
   * live row and creates a new one in its place.
   */
  it("writes each cron once per agent, in the one spelling that matches its live row", () => {
    everyFireCounted();
    for (const template of both) {
      for (const agent of template.agents) {
        const crons = (agent.schedules ?? []).map((one) => one.cron);
        expect(new Set(crons).size).toBe(crons.length);
        for (const cron of crons) {
          expect(fields(cron)).toHaveLength(5);
          expect(cron).toBe(cron.trim());
          // No zero-padding and no double spaces: `"0 08 * * 1"` is a different string, and so a
          // different deployment, from `"0 8 * * 1"`.
          for (const field of fields(cron)) expect(field).not.toMatch(/^0\d/);
        }
      }
    }
  });

  /** A fire is one task, and a day of fires is one day of budget. Both ceilings are the agent's. */
  it("keeps each fire inside the per-task ceiling and a day of them inside the daily cap", () => {
    everyFireCounted();
    for (const template of both) {
      for (const agent of template.agents) {
        const schedules = agent.schedules ?? [];
        for (const one of schedules) {
          expect(one.budget_micro_usd).toBeGreaterThan(0);
          expect(one.budget_micro_usd).toBeLessThanOrEqual(agent.budget.max_task_micro_usd);
        }
        expect(agent.budget.period).toBe("day");
        const worstDay = schedules.reduce((sum, one) => sum + one.budget_micro_usd, 0);
        expect(worstDay).toBeLessThanOrEqual(agent.budget.cap_micro_usd);
      }
    }
  });

  /**
   * PRODUCTION, 2026-09-07. The producer's very first render — one 10-second 1080x1920 video, the
   * exact thing this template exists to make — was debited **2,210,000 µUSD**
   * (`led_vna2cf3v27phg8meh4tdnxfcx0`) against a `max_task_micro_usd` of 2,000,000. The session
   * spent the money, blew the ceiling, and parked `budget_paused` with the video already rendered.
   * The operator had to raise the cap and file the post from a second session.
   *
   * A template whose flagship action costs more than its own per-task ceiling fails on first use,
   * for every customer, every time. The ceiling has to clear one render of the length the brief
   * asks for, with the session's own model calls on top.
   */
  it("gives the specialist a ceiling that clears one render of what it is briefed to make", () => {
    for (const template of both) {
      for (const agent of template.agents) {
        expect(agent.budget.max_task_micro_usd).toBeGreaterThan(ONE_RENDER_MICRO_USD);
      }
    }
    // And the fire that produces one must be allowed to spend it: a schedule's budget is the
    // session's own ceiling, so a fire capped under a render is the same failure one level down.
    const producer = TEMPLATES.faceless.agents.find((one) => one.name === "producer");
    expect(producer?.schedules?.[0]?.budget_micro_usd).toBeGreaterThan(ONE_RENDER_MICRO_USD);
  });

  it("tells each fire what to do, in its own words", () => {
    everyFireCounted();
    for (const template of both) {
      for (const agent of template.agents) {
        const inputs = (agent.schedules ?? []).map((one) => one.input);
        for (const input of inputs) expect(input.trim().length).toBeGreaterThan(40);
        // Two fires of one agent that said the same thing would be one fire declared twice.
        expect(new Set(inputs).size).toBe(inputs.length);
      }
    }
  });
});

describe("the data the screens read", () => {
  it("files what its crew actually makes", () => {
    expect(TEMPLATES.faceless.kinds.map((kind) => kind.id)).toEqual(["produced", "multi"]);
    expect(TEMPLATES.clipping.kinds.map((kind) => kind.id)).toEqual(["clip"]);
  });

  it("asks for a niche, and for a source channel only where there is one to cut from", () => {
    expect(TEMPLATES.faceless.questions.map((q) => q.key)).toEqual(["niche"]);
    expect(TEMPLATES.clipping.questions.map((q) => q.key)).toEqual(["niche", "sourceChannel"]);
  });

  it("prints its own words on every screen that has any", () => {
    const words = both.map((template) => Object.values(template.words));
    for (const set of words) expect(set.every((word) => word.trim() !== "")).toBe(true);
    // The two templates never print the same sentence: a screen that read the same either way
    // would be a screen that is not following the template at all.
    expect(new Set(words.flat()).size).toBe(words.flat().length);
  });

  it("is keyed by the name `defineProject({ template })` uses, and one of them is running", () => {
    for (const [key, template] of Object.entries(TEMPLATES)) expect(template.name).toBe(key);
    expect(both).toContain(ACTIVE);
  });
});
