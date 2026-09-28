/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for "Complete the set": complements only, taken fairly from each cart piece.
 */

import { describe, expect, it } from "vitest";

import { completeTheSet, type Neighbour } from "@/lib/reco/complete-set";

const CATEGORY: Record<string, string> = {
  sofa: "seating",
  armchair: "seating",
  rug: "rugs",
  "rug-2": "rugs",
  lamp: "lighting",
  "lamp-2": "lighting",
  table: "tables",
  shelf: "storage",
  vase: "decor",
  mirror: "decor",
};
const categoryOf = (id: string) => CATEGORY[id];
const n = (neighborId: string, kind: Neighbour["kind"], rank: number): Neighbour => ({ neighborId, kind, rank });

describe("completeTheSet", () => {
  it("leaves out substitutes: nothing from a category the cart already has", () => {
    const result = completeTheSet({
      anchors: ["sofa"],
      neighbours: new Map([["sofa", [n("armchair", "behavior", 1), n("lamp", "behavior", 2), n("table", "content", 1)]]]),
      categoryOf,
    });
    expect(result.map((entry) => entry.productId)).toEqual(["lamp", "table"]);
  });

  it("puts bought-together before looks-alike, and keeps each list's order", () => {
    const result = completeTheSet({
      anchors: ["sofa"],
      neighbours: new Map([["sofa", [n("table", "content", 1), n("shelf", "behavior", 2), n("lamp", "behavior", 1)]]]),
      categoryOf,
    });
    expect(result).toEqual([
      { productId: "lamp", anchorId: "sofa", source: "behavior" },
      { productId: "shelf", anchorId: "sofa", source: "behavior" },
      { productId: "table", anchorId: "sofa", source: "content" },
    ]);
  });

  it("takes turns between the cart's pieces, so each is completed", () => {
    const result = completeTheSet({
      anchors: ["sofa", "rug"],
      neighbours: new Map([
        ["sofa", [n("lamp", "behavior", 1), n("table", "behavior", 2), n("shelf", "behavior", 3)]],
        ["rug", [n("vase", "behavior", 1), n("mirror", "behavior", 2)]],
      ]),
      categoryOf,
      limit: 3,
    });
    expect(result.map((entry) => [entry.productId, entry.anchorId])).toEqual([
      ["lamp", "sofa"],
      ["vase", "rug"],
      ["table", "sofa"],
    ]);
  });

  it("suggests one piece per category and never the same piece twice", () => {
    const result = completeTheSet({
      anchors: ["sofa", "armchair"],
      neighbours: new Map([
        ["sofa", [n("lamp", "behavior", 1), n("lamp-2", "behavior", 2)]],
        ["armchair", [n("lamp", "behavior", 1), n("rug", "content", 1), n("rug-2", "content", 2)]],
      ]),
      categoryOf,
    });
    expect(result.map((entry) => entry.productId)).toEqual(["lamp", "rug"]);
  });

  it("stops at the limit, and returns nothing without neighbours", () => {
    const many = [n("lamp", "behavior", 1), n("table", "behavior", 2), n("shelf", "behavior", 3), n("vase", "behavior", 4), n("rug", "behavior", 5)];
    expect(completeTheSet({ anchors: ["sofa"], neighbours: new Map([["sofa", many]]), categoryOf })).toHaveLength(4);
    expect(completeTheSet({ anchors: ["sofa"], neighbours: new Map(), categoryOf })).toEqual([]);
    expect(completeTheSet({ anchors: [], neighbours: new Map(), categoryOf })).toEqual([]);
  });
});
