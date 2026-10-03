/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for AI pictures against PostgreSQL: the day's allowance, scenes made once for everyone, and whose picture is whose.
 */

import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { catalogFixtureSchema } from "@/lib/catalog/input";
import { upsertCatalog } from "@/lib/catalog/write";
import * as schema from "@/lib/db/schema";
import { photoKey } from "@/lib/photos/photos";
import { createPhotoStore } from "@/lib/photos/store";
import { pictureKey } from "@/lib/pictures/pictures";
import { createPictureStore } from "@/lib/pictures/store";

const url = process.env.DATABASE_URL;
const SOFA = "canova-3-seater-maxi-b07g2h3l4l";
const guest = { key: "guest:pictures-test-guest", kind: "guest" as const };
const customer = { key: "user:pictures-test-customer", kind: "customer" as const };
const stranger = { key: "guest:pictures-test-stranger", kind: "guest" as const };

describe.skipIf(url === undefined || url === "")("AI pictures", () => {
  let connection: ReturnType<typeof postgres>;
  let pictures: ReturnType<typeof createPictureStore>;
  let photos: ReturnType<typeof createPhotoStore>;
  let productId: string;
  const scene = (style: "warm-minimal" | "scandinavian" | "dark-moody" | "mediterranean", actor: { key: string; kind: "guest" | "customer" } = customer) =>
    pictures.start({ kind: "scene", productId, style, uploadId: null, actor, provider: "drawn", model: "vitrine-drawn-picture", expiresAt: null });

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    await upsertCatalog(db, catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/specimen.json", "utf8"))).products);
    productId = (await connection<{ id: string }[]>`SELECT id FROM products WHERE slug = ${SOFA}`)[0]!.id;
    pictures = createPictureStore(connection);
    photos = createPhotoStore(connection);
  });

  beforeEach(async () => {
    await connection`DELETE FROM pictures WHERE actor_key LIKE '%pictures-test%' OR (kind = 'scene' AND product_id = ${productId})`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("lets a guest make one picture a day and an account three, counting failed ones out", async () => {
    expect(await pictures.left(guest)).toBe(1);
    const first = await scene("warm-minimal", guest);
    expect(first).toMatchObject({ ok: true, made: true });
    expect(await scene("scandinavian", guest)).toEqual({ ok: false, reason: "allowance" });
    expect(await pictures.left(guest)).toBe(0);

    // A picture that failed was never made: the shopper gets the go back.
    if (!first.ok) throw new Error("unreachable");
    await pictures.mark(first.picture.id, { status: "failed", failureReason: "model_refused" });
    expect(await pictures.left(guest)).toBe(1);

    for (const style of ["warm-minimal", "scandinavian", "dark-moody"] as const) expect(await scene(style, customer)).toMatchObject({ ok: true });
    expect(await scene("mediterranean", customer)).toEqual({ ok: false, reason: "allowance" });
  });

  it("makes a scene once: the next shopper gets it at once, free, without using their allowance", async () => {
    const made = await scene("dark-moody", customer);
    if (!made.ok) throw new Error("unreachable");
    expect(made.made).toBe(true);

    const again = await scene("dark-moody", guest);
    expect(again).toMatchObject({ ok: true, made: false });
    if (!again.ok) throw new Error("unreachable");
    expect(again.picture.id).toBe(made.picture.id);
    expect(await pictures.left(guest)).toBe(1);

    await pictures.mark(made.picture.id, { status: "done", resultKey: "catalog/scenes/x.webp", costMicros: 67_000 });
    expect((await pictures.scenesOf(productId)).map((picture) => picture.style)).toEqual(["dark-moody"]);
    // Anyone may look at a scene.
    expect(await pictures.view(made.picture.id, null)).not.toBeNull();
  });

  it("refuses a second scene for the same piece and style even when two arrive together", async () => {
    const [a, b] = await Promise.all([scene("mediterranean", customer), scene("mediterranean", guest)]);
    const made = [a, b].filter((result) => result.ok && result.made);
    expect(made).toHaveLength(1);
    const ids = new Set([a, b].map((result) => (result.ok ? result.picture.id : null)));
    expect(ids.size).toBe(1);
  });

  it("shows a shopper's own room picture to them alone, and not after its day", async () => {
    const id = uuidv7();
    const upload = await photos.record({ kind: "room", actorKey: customer.key, userId: null, storageKey: photoKey(id), contentType: "image/webp", bytes: 40_000, width: 1600, height: 1200 });
    const started = await pictures.start({ kind: "quick", productId, style: null, uploadId: upload.id, actor: customer, provider: "drawn", model: "vitrine-drawn-picture", expiresAt: upload.expiresAt });
    if (!started.ok) throw new Error("unreachable");
    expect(await pictures.view(started.picture.id, customer.key)).not.toBeNull();
    expect(await pictures.view(started.picture.id, stranger.key)).toBeNull();
    expect(await pictures.view(started.picture.id, null)).toBeNull();
    expect(await pictures.view(started.picture.id, customer.key, new Date(Date.now() + 25 * 60 * 60 * 1000))).toBeNull();

    // When the photograph's day is up, the expiry job finds the picture made from it and deletes it too.
    await pictures.mark(started.picture.id, { status: "done", resultKey: pictureKey(started.picture.id) });
    const { results } = await photos.expired(new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(results).toContain(pictureKey(started.picture.id));
  });

  it("will not store a scene without a style, or a shopper's picture without their photograph", async () => {
    await expect(connection`INSERT INTO pictures (id, kind, product_id, actor_key, provider, model) VALUES (${uuidv7()}, 'scene', ${productId}, 'guest:pictures-test-x', 'drawn', 'm')`).rejects.toThrow();
    await expect(connection`INSERT INTO pictures (id, kind, product_id, actor_key, provider, model) VALUES (${uuidv7()}, 'quick', ${productId}, 'guest:pictures-test-x', 'drawn', 'm')`).rejects.toThrow();
  });
});
