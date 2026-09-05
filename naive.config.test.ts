/** The blueprint as `naive up` would read it: it parses, it names its template, and every agent carries the approval gate. */
import { describe, expect, it } from "vitest";
import project, { declaration } from "./naive.config";
import { ACTIVE, CHANNEL_IDENTITY, TEMPLATES } from "./templates/index.ts";

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
    expect(declaration.templates.map((one) => one.name).sort()).toEqual(["clipping", "faceless"]);
  });

  it("declares the dashboard and the running template's agents, each gated on operator approval", () => {
    // `channel`, not `dashboard`: app names are org-unique, and a generic one lets a second
    // blueprint adopt and overwrite this app on its own `naive up`.
    expect(project.apps.map((app) => app.name)).toEqual(["channel"]);
    expect(project.agents.map((agent) => agent.name)).toEqual(ACTIVE.agents.map((agent) => agent.name));
    for (const agent of project.agents) {
      expect(agent.system).toMatch(/never publish it yourself/);
      // Nothing enumerable is left to the default: every built-in this crew was not granted is
      // written `deny` by name, so the default governs only the tools a connected account
      // contributes — whose names come from the org's live connections and cannot be written here.
      expect(agent.tools?.default_config.permission).toBe("ask");
      expect(agent.tools?.configs["bash"]).toEqual({ enabled: false, permission: "deny" });
    }
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
  it("keeps the other template's crew instead of tombstoning it", () => {
    expect("removed" in declaration).toBe(false);
    expect(project.removed).toEqual({ apps: [], agents: [], skills: [], identities: [], vaults: [] });
    const other = ACTIVE.name === "faceless" ? TEMPLATES.clipping : TEMPLATES.faceless;
    const onlyTheirs = other.agents
      .map((agent) => agent.name)
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

  it("gives the deployed dashboard the org key, without putting a secret in this file", () => {
    // Declared nowhere before, so the deployed process had no key at all: the chat relay and every
    // platform-backed route could only ever answer 503. `{from_env}` also refuses the apply by name
    // when the variable is unset, instead of deploying a dashboard that cannot reach the platform.
    expect(project.apps[0]?.env?.["NAIVE_API_KEY"]).toEqual({ from_env: "NAIVE_API_KEY" });
    expect(JSON.stringify(project.apps[0]?.env)).not.toMatch(/sk_|secret/i);
  });

  it("declares the operator token every /api/* route is gated on", () => {
    // Declared nowhere before, so the deployed dashboard had no token to compare against and its
    // whole API — the queue, publishing, the roster, opening a billable session — answered anyone
    // who found the URL. `{from_env}` refuses the apply by name rather than deploying an open one,
    // and keeps the value out of this file.
    expect(project.apps[0]?.env?.["DASHBOARD_TOKEN"]).toEqual({ from_env: "DASHBOARD_TOKEN" });
  });

  it("serves its MCP endpoint from the dashboard and lets every agent file work through it", () => {
    expect(project.apps[0]).toMatchObject({ type: "fullstack", mcp: "/mcp" });
    for (const agent of project.agents) {
      expect(agent.system).toMatch(/channel\.create_post/);
      // The toolsets deny by default, so the dashboard's MCP tools must be allowed by name.
      expect(agent.tools?.configs["channel.create_post"]).toEqual({ enabled: true, permission: "allow" });
      expect(Object.keys(agent.tools?.configs ?? {}).some((name) => /^channel\.(approve|reject|post)/.test(name))).toBe(false);
    }
  });

  it("grants social.post only through the approval queue, and nothing else outward", () => {
    for (const agent of project.agents) {
      // `ask` (canonical-spec §6) parks the turn `awaiting_approval` with the call in
      // `pending_actions`; `allow` would publish straight past the operator.
      expect(agent.tools?.configs["social.post"]).toEqual({ enabled: true, permission: "ask" });
      // The only other tool that acts outward. Nothing else granted may run unattended by accident.
      const allowed = Object.entries(agent.tools?.configs ?? {})
        .filter(([, config]) => config.permission === "allow")
        .map(([name]) => name);
      expect(allowed).not.toContain("social.post");
      expect(allowed.filter((name) => name.startsWith("social."))).toEqual(["social.accounts"]);
    }
  });
});
