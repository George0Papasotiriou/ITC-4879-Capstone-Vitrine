/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for keeping made models: built once, stored under a key that follows the piece, never stored without its photograph.
 */

import { describe, expect, it } from "vitest";

import { madeModelFor, madeModelKey, MADE_PREFIX, type ModelPiece } from "@/lib/catalog/model/serve";

const piece: ModelPiece = {
  slug: "oak-side-table",
  kind: "TABLE",
  title: "Round Oak Side Table",
  attributes: { shape: "Round" },
  materials: ["wood"],
  colors: ["brown"],
  dims: { w: 50, d: 50, h: 55 },
  studio: null,
};

function storage() {
  const stored = new Map<string, Uint8Array>();
  let puts = 0;
  return {
    stored,
    puts: () => puts,
    files: {
      exists: async (key: string) => stored.has(key),
      putObject: async ({ key, body }: { key: string; body: Uint8Array }) => {
        puts += 1;
        stored.set(key, body);
      },
    },
  };
}

describe("madeModelKey", () => {
  it("is a catalogue path, the same for the same piece", () => {
    expect(madeModelKey(piece).startsWith(MADE_PREFIX)).toBe(true);
    expect(madeModelKey(piece)).toBe(madeModelKey({ ...piece }));
  });

  it("changes when the piece is described, measured or photographed differently — and only then", () => {
    const key = madeModelKey(piece);
    expect(madeModelKey({ ...piece, title: "Round Walnut Side Table" })).not.toBe(key);
    expect(madeModelKey({ ...piece, dims: { w: 60, d: 50, h: 55 } })).not.toBe(key);
    expect(madeModelKey({ ...piece, studio: "/products/oak.jpg" })).not.toBe(key);
  });
});

describe("madeModelFor", () => {
  it("builds and stores a model once; the next request finds it stored", async () => {
    const { files, puts, stored } = storage();
    const first = await madeModelFor(piece, { files, photo: async () => null });
    expect(first).toEqual({ key: madeModelKey(piece), stored: false });
    expect(Buffer.from(stored.get(madeModelKey(piece))!.subarray(0, 4)).toString("latin1")).toBe("glTF");
    const second = await madeModelFor(piece, { files, photo: async () => null });
    expect(second).toEqual({ key: madeModelKey(piece), stored: true });
    expect(puts()).toBe(1);
  }, 60_000);

  it("builds once when two shoppers ask at the same moment", async () => {
    const { files, puts } = storage();
    await Promise.all([madeModelFor(piece, { files, photo: async () => null }), madeModelFor(piece, { files, photo: async () => null })]);
    expect(puts()).toBe(1);
  }, 60_000);

  it("serves but does not keep a model whose photograph could not be fetched", async () => {
    const { files, puts } = storage();
    const photographed = { ...piece, studio: "https://example.invalid/oak.jpg" };
    const made = await madeModelFor(photographed, { files, photo: async () => null });
    expect(made.key).toBeNull();
    expect("glb" in made && made.glb.byteLength > 0).toBe(true);
    expect(puts()).toBe(0);
  }, 60_000);

  it("refuses a piece that has no floor to stand on", () => {
    expect(() => madeModelFor({ ...piece, kind: "HOME_MIRROR" }, { files: storage().files, photo: async () => null })).toThrow(RangeError);
  });
});
