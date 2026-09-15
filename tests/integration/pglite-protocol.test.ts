/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Regression tests for the PGlite wire-protocol fix.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import { withoutPrematureReady } from "../../scripts/pglite-server.mjs";

/**
 * Regression test for the PGlite wire-protocol fix (scripts/pglite-server.mjs).
 *
 * Before the fix, a failing statement in the extended protocol made PGlite send
 * two ReadyForQuery messages, and every later query on the same connection
 * received the previous query's result. The sequence below is the one that
 * exposed it: a rejected INSERT built by Drizzle, then ordinary queries.
 *
 * Against a real PostgreSQL (CI) the test passes trivially, which is the point:
 * the local stand-in must behave like the real thing.
 */

const url = process.env.DATABASE_URL;

/** The database error behind a failed query; Drizzle wraps it with the SQL text. */
async function databaseError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  return "no error";
}

describe.skipIf(url === undefined || url === "")("database connection after a failed statement", () => {
  let connection: ReturnType<typeof postgres>;

  beforeAll(async () => {
    connection = postgres(url as string, { max: 1, onnotice: () => {} });
    await migrate(drizzle(connection), { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("returns each query its own result after errors", async () => {
    const db = drizzle(connection, { schema });
    const [category] = await connection<{ id: string }[]>`
      INSERT INTO categories (id, slug, name_en, name_el)
      VALUES ('0190a0a0-0000-7000-8000-00000000abcd', 'protocol-probe', 'Probe', 'Probe')
      ON CONFLICT (slug) DO UPDATE SET name_en = excluded.name_en
      RETURNING id
    `;

    const probe = {
      slug: "protocol-probe",
      source: "abo" as const,
      sourceId: "PROTOCOL-PROBE",
      categoryId: category!.id,
      kind: "CHAIR",
      titleEn: "Probe",
      license: "test",
      attribution: "test",
    };

    // Two different failures in a row, each followed by a plain query.
    expect(await databaseError(db.insert(schema.products).values({ ...probe, priceCents: -1 }))).toMatch(/price_nonnegative/);
    expect(await connection`SELECT 7 AS seven`).toEqual([{ seven: 7 }]);

    expect(
      await databaseError(db.insert(schema.products).values({ ...probe, priceCents: 1000, compareAtCents: 900 })),
    ).toMatch(/compare_at_above_price/);
    expect(await connection`SELECT 8 AS eight`).toEqual([{ eight: 8 }]);

    // A literal statement that fails, then one that succeeds and returns rows.
    await expect(connection`SELECT 1 / 0`).rejects.toThrow(/division by zero/);
    const [row] = await connection<{ n: number }[]>`SELECT count(*)::int AS n FROM categories WHERE slug = 'protocol-probe'`;
    expect(row?.n).toBe(1);

    await connection`DELETE FROM categories WHERE slug = 'protocol-probe'`;
  });

  it("keeps a transaction usable for rollback after an error inside it", async () => {
    await expect(
      connection.begin(async (tx) => {
        await tx`SELECT 1`;
        await tx`SELECT 1 / 0`;
      }),
    ).rejects.toThrow(/division by zero/);
    expect(await connection`SELECT 'still aligned' AS status`).toEqual([{ status: "still aligned" }]);
  });
});

describe.skipIf(url === undefined || url === "")("concurrent connections", () => {
  it("gives every query its own result when many connections query at once", async () => {
    const pool = postgres(url as string, { max: 8, onnotice: () => {} });
    try {
      const work = Array.from({ length: 160 }, async (_, i) => {
        switch (i % 4) {
          case 0: {
            const [row] = await pool<{ n: number }[]>`SELECT ${i}::int AS n`;
            return row?.n === i;
          }
          case 1: {
            const rows = await pool<{ n: number }[]>`SELECT generate_series(1, ${(i % 7) + 1}) AS n`;
            return rows.length === (i % 7) + 1;
          }
          case 2: {
            try {
              await pool`SELECT ${i}::int / 0`;
              return false;
            } catch (error) {
              return /division by zero/.test((error as Error).message);
            }
          }
          default: {
            const value = await pool.begin(async (tx) => {
              await tx`SELECT set_config('vitrine.probe', ${String(i)}, true)`;
              const [row] = await tx<{ value: string }[]>`SELECT current_setting('vitrine.probe') AS value`;
              return row?.value;
            });
            return value === String(i);
          }
        }
      });
      const outcomes = await Promise.all(work);
      expect(outcomes.filter((ok) => !ok)).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });
});

describe("withoutPrematureReady", () => {
  const message = (type: string, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(5);
    header.write(type, 0, "ascii");
    header.writeInt32BE(4 + payload.length, 1);
    return Buffer.concat([header, payload]);
  };

  it("drops the ReadyForQuery that follows an ErrorResponse", () => {
    const output = Buffer.concat([message("2"), message("E", Buffer.from("SERROR\0")), message("Z", Buffer.from("E"))]);
    const { bytes, failed } = withoutPrematureReady(output);
    expect(failed).toBe(true);
    expect(bytes.equals(Buffer.concat([message("2"), message("E", Buffer.from("SERROR\0"))]))).toBe(true);
  });

  it("leaves a successful response untouched", () => {
    const output = Buffer.concat([message("2"), message("D", Buffer.from([0, 0])), message("C", Buffer.from("SELECT 1\0"))]);
    const { bytes, failed } = withoutPrematureReady(output);
    expect(failed).toBe(false);
    expect(bytes).toBe(output);
  });
});
