/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * ESLint configuration.
 */

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // ADR-008. postgres.js's untyped `sql.array(values)` misbehaves
          // against the local PGlite database: bare, it errors; with a cast it
          // returns no rows at all, without an error. A plain array with an
          // explicit cast behaves identically on PGlite and PostgreSQL.
          selector:
            "CallExpression[callee.object.name=/^(sql|rawSql|tx)$/][callee.property.name='array'][arguments.length<2]",
          message:
            "Untyped sql.array() breaks on PGlite (silently empty with a cast). Pass a plain array with a cast instead: ${ids}::uuid[]. See ADR-008.",
        },
      ],
    },
  },
  globalIgnores([
    // Defaults from eslint-config-next.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output: the bundled worker is generated, not authored.
    "dist/**",
    // The browser depth model's runtime, copied from onnxruntime-web (ADR-014).
    "public/models/**",
    // The Python research environment, whose packages ship JavaScript of their own.
    "research/.venv/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    // Generated SQL and drizzle metadata.
    "drizzle/**",
    // Local stack data.
    ".local/**",
    // Vendored Claude Code skills. Third-party tooling with its own style.
    ".claude/**",
  ]),
]);

export default eslintConfig;
