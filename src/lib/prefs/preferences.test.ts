/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for personal preferences: changes, merging a guest's into an account, sizes by garment, and whether a piece fits a room.
 */

import { describe, expect, it } from "vitest";

import { applyPatch, EMPTY_PREFERENCES, isEmpty, mergePreferences, preferencesPatchSchema, preferencesSchema, fitsYourSpace, preferredSize, roomFits, sizeGroupOf, undoPatch, withTaste } from "@/lib/prefs/preferences";

const living = { name: "Living room", wallCm: 240, depthCm: 400 };

describe("personal preferences", () => {
  it("starts empty, and fills from what the shopper says", () => {
    expect(isEmpty(EMPTY_PREFERENCES)).toBe(true);
    const next = applyPatch(EMPTY_PREFERENCES, { sizes: { upper: "M" }, rooms: [living], budgetEuros: 400 });
    expect(next.sizes).toEqual({ upper: "M" });
    expect(next.rooms).toEqual([living]);
    expect(next.budgetEuros).toBe(400);
    expect(isEmpty(next)).toBe(false);
  });

  it("removes a size or the budget when told null, and leaves the rest alone", () => {
    const set = applyPatch(EMPTY_PREFERENCES, { sizes: { upper: "M", lower: "L" }, budgetEuros: 400 });
    const next = applyPatch(set, { sizes: { upper: null }, budgetEuros: null });
    expect(next.sizes).toEqual({ lower: "L" });
    expect(next.budgetEuros).toBeNull();
  });

  it("never likes and avoids the same thing: the latest word wins", () => {
    const liked = applyPatch(EMPTY_PREFERENCES, { like: { colors: ["green", "oak"] } });
    const avoided = applyPatch(liked, { avoid: { colors: ["green"] } });
    expect(avoided.like.colors).toEqual(["oak"]);
    expect(avoided.avoid.colors).toEqual(["green"]);
    const likedAgain = applyPatch(avoided, { like: { colors: ["oak", "green"] } });
    expect(likedAgain.avoid.colors).toEqual([]);
  });

  it("keeps words clean and refuses what is not a preference", () => {
    expect(preferencesPatchSchema.safeParse({ like: { colors: ["  Green "] } }).data?.like?.colors).toEqual(["green"]);
    expect(preferencesPatchSchema.safeParse({ like: { colors: ["<script>"] } }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ sizes: { upper: "XXXL" } }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ address: "Ermou 10" }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ rooms: Array.from({ length: 6 }, () => living) }).success).toBe(false);
  });

  it("carries a guest's preferences into the account without losing either side", () => {
    const device = applyPatch(EMPTY_PREFERENCES, { sizes: { upper: "S", dress: "M" }, rooms: [living, { name: "Study", wallCm: 180 }], like: { colors: ["green"] }, budgetEuros: 300 });
    const account = applyPatch(EMPTY_PREFERENCES, { sizes: { upper: "M" }, rooms: [{ name: "living ROOM", wallCm: 300 }], like: { colors: ["oak"] }, avoid: { colors: ["green"] } });
    const merged = mergePreferences(device, account);
    // The account wins where both say something.
    expect(merged.sizes).toEqual({ upper: "M", dress: "M" });
    expect(merged.rooms.map((room) => room.name)).toEqual(["living ROOM", "Study"]);
    expect(merged.budgetEuros).toBe(300);
    // Liked on the device, avoided on the account: liked is joined, and the clash resolves one way.
    expect(merged.like.colors.includes("green") && merged.avoid.colors.includes("green")).toBe(false);
    expect(preferencesSchema.safeParse(merged).success).toBe(true);
  });

  it("undoes a change by putting back exactly what it changed", () => {
    const before = applyPatch(EMPTY_PREFERENCES, { sizes: { lower: "L" }, like: { colors: ["oak"] }, budgetEuros: 300 });
    const patch = { sizes: { upper: "M" as const, lower: "S" as const }, like: { colors: ["green"] }, budgetEuros: null };
    const after = applyPatch(before, patch);
    const undone = applyPatch(after, undoPatch(before, patch));
    expect(undone).toEqual(before);
  });

  it("starts the size picker at the shopper's size for that kind of garment", () => {
    const prefs = applyPatch(EMPTY_PREFERENCES, { sizes: { upper: "M", lower: "L" } });
    expect(sizeGroupOf("KNIT")).toBe("upper");
    expect(preferredSize(prefs, "COAT")).toBe("M");
    expect(preferredSize(prefs, "TROUSERS")).toBe("L");
    expect(preferredSize(prefs, "DRESS")).toBeNull();
    expect(preferredSize(prefs, "sofa")).toBeNull();
  });

  it("leaves out what the shopper avoids and brings forward what they like, keeping the rest in order", () => {
    const items = ["a", "b", "c", "d"].map((productId) => ({ productId }));
    const features = new Map([
      ["a", { colors: ["black"], materials: ["metal"] }],
      ["b", { colors: ["green"], materials: ["velvet"] }],
      ["c", { colors: ["white"], materials: ["oak"] }],
      ["d", { colors: ["green"], materials: ["oak"] }],
    ]);
    const prefs = applyPatch(EMPTY_PREFERENCES, { like: { colors: ["green"], materials: ["oak"] }, avoid: { materials: ["velvet"] } });
    expect(withTaste(items, features, prefs).map((item) => item.productId)).toEqual(["d", "c", "a"]);
    // With nothing said, nothing changes.
    expect(withTaste(items, features, EMPTY_PREFERENCES).map((item) => item.productId)).toEqual(["a", "b", "c", "d"]);
  });

  it("says whether a piece fits each room, leaving room to walk past", () => {
    const rooms = [living, { name: "Hall", wallCm: 150 }, { name: "Nook", wallCm: 400, depthCm: 60 }];
    expect(roomFits({ w: 220, d: 95, h: 80 }, rooms)).toEqual([
      { room: "Living room", wallCm: 240, fits: true, spareCm: 0 },
      { room: "Hall", wallCm: 150, fits: false, spareCm: -90 },
      // Wide enough, but too deep for the nook.
      { room: "Nook", wallCm: 400, fits: false, spareCm: 160 },
    ]);
    expect(roomFits({ w: 221, d: 95, h: 80 }, [living])[0]!.fits).toBe(false);
    // A lamp is not a question of walls, and a piece without measurements is not judged.
    expect(roomFits({ w: 25, d: 25, h: 60 }, rooms)).toEqual([]);
    expect(roomFits(null, rooms)).toEqual([]);
  });
});

describe("fitsYourSpace", () => {
  const living = { name: "Living room", wallCm: 240 };
  const study = { name: "Study", wallCm: 120, depthCm: 50 };
  const piece = (productId: string, category: string, w: number, d = 40) => ({ productId, category, dims: { w, d, h: 80 } });

  it("keeps pieces that fit a room, naming the first of the shopper's rooms they fit and the room left", () => {
    const result = fitsYourSpace([piece("sofa", "seating", 230), piece("desk", "tables", 100), piece("sideboard", "storage", 180, 45)], [study, living]);
    // The sofa is too wide for either wall with clearance; the desk fits the study first; the sideboard only the living room.
    expect(result).toEqual([
      { productId: "desk", room: "Study", spareCm: 0 },
      { productId: "sideboard", room: "Living room", spareCm: 40 },
    ]);
  });

  it("respects the room's depth, leaves out narrow pieces, and takes at most two per category", () => {
    const deep = piece("deep-desk", "tables", 90, 70);
    expect(fitsYourSpace([deep], [study])).toEqual([]);
    expect(fitsYourSpace([piece("stool", "seating", 45)], [living])).toEqual([]);
    const tables = [piece("t1", "tables", 100), piece("t2", "tables", 110), piece("t3", "tables", 120), piece("c1", "storage", 90)];
    expect(fitsYourSpace(tables, [living]).map((entry) => entry.productId)).toEqual(["t1", "t2", "c1"]);
    expect(fitsYourSpace(tables, [living], 2)).toHaveLength(2);
  });

  it("has nothing to say without rooms", () => {
    expect(fitsYourSpace([piece("desk", "tables", 100)], [])).toEqual([]);
  });
});
