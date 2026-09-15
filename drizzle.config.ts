/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * drizzle-kit configuration for generating migrations.
 */

import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit reads this for `pnpm db:generate` (produce SQL from the schema)
 * and `pnpm db:studio`. Generated SQL is reviewed by hand before it is
 * committed; `push` is never used (CLAUDE.md guardrails).
 */
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
