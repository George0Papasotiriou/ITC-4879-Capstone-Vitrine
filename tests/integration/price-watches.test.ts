/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for price watches and stored reports: one watch per piece, one email per drop, one file per week.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { catalogFixtureSchema, type ProductInput } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import { MAX_WATCHES } from "@/lib/commerce/price-watch";
import { createPriceWatchStore } from "@/lib/commerce/price-watch-store";
import * as schema from "@/lib/db/schema";
import { createReportStore, REPORT_KIND, reportKey } from "@/lib/report/store";
import type { WeeklyReportSummary } from "@/lib/report/weekly";

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("price watches", () => {
  let connection: ReturnType<typeof postgres>;
  let watches: ReturnType<typeof createPriceWatchStore>;
  let fixture: ProductInput[];
  let shopper: string;
  let products: { id: string; priceCents: number }[];

  const price = async (id: string, cents: number) => {
    await connection`UPDATE products SET price_cents = ${cents} WHERE id = ${id}`;
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories, price_watches, reports CASCADE`;
    fixture = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products;
    await upsertCatalog(db, fixture);
    await connection`UPDATE product_variants SET stock = 20`;
    watches = createPriceWatchStore(connection);
    products = (await connection<{ id: string; price_cents: number }[]>`SELECT id, price_cents FROM products ORDER BY source_id`).map((row) => ({
      id: row.id,
      priceCents: row.price_cents,
    }));
  });

  beforeEach(async () => {
    await connection`TRUNCATE price_watches`;
    await connection`DELETE FROM users WHERE email LIKE 'watcher.%@vitrine.test'`;
    shopper = uuidv7();
    await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${shopper}, 'Watcher', ${`watcher.${shopper}@vitrine.test`}, true, 'customer')`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("keeps one watch per person and piece, and moves the target rather than adding a row", async () => {
    const product = products[0]!;
    const first = await watches.set({ userId: shopper, productId: product.id, targetCents: product.priceCents - 5_000, locale: "en" });
    const second = await watches.set({ userId: shopper, productId: product.id, targetCents: product.priceCents - 9_000, locale: "el" });

    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    const mine = await watches.forPerson(shopper);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ productId: product.id, targetCents: product.priceCents - 9_000, priceCents: product.priceCents, notifiedAt: null });
  });

  it("refuses a target that is not below the price in the database, whatever the page said", async () => {
    const product = products[0]!;
    await expect(watches.set({ userId: shopper, productId: product.id, targetCents: product.priceCents, locale: "en" })).resolves.toEqual({
      ok: false,
      reason: "not_below_price",
    });
    await expect(watches.set({ userId: shopper, productId: uuidv7(), targetCents: 1_000, locale: "en" })).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("stops at the cap, and takes a new one once something is removed", async () => {
    const wanted = products.slice(0, MAX_WATCHES + 1);
    expect(wanted.length).toBeGreaterThan(MAX_WATCHES);
    for (const product of wanted.slice(0, MAX_WATCHES)) {
      await watches.set({ userId: shopper, productId: product.id, targetCents: Math.max(100, product.priceCents - 1_000), locale: "en" });
    }
    const overflow = wanted[MAX_WATCHES]!;
    await expect(watches.set({ userId: shopper, productId: overflow.id, targetCents: Math.max(100, overflow.priceCents - 1_000), locale: "en" })).resolves.toEqual({
      ok: false,
      reason: "too_many",
    });

    expect(await watches.remove({ userId: shopper, productId: wanted[0]!.id })).toBe(true);
    await expect(watches.set({ userId: shopper, productId: overflow.id, targetCents: Math.max(100, overflow.priceCents - 1_000), locale: "en" })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("emails once when the price arrives, and again only after it has gone back up", async () => {
    const product = products[1]!;
    const original = product.priceCents;
    await watches.set({ userId: shopper, productId: product.id, targetCents: original - 10_000, locale: "el" });

    // Nothing yet: the price has not moved.
    expect((await watches.pass()).due).toHaveLength(0);

    await price(product.id, original - 10_000);
    const first = await watches.pass();
    expect(first.due).toHaveLength(1);
    expect(first.due[0]).toMatchObject({ email: `watcher.${shopper}@vitrine.test`, locale: "el", priceCents: original - 10_000, targetCents: original - 10_000 });

    // Marked, so a second pass the same night sends nothing.
    await watches.markNotified(first.due.map((watch) => watch.id));
    expect((await watches.pass()).due).toHaveLength(0);
    expect((await watches.forPerson(shopper))[0]!.notifiedAt).not.toBeNull();

    // Back up: the watch is armed again, and fires on the next drop.
    await price(product.id, original);
    const rearm = await watches.pass();
    expect(rearm).toMatchObject({ rearmed: 1 });
    expect((await watches.forPerson(shopper))[0]!.notifiedAt).toBeNull();
    await price(product.id, original - 12_000);
    expect((await watches.pass()).due).toHaveLength(1);

    await price(product.id, original);
  });

  it("waits while the piece cannot be bought", async () => {
    const product = products[2]!;
    const original = product.priceCents;
    await watches.set({ userId: shopper, productId: product.id, targetCents: original - 5_000, locale: "en" });
    await price(product.id, original - 5_000);
    await connection`UPDATE products SET status = 'archived' WHERE id = ${product.id}`;
    expect((await watches.pass()).due).toHaveLength(0);

    await connection`UPDATE products SET status = 'active' WHERE id = ${product.id}`;
    await connection`UPDATE product_variants SET stock = 0 WHERE product_id = ${product.id}`;
    expect((await watches.pass()).due).toHaveLength(0);

    await connection`UPDATE product_variants SET stock = 20 WHERE product_id = ${product.id}`;
    expect((await watches.pass()).due).toHaveLength(1);
    await price(product.id, original);
  });

  it("goes when the account does", async () => {
    const product = products[0]!;
    await watches.set({ userId: shopper, productId: product.id, targetCents: product.priceCents - 1_000, locale: "en" });
    await connection`DELETE FROM users WHERE id = ${shopper}`;
    expect(await watches.forPerson(shopper)).toEqual([]);
  });
});

describe.skipIf(url === undefined || url === "")("stored reports", () => {
  let connection: ReturnType<typeof postgres>;
  let reports: ReturnType<typeof createReportStore>;
  const summary: WeeklyReportSummary = {
    salesCents: 120_000,
    orders: 7,
    refundsCents: 0,
    returnsRequested: 1,
    reviewsPublished: 3,
    searches: 40,
    zeroResultShare: 0.05,
    aiMicros: 4_200,
    aiCalls: 12,
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 2, onnotice: () => {} });
    await migrate(drizzle(connection, { schema }), { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE reports`;
    reports = createReportStore(connection);
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("keeps one row per week, with the figures read back as they were written", async () => {
    const week = { kind: REPORT_KIND, periodStart: "2026-09-14", periodEnd: "2026-09-20", storageKey: reportKey(REPORT_KIND, "2026-09-20"), bytes: 4_096, summary };
    await reports.save(week);
    await reports.save({ ...week, bytes: 5_120, summary: { ...summary, orders: 9 } });

    const stored = await reports.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ periodStart: "2026-09-14", periodEnd: "2026-09-20", bytes: 5_120, storageKey: "reports/weekly/2026-09-20.pdf" });
    expect(stored[0]!.summary).toEqual({ ...summary, orders: 9 });
  });

  it("lists the newest week first", async () => {
    await reports.save({ kind: REPORT_KIND, periodStart: "2026-09-07", periodEnd: "2026-09-13", storageKey: reportKey(REPORT_KIND, "2026-09-13"), bytes: 1, summary });
    expect((await reports.list()).map((report) => report.periodEnd)).toEqual(["2026-09-20", "2026-09-13"]);
  });

  it("names the confirmed admins, however their roles are stored", async () => {
    const ids = [uuidv7(), uuidv7(), uuidv7()];
    await connection`DELETE FROM users WHERE email LIKE 'report.%@vitrine.test'`;
    await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${ids[0]!}, 'One', ${`report.one.${ids[0]!}@vitrine.test`}, true, 'admin')`;
    await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${ids[1]!}, 'Two', ${`report.two.${ids[1]!}@vitrine.test`}, true, 'support,admin')`;
    // Not confirmed, and not an admin: neither hears about a report.
    await connection`INSERT INTO users (id, name, email, email_verified, role) VALUES (${ids[2]!}, 'Three', ${`report.three.${ids[2]!}@vitrine.test`}, false, 'admin')`;

    const admins = await reports.admins();
    const named = admins.filter((admin) => admin.email.startsWith("report."));
    expect(named.map((admin) => admin.name).sort()).toEqual(["One", "Two"]);
  });
});
