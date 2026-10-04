/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the piece's photographs as the image model gets them: which, in what order, how large, and the close crop.
 */

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { chooseReferenceMedia, detailCrop, MAX_REFERENCES, prepareImage, type MediaRow } from "@/lib/pictures/studio";

const row = (src: string, position: number, whiteGround = false, kind = "image"): MediaRow => ({ src, position, whiteGround, kind });

describe("chooseReferenceMedia (docs/adr/060)", () => {
  it("shows the studio shots on white first, then the others, in the listing's order, at most three, each once", () => {
    const media = [row("/a-room.jpg", 0), row("/b-white.jpg", 2, true), row("/c-white.jpg", 1, true), row("/d-spin.jpg", 0, false, "spin"), row("/b-white.jpg", 5, true), row("/e.jpg", 3), row("/f.jpg", 4)];
    expect(chooseReferenceMedia(media).map((entry) => entry.src)).toEqual(["/c-white.jpg", "/b-white.jpg", "/a-room.jpg"]);
    expect(MAX_REFERENCES).toBe(3);
    expect(chooseReferenceMedia(media, 5).map((entry) => entry.src)).toEqual(["/c-white.jpg", "/b-white.jpg", "/a-room.jpg", "/e.jpg", "/f.jpg"]);
    expect(chooseReferenceMedia([row("/spin.jpg", 0, true, "spin")])).toEqual([]);
  });
});

describe("prepareImage", () => {
  it("sends a photograph upright, at most the size the model reads, as a JPEG without its metadata", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#777" } })
      .withMetadata({ orientation: 6 })
      .png()
      .toBuffer();
    const ready = await prepareImage({ bytes: new Uint8Array(big), contentType: "image/png" });
    const meta = await sharp(Buffer.from(ready!.bytes)).metadata();
    // Orientation 6 turns the 4000 × 3000 picture upright: 3000 wide, 4000 high, then fitted in 1536.
    expect([meta.format, meta.width, meta.height, meta.orientation]).toEqual(["jpeg", 1152, 1536, undefined]);
    expect(await prepareImage({ bytes: new Uint8Array([0, 1, 2]), contentType: "image/jpeg" })).toBeNull();
  });
});

describe("detailCrop", () => {
  it("crops a studio photograph tight around the piece, with a margin, enlarged to fill the frame", async () => {
    // A white studio frame, 2000 × 1500, with a dark 400 × 300 piece standing in it.
    const studio = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#ffffff" } })
      .composite([{ input: await sharp({ create: { width: 400, height: 300, channels: 3, background: "#5a3d2b" } }).png().toBuffer(), left: 800, top: 900 }])
      .jpeg({ quality: 95 })
      .toBuffer();
    const crop = await detailCrop({ bytes: new Uint8Array(studio), contentType: "image/jpeg" });
    expect(crop).not.toBeNull();
    const meta = await sharp(Buffer.from(crop!.bytes)).metadata();
    expect(meta.format).toBe("jpeg");
    // The piece is 4:3; the margin keeps it about 4:3, filling a 1536 px frame.
    expect(meta.width).toBe(1536);
    expect(meta.height! / meta.width!).toBeGreaterThan(0.7);
    expect(meta.height! / meta.width!).toBeLessThan(0.85);
    // Its middle is the piece, its corner the white margin.
    const { data, info } = await sharp(Buffer.from(crop!.bytes)).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => data[(y * info.width + x) * info.channels]!;
    expect(at(info.width / 2, info.height / 2)).toBeLessThan(120);
    expect(at(4, 4)).toBeGreaterThan(235);
  });

  it("gives nothing when the photograph is not on white, or the piece already fills it", async () => {
    const room = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#6b5a48" } }).jpeg().toBuffer();
    expect(await detailCrop({ bytes: new Uint8Array(room), contentType: "image/jpeg" })).toBeNull();
  });
});
