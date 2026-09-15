/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for SQL array parameter forms.
 */

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Array parameters behave the same on PGlite and PostgreSQL — for the forms the
 * codebase allows (ADR-008).
 *
 * This suite runs locally against PGlite and in CI against PostgreSQL. Search
 * (A1) and recommendations (A2) pass arrays of ids into SQL constantly; if one
 * of these forms ever diverged, a result set could come back empty on one
 * database and full on the other, with no error on either.
 *
 * The form that does diverge — untyped `sql.array(values)` — is not tested here
 * because it is banned by lint rather than relied upon.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("array parameters", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(url as string, { max: 2, onnotice: () => {} });
    await sql`CREATE TEMP TABLE items (id uuid PRIMARY KEY, code text, rank int)`;
    await sql`
      INSERT INTO items VALUES
        ('0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e01', 'oak', 3),
        ('0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e02', 'walnut', 1),
        ('0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e03', 'linen', 2)
    `;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("matches text values from a plain array with a cast", async () => {
    const rows = await sql<{ code: string }[]>`
      SELECT code FROM items WHERE code = ANY(${["oak", "linen"]}::text[]) ORDER BY code
    `;
    expect(rows.map((row) => row.code)).toEqual(["linen", "oak"]);
  });

  it("matches uuids, the shape search and recommendations pass around", async () => {
    const ids = ["0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e02", "0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e03"];
    const rows = await sql<{ code: string }[]>`
      SELECT code FROM items WHERE id = ANY(${ids}::uuid[]) ORDER BY rank
    `;
    expect(rows.map((row) => row.code)).toEqual(["walnut", "linen"]);
  });

  it("preserves a caller's ranking with unnest ... WITH ORDINALITY", async () => {
    // Fusion (A1) produces an ordered id list; SQL must hand rows back in that
    // order, not in table order.
    const ranked = [
      "0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e03",
      "0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e01",
      "0192f3a1-9c4e-7b21-8d3f-5a6b7c8d9e02",
    ];
    const rows = await sql<{ code: string }[]>`
      SELECT items.code
      FROM unnest(${ranked}::uuid[]) WITH ORDINALITY AS wanted(id, position)
      JOIN items ON items.id = wanted.id
      ORDER BY wanted.position
    `;
    expect(rows.map((row) => row.code)).toEqual(["linen", "oak", "walnut"]);
  });

  it("returns nothing for an empty array, rather than failing", async () => {
    const rows = await sql`SELECT code FROM items WHERE code = ANY(${[] as string[]}::text[])`;
    expect(rows).toHaveLength(0);
  });

  it("matches an explicitly typed sql.array, the allowed escape hatch", async () => {
    const TEXT_OID = 25;
    const rows = await sql<{ code: string }[]>`
      SELECT code FROM items WHERE code = ANY(${sql.array(["walnut"], TEXT_OID)}) ORDER BY code
    `;
    expect(rows.map((row) => row.code)).toEqual(["walnut"]);
  });
});
