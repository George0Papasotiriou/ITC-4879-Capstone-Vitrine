/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for offering a 3D scan only when its file is in storage.
 */

import { describe, expect, it } from "vitest";

import { createStoredModelCheck } from "@/lib/catalog/stored-model";

const scan = { src: "/media/catalog/abo-3d/b016id2v5o.glb", bytes: 1200 };

function storage(present: Set<string>) {
  const asked: string[] = [];
  return {
    asked,
    files: async () => ({
      exists: async (key: string) => {
        asked.push(key);
        return present.has(key);
      },
    }),
  };
}

describe("createStoredModelCheck", () => {
  it("offers the scan when its file is there, and the stand-in when it is not", async () => {
    const there = storage(new Set(["catalog/abo-3d/b016id2v5o.glb"]));
    expect(await createStoredModelCheck(there.files)(scan)).toEqual(scan);
    const missing = storage(new Set());
    expect(await createStoredModelCheck(missing.files)(scan)).toBeNull();
  });

  it("asks storage once per key for a few minutes, then again", async () => {
    let clock = 0;
    const store = storage(new Set(["catalog/abo-3d/b016id2v5o.glb"]));
    const check = createStoredModelCheck(store.files, () => clock);
    await check(scan);
    await check(scan);
    expect(store.asked).toHaveLength(1);
    clock += 6 * 60_000;
    await check(scan);
    expect(store.asked).toHaveLength(2);
  });

  it("offers nothing that is not in the shop's own storage, and nothing when storage cannot be reached", async () => {
    const store = storage(new Set());
    expect(await createStoredModelCheck(store.files)({ src: "https://elsewhere.example/x.glb", bytes: null })).toBeNull();
    expect(store.asked).toHaveLength(0);
    const broken = createStoredModelCheck(async () => ({ exists: async () => Promise.reject(new Error("down")) }));
    expect(await broken(scan)).toBeNull();
    expect(await createStoredModelCheck(store.files)(null)).toBeNull();
  });
});
