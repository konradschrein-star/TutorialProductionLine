import { defineConfig } from "vitest/config";

// cf-api is a server-only package. Keep its test runner isolated from the
// repository's legacy browser Vite config, which requires React tooling that
// this package neither uses nor installs.
export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
  },
});
