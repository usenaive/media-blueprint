/**
 * The **whole** deployed dashboard server: one function, every route (ADR-0374).
 *
 * The host's file-map convention makes `dist/api/app.js` answer at `/api/app`, and
 * `dist/vercel.json` rewrites `/mcp` and `/api/*` onto it with the original path carried in
 * `__path`. One function rather than one per route means one warm instance for the browser and the
 * agents both, one `pg` bundle, and one route table (`routes.ts`) that cannot drift from the one
 * `pnpm serve` runs.
 *
 * A deployed app has no durable disk and no long-lived process, so the store's document lives in
 * the app database the platform provisions for a `fullstack` app (`DATABASE_URL`, server-set):
 * load, run the shared handler over it, write back once if it changed — all inside one transaction
 * with the row locked (`openDocument`), because "last write wins" over a whole document means
 * every concurrent write but the last one is silently thrown away. The upgrade is real tables, and
 * it starts by replacing this file's queries.
 */
import { Client } from "pg";
import { configFromEnv } from "./proxy.ts";
import { handleRequest, type ApiRequest } from "./routes.ts";
import { emptyState, openStoreOver, type Store, type StoreState } from "./store.ts";

const TABLE = "channel_store";
const ROW = "singleton";
/** Postgres `undefined_table` — the only error a first request should ever see from the `select`. */
const UNDEFINED_TABLE = "42P01";

interface Request {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface Response {
  status(code: number): Response;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  write(chunk: Uint8Array | string): void;
  end(body?: string): void;
}

/**
 * The platform hands us `...?sslmode=require`, which to libpq means "encrypt, do not assert a
 * chain" — the managed database terminates TLS at a pooler presenting a certificate this process
 * has no root for, so asserting one cannot succeed. node-postgres reads `sslmode` that way only
 * when asked to; left alone it verifies and fails with "self-signed certificate in certificate
 * chain". Asking here, rather than passing an `ssl` option, is the only thing that works: the
 * driver does `Object.assign({}, config, parse(connectionString))`, so anything the URL says about
 * TLS overrides an explicit option. Modes that *do* demand verification still get it.
 */
export function libpqCompat(url: string): string {
  const parsed = new URL(url);
  if (parsed.searchParams.has("sslmode")) parsed.searchParams.set("uselibpqcompat", "true");
  return parsed.toString();
}

/**
 * One client per invocation, never a `Pool`: an instance serves one request and is frozen between
 * them, so a pooled connection is a leaked backend on the database. Both timeouts are 5s because
 * the function's own ceiling is ~10s — a 10s connect timeout guarantees a bodiless gateway error
 * instead of our own 503.
 */
async function connect(): Promise<Client> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is unset: the app database is not provisioned yet");
  const client = new Client({
    connectionString: libpqCompat(url),
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    // A serverless instance can be frozen mid-request while holding the row lock; without this the
    // lock outlives the invocation and every later request waits on a caller that will never wake.
    idle_in_transaction_session_timeout: 10_000,
  });
  await client.connect();
  return client;
}

/** The slice of `pg`'s Client this file uses — the seam the concurrency test stands in. */
export interface Db {
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * Reads the document **with its row locked**, creating it empty on the very first request.
 * `select` first, `create table` only on `42P01`: the steady state is one round trip instead of
 * two, and a fresh deployment starts with an empty queue rather than someone else's rows
 * (ADR-0374 §5).
 *
 * `for update` is the whole fix for lost writes. Without it two invocations read the same document,
 * each appends its own post to its own copy, and the second `update` overwrites the first: eight
 * parallel `create_post` calls persisted five posts. The lock makes the second reader wait for the
 * first to commit, so it appends to a document that already contains the first's row.
 */
async function load(client: Db): Promise<StoreState> {
  const read = async () =>
    (await client.query<{ state: StoreState }>(`select state from ${TABLE} where id = $1 for update`, [ROW])).rows[0];
  try {
    const row = await read();
    if (row) return row.state;
  } catch (error) {
    if ((error as { code?: string }).code !== UNDEFINED_TABLE) throw error;
    await client.query(`create table if not exists ${TABLE} (id text primary key, state jsonb not null)`);
  }
  const fresh = emptyState();
  await client.query(`insert into ${TABLE} (id, state) values ($1, $2) on conflict (id) do nothing`, [
    ROW,
    JSON.stringify(fresh),
  ]);
  return (await read())?.state ?? fresh;
}

/** One request's exclusive hold on the document: the store to run over, and the way to let go. */
export interface Document {
  store: Store;
  /** Writes the document back if the handler changed it, and releases the lock. */
  commit(): Promise<void>;
  /** Releases the lock, changing nothing. */
  rollback(): Promise<void>;
}

/**
 * Opens the store document for exactly one request: `begin`, take the row lock, and hand back a
 * store whose writes land in this transaction. Every caller must reach `commit` or `rollback` —
 * both end the transaction, and until one of them does, every other invocation waiting on the row
 * is blocked, which is precisely the serialisation this store needs and did not have.
 */
export async function openDocument(client: Db): Promise<Document> {
  await client.query("begin");
  let state: StoreState;
  try {
    state = await load(client);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
  let dirty = false;
  const store = openStoreOver(state, () => {
    dirty = true;
  });
  return {
    store,
    async commit() {
      if (dirty) await client.query(`update ${TABLE} set state = $2 where id = $1`, [ROW, JSON.stringify(state)]);
      await client.query("commit");
    },
    async rollback() {
      await client.query("rollback");
    },
  };
}

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * The original path travels in `__path` because the host's rewrite semantics for `req.url` inside a
 * function are not something this repo can assert; `pathname` is the fallback. The host merges the
 * caller's own query parameters in, so they survive alongside it.
 */
export function requestOf(req: Request): ApiRequest {
  const url = new URL(req.url ?? "/", "http://app");
  const path = (url.searchParams.get("__path") ?? url.pathname).replace(/(.)\/+$/, "$1");
  const query = new URLSearchParams(url.searchParams);
  query.delete("__path");
  const headers: Record<string, string | undefined> = {};
  for (const name of Object.keys(req.headers)) headers[name.toLowerCase()] = header(req, name);
  return {
    method: (req.method ?? "GET").toUpperCase(),
    path,
    query,
    headers,
    body: req.body === undefined ? "" : typeof req.body === "string" ? req.body : JSON.stringify(req.body),
  };
}

interface Open {
  client?: Client;
  document?: Document;
  /** True when the failure was the database itself, which is a 503 and not a 502. */
  down: boolean;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  const request = requestOf(req);
  const open: Open = { down: false };

  try {
    const reply = await handleRequest(request, {
      // Opened lazily and once: `/api/chat`, `/api/agents` and `/api/social/*` cost no connection.
      async store() {
        if (open.document) return open.document.store;
        try {
          const client = await connect();
          open.client = client;
          open.document = await openDocument(client);
        } catch (error) {
          open.down = true;
          throw error;
        }
        return open.document.store;
      },
      config: configFromEnv(process.env),
      mcpToken: process.env["VETTA_MCP_TOKEN"],
      dashboardToken: process.env["DASHBOARD_TOKEN"],
      local: false,
    });

    // Committed before the reply is written: the lock is held for the handler and not for however
    // long the browser takes to read an event stream.
    await open.document?.commit();

    for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);

    if (reply.stream) {
      res.status(reply.status);
      res.setHeader("content-type", "text/event-stream");
      res.setHeader("cache-control", "no-cache");
      // The browser's EventSource reconnects cheaply when this function hits its duration ceiling.
      res.write("retry: 3000\n\n");
      const body = reply.stream.body;
      if (body === null) return res.end();
      const reader = body.getReader();
      for (let next = await reader.read(); !next.done; next = await reader.read()) res.write(next.value);
      return res.end();
    }
    if (reply.body === undefined) return res.status(reply.status).end();
    return res.status(reply.status).json(reply.body);
  } catch (error) {
    // The driver's own text can name the database host and user, so it is logged, never returned.
    console.error("dashboard request failed", error);
    await open.document?.rollback().catch(() => {});
    return open.down
      ? res.status(503).json({ error: "the app database is unavailable" })
      : res.status(502).json({ error: "upstream unavailable" });
  } finally {
    if (open.client) await open.client.end();
  }
}
