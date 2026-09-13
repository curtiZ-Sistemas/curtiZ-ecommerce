import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 1,
    fileParallelism: false,
    exclude: ["tests/e2e/**", "**/node_modules/**", "**/.next/**", "**/dist/**"]
  }
});
