/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Playwright end-to-end test configuration.
 */

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * With BASE_URL set they run against that deployment. Without it they run
 * against the local stack (ADR-008): Playwright starts `scripts/local.mjs` on a
 * production build, with an in-memory PostgreSQL that is created for the run
 * and thrown away afterwards, and waits until the health check answers. So
 * `pnpm build && pnpm test:e2e` exercises the real database, jobs and storage
 * paths — not a server with half its components missing.
 *
 * Tests always target a production build, never `next dev`: Turbopack
 * recompilation and dev-mode double effects made the same suite flaky.
 */
const LOCAL_PORT = 3100;
/** Kept apart from `pnpm local` (5433), so a test run never touches dev data. */
const TEST_DB_PORT = 5434;

/** Shared with tests that exercise the job queue through /api/dev/ping. */
export const E2E_PING_TOKEN = "local-e2e-ping-token-0001";

/** Lets tests act as visitors from another country, as a CDN header would (docs/adr/013). */
export const E2E_COUNTRY_HEADER = "x-vitrine-test-country";

const baseURL = process.env.BASE_URL ?? `http://localhost:${LOCAL_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI === "true",
  retries: process.env.CI === "true" ? 2 : 0,
  reporter: process.env.CI === "true" ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer:
    process.env.BASE_URL === undefined
      ? {
          command: `node scripts/local.mjs start --port ${LOCAL_PORT} --db-port ${TEST_DB_PORT} --ephemeral`,
          url: `http://localhost:${LOCAL_PORT}/api/health`,
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: "ignore",
          stderr: "pipe",
          env: { DEV_PING_TOKEN: E2E_PING_TOKEN, LOG_LEVEL: "warn", GEO_COUNTRY_HEADER: E2E_COUNTRY_HEADER },
        }
      : undefined,
});
