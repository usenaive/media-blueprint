/** The blueprint as `naive up` would read it: it parses, it names its template, and it declares no app. */
import { BLUEPRINTS } from "@usenaive-sdk/blueprints";
import { describe, expect, it } from "vitest";
import project, { declaration } from "./naive.config";
import { ACTIVE, CHANNEL_IDENTITY, CHANNEL_TIMEZONE, TEMPLATES } from "./templates/index.ts";
import { MEDIA_MANAGER } from "./templates/media-manager.ts";

describe("naive.config", () => {
  it("declares the machine it runs and the template that crews it", () => {
    // The pair `naive up` keys off: one repo per blueprint carrying every template it has, so
    // switching is an edit of `templates/index.ts` plus `naive up` — never a re-clone, never a
    // new app.
    expect(declaration.blueprint).toBe("media");
    expect(declaration.template).toBe(ACTIVE.name);
    expect(project.template).toBe(ACTIVE.name);
    expect(TEMPLATES[ACTIVE.name]).toBe(ACTIVE);
    // Every template the blueprint has, carried by this one repo: the engine refuses a repo that
    // carries only some, because switching to a missing one would be a re-clone.
    // What the repo hands `up` is what this repo carries AND the installed engine admits — the
    // engine refuses any other list. Read off `BLUEPRINTS` rather than written out, so the day
    // `longform` lands in that const the declaration widens on its own.
    const admits = BLUEPRINTS.media?.templates ?? [];
    expect(admits.length).toBeGreaterThan(0);
    expect(declaration.templates.map((one) => one.name).sort()).toEqual([...admits].sort());
    // The gap is one-directional and this is the side that must never open: a template the engine
    // knows and this repo does not carry is a `naive up` that cannot provision it at all.
    for (const name of admits) expect(Object.keys(TEMPLATES)).toContain(name);
  });

  /**
   * canonical-spec §31.5 (ADR-0921): the studio names the template in words and draws the networks
   * it is made for. Read off `declaration`: the pinned engine 0.8.0 strips what it does not know, and
   * the platform's artifact publisher builds with the engine that does.
   */
  it("names the running template for the studio, with the networks it is made for", () => {
    expect(declaration.title).toBe(ACTIVE.title);
    expect(declaration.description).toBe(ACTIVE.description);
    expect(declaration.platforms).toEqual(["youtube", "tiktok", "instagram"]);
    expect(Object.values(TEMPLATES).map((one) => one.title).sort()).toEqual(["Clipping channel", "Faceless channel", "Long-form channel"]);
    for (const one of Object.values(TEMPLATES)) {
      expect(one.title.length, one.name).toBeLessThanOrEqual(80);
      expect(one.description.length, one.name).toBeLessThanOrEqual(280);
    }
  });

  /**
   * canonical-spec §50: the channel's pages are one mini app the platform draws (ADR-0988, ADR-1023).
   * Read off `declaration`, like the label above: the pinned engine 0.8.0 strips `mini_apps`; the
   * platform checks it against its catalog when it is read.
   */
  it("declares one mini app, Media manager: one page and no panel", () => {
    const [manager, ...rest] = declaration.mini_apps;
    expect(rest).toEqual([]);
    expect([manager!.slug, manager!.name, manager!.icon]).toEqual(["media-manager", "Media manager", "play"]);
    // One page: the platform draws no tabs for it. No panel: the platform has none (ADR-1022).
    expect(manager!.pages.map((one) => one.slug)).toEqual(["overview"]);
    expect(manager).not.toHaveProperty("panels");
    // Words only: a digit in a title would be refused, since the platform writes every number.
    const words = manager!.pages.flatMap((one) => [one.title, ...Object.values(one.spec.elements).map((element) => String(element.props["title"] ?? element.props["label"] ?? ""))]);
    expect(words.join(" ")).not.toMatch(/[0-9]/);
  });

  /**
   * ADR-1023: the numbers first, then posts in the order a person acts on them, each its own section —
   * what waits on them (rows, only while something does), what goes out next (a sideways row of
   * cards, only while something is), what went out (a picture grid, always, with its views).
   */
  it("lays the page out as three numbers, then Waiting on you, Scheduled as a row and Posted as a grid", () => {
    const { elements } = MEDIA_MANAGER.pages[0]!.spec;
    const top = elements["page"]!.children!.map((key) => elements[key]!);
    expect(top.map((one) => one.type)).toEqual(["Grid", "Section", "Section", "Section"]);
    expect(top[0]!.children!.map((key) => elements[key]!.type)).toEqual(["Metric", "Progress", "Metric"]);
    const sections = top.slice(1).map((section) => {
      const [only, ...more] = section.children!.map((key) => elements[key]!);
      expect(more).toEqual([]);
      expect(only!.type).toBe("Posts");
      const { status } = only!.props["posts"] as { status: string };
      return [section.props["title"], section.props["hide_empty"] ?? false, status, only!.props["layout"] ?? "list"];
    });
    expect(sections).toEqual([
      ["Waiting on you", true, "waiting", "list"],
      ["Scheduled", true, "scheduled", "row"],
      ["Posted", false, "posted", "grid"],
    ]);
    const types = Object.values(elements).map((element) => element.type);
    for (const gone of ["BarList", "Accounts", "Answers", "Media", "MediaLibrary"]) expect(types).not.toContain(gone);
  });

  /** Each page is a tree the platform accepts: every child exists, has one parent, and hangs off the root. */
  it("lays each page out as one tree under its Page, of the platform's blocks only", () => {
    const BLOCKS = new Set(["Page", "Section", "Stack", "Grid", "Metric", "LineChart", "BarList", "Progress", "Roadmap", "Schedule", "Media", "Text", "Needs", "Activity", "Accounts", "Posts", "Answers", "MediaLibrary"]);
    for (const one of MEDIA_MANAGER.pages) {
      const { root, elements } = one.spec;
      expect(elements[root]!.type, one.slug).toBe("Page");
      const reached = new Set([root]);
      for (const key of reached) for (const child of elements[key]!.children ?? []) {
        expect(elements, `${one.slug}: ${child}`).toHaveProperty(child);
        expect(reached.has(child), `${one.slug}: ${child} twice`).toBe(false);
        reached.add(child);
      }
      expect([...reached].sort(), one.slug).toEqual(Object.keys(elements).sort());
      for (const element of Object.values(elements)) expect(BLOCKS.has(element.type), element.type).toBe(true);
    }
  });

  /** The old dashboard's Posts and Analytics, read by the platform's own sources (the legacy table is ADR-0993). */
  it("covers what the old dashboard showed: each post by what it waits on, views, posts against the cadence and spend", () => {
    const sources = JSON.stringify(MEDIA_MANAGER.pages.map((one) => one.spec));
    for (const source of ["posts", "posts_this_week", "views_total", "views_change", "spend_total"]) {
      expect(sources).toContain(`"$source":"${source}"`);
    }
  });

  it("declares no app: the crew runs on the platform's own board, media gallery and approval card", () => {
    expect(project.apps).toEqual([]);
    expect(declaration).not.toHaveProperty("apps");
    expect(project.agents.map((agent) => agent.name)).toEqual(ACTIVE.agents.map((agent) => agent.name));
  });

  /**
   * The crons, as the engine actually accepted them.
   *
   * `defineProject` parses the declaration through the published schema and STRIPS anything that
   * schema does not know, so reading `timezone` and `identity` back off `project` — not off the
   * template objects — is the check that the installed `@usenaive-sdk/blueprints` really carries
   * both fields. If a future release drops one, this test goes red here rather than at 07:00 in
   * somebody's org, where the fire would quietly run in UTC or as nobody.
   */
  it("hands `up` the running crew's crons, each with the timezone and the persona it fires as", () => {
    for (const agent of project.agents) {
      for (const one of agent.schedules ?? []) {
        expect(one.timezone).toBe(CHANNEL_TIMEZONE);
        expect(one.identity).toBe(CHANNEL_IDENTITY);
        // `up` refuses a schedule naming an identity this project never declares.
        expect(declaration.identities.map((identity) => identity.name)).toContain(one.identity);
      }
    }
    // Three fires: the head of the chain once, the analyst twice. Every other seat is woken by the
    // board, and its EMPTY set survives the parse — `[]` is what deletes an older version's crons.
    expect(project.agents.flatMap((agent) => agent.schedules ?? [])).toHaveLength(3);
    expect(project.agents.filter((agent) => agent.schedules?.length === 0).map((agent) => agent.name)).toEqual(
      ACTIVE.agents.filter((agent) => agent.schedules?.length === 0).map((agent) => agent.name),
    );
  });

  /**
   * Plan §2.4/§4: the engine carries `role`, `skills`, `required`, the setup questions and —
   * since `^0.6.0` — `tasks` through `defineProject`. Read back off `project`, not the template, so
   * a downgrade of `@usenaive-sdk/blueprints` goes red here rather than as a crew with no roles.
   *
   * *** `tasks` IS THE ONE THAT NEEDED THE PIN MOVED, AND THE ONE THAT FAILS SILENTLY. ***
   * `parseProject` strips what its schema does not know, and 0.5.0's schema does not know `tasks` —
   * so under the old pin this line reads `[]`, `up` seeds no board and no cards, and nothing refuses
   * anywhere. That is what `media@1.2.0` published and what an operator got: five agents and an
   * empty dashboard. Reading the count off `project` is the assertion that the installed engine
   * really carries the field.
   */
  it("hands `up` the crew's roles, skills, cards and the running template's setup questions", () => {
    expect(project.questions.map((q) => q.key)).toEqual(ACTIVE.questions.map((q) => q.key));
    // Two required — no question asks where the channel posts — plus the optional one (ADR-0757).
    expect(project.questions.length).toBe(ACTIVE.questions.length);
    expect(project.questions.filter((q) => q.optional !== true)).toHaveLength(2);
    for (const agent of project.agents) {
      expect(agent.role).toMatch(/\S/);
      // §31.11: a template that seeds `tasks` declares no intakes. The cards are the first work now.
      expect(agent.intake, agent.name).toBeUndefined();
      expect(agent.skills?.every((skill) => skill.startsWith("naive/"))).toBe(true);
    }
    expect(project.tasks).toEqual(ACTIVE.tasks);
    expect(project.tasks).toHaveLength(ACTIVE.tasks.length);
    expect(project.agents.find((agent) => agent.name === "channel-manager")?.required).toBe(true);
    // The chain survives `defineProject` (engine 0.5.0 validates it), so `up` compiles the grants.
    expect(project.agents.map((agent) => [agent.name, agent.handoffs])).toEqual(
      ACTIVE.agents.map((agent) => [agent.name, agent.handoffs]),
    );
  });

  it("declares the persona its agents act as, so a connected account is reachable from a turn", () => {
    // Connection tools resolve `session → agent → identity → connected accounts`. This blueprint
    // declared no identity and attached none, so every agent was offered zero tools from every
    // account the org had connected — while the dashboard sells connected accounts as the point.
    expect(declaration.identities.map((one) => one.name)).toEqual([CHANNEL_IDENTITY]);
    for (const agent of project.agents) expect(agent.identity).toBe(CHANNEL_IDENTITY);
  });

  /**
   * The switch rule: WIDEN, NEVER NARROW. Only `removed` deletes anything, so leaving it out is
   * what keeps an agent the other template declared alive — `up` reports it and writes nothing —
   * along with every row that is the operator's: the posts, the accounts, the app and its MCP
   * token. Listing the other crew here would make switching template a destructive act.
   */
  it("keeps the other templates' crews instead of tombstoning it", () => {
    expect("removed" in declaration).toBe(false);
    expect(project.removed).toEqual({ apps: [], agents: [], skills: [], identities: [], vaults: [] });
    // EVERY sibling that was declared, not one of them. With more than two templates a rule
    // checked against a single other crew passes while a third is quietly tombstoned. It reads
    // `declaration.templates`, not `TEMPLATES`, because `kept` can only name a crew `up` was
    // handed — a template the installed engine does not admit is absent from both.
    const others = declaration.templates.filter((one) => one.name !== ACTIVE.name);
    expect(others.length).toBeGreaterThan(0);
    const onlyTheirs = [...new Set(others.flatMap((one) => one.agents.map((agent) => agent.name)))]
      .filter((name) => !ACTIVE.agents.some((mine) => mine.name === name));
    expect(onlyTheirs.length).toBeGreaterThan(0);
    for (const name of onlyTheirs) {
      expect(project.removed.agents).not.toContain(name);
      // `kept` is the mirror of `removed`: `up` reports the live one and writes nothing.
      expect(project.kept.agents).toContain(name);
    }
    // The shared agent is the running crew's, not a kept name.
    expect(project.kept.agents).not.toContain("channel-manager");
  });

  /** Read off the parsed project, so an engine that dropped a permission would go red here. */
  it("publishes through one seat, only with the operator's yes, and denies it to every other", () => {
    for (const agent of project.agents) {
      expect(agent.tools?.default_config.permission, agent.name).toBe("deny");
      expect(agent.tools?.configs["social.post"], agent.name).toEqual(
        agent.name === "channel-manager" ? { enabled: true, permission: "ask" } : { enabled: false, permission: "deny" },
      );
    }
  });

  it("allows the metrics read on the analyst alone", () => {
    for (const agent of project.agents) {
      expect(agent.tools?.configs["social.post_metrics"], agent.name).toEqual(
        agent.name === "analyst" ? { enabled: true, permission: "allow" } : { enabled: false, permission: "deny" },
      );
    }
  });
});
