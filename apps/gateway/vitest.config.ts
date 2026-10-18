import { defineConfig } from "vitest/config";

// The integration tests spawn real workspace processes (one per person): generous timeouts, one file at a time.
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
