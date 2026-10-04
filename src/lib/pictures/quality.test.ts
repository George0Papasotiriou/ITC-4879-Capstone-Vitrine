/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the quality check's rules: the bar, the comparison of two attempts, and the corrections passed on.
 */

import { describe, expect, it } from "vitest";

import { better, corrections, overall, passes, QUALITY_BAR, verdictSchema, type Verdict } from "@/lib/pictures/quality";

const verdict = (patch: Partial<Verdict> = {}): Verdict => ({ fidelity: 8, realism: 8, scale: 7, roomKept: 8, issues: [], ...patch });

describe("passes (docs/adr/060)", () => {
  it("needs every question at or above its bar", () => {
    expect(passes(verdict(), "quick")).toBe(true);
    expect(passes(verdict({ fidelity: QUALITY_BAR.fidelity, realism: QUALITY_BAR.realism, scale: QUALITY_BAR.scale, roomKept: QUALITY_BAR.roomKept }), "quick")).toBe(true);
    expect(passes(verdict({ fidelity: 6 }), "quick")).toBe(false);
    expect(passes(verdict({ realism: 6 }), "scene")).toBe(false);
    expect(passes(verdict({ scale: 5 }), "room")).toBe(false);
  });

  it("asks whether the room was kept only for a shopper's own room", () => {
    expect(passes(verdict({ roomKept: 3 }), "quick")).toBe(false);
    expect(passes(verdict({ roomKept: null }), "quick")).toBe(false);
    expect(passes(verdict({ roomKept: null }), "scene")).toBe(true);
    expect(passes(verdict({ roomKept: 3 }), "scene")).toBe(true);
  });
});

describe("overall and better", () => {
  it("counts fidelity most, and is pulled down by the weakest answer", () => {
    expect(overall(verdict({ fidelity: 10 }), "scene")).toBeGreaterThan(overall(verdict({ realism: 10 }), "scene"));
    // Same mean, one glaring fault: lower.
    const even = verdict({ fidelity: 8, realism: 8 });
    const lopsided = verdict({ fidelity: 10, realism: 6 });
    expect(overall(lopsided, "scene")).toBeLessThan(overall(even, "scene"));
  });

  it("prefers the attempt that passes, then the higher score, then the first", () => {
    const one = { verdict: verdict({ fidelity: 6 }), id: 1 };
    const two = { verdict: verdict(), id: 2 };
    expect(better(one, two, "quick").id).toBe(2);
    expect(better(two, one, "quick").id).toBe(2);
    const high = { verdict: verdict({ fidelity: 10, realism: 10 }), id: 3 };
    expect(better(two, high, "quick").id).toBe(3);
    expect(better(two, { ...two, id: 4 }, "quick").id).toBe(2);
  });

  it("compares an unanswered check as if it had just cleared the bar", () => {
    const failing: { verdict: Verdict | null; id: number } = { verdict: verdict({ realism: 4 }), id: 1 };
    const unknown: { verdict: Verdict | null; id: number } = { verdict: null, id: 2 };
    expect(better(failing, unknown, "scene").id).toBe(2);
    expect(better<{ verdict: Verdict | null; id: number }>({ verdict: verdict({ fidelity: 10, realism: 10, scale: 10 }), id: 3 }, unknown, "scene").id).toBe(3);
  });
});

describe("corrections", () => {
  it("passes on at most five short, one-line instructions", () => {
    const issues = ["  the back legs\nare missing  ", 'the "logo" must go', "ok", ...Array.from({ length: 6 }, (_, k) => `issue number ${k}`)];
    const out = corrections(verdict({ issues: issues.slice(0, 6) }));
    expect(out).toEqual(["the back legs are missing", "the logo must go", "issue number 0", "issue number 1", "issue number 2"]);
    expect(corrections(verdict({ issues: ["x".repeat(240)] }))[0]).toHaveLength(160);
  });
});

describe("verdictSchema", () => {
  it("accepts the check's answer and refuses scores outside 0–10", () => {
    expect(verdictSchema.safeParse(verdict()).success).toBe(true);
    expect(verdictSchema.safeParse(verdict({ fidelity: 11 })).success).toBe(false);
    expect(verdictSchema.safeParse(verdict({ realism: 7.5 })).success).toBe(false);
    expect(verdictSchema.safeParse({ ...verdict(), issues: Array.from({ length: 7 }, () => "x") }).success).toBe(false);
  });
});
