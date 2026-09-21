/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for photographs and try-ons: who may see one, what expires, and what goes with it.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";
import { photoExpiry, photoKey, PHOTO_TTL_HOURS, tryOnKey } from "@/lib/photos/photos";
import { createPhotoStore } from "@/lib/photos/store";

const url = process.env.DATABASE_URL;
const HOUR = 60 * 60 * 1000;

describe.skipIf(url === undefined || url === "")("photographs", () => {
  let connection: ReturnType<typeof postgres>;
  let photos: ReturnType<typeof createPhotoStore>;
  const shopper = "guest:01a0-test-shopper";
  const someoneElse = "guest:01a0-test-stranger";
  const now = new Date("2026-09-21T10:00:00Z");

  const give = async (actorKey = shopper, at = now) => {
    const id = uuidv7();
    return photos.record(
      { kind: "try_on", actorKey, userId: null, storageKey: photoKey(id), contentType: "image/webp", bytes: 40_000, width: 900, height: 1200 },
      at,
    );
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    await migrate(drizzle(connection, { schema }), { migrationsFolder: "./drizzle" });
    photos = createPhotoStore(connection);
  });

  beforeEach(async () => {
    await connection`TRUNCATE uploads CASCADE`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("records a photograph with a day to live", async () => {
    const photo = await give();
    expect(photo.expiresAt.getTime() - now.getTime()).toBe(PHOTO_TTL_HOURS * HOUR);
    expect(photo.storageKey).toBe(photoKey(photo.id));
    // The key is the id and nothing else: it names no shopper and no content.
    expect(photo.storageKey).not.toContain(shopper);
  });

  it("is only ever shown to the shopper who gave it", async () => {
    const photo = await give();
    expect(await photos.byId(photo.id, shopper)).not.toBeNull();
    expect(await photos.byId(photo.id, someoneElse)).toBeNull();
    expect(await photos.forActor(someoneElse)).toEqual([]);
  });

  it("counts what a shopper is holding, and forgets what they deleted", async () => {
    await give();
    const second = await give();
    expect(await photos.countForActor(shopper)).toBe(2);

    expect(await photos.deleteOwn(second.id, someoneElse)).toBeNull();
    expect(await photos.deleteOwn(second.id, shopper)).not.toBeNull();
    expect(await photos.countForActor(shopper)).toBe(1);
    expect(await photos.byId(second.id, shopper)).toBeNull();
  });

  it("finds what is past its day, with the results made from it", async () => {
    const old = await give(shopper, new Date(now.getTime() - 30 * HOUR));
    const fresh = await give(shopper, now);
    const tryOnId = await photos.startTryOn(
      { uploadId: old.id, productId: null, variantId: null, actorKey: shopper, provider: "drawn", model: "vitrine-drawn-composite", expiresAt: old.expiresAt },
      new Date(now.getTime() - 29 * HOUR),
    );
    await photos.markTryOn(tryOnId, { status: "done", resultKey: tryOnKey(tryOnId) });

    const { photos: expired, results } = await photos.expired(now);
    expect(expired.map((photo) => photo.id)).toEqual([old.id]);
    expect(results).toEqual([tryOnKey(tryOnId)]);
    expect(expired.map((photo) => photo.id)).not.toContain(fresh.id);

    // Marked gone, so the next sweep leaves them alone.
    expect(await photos.markDeleted(expired.map((photo) => photo.id))).toBe(1);
    expect((await photos.expired(now)).photos).toEqual([]);
  });

  it("keeps a try-on with its photograph, and loses it with it", async () => {
    const photo = await give();
    const id = await photos.startTryOn(
      { uploadId: photo.id, productId: null, variantId: null, actorKey: shopper, provider: "drawn", model: "vitrine-drawn-composite", expiresAt: photo.expiresAt },
      now,
    );

    expect(await photos.tryOnById(id, shopper)).toMatchObject({ status: "queued", provider: "drawn" });
    expect(await photos.tryOnById(id, someoneElse)).toBeNull();

    await photos.markTryOn(id, { status: "done", resultKey: tryOnKey(id), costMicros: 0 });
    expect(await photos.tryOnById(id, shopper)).toMatchObject({ status: "done", resultKey: tryOnKey(id), costMicros: 0 });
    expect((await photos.tryOnsForActor(shopper)).map((tryOn) => tryOn.id)).toEqual([id]);

    // The row goes with the photograph: a picture of a person is not kept apart from it.
    await connection`DELETE FROM uploads WHERE id = ${photo.id}`;
    expect(await photos.tryOnById(id, shopper)).toBeNull();
  });

  it("remembers why a try-on failed, so the page can say so", async () => {
    const photo = await give();
    const id = await photos.startTryOn(
      { uploadId: photo.id, productId: null, variantId: null, actorKey: shopper, provider: "fashn", model: "tryon-v1.6", expiresAt: photoExpiry(now) },
      now,
    );
    await photos.markTryOn(id, { status: "failed", failureReason: "moderation" });
    expect(await photos.tryOnById(id, shopper)).toMatchObject({ status: "failed", failureReason: "moderation", resultKey: null });
  });
});
