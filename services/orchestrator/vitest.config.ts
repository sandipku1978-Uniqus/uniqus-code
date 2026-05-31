import { defineConfig } from "vitest/config";

// Minimal vitest setup for the orchestrator's unit tests. Tests live next to
// the code they cover (`src/**/*.test.ts`) and must stay deterministic and
// network-free. Test files are excluded from `tsc` (see tsconfig.json) so they
// never gate `npm run typecheck`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
