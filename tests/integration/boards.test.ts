/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for room boards against PostgreSQL: limits, one line per piece, order without gaps, and adoption.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MAX_BOARDS, MAX_ITEMS } from "@/lib/boards/boards";
import { createBoardStore } from "@/lib/boards/store";
import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";

const url = process.env.DATABASE_URL;
const OWNER = "user:boards-test-owner";

describe.skipIf(url === undefined || url === "")("room boards", () => {
  let connection: ReturnType<typeof postgres>;
  let boards: ReturnType<typeof createBoardStore>;
  let products: string[];

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await upsertCatalog(db, catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products);
    products = (await connection<{ id: string }[]>`SELECT id FROM products ORDER BY slug LIMIT 12`).map((row) => row.id);
    boards = createBoardStore(connection);
  });

  beforeEach(async () => {
    await connection`DELETE FROM boards WHERE owner_key LIKE '%boards-test%'`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("lets a shopper have twelve boards, and lists them latest first with their covers", async () => {
    for (let index = 0; index < MAX_BOARDS; index += 1) expect(await boards.create(OWNER, `Board ${index}`)).toMatchObject({ ok: true });
    expect(await boards.create(OWNER, "One too many")).toEqual({ ok: false, reason: "too_many" });
    const [first] = await boards.mine(OWNER);
    const made = await boards.byId(first!.id);
    await boards.add(made!.id, products[0]!);
    const mine = await boards.mine(OWNER);
    expect(mine[0]!.id).toBe(made!.id);
    expect(mine[0]!.items).toBe(1);
    expect(mine[0]!.productIds).toEqual([products[0]]);
  });

  it("keeps one line per piece: adding it again adds to its quantity, up to twenty", async () => {
    const created = await boards.create(OWNER, "Living room");
    if (!created.ok) throw new Error("unreachable");
    const id = created.board.id;
    expect(await boards.add(id, products[0]!)).toMatchObject({ ok: true, created: true, item: { quantity: 1, position: 0 } });
    expect(await boards.add(id, products[0]!, 2)).toMatchObject({ ok: true, created: false, item: { quantity: 3 } });
    expect(await boards.add(id, products[0]!, 30)).toMatchObject({ item: { quantity: 20 } });
    expect(await boards.items(id)).toHaveLength(1);
  });

  it("refuses a piece past the limit, even when many arrive at once", async () => {
    // The specimen catalogue has 25 pieces, so the limit (40 in the shop) is set to 10 here.
    const small = createBoardStore(connection, { maxItems: 10 });
    const created = await small.create(OWNER, "Full");
    if (!created.ok) throw new Error("unreachable");
    const results = await Promise.all(products.slice(0, 12).map((product) => small.add(created.board.id, product)));
    expect(results.filter((result) => result.ok)).toHaveLength(10);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "full" }, { ok: false, reason: "full" }]);
    const positions = (await small.items(created.board.id)).map((item) => item.position);
    expect(positions).toEqual(Array.from({ length: 10 }, (_, index) => index));
    expect(MAX_ITEMS).toBe(40);
  });

  it("keeps positions without gaps through moves and removals, and notes and quantities change", async () => {
    const created = await boards.create(OWNER, "Order");
    if (!created.ok) throw new Error("unreachable");
    const id = created.board.id;
    const added = [];
    for (const product of products.slice(0, 4)) {
      const result = await boards.add(id, product);
      if (result.ok) added.push(result.item);
    }
    await boards.move(id, added[3]!.id, 0);
    expect((await boards.items(id)).map((item) => item.productId)).toEqual([products[3], products[0], products[1], products[2]]);
    await boards.move(id, added[3]!.id, 99);
    expect((await boards.items(id)).map((item) => item.productId)).toEqual([products[0], products[1], products[2], products[3]]);
    const removed = await boards.remove(id, added[1]!.id);
    expect(removed?.productId).toBe(products[1]);
    expect((await boards.items(id)).map((item) => item.position)).toEqual([0, 1, 2]);
    expect(await boards.update(id, added[0]!.id, { quantity: 2, note: "for the window" })).toMatchObject({ quantity: 2, note: "for the window" });
    expect(await boards.update(id, added[0]!.id, { note: "" })).toMatchObject({ quantity: 2, note: null });
    // A piece of another board is not this board's to change.
    const other = await boards.create(OWNER, "Other");
    if (!other.ok) throw new Error("unreachable");
    expect(await boards.update(other.board.id, added[0]!.id, { quantity: 5 })).toBeNull();
  });

  it("moves new links on, and gives a guest's boards to their account on sign-in", async () => {
    const created = await boards.create("guest:boards-test-guest", "Before signing in");
    if (!created.ok) throw new Error("unreachable");
    expect(await boards.newLinks(created.board.id)).toBe(2);
    expect(await boards.adopt("guest:boards-test-guest", OWNER)).toBe(1);
    expect((await boards.byId(created.board.id))?.ownerKey).toBe(OWNER);
  });
});
