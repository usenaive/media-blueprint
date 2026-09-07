/** The two pieces of the deployed entry point that are decidable without a database. */
import { afterEach, describe, expect, it } from "vitest";
import { libpqCompat, openDocument, reasonOf, requestOf, whereOf, type Db } from "./api-entry.ts";
import { emptyState, type StoreState } from "./store.ts";
import type { Post } from "../seed/posts.ts";

describe("libpqCompat", () => {
  const url = "postgresql://u:p@pooler.test:5432/postgres?sslmode=require";

  it("asks the driver to read sslmode the way libpq does", () => {
    // Without this the driver verifies the chain for `require` and the connection fails against a
    // pooler whose certificate this process has no root for.
    expect(new URL(libpqCompat(url)).searchParams.get("uselibpqcompat")).toBe("true");
    expect(new URL(libpqCompat(url)).searchParams.get("sslmode")).toBe("require");
  });

  it("leaves a URL that says nothing about TLS alone", () => {
    const plain = "postgresql://u:p@db.test:5432/postgres";
    expect(libpqCompat(plain)).toBe(plain);
  });

  it("does not weaken a mode that asks to be verified", () => {
    // `uselibpqcompat` selects libpq's meaning for every mode, and libpq verifies for verify-full.
    const strict = libpqCompat("postgresql://u:p@db.test:5432/postgres?sslmode=verify-full");
    expect(new URL(strict).searchParams.get("sslmode")).toBe("verify-full");
  });
});

describe("requestOf", () => {
  it("takes the original path from __path and keeps the caller's own query", () => {
    // The rewrite states the path explicitly because the host's own `req.url` semantics inside a
    // function are not something this repo can assert. Everything else the caller sent survives.
    const req = requestOf({
      method: "get",
      url: "/api/app?__path=/api/posts&status=pending",
      headers: { Authorization: "Bearer t" },
    });
    expect(req).toMatchObject({ method: "GET", path: "/api/posts", body: "" });
    expect(req.query.get("status")).toBe("pending");
    expect(req.query.get("__path")).toBeNull();
    expect(req.headers.authorization).toBe("Bearer t");
  });

  it("falls back to the pathname, and reads a body the host already parsed", () => {
    const req = requestOf({ method: "POST", url: "/mcp", headers: {}, body: { jsonrpc: "2.0" } });
    expect(req.path).toBe("/mcp");
    expect(req.body).toBe('{"jsonrpc":"2.0"}');
  });

  it("strips a trailing slash so /api/posts/ is not a different route", () => {
    expect(requestOf({ url: "/api/app?__path=/api/posts/", headers: {} }).path).toBe("/api/posts");
    expect(requestOf({ url: "/", headers: {} }).path).toBe("/");
  });
});

/**
 * The document is one row, so two invocations that read it, each append their own post to their
 * own copy and write it back means the second overwrites the first: eight parallel `create_post`
 * calls persisted five posts on the real deployment while every in-repo test was green.
 *
 * A real Postgres is not available here, so the row lock is modelled: the fake grants exclusive
 * access to whoever selects `for update` and holds it until `commit`/`rollback`. That is the whole
 * point — a `select` without `for update` takes no lock, so the same test over the old query
 * (`select state from channel_store where id = $1`) loses rows exactly as production did.
 */
function fakeRow(): { posts(): Post[]; sql: string[]; client(): Db } {
  let state = JSON.stringify(emptyState());
  const sql: string[] = [];
  let held = false;
  const waiting: (() => void)[] = [];
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (held) waiting.push(resolve);
      else {
        held = true;
        resolve();
      }
    });
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else held = false;
  };
  // Every statement yields, so nothing is serialised by accident: without a lock the eight
  // requests interleave read-read-…-write-write and all but the last write is thrown away.
  const yieldToOthers = () => new Promise((resolve) => setTimeout(resolve, 0));

  return {
    posts: () => (JSON.parse(state) as StoreState).posts,
    sql,
    client(): Db {
      let holding = false;
      return {
        async query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }> {
          sql.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
          if (/\bfor update\b/.test(text)) {
            await acquire();
            holding = true;
          }
          await yieldToOthers();
          if (text.startsWith("select")) return { rows: [{ state: JSON.parse(state) as StoreState }] as R[] };
          if (text.startsWith(`update ${"channel_store"}`)) state = values![1] as string;
          if (text === "commit" || text === "rollback") {
            if (holding) {
              holding = false;
              release();
            }
          }
          return { rows: [] };
        },
      };
    },
  };
}

describe("concurrent writes", () => {
  it("keeps every one of eight parallel creates", async () => {
    const row = fakeRow();
    await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const document = await openDocument(row.client());
        document.store.createPost({ caption: `clip ${i}`, status: "pending" });
        await document.commit();
      }),
    );
    expect(row.posts().map((p) => p.caption).sort()).toEqual(
      Array.from({ length: 8 }, (_, i) => `clip ${i}`).sort(),
    );
  });

  it("takes the lock inside a transaction and lets it go on commit", async () => {
    const row = fakeRow();
    const document = await openDocument(row.client());
    document.store.createPost({ caption: "one", status: "pending" });
    await document.commit();
    expect(row.sql).toEqual([
      "begin",
      "savepoint before_store_probe",
      "select state from",
      "update channel_store set",
      "commit",
    ]);
  });

  it("releases the lock when the handler failed, without writing", async () => {
    const row = fakeRow();
    const first = await openDocument(row.client());
    first.store.createPost({ caption: "kept", status: "pending" });
    await first.rollback();
    // A second request must not be left waiting on the abandoned transaction.
    const second = await openDocument(row.client());
    await second.commit();
    expect(row.posts()).toEqual([]);
  });
});

/**
 * The 503 has to name WHY, because "the app database is unavailable" reads identically for four
 * problems with four different owners — and it has to do it without ever letting the driver's own
 * words, which quote the host, the user and the password, reach a response body.
 */
describe("reasonOf", () => {
  const withCode = (code: string, message = "") => Object.assign(new Error(message), { code, name: "error" });

  it("names an unset variable before it names anything else", () => {
    expect(reasonOf(new Error("DATABASE_URL is unset: the app database is not provisioned yet"))).toBe("unset");
  });

  it("reads the codes a socket fails with", () => {
    expect(reasonOf(withCode("ENOTFOUND"))).toBe("host-not-found");
    expect(reasonOf(withCode("ENETUNREACH"))).toBe("no-route");
    expect(reasonOf(withCode("SELF_SIGNED_CERT_IN_CHAIN"))).toBe("tls");
  });

  it("reaches inside the aggregate Node throws when every address failed", () => {
    // A host with several A/AAAA records fails as an AggregateError that carries no code itself.
    const aggregate = Object.assign(new Error("all attempts failed"), { errors: [withCode("ENETUNREACH")] });
    expect(reasonOf(aggregate)).toBe("no-route");
  });

  it("reads the pooler's refusal of an un-namespaced user through the catch-all SQLSTATE", () => {
    // This is the real production failure: the pooler ACCEPTS the connection and completes TLS,
    // then rejects it FATAL under XX000 because the username carried no `.<project-ref>` suffix,
    // so there is no tenant to route to. The code alone cannot tell it from any other internal
    // error, and before this it collapsed to "unknown".
    const refusal = withCode("XX000", "(ENOIDENTIFIER) no tenant identifier provided (external_id or sni_hostname required)");
    expect(reasonOf(refusal)).toBe("no-such-tenant");
    expect(reasonOf(withCode("XX000", "Tenant or user not found"))).toBe("no-such-tenant");
  });

  it("falls back to the SQLSTATE, which is a class code and not a secret", () => {
    // A refusal nobody has met yet is otherwise indistinguishable from a database that is down.
    expect(reasonOf(withCode("57P03", "the database system is starting up"))).toBe("sqlstate-57P03");
  });

  it("will not let a driver's own code string ride out as a reason", () => {
    // Only an exact five upper-case alphanumerics is a SQLSTATE; everything else is discarded.
    expect(reasonOf(withCode("SOME_LONG_DRIVER_CODE"))).toBe("unknown");
    expect(reasonOf(withCode("xx000"))).toBe("unknown");
  });

  it("still distinguishes a genuinely wrong password", () => {
    expect(reasonOf(withCode("28P01"))).toBe("bad-password");
  });

  it("discards anything it does not recognise rather than passing a driver string through", () => {
    // The safety property: an unmapped failure can never become the way the connection string
    // escapes, however specific its message is.
    const leaky = withCode("XX000", 'connection to "db.secret-ref.example:5432" as user "postgres" failed');
    expect(reasonOf(leaky)).toBe("sqlstate-XX000");
    expect(reasonOf("not an error at all")).toBe("unknown");
  });
});

describe("whereOf", () => {
  const url = process.env["DATABASE_URL"];
  afterEach(() => {
    if (url === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = url;
  });

  it("reports the endpoint's shape and no part of its value", () => {
    process.env["DATABASE_URL"] =
      "postgresql://postgres:hunter2@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require";
    const at = whereOf(Object.assign(new Error("nope"), { name: "error" }));
    expect(at).toEqual({
      name: "error",
      scheme: "postgresql",
      port: "5432",
      params: ["sslmode"],
      endpoint: "pooled",
    });
    // Nothing that identifies the database may appear, at any depth.
    expect(JSON.stringify(at)).not.toMatch(/hunter2|postgres:|supabase|pooler\./);
  });

  it("says when the endpoint is the project's direct host instead of the pooled one", () => {
    // The distinction an operator cannot otherwise see, and the one that decides whether a
    // serverless runtime can dial it at all.
    process.env["DATABASE_URL"] = "postgresql://u:p@db.ref.supabase.co:5432/postgres";
    expect(whereOf(new Error("x"))).toMatchObject({ endpoint: "direct", params: [] });
  });

  it("says the variable is unset without inventing a shape for it", () => {
    delete process.env["DATABASE_URL"];
    expect(whereOf(new Error("x"))).toEqual({ name: "Error", url: "unset" });
  });
});

/**
 * A fresh app database has no `channel_store` table, so the very first request is the one that has
 * to create it — and it runs inside the transaction `openDocument` has already opened.
 *
 * Postgres aborts a transaction at the first statement that errors and refuses everything after it
 * with `25P02` until the block ends. So `select … for update` failing `42P01` does not just need
 * catching: the transaction it failed in has to be unwound before the recovery DDL can run at all.
 * Modelled here because that rule is the whole bug and a real Postgres is not available.
 */
function abortingRow(): { created: boolean; client(): Db } {
  let exists = false;
  let aborted = false;
  const state = { exists: false };
  const out = {
    get created() {
      return state.exists;
    },
    client(): Db {
      return {
        async query<R>(text: string): Promise<{ rows: R[] }> {
          const sql = text.trim().toLowerCase();
          const isUnwind = sql === "rollback" || sql === "commit" || sql.startsWith("rollback to savepoint");
          if (aborted && !isUnwind) {
            throw Object.assign(new Error("current transaction is aborted, commands ignored until end of transaction block"), {
              name: "error",
              code: "25P02",
            });
          }
          if (isUnwind) aborted = false;
          if (sql.startsWith("select") && !exists) {
            aborted = true;
            throw Object.assign(new Error(`relation "channel_store" does not exist`), { name: "error", code: "42P01" });
          }
          if (sql.startsWith("create table")) {
            exists = true;
            state.exists = true;
          }
          if (sql.startsWith("select")) return { rows: [{ state: emptyState() }] as R[] };
          return { rows: [] };
        },
      };
    },
  };
  return out;
}

describe("first request on a fresh app database", () => {
  it("creates the store table instead of dying inside the aborted transaction", async () => {
    // Before the savepoint this threw 25P02 and every /api/* route answered 503 forever: the
    // database was reachable and healthy the whole time, and the app could never take its first
    // write. Measured on the live `channel` app as `reason: "sqlstate-25P02"`.
    const row = abortingRow();
    const document = await openDocument(row.client());
    expect(row.created).toBe(true);
    await document.commit();
  });
});
