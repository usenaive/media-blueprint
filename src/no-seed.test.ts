/**
 * No seed row may reach the shipped bundle (ADR-0374 §5).
 *
 * A compiled-in row is a fabricated row: it outlives a reload the real data does not, and it hides
 * a dead route behind a full-looking screen — which is exactly how this dashboard shipped
 * presenting nine invented posts as the operator's queue.
 *
 * This guard used to be a regex over import statements, and it was walked round twice: once with
 * the explicit `.ts` extension that `server/store.ts` itself writes, once with a multi-line import
 * (the pattern was `/m`, so `.` never crossed the newline). Import *syntax* is not the thing that
 * matters, so this asks the only question that does — does a seed row reach the asset the
 * deployment serves? It bundles `src/main.tsx` the way the build does and then checks both the
 * module graph (no `seed/posts.ts` compiled in) and the emitted JavaScript (no seed id in the
 * text). `import type` is erased and leaves neither behind, so it stays legal; every value import
 * does, whatever its spelling, and so does a hand-pasted copy of the rows.
 *
 * `seed/style-templates.ts` is exempt: the preset catalogue is the blueprint's own product, not
 * anyone's work pretending to be done.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type BuildOptions } from "esbuild";
import { describe, expect, it } from "vitest";
import { CLIPPING_SEEDS, FACELESS_SEEDS } from "../seed/posts.ts";

const src = dirname(fileURLToPath(import.meta.url));
const root = dirname(src);

/** The one module whose contents may never ship. Paths are relative to the blueprint root. */
const FORBIDDEN = "seed/posts.ts";

/**
 * Row ids are the seeds' fingerprint in the emitted text: unique, and unchanged by minification.
 * Both templates' demo rows, because the screens import `templates/` and a template that carried
 * its own rows would ship them — which is why the rows live here and the templates do not.
 */
const SEED_IDS = [...FACELESS_SEEDS, ...CLIPPING_SEEDS].map((post) => post.id);

/**
 * Bundle from the real entry point, or from a snippet resolved as if it were a file in `src/`.
 * `packages: "external"` leaves react and friends alone; every relative import is followed, which
 * is the graph we care about. CSS is dropped — nothing renders here, we only read the JavaScript.
 */
async function bundle(entry: { file: string } | { source: string }) {
  const options: BuildOptions =
    "file" in entry
      ? { entryPoints: [entry.file] }
      : { stdin: { contents: entry.source, resolveDir: src, loader: "ts", sourcefile: "offender.ts" } };
  const result = await build({
    ...options,
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    packages: "external",
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  const js = result.outputFiles.map((file) => file.text).join("\n");
  return {
    inputs: Object.keys(result.metafile.inputs),
    seedModules: Object.keys(result.metafile.inputs).filter((path) => path === FORBIDDEN),
    seedIds: SEED_IDS.filter((id) => js.includes(id)),
  };
}

describe("no seed row reaches the shipped dashboard bundle", () => {
  it("compiles no seed module and emits no seed row", async () => {
    const { seedModules, seedIds } = await bundle({ file: "src/main.tsx" });
    expect(seedModules).toEqual([]);
    expect(seedIds).toEqual([]);
  });

  it("is actually walking the whole app", async () => {
    // A bundle of nothing satisfies every assertion above and guards nothing.
    const { inputs } = await bundle({ file: "src/main.tsx" });
    expect(inputs.filter((path) => path.startsWith("src/screens/")).length).toBeGreaterThan(4);
    expect(SEED_IDS.length).toBeGreaterThan(4);
  });

  it("keeps the style-template catalogue, which is the product and not a pretend row", async () => {
    expect((await bundle({ file: "src/main.tsx" })).inputs).toContain("seed/style-templates.ts");
  });

  it("ships the templates themselves, which are what the screens read their words from", async () => {
    // The blueprint's own data — crews, post kinds, onboarding questions, screen vocabulary. It
    // carries no row anyone is meant to mistake for work, and the two checks above prove it.
    const { inputs } = await bundle({ file: "src/main.tsx" });
    expect(inputs).toContain("templates/index.ts");
    expect(inputs).toContain("templates/faceless.ts");
    expect(inputs).toContain("templates/clipping.ts");
  });

  /**
   * The three spellings that matter: the plain one the old regex caught, and the two it did not.
   * Each must be caught by both halves of the check.
   */
  it.each([
    ["plain", 'import { FACELESS_SEEDS } from "../seed/posts";\nexport const rows = FACELESS_SEEDS;'],
    ["explicit .ts extension", 'import { CLIPPING_SEEDS } from "../seed/posts.ts";\nexport const rows = CLIPPING_SEEDS;'],
    ["multi-line", 'import {\n  FACELESS_SEEDS,\n  type Post,\n} from "../seed/posts";\nexport const rows: Post[] = FACELESS_SEEDS;'],
  ])("catches a seed import written %s", async (_name, source) => {
    const { seedModules, seedIds } = await bundle({ source });
    expect(seedModules).toEqual([FORBIDDEN]);
    expect(seedIds.length).toBeGreaterThan(0);
  });

  it("still allows a type-only import, which is erased", async () => {
    const source = 'import type { Post } from "../seed/posts";\nexport const rows: Post[] = [];';
    const { seedModules, seedIds } = await bundle({ source });
    expect(seedModules).toEqual([]);
    expect(seedIds).toEqual([]);
  });

  it("catches rows pasted in by hand, with no import at all", async () => {
    const [first] = FACELESS_SEEDS;
    const source = `export const rows = [{ id: ${JSON.stringify(first?.id)} }];`;
    expect((await bundle({ source })).seedIds).toEqual([first?.id]);
  });
});
