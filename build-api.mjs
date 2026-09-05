/**
 * Emits the deployed dashboard's server half into `dist/`, which is what `deploy_dir` ships.
 *
 * **One function, not one per route** (ADR-0374). The host's zero-config file map turns
 * `api/<name>.js` into `/api/<name>`, so `dist/api/app.js` answers at `/api/app` and the rewrites
 * below send `/mcp` and every `/api/*` path to it with the original path carried in `__path`. One
 * function means one warm instance for the browser and the agents both, one `pg` bundle, and one
 * route table; a file per route would re-bundle the store a dozen times and drift a dozen ways.
 *
 * The rewrite order matters and is checked by the test beside this file: `/mcp` first, then
 * `/api/*`, then the single-page fallback — which excludes `/api/` so a function is never
 * swallowed. The host checks the filesystem before it rewrites, so `/api/app` and every static
 * asset are served directly and the fallback still catches screen URLs (a reload, a bookmark or a
 * shared deep link into any screen would otherwise be a hard 404).
 *
 * `app` is a reserved route name: no product route may be `/api/app`.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

mkdirSync(join(dist, "api"), { recursive: true });

// The route-per-file layout this replaced. A stale one left behind is a second, older copy of the
// server answering `/api/mcp` beside the catch-all, over the same database — so it is removed here
// rather than left to whether `vite build` happened to empty the directory first.
rmSync(join(dist, "api", "mcp.js"), { force: true });

await build({
  entryPoints: [join(root, "server", "api-entry.ts")],
  outfile: join(dist, "api", "app.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // Installed from the manifest below rather than inlined: `pg` ships native-ish internals that do
  // not survive bundling, and the host installs it anyway.
  external: ["pg"],
});

const rewrites = [
  { source: "/mcp", destination: "/api/app?__path=/mcp" },
  { source: "/api/(.*)", destination: "/api/app?__path=/api/$1" },
  { source: "/((?!api/).*)", destination: "/index.html" },
];

writeFileSync(join(dist, "vercel.json"), `${JSON.stringify({ rewrites }, null, 2)}\n`);

writeFileSync(
  join(dist, "package.json"),
  `${JSON.stringify(
    { name: "media-dashboard", private: true, type: "module", dependencies: { pg: "^8.16.3" } },
    null,
    2,
  )}\n`,
);

process.stdout.write("dist/api/app.js, dist/vercel.json, dist/package.json\n");
