/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the Stylist's word rule: a slot's avoided words match whole words only.
 */

import { describe, expect, it } from "vitest";

import { TEMPLATES } from "@/lib/optimize/templates";
import { avoidPattern } from "@/lib/stylist/stylist";

/** PostgreSQL's \m and \M (start and end of a word), as JavaScript's \b, to check the pattern's meaning here. */
const asJs = (pattern: string) => new RegExp(pattern.replace(/\\m|\\M/g, "\\b"), "i");

describe("avoidPattern", () => {
  it("rules out whole words, in any case, and nothing that merely contains them", () => {
    const pattern = asJs(avoidPattern(["office", "bar"]));
    expect(pattern.test("Low Back Upholstered Mesh Adjustable Swivel Computer Office Chair")).toBe(true);
    expect(pattern.test("Bar Stool with Back")).toBe(true);
    expect(pattern.test("Barrel Accent Chair")).toBe(false);
    expect(pattern.test("Mid-Century Dining Chair")).toBe(false);
  });

  it("keeps only letters, digits, spaces and hyphens, so a word can never change the pattern", () => {
    expect(avoidPattern(["a|b", "c)"])).toBe("\\m(ab|c)\\M");
  });

  it("dining chairs and the living room's extra seat avoid work seats; the coffee table is at least 70 cm wide", () => {
    const slot = (template: keyof typeof TEMPLATES, id: string) => TEMPLATES[template].slots.find((entry) => entry.id === id)!;
    expect(slot("dining", "chairs").avoidWords).toContain("office");
    expect(slot("dining", "chairs").requireWords).toEqual(["dining", "kitchen"]);
    expect(slot("living-room", "accent-seat").avoidWords).toContain("drafting");
    expect(slot("living-room", "coffee-table").size?.minWidthCm).toBe(70);
  });
});
