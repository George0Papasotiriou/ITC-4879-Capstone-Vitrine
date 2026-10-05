/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the try-on engines, FASHN's credit tables, the model-shot briefs, and outfits put on in dressing order.
 */

import { describe, expect, it } from "vitest";

import { canAnimate, studioMode } from "@/lib/fitting/driver";
import { fashnCredits, isWearable, planOutfit, slotOf, tryOnCall, tryOnEngine } from "@/lib/fitting/engines";
import { isModelPreset, MODEL_PRESETS, modelShotPrompt } from "@/lib/fitting/presets";

describe("which engine tries a piece on (docs/adr/063)", () => {
  it("sends clothes to the shop's chosen engine and everything else to Try-On Max", () => {
    expect(tryOnEngine("SHIRT")).toBe("v1.6");
    expect(tryOnEngine("DRESS", "max")).toBe("max");
    for (const kind of ["SHOES", "BOOT", "HANDBAG", "HAT", "EARRING", "NECKLACE"]) expect(tryOnEngine(kind)).toBe("max");
    expect(isWearable("SOFA")).toBe(false);
    expect(isWearable("SANDAL")).toBe(true);
  });

  it("charges what FASHN's tables say", () => {
    expect(fashnCredits({ model: "tryon-v1.6" })).toBe(1);
    expect(fashnCredits({ model: "tryon-max", mode: "balanced", resolution: "1k" })).toBe(2);
    expect(fashnCredits({ model: "tryon-max", mode: "quality", resolution: "4k", images: 2 })).toBe(10);
    expect(fashnCredits({ model: "product-to-model", mode: "fast", resolution: "1k", faceReference: true })).toBe(4);
    expect(fashnCredits({ model: "image-to-video", seconds: 5, resolution: "480p" })).toBe(1);
    expect(fashnCredits({ model: "image-to-video", seconds: 10, resolution: "1080p" })).toBe(12);
    expect(tryOnCall("HANDBAG")).toEqual({ model: "tryon-max", mode: "balanced", resolution: "1k" });
    expect(tryOnCall("TOP")).toEqual({ model: "tryon-v1.6" });
  });
});

describe("planOutfit", () => {
  it("puts an outfit on as a person dresses: what covers the body, what goes over it, then shoes, bag and jewellery", () => {
    const plan = planOutfit([
      { id: "boots", kind: "BOOT" },
      { id: "jacket", kind: "JACKET" },
      { id: "jeans", kind: "TROUSERS" },
      { id: "shirt", kind: "SHIRT" },
    ]);
    expect(plan).toEqual({ ok: true, pieces: [{ id: "jeans", kind: "TROUSERS" }, { id: "shirt", kind: "SHIRT" }, { id: "jacket", kind: "JACKET" }, { id: "boots", kind: "BOOT" }] });
    expect(planOutfit([{ id: "bag", kind: "HANDBAG" }, { id: "dress", kind: "DRESS" }])).toMatchObject({ ok: true, pieces: [{ id: "dress" }, { id: "bag" }] });
  });

  it("refuses what cannot be put on together, and says why", () => {
    expect(planOutfit([{ id: "a", kind: "SHIRT" }])).toEqual({ ok: false, reason: "too_few" });
    expect(planOutfit(["TOP", "TROUSERS", "BOOT", "HANDBAG", "HAT"].map((kind, index) => ({ id: String(index), kind })))).toEqual({ ok: false, reason: "too_many" });
    expect(planOutfit([{ id: "a", kind: "SHIRT" }, { id: "b", kind: "KNIT" }])).toEqual({ ok: false, reason: "same_slot" });
    expect(planOutfit([{ id: "a", kind: "DRESS" }, { id: "b", kind: "SKIRT" }])).toEqual({ ok: false, reason: "dress_and_separates" });
    expect(planOutfit([{ id: "a", kind: "SHIRT" }, { id: "b", kind: "SOFA" }])).toEqual({ ok: false, reason: "not_wearable" });
    expect(slotOf("EARRING")).toBe("accessory");
    expect(slotOf("LAMP")).toBeNull();
  });
});

describe("the model-shot briefs", () => {
  it("names the build and skin tone picked, dresses men's pieces on a man, and frames each kind to show it", () => {
    expect(MODEL_PRESETS).toHaveLength(4);
    expect(isModelPreset("curvy-deep")).toBe(true);
    expect(isModelPreset("anyone")).toBe(false);
    const coat = modelShotPrompt("curvy-deep", "men", "COAT");
    expect(coat).toContain("a man with a broad, heavier build and deep brown skin");
    expect(coat).toContain("full-length");
    expect(modelShotPrompt("curvy-deep", "women", "DRESS")).toContain("a woman with a curvy, fuller build");
    expect(modelShotPrompt("tall-olive", "women", "EARRING")).toContain("head-and-shoulders");
    expect(modelShotPrompt("slim-light", "men", "SHOES")).toContain("the shoes clearly visible");
    // The brief never describes the product: the photograph does.
    expect(modelShotPrompt("average-medium", "women", "SKIRT")).not.toMatch(/skirt/i);
  });
});

describe("which FASHN the shop talks to", () => {
  it("uses the service with a key, the fixture only when asked, and the stand-in otherwise", () => {
    expect(studioMode({ FASHN_PROVIDER: "auto", FASHN_API_KEY: "key" })).toBe("service");
    expect(studioMode({ FASHN_PROVIDER: "auto" })).toBe("drawn");
    expect(studioMode({ FASHN_PROVIDER: "fixture", FASHN_API_KEY: "key" })).toBe("fixture");
    expect(canAnimate("drawn")).toBe(false);
    expect(canAnimate("service")).toBe(true);
  });
});
