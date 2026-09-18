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
import { BUILTIN_TOOLS, CARD_ORDER, CONTEXT_PREAMBLE, ONE_RENDER_MICRO_USD, PLATFORM_CHOICES, RENDERER, words } from "./template.ts";
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
   * Day one, as cards (`canonical-spec §31.11`). Every seat owes exactly the set-up its intake used
   * to carry, written to consume the setup answers rather than restate a hard-coded niche — and
   * §31.11's own rule that a template seeding `tasks` declares no intakes is the first assertion,
   * because an intake left beside a card is the race back with a card on top of it.
   */
  it("seeds every seat's day one as a card on the board, and declares no intake beside it", () => {
    for (const template of both) {
      for (const agent of template.agents) expect(agent.intake, agent.name).toBeUndefined();
      const seats = new Set(agentNames(template));
      const keys = template.tasks.map((task) => task.key);
      expect(new Set(keys).size, template.name).toBe(keys.length);
      // Every card names a seat this template actually declares — `up` refuses one that does not,
      // and a card assigned to nobody live is never due and never woken (§28.18).
      for (const task of template.tasks) {
        expect([task.key, seats.has(task.assignee!)], task.key).toEqual([task.key, true]);
        expect(task.body, task.key).toMatch(/project_context/);
        // `media:<key>` is the card key on the wire, and 128 characters is what one holds.
        expect(`media:${task.key}`.length).toBeLessThanOrEqual(128);
        for (const blocker of task.blocked_by ?? []) expect(keys, task.key).toContain(blocker);
      }
      // Every seat owes at least one; a seat with no card is a seat the install never starts.
      expect(new Set(template.tasks.map((task) => task.assignee)), template.name).toEqual(seats);
      expect(template.tasks.find((t) => t.key === "channel-plan")?.body).toMatch(/cadence/);
      expect(template.tasks.find((t) => t.key === "report-frame")?.body).toMatch(/report/i);
    }
    expect(TEMPLATES.faceless.tasks.find((t) => t.key === "first-briefs")?.body).toMatch(/five briefs/);
    expect(TEMPLATES.faceless.tasks.find((t) => t.key === "hook-style")?.body).toMatch(/hook style/i);
    expect(TEMPLATES.clipping.tasks.find((t) => t.key === "first-moments")?.body).toMatch(/reference channel\(s\).*first five moments/s);
  });

  /**
   * *** THE TWO TOOLS WITHOUT WHICH NONE OF THIS WORKS, AND THEY WERE DENIED BY NAME. ***
   *
   * The tick's wake message carries the card's TITLE and a pointer — *"Read it with
   * board_read({card_id}) — its notes and comments are the brief"* — so the body every card above
   * is written into is reachable only through `board_read`, and the card reaches `done`, which is
   * what releases everything blocked on it, only through `board_write`. §28.11 publishes both to
   * every session seated on a board, but that is construction: the harness filters the injected
   * modules through this toolset, and `toolset()` writes every built-in it is not handed as
   * `{enabled:false, permission:"deny"}` by name. Unlisted, the crew would have been woken onto
   * cards it could not read and could not close — one wave, then silence.
   */
  it("grants every seat the two board tools a seeded card cannot be worked without", () => {
    for (const template of both) {
      for (const agent of template.agents) {
        for (const tool of ["board_read", "board_write", "find_files"]) {
          expect(agent.tools?.configs[tool], `${template.name}/${agent.name}/${tool}`).toEqual({ enabled: true, permission: "allow" });
        }
      }
    }
  });

  /**
   * THE CHAIN, AND THE WAVE IT BUYS. A card with an open `blocked_by` is not due, so its seat is
   * neither woken nor billed until the card it waits on is `done`. Both boards are the same shape:
   * four cards that depend on nothing open the install together, then two, then one.
   *
   * The count is asserted because it is the money. Each wake is one ordinary session on the seat's
   * own `max_task_micro_usd`, so the first wave is what a fresh install spends in its first minute,
   * and a blocker quietly dropped here is that bill going up without anybody deciding it should.
   */
  it("orders each board as a real chain: four cards open, three wait", () => {
    const chains: Record<TemplateName, Record<string, string[]>> = {
      faceless: {
        "channel-plan": [],
        "first-briefs": [],
        look: [],
        "hook-style": [],
        "report-frame": ["channel-plan"],
        "first-scripts": ["first-briefs", "hook-style", "look"],
        "first-render": ["first-scripts"],
      },
      clipping: {
        "channel-plan": [],
        "first-moments": [],
        "source-check": [],
        "caption-style": [],
        "report-frame": ["channel-plan"],
        "first-cuts": ["first-moments", "source-check"],
        "first-captions": ["first-cuts", "caption-style"],
      },
    };
    for (const template of both) {
      const chain = chains[template.name];
      expect(Object.fromEntries(template.tasks.map((task) => [task.key, task.blocked_by ?? []])), template.name).toEqual(chain);
      expect(template.tasks.filter((task) => (task.blocked_by ?? []).length === 0), template.name).toHaveLength(4);
      // Declaration order is dependency order: `up` writes cards one after another and a `blocked_by`
      // carries the `crd_` an EARLIER create answered, so a blocker declared after the card it
      // blocks is refused at apply time ("was not seeded in this run").
      const seen = new Set<string>();
      for (const task of template.tasks) {
        for (const blocker of task.blocked_by ?? []) expect(seen, `${template.name}/${task.key}`).toContain(blocker);
        seen.add(task.key);
      }
    }
    // The one card that spends real money is last on `faceless`, behind the whole chain.
    expect(TEMPLATES.faceless.tasks.at(-1)?.key).toBe("first-render");
    expect(TEMPLATES.faceless.tasks.find((t) => t.key === "first-render")?.body).toMatch(/one generate_video call/);
    // And no card tells a seat to hand off: the board wakes the next one, so a `send_to_agent` here
    // would open a second session on work the tick is already about to start.
    for (const template of both) {
      for (const task of template.tasks) expect(task.body, task.key).not.toMatch(/send_to_agent the/);
    }
  });

  /**
   * The STANDING chain, which is the crons' and not day one's. Day one is the board above — a card
   * that waits on another is not due and its seat is not woken — but every fire after it still
   * hands on by name (`send_to_agent` with `wait: false`, canonical-spec §28.15): each seat may name
   * exactly the next one, the producer is the end, and the timers reconcile by `stage` for whatever
   * a handoff did not carry.
   */
  it("orders the faceless pipeline as a chain of handoffs: scout → scriptwriter → producer, and nobody else", () => {
    // `false`, never omitted: the platform's default is anyone in the organization (§28.12).
    const chain: Record<string, string[] | false> = {
      "trend-scout": ["scriptwriter"],
      scriptwriter: ["producer"],
      producer: false,
      analyst: false,
      "channel-manager": false,
    };
    for (const agent of TEMPLATES.faceless.agents) {
      expect(agent.handoffs, agent.name).toEqual(chain[agent.name]);
      // The grant the engine compiles from `handoffs` (§31.7), so the declaration reads whole.
      for (const tool of ["send_to_agent", "list_agents"]) {
        expect(agent.tools?.configs[tool], `${agent.name}/${tool}`).toEqual(
          chain[agent.name] === false ? { enabled: false, permission: "deny" } : { enabled: true, permission: "allow" },
        );
      }
    }
    const seat = (name: string) => TEMPLATES.faceless.agents.find((a) => a.name === name);
    // The head files first, then hands on — the ids, a stable key — and hands on nothing it did not file.
    expect(seat("trend-scout")?.system).toMatch(/only then.*send_to_agent the scriptwriter once, wait false.*Filed nothing, hand on nothing/s);
    // The writer claims the brief row (`expected_stage`) before it plans, and its plan is a video
    // project on that row; the producer claims the plan (`expected_status`) before it renders. So a
    // handoff and the cron that overlaps it cannot both plan or render the same piece, and each
    // hands on only what it claimed.
    expect(seat("scriptwriter")?.system).toMatch(/named by id in a handoff.*Claim each before you write it.*stage scripting, expected_stage brief.*channel\.create_project, kind generation, post_id the row.*`stage` scripted.*send_to_agent the producer once, wait false.*project ids.*claimed nothing, hand on nothing/s);
    expect(seat("producer")?.system).toMatch(/named to you by the operator or a handoff.*claim it before you spend anything.*status rendering and expected_status planned.*status rendered, expected_status rendering.*You end the chain/s);
    // Nothing on the platform joins clips, so a multi-scene plan is one render, not one per scene.
    expect(seat("producer")?.system).toContain("one generate_video call — nothing here joins clips");
    // The timers are the fallback, by stage and status, and they claim the same way.
    expect(seat("scriptwriter")?.schedules?.[0]?.input).toMatch(/stage brief.*stage scripting, expected_stage brief.*channel\.create_project \(kind generation, post_id the row\).*send_to_agent the producer once, wait false.*project ids/s);
    expect(seat("producer")?.schedules?.[0]?.input).toMatch(/status planned, kind generation.*status rendering, expected_status planned.*status rendered, expected_status rendering/s);
    /**
     * AND THE RENDER IS GUARDED AT BOTH ENDS, in the only seat that spends on one.
     *
     * A claim on the way in and nothing on the way out is half a guard: the producer's completion
     * write landed whatever had happened to the plan while it rendered, so a stale session could
     * overwrite the render that replaced it, and neither the producer nor the manager was told that
     * a rendered plan is one the channel has already paid ~$3.32 for. Both are said in the brief
     * and on the timer, because the tool refusing it (`server/mcp.ts`) tells a seat only after it
     * has spent the money.
     */
    for (const prompt of [seat("producer")?.system, seat("producer")?.schedules?.[0]?.input]) {
      expect(prompt).toMatch(/`?expected_status`? rendering.*(no longer yours|moved on).*(twice|second time)/s);
    }
    // The sentence about the receipt itself is on the timer, not in the brief: the producer's
    // `system` is at the 400-word ceiling to the word, and the tool refuses the claim — before the
    // render, not after — with the same sentence on it (`update_project`, `server/mcp.ts`).
    expect(seat("producer")?.schedules?.[0]?.input).toMatch(/rendered plan.*paid.*never render it again/s);
    // A claim a dead session left behind is aged out by the manager's sweep, not by the seat that
    // finds it — and the sweep frees a claim, never a render: a row with media goes forward, not
    // back, and a rendered plan is final.
    expect(seat("channel-manager")?.schedules?.find((s) => s.cron === "0 8 * * *")?.input).toMatch(/scripting or rendering.*more than a day old.*scripting to brief, rendering to scripted.*expected_stage.*Never send back a row that already carries a media_url.*forward to rendered.*channel\.list_projects.*rendering whose statusAt is more than a day old.*back to planned.*expected_status rendering.*rendered one is final/s);
    // And no card is told another seat is running beside it: the board says what waits on what.
    for (const task of TEMPLATES.faceless.tasks) expect(task.body, task.key).not.toMatch(/alongside yours|running alongside/);
  });

  /**
   * THE ROWS THE UPGRADE WOULD HAVE STRANDED, and the one fire that goes back for them.
   *
   * Before the plan existed, the scriptwriter wrote the script into the row's caption and moved the
   * row to `scripted`, and the producer's 07:00 fire read exactly that (`channel.list_posts with
   * stage scripted`). It reads plans now (`channel.list_projects`, status planned, kind generation),
   * so on any channel upgraded past that commit the rows the old chain had already scripted match
   * nobody's list: the writer's fire looks for `brief`, the producer's for a plan that was never
   * written. They are not lost, they are worse — they sit on the production strip looking like work
   * in flight, forever, and the manager's 08:00 sweep keeps feeding more in, because freeing a dead
   * `rendering` claim puts a row back at `scripted`.
   *
   * So the 06:30 fire goes back for them, and it is the only place that can: it is the seat that
   * writes plans. `list_posts` filters on status and stage and nothing else (`server/mcp.ts`), so
   * "no plan" cannot be a filter — it is `projectId`, absent on the rows the stage filter returns,
   * and absent on exactly the rows whose plan was never written (`create_project` sets it on every
   * row it plans, and refuses a second plan on a row that has one). The claim discriminates for the
   * same reason the `brief` one does: `scripting` with `expected_stage scripted` is a transition, so
   * of two sessions that both saw `scripted` only the first lands. `scripting` itself is left out —
   * a row there may be a live claim that `expected_stage scripting` could not tell from a dead one,
   * and the manager's sweep already ages a dead one back to `brief`.
   */
  it("sends the scriptwriter's 06:30 fire back for rows the old chain left at scripted with no plan", () => {
    const fire = TEMPLATES.faceless.agents.find((a) => a.name === "scriptwriter")?.schedules?.[0];
    expect(fire?.cron).toBe("30 6 * * *");
    // Read `scripted`, keep only the ones with no `projectId`, claim off `scripted` — not off `brief`.
    expect(fire?.input).toMatch(/channel\.list_posts, stage scripted.*no projectId.*channel\.update_post, stage scripting, expected_stage scripted/s);
    // And plan from what the row already carries: the old chain's script is its caption.
    expect(fire?.input).toMatch(/plan it from the caption already on the row/);
    // The rescue is the second pass, after the briefs — the fire that drops its own brief list to
    // chase orphans is a fire that stops planning the day's work.
    expect(fire?.input.indexOf("stage scripting, expected_stage brief")).toBeLessThan(fire?.input.indexOf("stage scripting, expected_stage scripted") ?? -1);
    // A rescued row lands back where it was, with the plan on it this time — so the producer's
    // 07:00 fire, which reads plans, finally sees it.
    expect(fire?.input).toMatch(/puts the row back at stage scripted with the plan on it/);
    expect(TEMPLATES.faceless.agents.find((a) => a.name === "producer")?.schedules?.[0]?.input).toContain("channel.list_projects, status planned, kind generation");
  });

  /**
   * #6 — day one produced nothing, because the five intakes raced each other.
   *
   * MEASURED IN PRODUCTION, 2026-09-09: the scriptwriter's day-one session read
   * `channel.list_posts -> "[]"` and filed *"the trend-scout hasn't filed any briefs yet in its
   * parallel session"* as its finding — while the trend-scout was filing five briefs in the same
   * minute. `up` opened every intake at once (`packages/blueprints/src/up.ts`: one `eachInFlight`
   * over the crew, after every write) and `intake` had no ordering knob.
   *
   * `blocked_by` is the fix; `CARD_ORDER` is the half a blocker cannot enforce. A card left `todo`
   * or `doing` when its session ends is parked `blocked` by the tick (§28.18) and everything behind
   * it waits forever — so every body says, in one place and in the same words, that FINISHING the
   * card with a note is what releases the next seat. Appended by the same helper that builds the
   * card, not left to whoever writes the next one.
   */
  it("tells every card, in one place, that closing it is what wakes the next seat", () => {
    for (const template of both) {
      for (const task of template.tasks) expect(task.body, task.key).toContain(CARD_ORDER);
    }
    // Read the card first: the wake message carries the title and a pointer, and nothing else.
    expect(CARD_ORDER).toMatch(/board_read/);
    // Close it with a note — `done` with nothing written is refused `missing_note` (§28.11).
    expect(CARD_ORDER).toMatch(/done, with a note/);
    // An unblocked card is waiting on nothing, so "wait" is never the answer and an empty queue is
    // not a finding — the sentence #6 cost, kept.
    expect(CARD_ORDER).toMatch(/not a finding/i);
    // And it names where the standing work happens, so no card reads as the whole job.
    expect(CARD_ORDER).toMatch(/timers/i);
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

  /**
   * The plan is a row of its own (`seed/projects.ts`): the seat that plans a video never spends
   * on it, and the seat that spends reads the plan rather than writing one. Every seat may read
   * and write plans through the dashboard tools — the manager sweeps them, the caption-editor
   * reads the why — but the render and the cut are still the two seats' alone.
   */
  it("plans a video before anyone renders it: planners write projects, executors claim and finish them", () => {
    const PROJECT_TOOLS = ["channel.list_projects", "channel.get_project", "channel.create_project", "channel.update_project"];
    for (const template of both) {
      for (const agent of template.agents) {
        for (const tool of PROJECT_TOOLS) expect(agent.tools?.configs[tool], `${agent.name}/${tool}`).toEqual({ enabled: true, permission: "allow" });
      }
    }
    const seat = (template: MediaTemplate, name: string) => template.agents.find((a) => a.name === name);
    // Faceless: the scriptwriter writes a generation plan on the brief; the producer renders it.
    expect(seat(TEMPLATES.faceless, "scriptwriter")?.system).toMatch(/channel\.create_project, kind generation.*scenes in order.*seconds.*voiceover.*on-screen text/s);
    expect(seat(TEMPLATES.faceless, "scriptwriter")?.system).toMatch(/neither render nor find topics/);
    expect(seat(TEMPLATES.faceless, "producer")?.system).toMatch(/channel\.get_project.*generate_video.*Do not rewrite it/s);
    // Clipping: the scout writes a clipping plan — URL, timestamps, why; the clipper cuts it.
    expect(seat(TEMPLATES.clipping, "scout")?.system).toMatch(/channel\.create_project, kind clipping.*URL.*starts and ends.*why this moment/s);
    expect(seat(TEMPLATES.clipping, "scout")?.system).toMatch(/neither cut nor caption/);
    expect(seat(TEMPLATES.clipping, "clipper")?.system).toMatch(/status rendering, expected_status planned.*channel\.get_project.*clip_video.*status rendered, expected_status rendering/s);
    expect(seat(TEMPLATES.clipping, "clipper")?.schedules?.[0]?.input).toMatch(/status planned, kind clipping.*expected_status planned.*status rendered, expected_status rendering/s);
    // clip_video takes a URL and picks the clips itself; the plan's timestamps choose among what comes back.
    expect(seat(TEMPLATES.clipping, "clipper")?.system).toMatch(/clip_video takes the whole source URL, no timestamps.*pick by title \(you cannot open a file\) the clip that is the plan's moment.*that file id as `media_url`/s);
    // The one who rewrites the caption reads the plan's reasoning, and the gate names both rows.
    expect(seat(TEMPLATES.clipping, "caption-editor")?.system).toMatch(/channel\.get_project on the row's projectId/);
    for (const template of both) for (const agent of template.agents) expect(agent.system).toMatch(/a video project is the plan a video is made from/);
  });

  it("names, per kind of plan, the seat the dashboard's Render button opens a session with — and each crew has it", () => {
    // `POST /api/projects/:id/render` looks the renderer up by this name in the live roster, so a
    // rename here without one in the template would send every press to nobody.
    expect(TEMPLATES.faceless.agents.map((a) => a.name)).toContain(RENDERER.generation);
    expect(TEMPLATES.clipping.agents.map((a) => a.name)).toContain(RENDERER.clipping);
    const producer = TEMPLATES.faceless.agents.find((a) => a.name === RENDERER.generation);
    const clipper = TEMPLATES.clipping.agents.find((a) => a.name === RENDERER.clipping);
    // Both are briefed to take a plan named to them, which is what the button's message does.
    expect(producer?.system).toMatch(/one named to you/);
    expect(clipper?.system).toMatch(/named to you/);
  });

  /**
   * The Studio's revision (`POST /api/studio/:id/revise`, `server/routes.ts`) is a message on the
   * session that made the video, so each renderer is told what one is: the same plan, re-read, and
   * the same finishing write — never a second project, which would be a second render nobody asked
   * for. Opening a rendered plan again is the operator's alone; the manager is told so, in the one
   * brief the operator's Chat reaches, so it never asks a seat to do it.
   */
  it("briefs each renderer for the operator's revision on the same plan, and tells the manager the revision is not its move", () => {
    const REVISION = /A revision arrives as a message on your session: re-read the plan with channel\.get_project, apply the operator's note, finish with the same update_project write, changed (scenes|sources) on it\. Never open a second project\./;
    for (const [template, seat] of [[TEMPLATES.faceless, RENDERER.generation], [TEMPLATES.clipping, RENDERER.clipping]] as const) {
      const renderer = template.agents.find((a) => a.name === seat);
      expect(renderer?.system, seat).toMatch(REVISION);
      // The revision is finished by the same guarded write, not a new one, and still never published.
      expect(renderer?.system).toMatch(/status rendered, expected_status rendering.*A revision arrives.*never publish it yourself/s);
      // Nobody else is briefed for it: a revision reaches the seat that rendered, not the crew.
      for (const agent of template.agents) if (agent.name !== seat) expect(agent.system, agent.name).not.toContain("A revision arrives");
    }
    for (const template of both) {
      expect(template.agents.find((a) => a.name === "channel-manager")?.system).toMatch(/revising a rendered one is the operator's move, never yours/);
    }
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
        for (const spends of ["generate_speech", "transcribe_audio", "find_stock_photo"]) {
          expect(permissionFor(template, agent.name, spends)).toBe("deny");
        }
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
    // The day-one card is the other side of the same coin: a seat that already holds the tool
    // must not raise a request_tools card for it "in case" a later render card needs it.
    const styleCard = TEMPLATES.faceless.tasks.find((task) => task.assignee === "producer");
    expect(styleCard?.body).toMatch(/tools you were offered this turn — that list is complete.*If it is there.*do not call request_tools.*never request a tool you already hold.*never request one for a card you are not on.*Only if it is missing.*request_tools, once/s);
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
  /**
   * What a fresh install can spend before anybody has touched it. A card carries no budget of its
   * own — the tick starts an ordinary session on the assignee's agent (§28.18) — so day one is
   * bounded by the seat's own per-task ceiling, once per card, and NOT by the smaller one-off
   * numbers the intakes used to name.
   */
  const dayOne = (template: MediaTemplate) =>
    template.tasks.reduce((sum, task) => sum + (template.agents.find((one) => one.name === task.assignee)?.budget.max_task_micro_usd ?? 0), 0);

  it("prints each seat's timers and the cards it owes, as the declarations actually hold them", () => {
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
      // The "Day one" cell names this seat's card keys, in declaration order — the one place the
      // README and the board can disagree, and a card renamed without the table is a reader sent
      // looking for a card that is not there.
      expect([current.name, agent.name, [...cells[6]!.matchAll(/`([\w-]+)`/g)].map((m) => m[1])]).toEqual([
        current.name,
        agent.name,
        current.tasks.filter((task) => task.assignee === agent.name).map((task) => task.key),
      ]);
    }
    // Five seats per template, both tables read.
    expect(rows).toBe(10);
  });

  it("prints a day-one ceiling that is one per-task ceiling per card", () => {
    const said = /\(\$([\d.]+) on `faceless`, \$([\d.]+) on `clipping`\)/.exec(README);
    expect(said).not.toBeNull();
    expect([Number(said![1]), Number(said![2])]).toEqual([usd(dayOne(TEMPLATES.faceless)), usd(dayOne(TEMPLATES.clipping))]);
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
