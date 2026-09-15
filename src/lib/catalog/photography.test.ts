/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for white-ground detection and web master image processing.
 */

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { catalogImageKey, hasWhiteGround, isWhiteGround, MASTER_EDGE, webMaster } from "@/lib/catalog/photography";
import { isValidKey } from "@/lib/storage/signing";

/** A square image: a background colour with a centred block of another colour. */
async function picture(background: string, object: string, objectShare = 0.5, size = 400): Promise<Buffer> {
  const inner = Math.round(size * objectShare);
  const block = await sharp({ create: { width: inner, height: inner, channels: 3, background: object } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background } })
    .composite([{ input: block, gravity: "centre" }])
    .jpeg()
    .toBuffer();
}

describe("white ground check", () => {
  it("accepts a product on a white studio ground", async () => {
    expect(await hasWhiteGround(await picture("#ffffff", "#5b4636"))).toBe(true);
  });

  it("rejects a product on a coloured or grey background", async () => {
    expect(await hasWhiteGround(await picture("#d9cbb8", "#5b4636"))).toBe(false);
    expect(await hasWhiteGround(await picture("#c8c8c8", "#222222"))).toBe(false);
  });

  it("accepts a wide product that touches part of the frame edge", async () => {
    const size = 48;
    const rgb = new Uint8Array(size * size * 3).fill(255);
    // A dark band across the middle rows, reaching both side edges.
    for (let y = 20; y < 26; y += 1) {
      for (let x = 0; x < size; x += 1) rgb.fill(40, (y * size + x) * 3, (y * size + x) * 3 + 3);
    }
    expect(isWhiteGround(rgb, size)).toBe(true);
  });

  it("rejects a pale but tinted full-bleed photograph", () => {
    const size = 48;
    const rgb = new Uint8Array(size * size * 3);
    for (let i = 0; i < rgb.length; i += 3) rgb.set([250, 236, 222], i);
    expect(isWhiteGround(rgb, size)).toBe(false);
  });
});

describe("webMaster", () => {
  it("produces a WebP no larger than the master edge, keeping the aspect ratio", async () => {
    const wide = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    const master = await webMaster(wide);
    expect(master.width).toBe(MASTER_EDGE);
    expect(master.height).toBe(MASTER_EDGE / 2);
    expect((await sharp(master.body).metadata()).format).toBe("webp");
  });

  it("never enlarges a small image", async () => {
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const master = await webMaster(small);
    expect([master.width, master.height]).toEqual([300, 200]);
  });
});

describe("catalogImageKey", () => {
  it("makes valid, stable storage keys from any source image id", () => {
    const key = catalogImageKey("abo", "B07B4YVDLQ", "71T+bO0FkKL");
    expect(key).toMatch(/^catalog\/abo\/b07b4yvdlq\/[0-9a-f]{16}\.webp$/);
    expect(isValidKey(key)).toBe(true);
    expect(catalogImageKey("abo", "B07B4YVDLQ", "71T+bO0FkKL")).toBe(key);
    expect(catalogImageKey("abo", "B07B4YVDLQ", "81hmIvQwu8L")).not.toBe(key);
  });
});
