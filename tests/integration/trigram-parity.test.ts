/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checks that application trigram similarity matches pg_trgm.
 */

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { trigramSimilarity } from "@/lib/search/trigram";

/**
 * The application's trigram similarity and the database's must be the same
 * function (docs/PLAN.md 2.6, A1).
 *
 * Fuzzy retrieval runs in PostgreSQL with pg_trgm; choosing between Greeklish
 * candidates runs in TypeScript. If the two disagreed, a candidate the app
 * rejected as dissimilar could be one the database would have matched, and the
 * pipeline would be inconsistent in a way no single test would reveal.
 *
 * Each pair is scored by both, on the real extension, and must agree to within
 * floating-point rounding. pg_trgm returns a `real` (float4), so agreement is
 * checked to 6 decimal places.
 *
 * Both sides see folded text (as the pipeline stores it), so the comparison is
 * of the similarity measure itself, not of two normalisations.
 */

const url = process.env.DATABASE_URL;

const PAIRS: [string, string][] = [
  ["chair", "chiar"],
  ["lounge chair", "lounge chiar"],
  ["sofa", "soffa"],
  ["walnut", "wallnut"],
  ["oak", "oak"],
  ["lamp", "rug"],
  ["mid century modern", "mid-century"],
  ["a", "ab"],
  ["καρεκλα", "καρεκλλα"],
  ["καναπεσ", "καναπεδεσ"],
  ["φωτιστικο δαπεδου", "φωτιστικο"],
  ["χαλι", "χαλια"],
];

describe.skipIf(url === undefined || url === "")("trigram similarity parity with pg_trgm", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(url as string, { max: 1, onnotice: () => {} });
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  for (const [a, b] of PAIRS) {
    it(`"${a}" vs "${b}"`, async () => {
      const [row] = await sql<{ s: number }[]>`SELECT similarity(${a}, ${b}) AS s`;
      const database = Number(row?.s);
      expect(trigramSimilarity(a, b)).toBeCloseTo(database, 6);
    });
  }
});
