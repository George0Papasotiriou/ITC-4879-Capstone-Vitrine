/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the showcase: accounts that can sign in, a history written once, and the lock.
 */

import { readFile } from "node:fs/promises";

import { verifyPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseRoles } from "@/lib/auth/roles";
import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { SHOWCASE_ACCOUNTS, SHOWCASE_MARKER, TICKET_STORIES } from "@/lib/showcase/plan";
import { ensureAccounts, ensureHistory, lockShowcase } from "@/lib/showcase/seed";

const url = process.env.DATABASE_URL;
const PASSWORD = "a showcase password for tests";
const SECRET = "s".repeat(32);
const quiet = () => {};

describe.skipIf(url === undefined || url === "")("showcase", () => {
  let connection: ReturnType<typeof postgres>;
  const count = async (query: postgres.PendingQuery<{ n: number }[]>) => (await query)[0]!.n;
  const emails = SHOWCASE_ACCOUNTS.map((account) => account.email);

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await connection`TRUNCATE products, brands, categories, carts, orders, reviews, support_tickets, price_watches, audit_log CASCADE`;
    await connection`DELETE FROM users WHERE email = ANY(${emails}::text[])`;
    await connection`DELETE FROM app_settings WHERE key = ${SHOWCASE_MARKER}`;
    await upsertCatalog(db, catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products);
    // Enough on every shelf that the history never runs a piece short.
    await connection`UPDATE product_variants SET stock = 200`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("creates two accounts for every role, confirmed, that sign in with the password", async () => {
    const people = await ensureAccounts(connection, PASSWORD, quiet);
    expect(people.size).toBe(8);

    const rows = await connection<{ email: string; role: string; email_verified: boolean; password: string }[]>`
      SELECT u.email, u.role, u.email_verified, a.password FROM users u JOIN accounts a ON a.user_id = u.id AND a.provider_id = 'credential'
      WHERE u.email = ANY(${emails}::text[])
    `;
    expect(rows).toHaveLength(8);
    for (const account of SHOWCASE_ACCOUNTS) {
      const row = rows.find((entry) => entry.email === account.email)!;
      expect(parseRoles(row.role), account.email).toEqual([account.role]);
      expect(row.email_verified, account.email).toBe(true);
      expect(await verifyPassword({ hash: row.password, password: PASSWORD }), account.email).toBe(true);
    }
    // Every account's creation is on record, with no person as the actor.
    expect(await count(connection`SELECT count(*)::int AS n FROM audit_log WHERE action = 'role.grant' AND actor_user_id IS NULL`)).toBe(8);
  });

  it("changes the password on the next deploy, and keeps the same accounts", async () => {
    const before = await connection<{ id: string }[]>`SELECT id FROM users WHERE email = ANY(${emails}::text[]) ORDER BY email`;
    await ensureAccounts(connection, "a different showcase password", quiet);
    const after = await connection<{ id: string }[]>`SELECT id FROM users WHERE email = ANY(${emails}::text[]) ORDER BY email`;
    expect(after).toEqual(before);
    const [row] = await connection<{ password: string }[]>`SELECT a.password FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.email = 'admin1@vitrine.test'`;
    expect(await verifyPassword({ hash: row!.password, password: "a different showcase password" })).toBe(true);
    expect(await verifyPassword({ hash: row!.password, password: PASSWORD })).toBe(false);
    // The grants were recorded once, when the accounts were new.
    expect(await count(connection`SELECT count(*)::int AS n FROM audit_log WHERE action = 'role.grant'`)).toBe(8);
  });

  it("writes a history every account can show, through the shop's own stores", async () => {
    const people = await ensureAccounts(connection, PASSWORD, quiet);
    await ensureHistory(connection, people, { cookieSecret: SECRET, log: quiet });

    for (const account of SHOWCASE_ACCOUNTS) {
      expect(await count(connection`SELECT count(*)::int AS n FROM orders WHERE user_id = ${people.get(account.key)!.id}`), account.email).toBeGreaterThan(0);
    }
    const eleni = await connection<{ status: string }[]>`SELECT status FROM orders WHERE user_id = ${people.get("customer1")!.id}`;
    expect(new Set(eleni.map((order) => order.status))).toEqual(new Set(["delivered", "shipped", "paid", "refunded", "cancelled"]));

    expect(await count(connection`SELECT count(*)::int AS n FROM orders WHERE email LIKE '%@guests.vitrine.test'`)).toBeGreaterThanOrEqual(20);
    expect(await count(connection`SELECT count(*)::int AS n FROM support_tickets`)).toBe(TICKET_STORIES.length);
    expect(await count(connection`SELECT count(*)::int AS n FROM support_messages WHERE internal AND body LIKE 'Handed over from the Concierge%'`)).toBe(1);
    expect(await count(connection`SELECT count(*)::int AS n FROM reviews WHERE status = 'hidden'`)).toBe(2);
    expect(await count(connection`SELECT count(*)::int AS n FROM price_watches`)).toBeGreaterThanOrEqual(3);
    expect(await count(connection`SELECT count(*)::int AS n FROM carts WHERE user_id = ${people.get("customer1")!.id}`)).toBe(1);
    expect(await count(connection`SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id IN (${people.get("merchandiser1")!.id}, ${people.get("merchandiser2")!.id})`)).toBe(3);
    // No email was queued: every address is under .test, and the seeding never sends.
    expect(await count(connection`SELECT count(*)::int AS n FROM email_outbox WHERE to_address LIKE '%vitrine.test'`)).toBe(0);
  });

  it("writes nothing twice, even when a deploy stopped before it finished", async () => {
    const totals = async () => ({
      orders: await count(connection`SELECT count(*)::int AS n FROM orders`),
      tickets: await count(connection`SELECT count(*)::int AS n FROM support_tickets`),
      reviews: await count(connection`SELECT count(*)::int AS n FROM reviews`),
      audit: await count(connection`SELECT count(*)::int AS n FROM audit_log`),
    });
    const before = await totals();
    const people = await ensureAccounts(connection, PASSWORD, quiet);
    await ensureHistory(connection, people, { cookieSecret: SECRET, log: quiet });
    expect(await totals()).toEqual(before);

    // As if the last deploy stopped before writing its marker: every part checks for itself.
    await connection`DELETE FROM app_settings WHERE key = ${SHOWCASE_MARKER}`;
    await ensureHistory(connection, people, { cookieSecret: SECRET, log: quiet });
    expect(await totals()).toEqual(before);
  });

  it("locks the accounts without taking the shop's history with them", async () => {
    const orders = await count(connection`SELECT count(*)::int AS n FROM orders`);
    await lockShowcase(connection, quiet);
    expect(await count(connection`SELECT count(*)::int AS n FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.email = ANY(${emails}::text[])`)).toBe(0);
    expect(await count(connection`SELECT count(*)::int AS n FROM orders`)).toBe(orders);
  });
});
