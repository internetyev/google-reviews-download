import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests exercise logic, not the DOM (no rendering), so the node environment
// is enough and keeps the run fast. The `@/*` alias mirrors tsconfig.json
// `paths` so test imports match production import paths exactly — a test
// importing `@/lib/export/csv` resolves the same file the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  // tsconfig.json sets `jsx: "preserve"` (Next compiles JSX itself). Vitest
  // has no Next pipeline, so it must transform JSX. tests/faq-jsonld imports
  // app/_components/faq.tsx, whose FAQ_ITEMS array holds module-level JSX in
  // each item's `a` field that evaluates at import time. The automatic runtime
  // auto-imports react/jsx-runtime (react is a dependency), so faq.tsx loads
  // with no React global and no source change. The suite never renders the
  // elements — it only reads FAQ_ITEMS / faqJsonLd().
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
