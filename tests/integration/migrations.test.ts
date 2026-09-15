/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration test that all migrations apply on PostgreSQL with pgvector.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migrations run against a real PostgreSQL with pgvector.
 *
 * This is the test that would have caught the most expensive class of bug in
 * this project: a migration that works on a developer's machine but fails on
 * Railway because an extension is unavailable. It runs in CI against a
 * pgvector service container, and locally only if DATABASE_URL points at a
 * throwaway database.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("foundation migration", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    sql = postgres(url as string, { max: 1, onnotice: () => {} });
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("enables the extensions hybrid search depends on", async () => {
    const rows = await sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension
      WHERE extname IN ('vector', 'pg_trgm', 'unaccent')
      ORDER BY extname
    `;
    expect(rows.map((r) => r.extname)).toEqual(["pg_trgm", "unaccent", "vector"]);
  });

  it("creates app_settings with a timestamptz updated_at", async () => {
    const rows = await sql<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'app_settings'
      ORDER BY ordinal_position
    `;

    const columns = Object.fromEntries(
      rows.map((r) => [r.column_name, r.data_type]),
    );

    expect(columns["key"]).toBe("text");
    expect(columns["value"]).toBe("jsonb");
    // Times are stored as timestamptz in UTC everywhere (docs/PLAN.md 2.4).
    expect(columns["updated_at"]).toBe("timestamp with time zone");
  });

  it("can store and query a vector, proving pgvector is usable", async () => {
    await sql`CREATE TEMP TABLE embedding_probe (id int, v vector(3))`;
    await sql`INSERT INTO embedding_probe VALUES (1, '[1,0,0]'), (2, '[0,1,0]')`;

    const rows = await sql<{ id: number }[]>`
      SELECT id FROM embedding_probe ORDER BY v <=> '[1,0,0]' LIMIT 1
    `;
    expect(rows[0]?.id).toBe(1);
  });

  it("is idempotent: running it twice changes nothing", async () => {
    await expect(
      migrate(drizzle(sql), { migrationsFolder: "./drizzle" }),
    ).resolves.not.toThrow();
  });
});
