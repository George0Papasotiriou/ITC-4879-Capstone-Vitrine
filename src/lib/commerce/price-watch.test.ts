/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the price-watch rules: valid targets, the suggested target, and who gets an email.
 */

import { describe, expect, it } from "vitest";

import { MIN_TARGET_CENTS, parseTargetCents, suggestedTargetCents, watchDecisions, type WatchState } from "@/lib/commerce/price-watch";

describe("parseTargetCents", () => {
  it("reads a target as typed", () => {
    expect(parseTargetCents("399", 51_900)).toEqual({ ok: true, cents: 39_900 });
    expect(parseTargetCents("399,50", 51_900)).toEqual({ ok: true, cents: 39_950 });
    expect(parseTargetCents(" €1.299,00 ", 189_900)).toEqual({ ok: true, cents: 129_900 });
  });

  it("refuses what is not a price", () => {
    expect(parseTargetCents("soon", 51_900)).toEqual({ ok: false, problem: "invalid" });
    expect(parseTargetCents("-20", 51_900)).toEqual({ ok: false, problem: "invalid" });
  });

  it("refuses a target that is too low or not below the price", () => {
    expect(parseTargetCents("0,50", 51_900)).toEqual({ ok: false, problem: "too_low" });
    expect(parseTargetCents("519", 51_900)).toEqual({ ok: false, problem: "not_below_price" });
    expect(parseTargetCents("600", 51_900)).toEqual({ ok: false, problem: "not_below_price" });
  });
});

describe("suggestedTargetCents", () => {
  it("suggests a tenth below, at a whole euro", () => {
    expect(suggestedTargetCents(51_900)).toBe(46_700);
    expect(suggestedTargetCents(10_000)).toBe(9_000);
  });

  it("stays below the price and above the floor", () => {
    expect(suggestedTargetCents(150)).toBe(MIN_TARGET_CENTS);
    expect(suggestedTargetCents(250)).toBe(150);
  });
});

describe("watchDecisions", () => {
  const watch = (overrides: Partial<WatchState>): WatchState => ({ id: "w1", targetCents: 40_000, priceCents: 51_900, available: true, notifiedAt: null, ...overrides });

  it("emails a watch whose price has been reached, once", () => {
    expect(watchDecisions([watch({ priceCents: 39_900 })])).toEqual({ notify: ["w1"], reset: [] });
    expect(watchDecisions([watch({ priceCents: 39_900, notifiedAt: new Date() })])).toEqual({ notify: [], reset: [] });
  });

  it("emails on the target exactly", () => {
    expect(watchDecisions([watch({ priceCents: 40_000 })]).notify).toEqual(["w1"]);
  });

  it("waits while the product is not for sale", () => {
    expect(watchDecisions([watch({ priceCents: 39_900, available: false })])).toEqual({ notify: [], reset: [] });
  });

  it("arms the watch again when the price goes back up", () => {
    expect(watchDecisions([watch({ priceCents: 51_900, notifiedAt: new Date() })])).toEqual({ notify: [], reset: ["w1"] });
    expect(watchDecisions([watch({ priceCents: 51_900 })])).toEqual({ notify: [], reset: [] });
  });
});
