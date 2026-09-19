/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the audit log's change detection.
 */

import { describe, expect, it } from "vitest";

import { diffFields, sameValue } from "@/lib/admin/audit";

describe("sameValue", () => {
  it("compares arrays and objects by content, dates by instant", () => {
    expect(sameValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameValue({ w: 1, d: 2 }, { d: 2, w: 1 })).toBe(true);
    expect(sameValue(new Date("2026-09-19T10:00:00Z"), new Date("2026-09-19T10:00:00.000Z"))).toBe(true);
    expect(sameValue(null, undefined)).toBe(false);
    expect(sameValue([], null)).toBe(false);
  });
});

describe("diffFields", () => {
  const before = { titleEn: "Oak chair", titleEl: null as string | null, priceCents: 12900, highlightsEn: ["Solid oak"], status: "active" };

  it("keeps only the fields that changed, before and after", () => {
    expect(diffFields(before, { titleEn: "Oak dining chair", priceCents: 12900, highlightsEn: ["Solid oak"] })).toEqual({
      titleEn: { before: "Oak chair", after: "Oak dining chair" },
    });
  });

  it("treats a missing field as untouched, and null as a change", () => {
    expect(diffFields(before, { titleEl: undefined })).toEqual({});
    expect(diffFields<Record<string, unknown>>({ ...before, titleEl: "Καρέκλα" }, { titleEl: null })).toEqual({ titleEl: { before: "Καρέκλα", after: null } });
  });

  it("records a field that had no value as null before", () => {
    expect(diffFields(before, { titleEl: "Δρύινη καρέκλα" })).toEqual({ titleEl: { before: null, after: "Δρύινη καρέκλα" } });
  });

  it("sees a changed list", () => {
    expect(diffFields(before, { highlightsEn: ["Solid oak", "Made in Greece"] })).toEqual({
      highlightsEn: { before: ["Solid oak"], after: ["Solid oak", "Made in Greece"] },
    });
  });

  it("finds nothing when nothing changed", () => {
    expect(diffFields(before, { ...before })).toEqual({});
  });
});
