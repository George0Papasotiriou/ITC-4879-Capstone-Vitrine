/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for Showcase mode: themes as Stylist requests, and pieces at their true relative sizes.
 */

import { describe, expect, it } from "vitest";

import { layoutStage } from "@/lib/display/stage";
import { DEFAULT_THEME, displayFromParams, displayHref, THEMES } from "@/lib/display/themes";
import { stylistRequestSchema } from "@/lib/stylist/stylist";

const sofa = { id: "sofa", dimsCm: { w: 220, d: 95, h: 85 }, hero: true };
const lamp = { id: "lamp", dimsCm: { w: 40, d: 40, h: 160 } };
const table = { id: "table", dimsCm: { w: 60, d: 60, h: 45 } };
const chair = { id: "chair", dimsCm: { w: 75, d: 80, h: 90 } };

describe("layoutStage", () => {
  it("keeps every piece's height and width in the same ratio as in the room", () => {
    const { pieces } = layoutStage([sofa, lamp, table, chair], 16 / 9);
    const by = Object.fromEntries(pieces.map((piece) => [piece.id, piece]));
    expect(by.lamp!.heightPct / by.table!.heightPct).toBeCloseTo(160 / 45, 1);
    expect(by.sofa!.widthPct / by.table!.widthPct).toBeCloseTo(220 / 60, 1);
  });

  it("fits the row inside the window, the tallest within its share of the height", () => {
    for (const aspect of [16 / 9, 3 / 4, 1]) {
      const { pieces } = layoutStage([sofa, lamp, table, chair], aspect);
      for (const piece of pieces) {
        expect(piece.leftPct).toBeGreaterThanOrEqual(0);
        expect(piece.leftPct + piece.widthPct).toBeLessThanOrEqual(100.01);
        expect(piece.heightPct).toBeLessThanOrEqual(72.01);
      }
    }
  });

  it("stands the hero in the middle and in front, the others rising outwards", () => {
    const { pieces } = layoutStage([table, lamp, sofa, chair], 16 / 9);
    const hero = pieces.find((piece) => piece.id === "sofa")!;
    expect(hero.leftPct + hero.widthPct / 2).toBeGreaterThan(35);
    expect(hero.leftPct + hero.widthPct / 2).toBeLessThan(65);
    expect(Math.max(...pieces.map((piece) => piece.z))).toBe(hero.z);
    // The tallest piece stands at an end of the row.
    const order = [...pieces].sort((a, b) => a.leftPct - b.leftPct).map((piece) => piece.id);
    expect([order[0], order.at(-1)]).toContain("lamp");
  });

  it("lays a rug on the floor under the row, and marks a stand-in size as not measured", () => {
    const { pieces } = layoutStage([sofa, { id: "rug", dimsCm: { w: 200, d: 140, h: 1 }, flat: true }, { id: "vase", dimsCm: null }], 16 / 9);
    expect(pieces.find((piece) => piece.id === "rug")).toMatchObject({ flat: true, z: 0 });
    expect(pieces.find((piece) => piece.id === "vase")!.measured).toBe(false);
    expect(pieces.find((piece) => piece.id === "sofa")!.measured).toBe(true);
  });

  it("draws nothing for nothing, or for a window with no size", () => {
    expect(layoutStage([], 1).pieces).toEqual([]);
    expect(layoutStage([sofa], 0).pieces).toEqual([]);
  });
});

describe("themes", () => {
  it("are all requests the Budget Stylist accepts", () => {
    for (const theme of THEMES) {
      expect(stylistRequestSchema.safeParse({ template: theme.template, budgetCents: theme.budgetCents, query: theme.query }).success, theme.id).toBe(true);
    }
  });

  it("read a link by theme, or by template, budget and words, and fall back to the first theme", () => {
    expect(displayFromParams({ theme: "oak-bedroom" }).theme?.id).toBe("oak-bedroom");
    expect(displayFromParams({ template: "living-room", budget: "1800", words: "velvet" }).request).toEqual({ template: "living-room", budgetCents: 180_000, query: "velvet" });
    expect(displayFromParams({ template: "garage", budget: "10" }).theme).toBe(DEFAULT_THEME);
    expect(displayFromParams({ template: "dining", budget: "999999999" }).theme).toBe(DEFAULT_THEME);
  });

  it("write links that read back as the same display", () => {
    const request = { template: "bedroom" as const, budgetCents: 120_000, query: "linen" };
    const params = Object.fromEntries(new URL(`https://x${displayHref(request)}`).searchParams);
    expect(displayFromParams(params).request).toEqual(request);
    expect(displayHref(DEFAULT_THEME, DEFAULT_THEME.id)).toBe("/showcase?theme=reading-corner");
  });
});
