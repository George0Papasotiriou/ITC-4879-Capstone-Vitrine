/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for search query masking: numbers and emails never stored, sizes kept.
 */

import { describe, expect, it } from "vitest";

import { maskQuery } from "@/lib/admin/search-events";

describe("maskQuery", () => {
  it("folds the query as search does", () => {
    expect(maskQuery("  Δερμάτινος   ΚΑΝΑΠΈΣ ")).toBe("δερματινοσ καναπεσ");
    expect(maskQuery("Mid-Century chair")).toBe("mid century chair");
  });

  it("masks phone and card numbers, however they are grouped", () => {
    expect(maskQuery("call me 690 000 0000")).toBe("call me #");
    expect(maskQuery("6900000000")).toBe("#");
    expect(maskQuery("card 4242-4242-4242-4242 sofa")).toBe("card # sofa");
    expect(maskQuery("+30 210 1234567")).toBe("#");
  });

  it("keeps sizes and prices readable", () => {
    expect(maskQuery("sofa 180 200")).toBe("sofa 180 200");
    expect(maskQuery("lamp under 150")).toBe("lamp under 150");
    expect(maskQuery("rug 160x230")).toBe("rug 160x230");
  });

  it("drops email addresses entirely", () => {
    expect(maskQuery("eleni.p@example.com oak table")).toBe("oak table");
  });

  it("caps the stored length", () => {
    expect(maskQuery("sofa ".repeat(100)).length).toBeLessThanOrEqual(200);
  });
});
