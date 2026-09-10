/**
 * The local dashboard server: serves the built static app from `dist/` and hands every `/mcp` and
 * `/api/*` request to the one shared route table (`routes.ts`) — the same one the deployed function
 * runs, over a JSON file instead of the app database, so `pnpm serve` and the deployment cannot
 * disagree about a route. The org API key stays in this process (`NAIVE_API_KEY`); the browser only
 * ever talks to `/api/*`.
 *
 * `pnpm dev` proxies `/api` and `/mcp` here (`vite.config.ts`), which is how the demo keeps its
 * seeded rows without compiling a single one into the shipped bundle.
 *
 * Run: `pnpm build && pnpm serve` (node's own type stripping; zero deps).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { configFromEnv } from "./proxy.ts";
import { handleRequest, type ApiRequest } from "./routes.ts";
import { openStore } from "./store.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = configFromEnv(process.env);
const mcpToken = process.env["VETTA_MCP_TOKEN"];
const dashboardToken = process.env["DASHBOARD_TOKEN"];
// All three are the platform's to set; a laptop has none, and the loopback bypass below needs none.
const dashboardPassword = process.env["DASHBOARD_PASSWORD"];
const studioUrl = process.env["NAIVE_STUDIO_URL"];
const appId = process.env["NAIVE_APP_ID"];
const store = openStore(join(root, "data", "store.json"));

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2",
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString("utf8"); });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });

async function requestOf(req: IncomingMessage, url: URL): Promise<ApiRequest> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return {
    method: (req.method ?? "GET").toUpperCase(),
    path: url.pathname.replace(/(.)\/+$/, "$1"),
    query: url.searchParams,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req),
  };
}

/**
 * Whether this request came from this machine. `/api/*` is bearer-gated everywhere else, and the
 * one caller allowed past that gate is the operator's own browser on `pnpm serve` / `pnpm dev`.
 * Anything arriving over a real network — this server bound to 0.0.0.0, a tunnel, a LAN peer —
 * is not that caller and gets the same gate the deployment has.
 */
const isLoopback = (address: string | undefined): boolean =>
  address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const reply = await handleRequest(await requestOf(req, url), {
    store: () => Promise.resolve(store),
    config,
    mcpToken,
    dashboardToken,
    dashboardPassword,
    studioUrl,
    appId,
    local: isLoopback(req.socket.remoteAddress),
  });
  // `/api/enter` answers with a cookie and a `location` and nothing else; every other route sets none.
  const extra = reply.headers ?? {};
  if (reply.stream) {
    if (reply.sse) {
      res.writeHead(reply.status, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write("retry: 3000\n\n");
    } else {
      res.writeHead(reply.status, { "content-type": reply.stream.headers.get("content-type") ?? "application/octet-stream" });
    }
    if (reply.stream.body === null) return void res.end();
    const reader = reply.stream.body.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) res.write(next.value);
    return void res.end();
  }
  if (reply.body === undefined) return void res.writeHead(reply.status, extra).end();
  res.writeHead(reply.status, { "content-type": "application/json", ...extra });
  res.end(JSON.stringify(reply.body));
}

async function handleStatic(res: ServerResponse, path: string): Promise<void> {
  const clean = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, "dist", clean === "/" ? "index.html" : clean);
  try {
    const content = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(await readFile(join(root, "dist", "index.html")));
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const handled = url.pathname === "/mcp" || url.pathname.startsWith("/api/")
    ? handleApi(req, res, url)
    : handleStatic(res, url.pathname);
  handled.catch((error: unknown) => {
    console.error("dashboard request failed", error);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream unavailable" }));
  });
});

const port = Number(process.env["PORT"] ?? 8788);
server.listen(port, () => console.log(
  `dashboard on :${port} (${config === null ? "store only — no NAIVE_API_KEY" : "platform mode"}; mcp ${mcpToken === undefined ? "closed — no VETTA_MCP_TOKEN" : "open"})`,
));
