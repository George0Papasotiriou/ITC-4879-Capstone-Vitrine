/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the recent-searches list kept on the device.
 */

import { describe, expect, it } from "vitest";

import { RECENT_LIMIT, withRecent } from "@/components/search/search-events";

describe("withRecent", () => {
  it("puts the newest search first", () => {
    expect(withRecent(["lamp", "sofa"], "rug")).toEqual(["rug", "lamp", "sofa"]);
  });

  it("moves a repeated search to the front instead of listing it twice, ignoring case", () => {
    expect(withRecent(["lamp", "Oak table", "sofa"], "oak TABLE")).toEqual(["oak TABLE", "lamp", "sofa"]);
  });

  it("keeps only the latest five", () => {
    const list = ["a", "b", "c", "d", "e"];
    const next = withRecent(list, "f");
    expect(next).toHaveLength(RECENT_LIMIT);
    expect(next).toEqual(["f", "a", "b", "c", "d"]);
  });

  it("tidies spaces and ignores an empty search", () => {
    expect(withRecent(["lamp"], "  grey   chair ")).toEqual(["grey chair", "lamp"]);
    expect(withRecent(["lamp"], "   ")).toEqual(["lamp"]);
  });
});
