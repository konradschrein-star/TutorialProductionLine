import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    pool: "forks",
    singleFork: true,
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/migrations/**",
        "src/seed*.ts",
        "src/**/__tests__/**",
        "src/index.ts",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 55,
      },
    },
  },
});
