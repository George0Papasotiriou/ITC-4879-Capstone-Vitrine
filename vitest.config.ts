/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Vitest configuration for the unit and integration test projects.
 */

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const srcAlias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

/**
 * Two projects, run separately (docs/PLAN.md Part 6).
 *
 * - `unit` covers pure logic and runs anywhere, with no services. This is where
 *   the graded algorithms are tested.
 * - `integration` needs PostgreSQL with pgvector. CI provides a real one;
 *   locally, global setup starts an in-memory PGlite (ADR-008), so the suite
 *   runs on any machine without Docker.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: srcAlias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          // Tests assert on behaviour, not log lines; failures still print.
          env: { LOG_LEVEL: "silent" },
        },
      },
      {
        resolve: { alias: srcAlias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/setup/database.ts"],
          env: { LOG_LEVEL: "silent" },
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
