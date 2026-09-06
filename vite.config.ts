import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  /**
   * *** THE ONE WAY THE BROWSER LEARNS WHICH TEMPLATE THIS BUILD IS. ***
   *
   * `templates/index.ts` picks `ACTIVE` from `process.env["NAIVE_TEMPLATE"]`, and that module is
   * imported by the screens as well as by `naive.config.ts`. In Node the read works. In a client
   * bundle it does not: Vite compiles a bare `process.env` to `{}`, so the screens read `undefined`
   * and every build fell back to this repository's default template — measured, the published
   * `faceless` and `clipping` dashboards were byte-identical, and an operator installing `clipping`
   * got the `faceless` UI.
   *
   * A `define` is the fix because the template is a BUILD-TIME fact, not a runtime one: one build
   * is one template, the deployed dashboard is static files, and there is no request in which the
   * value could still be chosen. So it is substituted here, where it is known.
   *
   * Unset — every run that is not the platform's artifact publisher — this substitutes `""`, which
   * is falsy, and `templates/index.ts` keeps the default the file itself names. Nothing changes for
   * an operator who switches template by editing that line.
   */
  define: { "process.env.NAIVE_TEMPLATE": JSON.stringify(process.env["NAIVE_TEMPLATE"] ?? "") },
  // `pnpm dev` keeps its demo without compiling a single seed row into the bundle: the dev server
  // forwards the real routes to a local `pnpm serve`, which reads the seeded file store.
  server: { proxy: { "/api": "http://localhost:8788", "/mcp": "http://localhost:8788" } },
});
