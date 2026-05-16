import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests cover pure library logic only (no DOM, no Next runtime), so the
// node environment is enough and keeps the run fast. The `@/*` alias mirrors
// tsconfig.json `paths` so test imports match production import paths exactly
// — a test importing `@/lib/export/csv` resolves the same file the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
