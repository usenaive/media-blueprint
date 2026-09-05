/** The two pieces of the deployed entry point that are decidable without a database. */
import { describe, expect, it } from "vitest";
import { libpqCompat, openDocument, requestOf, type Db } from "./api-entry.ts";
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
    expect(row.sql).toEqual(["begin", "select state from", "update channel_store set", "commit"]);
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
