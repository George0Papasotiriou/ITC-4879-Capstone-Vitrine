/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * tsup configuration that bundles the worker into a single file.
 */

import { defineConfig } from "tsup";

/**
 * The worker is bundled into a single file rather than deployed as source.
 *
 * ADR-001: an earlier Railway project crash-looped because a workspace package
 * could not be resolved at runtime under ESM. Bundling removes runtime module
 * resolution from the equation entirely — the worker ships as one file with its
 * dependencies resolved at build time.
 */
export default defineConfig({
  entry: { "worker/index": "src/worker/index.ts" },
  outDir: "dist",
  format: ["esm"],
  target: "node24",
  platform: "node",
  sourcemap: true,
  clean: true,
  // Native and heavyweight dependencies stay external: they are installed in
  // node_modules on the Railway service and must not be inlined.
  external: ["bullmq", "ioredis", "postgres", "pino", "pino-pretty", "sharp"],
  banner: { js: "process.env.VITRINE_SERVICE ||= 'worker';" },
})
