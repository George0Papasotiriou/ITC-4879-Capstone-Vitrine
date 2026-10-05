/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the outfit builder against PostgreSQL: looks completed around a real garment, and capsules within a budget, for the right department.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { roleOf } from "@/lib/optimize/outfit";
import { CAPSULE_SIZES, createWardrobe, departmentOf, LOOK_MIN_BUDGET_CENTS } from "@/lib/stylist/wardrobe";

/** docs/adr/066, with the real clothes (ADR-062) and wearables (ADR-061). */

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("the outfit builder in the database", () => {
  let connection: ReturnType<typeof postgres>;
  const facts = new Map<string, { kind: string; department: "women" | "men" | null; priceCents: number }>();

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    for (const file of ["amazon-clothes.json", "abo-wear.json"]) {
      await upsertCatalog(db, catalogFixtureSchema.parse(JSON.parse(await readFile(`src/lib/catalog/fixtures/${file}`, "utf8"))).products);
    }
    const rows = await connection<{ id: string; kind: string; attributes: Record<string, string>; title_en: string; price_cents: number }[]>`
      SELECT id, kind, attributes, title_en, price_cents FROM products WHERE status = 'active'
    `;
    for (const row of rows) facts.set(row.id, { kind: row.kind, department: departmentOf(row), priceCents: row.price_cents });
  }, 120_000);

  afterAll(async () => {
    await connection?.end();
  });

  it("completes a men's tee with men's or unisex trousers and shoes, within the budget", async () => {
    const [tee] = await connection<{ id: string; price_cents: number }[]>`SELECT id, price_cents FROM products WHERE slug = 'short-sleeve-pocket-tee-b00blo0cqq'`;
    const result = await createWardrobe(connection).lookFor(tee!.id, "GR", 30000);
    expect(result).not.toBeNull();
    expect(result!.looks.length).toBeGreaterThan(0);
    for (const look of result!.looks) {
      expect(look.ids[0]).toBe(tee!.id);
      const roles = look.ids.map((id) => roleOf(facts.get(id)!.kind));
      expect(roles).toContain("bottom");
      expect(roles).toContain("shoes");
      for (const id of look.ids.slice(1)) expect(facts.get(id)!.department).not.toBe("women");
      expect(new Set(look.ids).size).toBe(look.ids.length);
    }
  });

  it("finds a look for a cheap tee at the default budget: three times its price, but never less than €150", async () => {
    const [tee] = await connection<{ id: string; price_cents: number }[]>`SELECT id, price_cents FROM products WHERE slug = 'short-sleeve-pocket-tee-b00blo0cqq'`;
    expect(tee!.price_cents * 3).toBeLessThan(LOOK_MIN_BUDGET_CENTS);
    const result = await createWardrobe(connection).lookFor(tee!.id, "GR");
    expect(result!.looks.length).toBeGreaterThan(0);
    for (const look of result!.looks) expect(look.totalCents - tee!.price_cents).toBeLessThanOrEqual(LOOK_MIN_BUDGET_CENTS);
  });

  it("builds a women's capsule of the asked size within the budget, and says how many outfits it makes", async () => {
    const capsule = await createWardrobe(connection).capsule("women", "small", 60000, "GR");
    expect(capsule).not.toBeNull();
    const counts = CAPSULE_SIZES.small.women;
    expect(capsule!.ids).toHaveLength(counts.top + counts.bottom + counts.dress + counts.shoes);
    expect(capsule!.totalCents).toBeLessThanOrEqual(60000);
    expect(capsule!.outfits).toBeGreaterThan(0);
    expect(capsule!.outfits).toBeLessThanOrEqual(capsule!.possible);
    for (const id of capsule!.ids) expect(facts.get(id)!.department).not.toBe("men");
    expect(capsule!.examples.length).toBeGreaterThan(0);
  });

  it("finds no capsule when the budget cannot buy one", async () => {
    expect(await createWardrobe(connection).capsule("men", "small", 2000, "GR")).toBeNull();
  });
});
