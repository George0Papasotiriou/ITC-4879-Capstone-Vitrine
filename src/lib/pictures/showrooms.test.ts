/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the showroom rooms: made once at 4K, stored with their tile, and found again by the product page.
 */

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import type { ModelEntry, Usage } from "@/lib/ai/models";
import { FIXTURE_MODEL, type ImageMaker } from "@/lib/pictures/makers";
import { showroomFiles } from "@/lib/pictures/pictures";
import { forgetShowroomTiles, madeShowrooms, makeShowroom, SHOWROOMS, showroomTiles } from "@/lib/pictures/showrooms";
import type { StorageDriver } from "@/lib/storage/types";

/** Storage in a Map: enough for what the showrooms read and write. */
function memoryStorage(): StorageDriver & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    kind: "local",
    objects,
    presignedUploadUrl: async () => "",
    presignedDownloadUrl: async () => "",
    putObject: async ({ key, body, contentType }) => void objects.set(key, { body, contentType }),
    exists: async (key) => objects.has(key),
    getObject: async (key) => objects.get(key) ?? null,
    deleteObject: async (key) => void objects.delete(key),
    check: async () => ({ location: "memory" }),
  };
}

afterEach(() => forgetShowroomTiles());

describe("showrooms (docs/adr/060)", () => {
  it("are sixteen: four styles of four rooms", () => {
    expect(SHOWROOMS).toHaveLength(16);
    expect(new Set(SHOWROOMS.map((entry) => `${entry.style}-${entry.room}`)).size).toBe(16);
  });

  it("are made at 4K, 4:3, from words alone, and stored as a full-size JPEG with a 640 px tile", async () => {
    const files = memoryStorage();
    const asked: { prompt: string; images: number; size: string; aspectRatio: string }[] = [];
    const spent: { entry: ModelEntry; usage: Usage }[] = [];
    const maker: ImageMaker = {
      entry: FIXTURE_MODEL,
      async make({ prompt, images, size, aspectRatio }) {
        asked.push({ prompt, images: images.length, size, aspectRatio });
        const bytes = await sharp({ create: { width: 4096, height: 3072, channels: 3, background: "#d8cbb5" } }).jpeg().toBuffer();
        return { ok: true, image: { bytes: new Uint8Array(bytes), contentType: "image/jpeg" }, usage: { units: 1, outputTokens: 900 } };
      },
    };
    const made = await makeShowroom({ maker, files, spend: async (entry, usage) => void spent.push({ entry, usage }) }, { style: "scandinavian", room: "bedroom" });
    expect(made.ok).toBe(true);
    expect(asked).toEqual([{ prompt: expect.stringContaining("a bedroom"), images: 0, size: "4K", aspectRatio: "4:3" }]);
    expect(spent).toEqual([{ entry: FIXTURE_MODEL, usage: { units: 1, outputTokens: 900 } }]);

    const keys = showroomFiles("scandinavian", "bedroom");
    const original = await sharp(Buffer.from(files.objects.get(keys.original)!.body)).metadata();
    const tile = await sharp(Buffer.from(files.objects.get(keys.tile)!.body)).metadata();
    expect([original.format, original.width, original.height]).toEqual(["jpeg", 4096, 3072]);
    expect([tile.format, tile.width, tile.height]).toEqual(["webp", 640, 480]);
    expect(await madeShowrooms(files)).toEqual([{ style: "scandinavian", room: "bedroom" }]);
  });

  it("records the cost of a refusal too, and stores nothing", async () => {
    const files = memoryStorage();
    const spent: Usage[] = [];
    const maker: ImageMaker = { entry: FIXTURE_MODEL, make: async () => ({ ok: false, reason: "model_refused", usage: { units: 0, inputTokens: 300 } }) };
    expect(await makeShowroom({ maker, files, spend: async (_entry, usage) => void spent.push(usage) }, { style: "dark-moody", room: "office" })).toEqual({ ok: false, reason: "model_refused", usage: { units: 0, inputTokens: 300 } });
    expect(spent).toEqual([{ units: 0, inputTokens: 300 }]);
    expect(files.objects.size).toBe(0);
  });

  it("gives the product page each style's tile for a room, looking at storage once every ten minutes", async () => {
    const files = memoryStorage();
    const put = (style: "warm-minimal" | "mediterranean", room: "living" | "dining") => files.putObject({ key: showroomFiles(style, room).original, body: new Uint8Array([1]), contentType: "image/jpeg" });
    await put("warm-minimal", "living");
    await put("mediterranean", "dining");
    const now = 1_000_000;
    expect(await showroomTiles(files, "living", now)).toEqual({ "warm-minimal": `/media/${showroomFiles("warm-minimal", "living").tile}` });
    expect(await showroomTiles(files, "dining", now)).toEqual({ mediterranean: `/media/${showroomFiles("mediterranean", "dining").tile}` });
    // A room made a moment later is seen after ten minutes, or at once once the cache is told.
    await put("mediterranean", "living");
    expect(Object.keys(await showroomTiles(files, "living", now + 60_000))).toEqual(["warm-minimal"]);
    expect(Object.keys(await showroomTiles(files, "living", now + 11 * 60_000))).toEqual(["warm-minimal", "mediterranean"]);
  });
});
