/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for personal preferences on an account and the history ledger: kept, checked, merged, and deleted line by line.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { applyPatch, EMPTY_PREFERENCES, mergePreferences } from "@/lib/prefs/preferences";
import { createPreferenceStore } from "@/lib/prefs/store";
import { createTasteGraph } from "@/lib/reco/store";

const url = process.env.DATABASE_URL;

describe.skipIf(url === undefined || url === "")("preferences and the data ledger", () => {
  let connection: ReturnType<typeof postgres>;

  const newUser = async () => {
    const id = uuidv7();
    await connection`INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (${id}, 'Test', ${`prefs-${id}@example.com`}, true, now(), now())`;
    return id;
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    // The specimen catalogue, upserted: history needs products to point at.
    await upsertCatalog(db, catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products);
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("keeps an account's preferences and comfort settings, and reads nothing for a stranger", async () => {
    const store = createPreferenceStore(connection);
    const user = await newUser();
    expect(await store.forUser(user)).toMatchObject({ preferences: EMPTY_PREFERENCES, comfort: "", updatedAt: null });

    const prefs = applyPatch(EMPTY_PREFERENCES, { sizes: { upper: "M" }, rooms: [{ name: "Living room", wallCm: 240 }], like: { colors: ["green"] }, budgetEuros: 400 });
    await store.save(user, prefs);
    await store.saveComfort(user, "text_125.motion_reduce.nonsense_1");
    const kept = await store.forUser(user);
    expect(kept.preferences).toEqual(prefs);
    // Only settings the shop knows are kept.
    expect(kept.comfort).toBe("text_125.motion_reduce");
    expect((await store.forUser(uuidv7())).preferences).toEqual(EMPTY_PREFERENCES);
  });

  it("reads a row the shop no longer understands as nothing, rather than showing it", async () => {
    const store = createPreferenceStore(connection);
    const user = await newUser();
    await connection`INSERT INTO user_preferences (user_id, data) VALUES (${user}, ${JSON.stringify({ sizes: { upper: "XXXL" }, secret: "x" })}::text::jsonb)`;
    expect((await store.forUser(user)).preferences).toEqual(EMPTY_PREFERENCES);
  });

  it("merges a guest's device into the account on sign-in, keeping both sides", async () => {
    const store = createPreferenceStore(connection);
    const user = await newUser();
    await store.save(user, applyPatch(EMPTY_PREFERENCES, { sizes: { upper: "L" } }));
    const device = applyPatch(EMPTY_PREFERENCES, { sizes: { upper: "S", lower: "M" }, rooms: [{ name: "Study", wallCm: 180 }] });
    const merged = await store.save(user, mergePreferences(device, (await store.forUser(user)).preferences));
    expect(merged.sizes).toEqual({ upper: "L", lower: "M" });
    expect(merged.rooms).toEqual([{ name: "Study", wallCm: 180 }]);
  });

  it("goes with the account when the account is deleted", async () => {
    const store = createPreferenceStore(connection);
    const user = await newUser();
    await store.save(user, applyPatch(EMPTY_PREFERENCES, { budgetEuros: 200 }));
    await connection`DELETE FROM users WHERE id = ${user}`;
    expect(await connection`SELECT 1 FROM user_preferences WHERE user_id = ${user}`).toHaveLength(0);
  });

  it("lists a shopper's own history, newest first, and forgets one line only for its owner", async () => {
    const graph = createTasteGraph(connection);
    const [product] = await connection<{ id: string }[]>`SELECT id FROM products WHERE status = 'active' LIMIT 1`;
    expect(product, "the integration database is seeded with the catalogue").toBeDefined();
    if (product === undefined) return;
    const me = uuidv7();
    const someoneElse = uuidv7();
    await graph.record({ actorId: me, sessionId: "s1", productId: product.id, kind: "view" });
    await graph.record({ actorId: me, sessionId: "s1", productId: product.id, kind: "cart" });
    await graph.record({ actorId: someoneElse, sessionId: "s2", productId: product.id, kind: "view" });

    const history = await graph.history(me, "en");
    expect(history.map((entry) => entry.kind)).toEqual(["cart", "view"]);
    expect(history[0]).toMatchObject({ productId: product.id });
    expect(history[0]!.title.length).toBeGreaterThan(0);

    // Someone else's id cannot delete my line; my own can.
    expect(await graph.forgetOne(someoneElse, history[0]!.id)).toBe(false);
    expect(await graph.forgetOne(me, history[0]!.id)).toBe(true);
    expect((await graph.history(me, "en")).map((entry) => entry.kind)).toEqual(["view"]);
    expect(await graph.history(someoneElse, "en")).toHaveLength(1);
  });
});
