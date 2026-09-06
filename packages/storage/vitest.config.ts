import { defineConfig } from "vitest/config";

// Storage tests are pure Node tests. A package-local config keeps Vitest from
// inheriting the root React/jsdom setup path relative to this workspace.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
  },
});
