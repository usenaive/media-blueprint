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
import { ONE_RENDER_MICRO_USD, approvalGate } from "./template.ts";
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

/** The roles that publish — the only ones that hold `social.post`, and only ever at `ask`. */
const PUBLISHERS: Record<string, string[]> = {
  faceless: ["producer", "channel-manager"],
  clipping: ["clipper", "channel-manager"],
};

describe("the crews", () => {
  /**
   * A full desk per template, in pipeline order, and the two names the live rows already carry
   * (`producer`, `clipper`, `channel-manager`) kept — `naive up` matches agents by name, so renaming
   * one orphans its sessions. The dashboard's template card counts what is in this array and
   * nothing else.
   */
  it("runs a full desk on each template, in pipeline order, keeping the names the live rows carry", () => {
    expect(agentNames(TEMPLATES.faceless)).toEqual([
      "trend-researcher", "scriptwriter", "producer", "qa-reviewer", "analytics-reporter", "channel-manager",
    ]);
    expect(agentNames(TEMPLATES.clipping)).toEqual([
      "source-scout", "clipper", "caption-writer", "qa-reviewer", "analytics-reporter", "channel-manager",
    ]);
    for (const template of both) {
      expect(new Set(agentNames(template)).size).toBe(template.agents.length);
      for (const agent of template.agents) {
        expect(agent.name).toMatch(/^[a-z]+(-[a-z]+)*$/);
        expect(agent.description?.trim().length).toBeGreaterThan(40);
        // One role per agent, briefed in its own words: the text after the shared gate is its own.
        expect(agent.system?.startsWith(`${approvalGate} You are the `)).toBe(true);
      }
      // No two agents of one template read the same brief.
      const briefs = template.agents.map((agent) => agent.system?.slice(approvalGate.length));
      expect(new Set(briefs).size).toBe(briefs.length);
    }
  });

  /**
   * Deny by default, per role. The desk roles hold no platform tool beyond the dashboard's: the
   * researcher and the scout read the web, the reporter reads the accounts, and the writers and
   * reviewers hold nothing but the queue they edit. Only the roles that make or post a piece hold a
   * publish tool at all.
   */
  it("gives each role only the platform tools its job needs", () => {
    const platformTools = (template: MediaTemplate, name: string) =>
      toolsOf(template, name).filter((tool) => !tool.startsWith("channel.") && !["ask_operator", "request_tools"].includes(tool)).sort();
    expect(platformTools(TEMPLATES.faceless, "trend-researcher")).toEqual(["web_fetch", "web_search"]);
    expect(platformTools(TEMPLATES.faceless, "scriptwriter")).toEqual([]);
    expect(platformTools(TEMPLATES.faceless, "producer")).toEqual(["generate_image", "generate_video", "social.accounts", "social.post"]);
    expect(platformTools(TEMPLATES.faceless, "qa-reviewer")).toEqual([]);
    expect(platformTools(TEMPLATES.faceless, "analytics-reporter")).toEqual(["social.accounts"]);
    expect(platformTools(TEMPLATES.clipping, "source-scout")).toEqual(["web_fetch", "web_search"]);
    expect(platformTools(TEMPLATES.clipping, "clipper")).toEqual(["clip_video", "social.accounts", "social.post"]);
    expect(platformTools(TEMPLATES.clipping, "caption-writer")).toEqual([]);
    expect(platformTools(TEMPLATES.clipping, "qa-reviewer")).toEqual([]);
    expect(platformTools(TEMPLATES.clipping, "analytics-reporter")).toEqual(["social.accounts"]);
    for (const template of both) {
      expect(platformTools(template, "channel-manager")).toEqual(["social.accounts", "social.post", "web_fetch", "web_search"]);
      for (const agent of template.agents) {
        const holdsPost = agent.tools?.configs["social.post"]?.enabled === true;
        expect(holdsPost).toBe(PUBLISHERS[template.name]!.includes(agent.name));
      }
    }
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
        // `pending_actions`; `allow` would publish straight past the operator. A role that does not
        // publish does not hold the tool at all.
        if (PUBLISHERS[template.name]!.includes(agent.name)) {
          expect(agent.tools?.configs["social.post"]).toEqual({ enabled: true, permission: "ask" });
        } else {
          expect(agent.tools?.configs["social.post"]).toBeUndefined();
        }
        const allowed = Object.entries(agent.tools?.configs ?? {})
          .filter(([, config]) => config.permission === "allow")
          .map(([name]) => name);
        expect(allowed.filter((name) => name.startsWith("social.")).every((name) => name === "social.accounts")).toBe(true);
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

  /**
   * The gate tells every agent that the offered list is complete, to `request_tools` for a tool or
   * model it lacks and to `ask_operator` for a fact it lacks — so every agent must hold both on
   * purpose, not by falling through the default, and the built-ins it must not fall through to (the
   * platform's own mailbox) are denied by name. The producer's case is the sharp one: a turn with no
   * `generate_video` must request it — the request is what changes its toolset — not narrate a video.
   */
  it("lets every agent ask the operator for what it lacks, and nothing else it was not named", () => {
    for (const template of both) {
      for (const agent of template.agents) {
        expect(agent.system).toMatch(/complete list of what you can do right now/);
        expect(agent.system).toMatch(/request it once with request_tools/);
        expect(agent.system).toMatch(/ask once with ask_operator/);
        expect(agent.tools?.configs["ask_operator"]).toEqual({ enabled: true, permission: "ask" });
        expect(agent.tools?.configs["request_tools"]).toEqual({ enabled: true, permission: "ask" });
        for (const mailbox of ["email.inboxes", "email.read", "email.send"]) {
          expect(agent.tools?.configs[mailbox]).toEqual({ enabled: false, permission: "deny" });
        }
      }
    }
    const producer = TEMPLATES.faceless.agents.find((agent) => agent.name === "producer");
    expect(producer?.schedules?.[0]?.input).toMatch(/If generate_video is not among your tools.*request_tools.*config\.models/);
    const clipper = TEMPLATES.clipping.agents.find((agent) => agent.name === "clipper");
    expect(clipper?.schedules?.[0]?.input).toMatch(/If clip_video is not among your tools.*request_tools/);
  });

  /**
   * The review bug on the sibling agency blueprint, kept out here: a role's own text — its brief
   * and each of its fires — may name only what THIS template declares. A deliverable kind of the
   * other template would send the agent filing work the store cannot hold; a tool the role does not
   * hold would send it calling something the toolset denies. The shared gate is excluded because it
   * names `clip_video` and `generate_video` on purpose, as the things to `request_tools` for.
   */
  it("names, in each role's own words, only the kinds this template declares and the tools that role holds", () => {
    // Every platform tool a prompt could name as a tool. The sandbox's one-word names (`read`,
    // `write`, `find`…) are left out: in prose they are verbs, and every crew denies them anyway.
    const EVERY_TOOL = [
      "read_skill", "publish_file", "web_search", "web_fetch", "generate_image", "generate_video",
      "clip_video", "send_to_agent", "wait_for_agents", "list_agents", "board_read", "board_write",
      "ask_operator", "request_tools", "email.inboxes", "email.read", "email.send",
      "social.accounts", "social.post",
    ];
    const everyKind = both.flatMap((template) => template.kinds.map((kind) => kind.id));
    for (const template of both) {
      const declared = template.kinds.map((kind) => kind.id);
      const foreign = everyKind.filter((kind) => !declared.includes(kind));
      for (const agent of template.agents) {
        expect(agent.system?.startsWith(approvalGate)).toBe(true);
        const ownWords = [agent.system?.slice(approvalGate.length) ?? "", ...(agent.schedules ?? []).map((one) => one.input)];
        const held = toolsOf(template, agent.name);
        for (const text of ownWords) {
          for (const kind of foreign) expect(text).not.toMatch(new RegExp(`\\b${kind}\\b`, "i"));
          // `channel.<x>` must be one of the dashboard's own MCP tools, which every agent holds.
          for (const [name] of text.matchAll(/\bchannel\.[a-z_]+/g)) expect(held).toContain(name);
          for (const tool of EVERY_TOOL) {
            if (new RegExp(`(^|[^a-z_.])${tool.replace(".", "\\.")}(?![a-z_])`).test(text)) expect(held).toContain(tool);
          }
        }
      }
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
  /** The desk around the specialist, in the order it fires each morning and each week. */
  const DESK: Record<string, { weekly: string[]; morning: string[] }> = {
    faceless: { weekly: ["trend-researcher", "analytics-reporter"], morning: ["scriptwriter", "producer", "qa-reviewer"] },
    clipping: { weekly: ["source-scout", "analytics-reporter"], morning: ["clipper", "caption-writer", "qa-reviewer"] },
  };

  const schedulesOf = (template: MediaTemplate, name: string) =>
    template.agents.find((agent) => agent.name === name)?.schedules ?? [];
  const everySchedule = both.flatMap((template) =>
    template.agents.flatMap((agent) => agent.schedules ?? []),
  );

  /**
   * Every fire this repo declares: one on each of the five desk roles and three on each manager,
   * per template. Called by the tests below that assert a property of each schedule, because a
   * `for` loop over a template that declares none passes — which is exactly the state this whole
   * block exists to keep out.
   */
  const everyFireCounted = () => expect(everySchedule).toHaveLength(16);

  const fields = (cron: string) => cron.split(" ");
  const hourOf = (cron: string) => Number(fields(cron)[1]);
  const minuteOfDay = (cron: string) => hourOf(cron) * 60 + Number(fields(cron)[0]);
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
    expect(counts).toHaveLength(12);
    expect(counts.filter(([, count]) => count === 0)).toEqual([]);
  });

  /**
   * The desk is a pipeline over one queue row — brief, words, piece, review — and each role reads
   * what the one before it wrote, so the order of the fires is the order of the work: the week's
   * briefs land before the Monday plan, and each morning's roles fire in turn before the manager's
   * 08:00 sweep hands the operator rows that are ready to approve.
   */
  it("fires the desk in pipeline order: briefs before the plan, and each morning's roles before the sweep", () => {
    for (const template of both) {
      const { weekly, morning } = DESK[template.name]!;
      for (const name of [...weekly, ...morning]) expect(schedulesOf(template, name)).toHaveLength(1);
      const plan = schedulesOf(template, "channel-manager").find((one) => isWeekly(one.cron))!;
      const sweep = schedulesOf(template, "channel-manager").find(
        (one) => isDaily(one.cron) && /queue/i.test(one.input),
      )!;
      // The week's briefs are filed the evening before the plan that keeps or fills them.
      const [briefs, report] = weekly.map((name) => schedulesOf(template, name)[0]!);
      expect(isWeekly(briefs!.cron)).toBe(true);
      expect(fields(briefs!.cron)[4]).toBe(String((Number(fields(plan.cron)[4]) + 6) % 7));
      // The report lands on the plan's morning, after the sweep and before the plan.
      expect(isWeekly(report!.cron)).toBe(true);
      expect(fields(report!.cron)[4]).toBe(fields(plan.cron)[4]);
      expect(minuteOfDay(report!.cron)).toBeGreaterThan(minuteOfDay(sweep.cron));
      expect(minuteOfDay(report!.cron)).toBeLessThan(minuteOfDay(plan.cron));
      // The morning's roles are daily, strictly in order, and all before the sweep.
      const minutes = morning.map((name) => schedulesOf(template, name)[0]!).map((one) => {
        expect(isDaily(one.cron)).toBe(true);
        return minuteOfDay(one.cron);
      });
      for (let i = 1; i < minutes.length; i++) expect(minutes[i]!).toBeGreaterThan(minutes[i - 1]!);
      expect(minutes.at(-1)!).toBeLessThan(minuteOfDay(sweep.cron));
    }
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
