/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for AI pricing: token and per-unit costs in millionths of a euro, and unconfirmed prices.
 */

import { describe, expect, it } from "vitest";

import { costMicros, eurToMicros, MODELS } from "@/lib/ai/models";

describe("costMicros", () => {
  it("prices a Concierge turn by its tokens (PLAN 3.2: about $0.006)", () => {
    // 6,000 tokens in at $0.75/M and 400 out at $3.75/M = $0.0045 + $0.0015.
    expect(costMicros(MODELS.concierge.pricing, { inputTokens: 6_000, outputTokens: 400 })).toBe(6_000);
  });

  it("prices per unit: a try-on, five seconds of video, an image", () => {
    expect(costMicros(MODELS.tryOn.pricing, { units: 1 })).toBe(75_000);
    expect(costMicros(MODELS.video.pricing, { units: 5 })).toBe(250_000);
    expect(costMicros(MODELS.image.pricing, { units: 1 })).toBe(67_000);
  });

  it("rounds a fraction of a micro up, never down", () => {
    expect(costMicros(MODELS.concierge.pricing, { inputTokens: 1 })).toBe(1);
    expect(costMicros(MODELS.concierge.pricing, {})).toBe(0);
  });

  it("does not guess a price that has not been confirmed", () => {
    expect(costMicros(MODELS.embedding.pricing, { inputTokens: 1_000 })).toBeNull();
  });

  it("converts the daily budget to the same unit", () => {
    expect(eurToMicros(3)).toBe(3_000_000);
  });
});

describe("MODELS", () => {
  it("names every model once, with its provider", () => {
    for (const entry of Object.values(MODELS)) {
      expect(entry.id).toMatch(/^[a-z0-9.-]+$/);
      expect(["google", "openai", "fashn", "demo"]).toContain(entry.provider);
    }
  });
});
