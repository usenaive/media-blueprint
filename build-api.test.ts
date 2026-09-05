/**
 * What `deploy_dir` actually ships. `pnpm api:build` is run for real here because the three files
 * below are the whole server contract with the host, and every one of them is a filename or a
 * string the host reads — nothing a unit test of the script's internals would catch.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL(".", import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(`${root}dist/${name}`, "utf8")) as Record<string, unknown>;

beforeAll(() => {
  execFileSync("node", ["build-api.mjs"], { cwd: root, stdio: "pipe" });
}, 60_000);

describe("the deployed tree", () => {
  it("emits exactly one function, and it is the catch-all", () => {
    // One function over a dozen: one warm instance for the browser and the agents both, one `pg`
    // bundle, and one route table that cannot drift from the one `pnpm serve` runs.
    expect(existsSync(`${root}dist/api/app.js`)).toBe(true);
    expect(existsSync(`${root}dist/api/mcp.js`)).toBe(false);
    expect(readFileSync(`${root}dist/api/app.js`, "utf8")).toContain("channel_store");
  });

  it("rewrites /mcp and /api/* onto it, in order, and keeps the single-page fallback", () => {
    // Order is the contract: the fallback excludes `/api/`, so a function is never swallowed, and
    // the host checks the filesystem first, so `/api/app` and the static assets are served directly.
    expect(read("vercel.json").rewrites).toEqual([
      { source: "/mcp", destination: "/api/app?__path=/mcp" },
      { source: "/api/(.*)", destination: "/api/app?__path=/api/$1" },
      { source: "/((?!api/).*)", destination: "/index.html" },
    ]);
  });

  it("ships the manifest that installs the driver the function does not bundle", () => {
    expect(read("package.json")).toMatchObject({ type: "module", dependencies: { pg: "^8.16.3" } });
  });
});
