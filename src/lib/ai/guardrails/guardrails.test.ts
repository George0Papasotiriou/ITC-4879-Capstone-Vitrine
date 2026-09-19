/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the Concierge's guardrails: the page map and the rate limit.
 */

import { describe, expect, it } from "vitest";

import { describePageMap, parsePageMap } from "@/lib/ai/guardrails/page-map";
import { createRateLimiter } from "@/lib/ai/guardrails/rate-limit";

describe("page map", () => {
  it("keeps a valid map and drops a malformed one", () => {
    expect(parsePageMap({ route: "/c/lighting", targets: ["product:abc", "nav:cart"], cartCount: 2 })).toEqual({ route: "/c/lighting", targets: ["product:abc", "nav:cart"], cartCount: 2 });
    expect(parsePageMap({ route: "https://evil.example", targets: [] })).toBeNull();
    expect(parsePageMap({ route: "/", targets: ["<script>"] })).toBeNull();
    expect(parsePageMap({ route: "/", targets: Array.from({ length: 41 }, (_, index) => `product:${index}`) })).toBeNull();
  });

  it("reads as short lines for the model", () => {
    expect(describePageMap({ route: "/c/lighting", title: "Lighting <b>", targets: ["nav:cart"], filters: { color: ["white"] }, cartCount: 1 })).toBe(
      "Page: /c/lighting (Lighting b)\nTargets on screen: nav:cart\nActive filters: color=white\nItems in cart: 1",
    );
    expect(describePageMap(null)).toBe("Page: unknown.");
  });
});

describe("rate limit", () => {
  it("allows the limit within the window, then again once it has passed", () => {
    const allow = createRateLimiter({ limit: 3, windowMs: 1_000 });
    expect([0, 10, 20, 30].map((at) => allow("1.2.3.4", at))).toEqual([true, true, true, false]);
    expect(allow("5.6.7.8", 40)).toBe(true);
    expect(allow("1.2.3.4", 1_015)).toBe(true);
  });

  it("forgets the oldest addresses when full, so memory stays bounded", () => {
    const allow = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    allow("a", 0);
    allow("b", 1);
    allow("c", 2);
    // "a" was dropped, so it is allowed again although its minute is not over.
    expect(allow("a", 3)).toBe(true);
    expect(allow("c", 4)).toBe(false);
  });
});
