import { fileURLToPath } from "node:url";

import "dotenv/config";
import { defineConfig } from "vitest/config";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5435/clipmarket_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Every test file shares one database, so they run one at a time.
    fileParallelism: false,
    // Set before any module reads it, so `src/db` connects to the test database
    // and never to the development one.
    env: {
      DATABASE_URL: testDatabaseUrl,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "test-secret-0123456789abcdef",
      NODE_ENV: "test",
    },
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
