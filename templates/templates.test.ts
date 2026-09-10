/**
 * The two templates this blueprint carries, as data.
 *
 * Everything that differs between a faceless channel and a clipping one is asserted here, because
 * that is where the difference is allowed to live: the screens, the routes, the store and `/mcp`
 * are the blueprint's and are shared. What may never differ is the way out — every agent of every
 * template publishes only through the operator's queue.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTIVE, CHANNEL_IDENTITY, CHANNEL_TIMEZONE, TEMPLATES } from "./index.ts";
import { BUILTIN_TOOLS, CONTEXT_PREAMBLE, DAY_ONE_ORDER, ONE_RENDER_MICRO_USD, PLATFORM_CHOICES, words } from "./template.ts";
import { POST_PLATFORMS } from "../seed/posts.ts";
import type { MediaTemplate, TemplateName } from "./template.ts";

/** The four of the platform's twelve `naive/*` catalogue skills a media crew has a use for; no other ref is allowed here. */
const CATALOGUE = ["naive/short-video-hooks", "naive/clip-selection", "naive/caption-writing", "naive/seo-content-brief"];

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
  it("is a crew of five per template, sharing the channel manager and the analyst seat", () => {
    expect(agentNames(TEMPLATES.faceless)).toEqual(["channel-manager", "producer", "trend-scout", "scriptwriter", "analyst"]);
    expect(agentNames(TEMPLATES.clipping)).toEqual(["channel-manager", "clipper", "scout", "caption-editor", "analyst"]);
  });

  /**
   * Plan §2.1/§2.4: a template is a crew a person chooses from, not a count of resources. Every
   * seat says what it is for (`role`), opens its `system` with the shared preamble, stays inside the
   * 150–400 words a person will actually read, and names only catalogue skills.
   */
  it("gives every seat a role, the shared preamble, a readable system and catalogue skills", () => {
    expect(CONTEXT_PREAMBLE).toMatch(/^Read `project_context` before anything else; the answers there are the client's, not yours to invent\./);
    for (const template of both) {
      for (const agent of template.agents) {
        expect(agent.role, agent.name).toMatch(/\S/);
        expect(agent.description, agent.name).toMatch(/\S/);
        const system = agent.system ?? "";
        expect(system.startsWith(CONTEXT_PREAMBLE), agent.name).toBe(true);
        expect(words(system), `${template.name}/${agent.name}`).toBeGreaterThanOrEqual(150);
        expect(words(system), `${template.name}/${agent.name}`).toBeLessThanOrEqual(400);
        for (const skill of agent.skills ?? []) expect(CATALOGUE).toContain(skill);
        // A skill named is a skill it can read.
        if ((agent.skills ?? []).length > 0) expect(toolsOf(template, agent.name)).toContain("read_skill");
        expect(toolsOf(template, agent.name)).toContain("project_context");
      }
    }
  });

  it("requires only the seat the dashboard's Chat is wired to", () => {
    for (const template of both) {
      expect(template.agents.filter((agent) => agent.required === true).map((agent) => agent.name)).toEqual(["channel-manager"]);
    }
  });

  /**
   * Day one (plan §2.5). The apply opens one session per agent with `intake.message`, and every
   * message is written to consume the setup answers rather than restate a hard-coded niche — the
   * scout files the first five briefs for the niche, the writer scripts them, the analyst lays out
   * the report, the manager writes the plan from the cadence answer.
   */
  it("opens day one on every seat, from the context and inside the per-task ceiling", () => {
    for (const template of both) {
      for (const agent of template.agents) {
        expect(agent.intake?.message, agent.name).toMatch(/project_context/);
        expect(agent.intake?.budget_micro_usd, agent.name).toBeGreaterThan(0);
        expect(agent.intake?.budget_micro_usd, agent.name).toBeLessThanOrEqual(agent.budget.max_task_micro_usd);
        expect(Number.isInteger(agent.intake?.budget_micro_usd)).toBe(true);
      }
      expect(template.agents.find((a) => a.name === "channel-manager")?.intake?.message).toMatch(/cadence/);
      expect(template.agents.find((a) => a.name === "analyst")?.intake?.message).toMatch(/report/i);
    }
    expect(TEMPLATES.faceless.agents.find((a) => a.name === "trend-scout")?.intake?.message).toMatch(/five/);
    expect(TEMPLATES.faceless.agents.find((a) => a.name === "scriptwriter")?.intake?.message).toMatch(/hook/i);
    expect(TEMPLATES.clipping.agents.find((a) => a.name === "scout")?.intake?.message).toMatch(/source channel\(s\).*first five/);
  });

  it("makes no seat's day one wait on another's: the apply opens every intake at once", () => {
    // The seats downstream of the scout are told that, told not to invent the upstream work, and
    // told which fire — in cron order — takes the first of it; and they are budgeted for set-up
    // (every call holds its quote until the turn commits, so the cap is turns, not dollars), under
    // the timer that does render.
    const downstream: [MediaTemplate, string, RegExp][] = [
      [TEMPLATES.faceless, "producer", /alongside yours.*Render nothing today.*07:00 fire/s],
      [TEMPLATES.faceless, "scriptwriter", /alongside yours.*not yours to invent.*06:30 fire/s],
      [TEMPLATES.clipping, "clipper", /alongside yours.*Cut nothing today.*07:00 fire/s],
      [TEMPLATES.clipping, "caption-editor", /cuts nothing until its 07:00 fire.*07:30 fire/s],
    ];
    for (const [template, name, says] of downstream) {
      const seat = template.agents.find((a) => a.name === name);
      expect(seat?.intake?.message, name).toMatch(says);
    }
    for (const [template, name] of [[TEMPLATES.faceless, "producer"], [TEMPLATES.clipping, "clipper"]] as const) {
      const seat = template.agents.find((a) => a.name === name);
      const timer = Math.max(...(seat?.schedules ?? []).map((s) => s.budget_micro_usd ?? 0));
      expect(seat?.intake?.budget_micro_usd, name).toBeLessThan(timer);
      expect(seat?.intake?.budget_micro_usd, name).toBeLessThan(ONE_RENDER_MICRO_USD * 4);
    }
  });

  /**
   * #6 — day one produced nothing, because the five intakes race each other.
   *
   * MEASURED IN PRODUCTION, 2026-09-09: the scriptwriter's day-one session read
   * `channel.list_posts -> "[]"` and filed *"the trend-scout hasn't filed any briefs yet in its
   * parallel session"* as its finding — while the trend-scout was filing five briefs in the same
   * minute. `up` opens every intake at once (`packages/blueprints/src/up.ts`: one `eachInFlight`
   * over the crew, after every write) and there is no ordering knob on `intake`. Only the crons run
   * in order. Each message said a piece of that in its own words, and the one seat that was told
   * still reported the emptiness as a result; so it is said once, to every seat of every template,
   * by the same helper that composes the system prompt — not left to whoever writes the next seat.
   */
  it("tells every seat, in one place, that an empty day-one queue is not a finding", () => {
    for (const template of both) {
      for (const agent of template.agents) {
        expect(agent.intake?.message, agent.name).toContain(DAY_ONE_ORDER);
      }
    }
    expect(DAY_ONE_ORDER).toMatch(/not a finding/i);
    // And it names where the ordered work actually happens, so "wait" is never the answer.
    expect(DAY_ONE_ORDER).toMatch(/cron/i);
  });

  /**
   * #5 — where this channel posts is the channel OWNER'S, and it was a constant in `server/mcp.ts`,
   * then a constant here. It is now `PLATFORM_QUESTION`, asked in the studio before anything is
   * provisioned; what is left on the template is the FALLBACK an install with no usable answer
   * files against, and it is the question's own first option so the two can never disagree.
   */
  it("declares a fallback network its crew can file for, and it is the question's own default", () => {
    for (const template of both) {
      expect(POST_PLATFORMS as readonly string[], template.name).toContain(template.platform);
      expect(template.platform, template.name).toBe(PLATFORM_CHOICES[0]!.platform);
    }
    expect(TEMPLATES.faceless.platform).toBe("youtube");
    expect(TEMPLATES.clipping.platform).toBe("youtube");
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
   * A brief that names a tool the same file denies is an instruction the agent cannot follow: the
   * clipping scout was told to watch its sources with `browser`, which every toolset here denies
   * by name (the sandbox is denied on purpose — a content agent needs no machine, and denying it
   * is what keeps a session from provisioning and billing one). The agent spends a turn asking for
   * a tool the blueprint decided it may not have, or narrates the watch it could not do.
   */
  it("never tells an agent to use a tool its own toolset denies", () => {
    // The built-ins whose names are identifiers rather than ordinary English: "read", "write",
    // "edit", "find", "ls" and "apps" appear in every brief as words and mean nothing about tools.
    const AMBIGUOUS = ["read", "write", "edit", "find", "ls", "apps"];
    const offences: string[] = [];
    for (const template of both) {
      for (const agent of template.agents) {
        for (const tool of BUILTIN_TOOLS) {
          if (AMBIGUOUS.includes(tool)) continue;
          if (!new RegExp(`\\b${tool.replace(".", "\\.")}\\b`).test(agent.system ?? "")) continue;
          if (permissionFor(template, agent.name, tool) === "deny") {
            offences.push(`${template.name}/${agent.name} is told to use ${tool}, which its toolset denies`);
          }
        }
      }
    }
    expect(offences).toEqual([]);
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
   * Every fire this repo declares: one on each of the four specialists and three on each manager.
   * Called by the tests below that assert a property of each schedule, because a `for` loop over a
   * template that declares none passes — which is exactly the state this whole block exists to keep out.
   */
  const everyFireCounted = () => expect(everySchedule).toHaveLength(14);

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
    expect(counts).toHaveLength(10);
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

  /**
   * Three questions per template, asked by the studio before anything is provisioned — the engine
   * refuses a fourth, and `onboarding.test.ts` holds it to that by asking the engine itself.
   * `choice` where the answers are a short list, `text` where they are the client's own words.
   *
   * TWO OF THE THREE ARE SHARED NOW. Where the channel posts is not a matter of template — both
   * crews make the same vertical video and both need a network to file it for — so
   * `PLATFORM_QUESTION` sits between the template's own question and the cadence, and each
   * template spends its one remaining slot on the thing only it needs: the niche, or the sources.
   */
  it("asks exactly three setup questions per template, and no more anywhere", () => {
    expect(TEMPLATES.faceless.questions.map((q) => [q.key, q.type])).toEqual([["niche", "choice"], ["platform", "choice"], ["cadence", "choice"]]);
    expect(TEMPLATES.clipping.questions.map((q) => [q.key, q.type])).toEqual([["sources", "text"], ["platform", "choice"], ["cadence", "choice"]]);
    for (const template of both) {
      expect(template.questions).toHaveLength(3);
      for (const question of template.questions) expect(question.label).toMatch(/\S/);
      expect(new Set(template.questions.map((q) => q.key)).size).toBe(3);
    }
    // Each shared question is one question, spelled once: the cadence sizes every plan and every
    // timer, and the network is what every filed row is stamped with.
    expect(TEMPLATES.faceless.questions[1]).toBe(TEMPLATES.clipping.questions[1]);
    expect(TEMPLATES.faceless.questions[2]).toBe(TEMPLATES.clipping.questions[2]);
    expect(TEMPLATES.faceless.questions[2]).toMatchObject({ type: "choice", options: ["daily", "3× a week", "weekly"] });
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

/**
 * The money, as the README prints it.
 *
 * Every figure in the README's crew tables and its day-one total is a dollar rendering of a
 * `budget_micro_usd` in `templates/`, and every one of them was left behind when the budgets were
 * raised — understating what the operator is signing up for by 5–12x on every line. A README that
 * quotes a number the code does not hold is the one kind of documentation bug a reader cannot
 * detect, so the numbers are read out of the declarations here rather than kept in step by hand.
 */
describe("the spend this blueprint declares", () => {
  const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const usd = (micro: number) => micro / 1_000_000;
  const dollars = (cell: string) => [...cell.matchAll(/\$([\d.]+)/g)].map((m) => Number(m[1]));
  const intakes = (template: MediaTemplate) =>
    template.agents.reduce((sum, one) => sum + (one.intake?.budget_micro_usd ?? 0), 0);

  it("prints each seat's timers and day one at the budgets those fires actually carry", () => {
    let current: MediaTemplate | undefined;
    let rows = 0;
    for (const line of README.split("\n")) {
      const heading = /^#{2,3} +`?(faceless|clipping)`?$/.exec(line.trim());
      if (line.startsWith("#")) current = heading ? TEMPLATES[heading[1] as TemplateName] : undefined;
      const cells = line.split("|");
      const named = /^`([\w-]+)`/.exec(cells[1]?.trim() ?? "");
      if (current === undefined || cells.length < 8 || named === null) continue;
      const agent = current.agents.find((one) => one.name === named[1]);
      if (agent === undefined) continue;
      rows += 1;
      expect([current.name, agent.name, dollars(cells[5]!)]).toEqual([
        current.name,
        agent.name,
        (agent.schedules ?? []).map((one) => usd(one.budget_micro_usd)),
      ]);
      expect([current.name, agent.name, dollars(cells[6]!)]).toEqual([
        current.name,
        agent.name,
        [usd(agent.intake?.budget_micro_usd ?? 0)],
      ]);
    }
    // Five seats per template, both tables read.
    expect(rows).toBe(10);
  });

  it("prints a day-one total that is the sum of the day-one budgets", () => {
    const said = /\(\$([\d.]+) on `faceless`, \$([\d.]+) on `clipping`\)/.exec(README);
    expect(said).not.toBeNull();
    expect([Number(said![1]), Number(said![2])]).toEqual([usd(intakes(TEMPLATES.faceless)), usd(intakes(TEMPLATES.clipping))]);
  });

  /**
   * The comment above `budget` is the argument for the number, so a stale one argues for a
   * ceiling that is not there — it justified $6/task and $20/day while the knob it sits on says
   * $20 and $60.
   */
  it("argues for the ceilings it declares, in the comment that justifies them", () => {
    const source = readFileSync(new URL("./template.ts", import.meta.url), "utf8");
    const { budget } = TEMPLATES.faceless.agents[0]!;
    const printed = [...source.matchAll(/\$([\d.]+)\/(task|day)/g)];
    expect(printed.length).toBeGreaterThan(1);
    for (const [, amount, unit] of printed) {
      expect([unit, Number(amount)]).toEqual([unit, usd(unit === "task" ? budget.max_task_micro_usd : budget.cap_micro_usd)]);
    }
  });
});
