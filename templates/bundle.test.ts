/**
 * *** THE TEMPLATE HAS TO REACH THE BUNDLE, AND FOR A LONG TIME IT DID NOT. ***
 *
 * `templates/index.ts` picks `ACTIVE` from `process.env["NAIVE_TEMPLATE"]`, and that module is the
 * screens' as much as the config's. In Node the read works, which is why `naive.config.ts` reported
 * the right template and the catalog row said `clipping`. In a client bundle it does not: Vite
 * compiles a bare `process.env` to `{}`, so the screens read `undefined` and fell back to this
 * repository's default. Measured on the published catalog, `faceless@0.2.0` and `clipping@0.2.0`
 * shipped the SAME digest — one dashboard, published twice under two names, and an operator
 * installing `clipping` got the `faceless` UI.
 *
 * A unit test on `ACTIVE` cannot see this: it runs in Node, where the read has always worked. Only
 * the emitted bytes can, so this builds them. Two templates, two bundles, and they must differ —
 * which is exactly the property the platform's publisher refuses to publish without.
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const original = process.env["NAIVE_TEMPLATE"];

/** The screens, compiled for one template. Never written: `dist` belongs to `build-api.test.ts`. */
async function clientBundle(template: string): Promise<string> {
  process.env["NAIVE_TEMPLATE"] = template;
  const result = (await build({
    configFile: `${root}vite.config.ts`,
    logLevel: "silent",
    build: { write: false },
  })) as Rollup.RollupOutput;
  return result.output
    .filter((chunk): chunk is Rollup.OutputChunk => chunk.type === "chunk")
    .map((chunk) => chunk.code)
    .join("\n");
}

/** Compared as digests, not as text: two 300 kB bundles printed side by side say nothing. */
const digest = (code: string) => createHash("sha256").update(code).digest("hex");

describe("the built dashboard", () => {
  let faceless = "";
  let clipping = "";

  beforeAll(async () => {
    faceless = await clientBundle("faceless");
    clipping = await clientBundle("clipping");
  }, 180_000);

  afterAll(() => {
    if (original === undefined) delete process.env["NAIVE_TEMPLATE"];
    else process.env["NAIVE_TEMPLATE"] = original;
  });

  it("is a different bundle for each template", () => {
    // The whole bug in one line. Before the `define` in `vite.config.ts` these two bundles were
    // byte-identical, and so were the two catalog rows built from them.
    expect(digest(clipping)).not.toEqual(digest(faceless));
  });

  it("carries the choice as a literal, not as a read the browser cannot make", () => {
    // `{}.NAIVE_TEMPLATE` is what the broken build shipped: the name survives into the bundle
    // precisely because nothing substituted it. Substituted, the name is gone and the value is in.
    expect(faceless).not.toContain("NAIVE_TEMPLATE");
    expect(clipping).not.toContain("NAIVE_TEMPLATE");
  });
});
