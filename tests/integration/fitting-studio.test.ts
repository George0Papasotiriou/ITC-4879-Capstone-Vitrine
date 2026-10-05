/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Integration tests for the Fitting Room's studio against PostgreSQL: outfits as chains of try-ons, videos asked for once, model shots made once for everyone.
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
import { createModelShotStore, modelShotKey } from "@/lib/fitting/shots-store";
import { photoKey, tryOnVideoKey } from "@/lib/photos/photos";
import { createPhotoStore } from "@/lib/photos/store";

/** docs/adr/063. The clothes specimen supplies real garments to try on. */

const url = process.env.DATABASE_URL;
const shopper = "user:01a0-studio-shopper";

describe.skipIf(url === undefined || url === "")("the Fitting Room's studio", () => {
  let connection: ReturnType<typeof postgres>;
  let photos: ReturnType<typeof createPhotoStore>;
  let shots: ReturnType<typeof createModelShotStore>;
  let pieces: string[];

  const give = async () => {
    const id = uuidv7();
    return photos.record({ kind: "try_on", actorKey: shopper, userId: null, storageKey: photoKey(id), contentType: "image/webp", bytes: 40_000, width: 900, height: 1200 }, new Date());
  };

  beforeAll(async () => {
    connection = postgres(url as string, { max: 4, onnotice: () => {} });
    const db = drizzle(connection, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const specimen = catalogFixtureSchema.parse(JSON.parse(await readFile("src/lib/catalog/fixtures/clothes-specimen.json", "utf8"))).products;
    await upsertCatalog(db, specimen);
    pieces = (await connection<{ id: string }[]>`SELECT id FROM products WHERE source = 'amazon' ORDER BY source_id LIMIT 3`).map((row) => row.id);
    photos = createPhotoStore(connection);
    shots = createModelShotStore(connection);
  });

  beforeEach(async () => {
    await connection`TRUNCATE uploads CASCADE`;
    await connection`DELETE FROM model_shots`;
  });

  afterAll(async () => {
    await connection?.end();
  });

  it("keeps an outfit's try-ons together, in the order they are put on", async () => {
    const photo = await give();
    const outfitId = uuidv7();
    const at = new Date();
    // Written out of order on purpose: position decides, not creation.
    for (const [position, productId] of [[2, pieces[2]], [0, pieces[0]], [1, pieces[1]]] as const) {
      await photos.startTryOn({ uploadId: photo.id, productId: productId!, variantId: null, actorKey: shopper, provider: "fixture", model: "tryon-v1.6", expiresAt: photo.expiresAt, outfitId, outfitPosition: position }, at);
    }
    const steps = await photos.outfitSteps(outfitId);
    expect(steps.map((step) => step.outfitPosition)).toEqual([0, 1, 2]);
    expect(steps.map((step) => step.productId)).toEqual(pieces);
    expect(steps.every((step) => step.outfitId === outfitId && step.videoStatus === null)).toBe(true);
  });

  it("asks for a try-on's video only once it is finished, and only once", async () => {
    const photo = await give();
    const id = await photos.startTryOn({ uploadId: photo.id, productId: pieces[0]!, variantId: null, actorKey: shopper, provider: "fixture", model: "tryon-v1.6", expiresAt: photo.expiresAt });
    expect(await photos.requestVideo(id, shopper)).toBe(false);
    await photos.markTryOn(id, { status: "done", resultKey: `photos/try-on/${id}.webp` });
    // Someone else's try-on is not theirs to animate.
    expect(await photos.requestVideo(id, "user:someone-else")).toBe(false);
    expect(await photos.requestVideo(id, shopper)).toBe(true);
    expect(await photos.requestVideo(id, shopper)).toBe(false);

    await photos.markVideo(id, { status: "failed", failure: "ImageLoadError" });
    // A failed video can be asked for again.
    expect(await photos.requestVideo(id, shopper)).toBe(true);
    const key = tryOnVideoKey(id, "video/mp4");
    await photos.markVideo(id, { status: "done", videoKey: key, costMicros: 75_000 });
    const row = await photos.tryOnById(id, shopper);
    expect(row).toMatchObject({ videoStatus: "done", videoKey: key, videoFailure: null });
    expect(key).toBe(`photos/try-on/${id}-move.mp4`);
  });

  it("deletes the video with the photograph when its day is up", async () => {
    const photo = await give();
    const id = await photos.startTryOn({ uploadId: photo.id, productId: pieces[0]!, variantId: null, actorKey: shopper, provider: "fixture", model: "tryon-v1.6", expiresAt: photo.expiresAt });
    await photos.markTryOn(id, { status: "done", resultKey: `photos/try-on/${id}.webp` });
    await photos.markVideo(id, { status: "done", videoKey: tryOnVideoKey(id, "video/webm") });
    const due = await photos.expired(new Date(photo.expiresAt.getTime() + 1_000));
    expect(due.results).toEqual(expect.arrayContaining([`photos/try-on/${id}.webp`, `photos/try-on/${id}-move.webm`]));
  });

  it("makes a model shot once, for everyone, and makes a failed one again", async () => {
    const first = await shots.request({ productId: pieces[0]!, preset: "tall-olive", provider: "fixture", model: "product-to-model", requestedBy: shopper });
    expect(first.created).toBe(true);
    // A second shopper asking for the same piece on the same model gets the same shot, and is not the one charged.
    const second = await shots.request({ productId: pieces[0]!, preset: "tall-olive", provider: "fixture", model: "product-to-model", requestedBy: "guest:another" });
    expect(second).toMatchObject({ created: false, shot: { id: first.shot.id } });
    const [owner] = await connection<{ requested_by: string }[]>`SELECT requested_by FROM model_shots WHERE id = ${first.shot.id}`;
    expect(owner?.requested_by).toBe(shopper);

    await shots.mark(first.shot.id, { status: "failed", failureReason: "ImageLoadError" });
    const again = await shots.request({ productId: pieces[0]!, preset: "tall-olive", provider: "fixture", model: "product-to-model", requestedBy: "guest:another" });
    expect(again).toMatchObject({ created: true, shot: { id: first.shot.id, status: "queued" } });

    await shots.mark(first.shot.id, { status: "done", storageKey: modelShotKey(pieces[0]!, "tall-olive"), costMicros: 150_000 });
    expect(await shots.forProduct(pieces[0]!)).toEqual([expect.objectContaining({ preset: "tall-olive", status: "done", storageKey: `catalog/model-shots/v1/${pieces[0]}-tall-olive.jpg` })]);
    // Another model of the same piece is a shot of its own.
    expect((await shots.request({ productId: pieces[0]!, preset: "slim-light", provider: "fixture", model: "product-to-model", requestedBy: shopper })).created).toBe(true);
  });
});
