import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `pnpm dev` keeps its demo without compiling a single seed row into the bundle: the dev server
  // forwards the real routes to a local `pnpm serve`, which reads the seeded file store.
  server: { proxy: { "/api": "http://localhost:8788", "/mcp": "http://localhost:8788" } },
});
