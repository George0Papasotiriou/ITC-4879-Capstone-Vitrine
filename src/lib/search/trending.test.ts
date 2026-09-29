/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for "Trending now": what may be shown, counting people once, and fresh over big.
 */

import { describe, expect, it } from "vitest";

import { createMemoryKv } from "@/lib/kv/memory";
import { combineTrending, readTrending, recordTrending, trendingTerm } from "@/lib/search/trending";

const HOUR = 60 * 60 * 1000;

describe("trendingTerm", () => {
  it("keeps plain words in any script, tidied", () => {
    expect(trendingTerm("  Oak   Table ")).toBe("oak table");
    expect(trendingTerm("καναπές")).toBe("καναπές");
    expect(trendingTerm("mid-century chair")).toBe("mid-century chair");
  });

  it("never shows anything with digits, symbols, or too many words", () => {
    for (const query of ["eleni@example.com", "order VT-2026-0042", "6912345678", "https://x.example", "a", "one two three four five", "<script>"]) {
      expect(trendingTerm(query)).toBeNull();
    }
  });
});

describe("combineTrending", () => {
  it("halves a count's weight every six hours", () => {
    const [top] = combineTrending(
      [
        { ageHours: 0, counts: [{ member: "sofa", score: 2 }] },
        { ageHours: 6, counts: [{ member: "sofa", score: 2 }] },
      ],
      { minPeople: 1 },
    );
    expect(top).toEqual({ term: "sofa", score: 3, people: 4 });
  });

  it("puts something many look for now above something bigger yesterday", () => {
    const shelf = combineTrending(
      [
        { ageHours: 0, counts: [{ member: "rug", score: 4 }] },
        { ageHours: 20, counts: [{ member: "lamp", score: 30 }] },
      ],
      { minPeople: 1 },
    );
    expect(shelf.map((entry) => entry.term)).toEqual(["rug", "lamp"]);
  });

  it("shows nothing fewer than three people looked for", () => {
    expect(combineTrending([{ ageHours: 0, counts: [{ member: "rare", score: 2 }] }])).toEqual([]);
  });
});

describe("recording and reading", () => {
  it("counts one person once per term and hour, and only searches that found something", async () => {
    const store = createMemoryKv();
    const now = Date.UTC(2026, 8, 29, 10, 30);
    expect(await recordTrending(store, "sofa", "person-a", 12, now)).toBe(true);
    expect(await recordTrending(store, "Sofa ", "person-a", 12, now + 1000)).toBe(false);
    expect(await recordTrending(store, "sofa", "person-b", 0, now)).toBe(false);
    expect(await recordTrending(store, "sofa", "person-b", 3, now)).toBe(true);
    expect(await recordTrending(store, "sofa", "person-c", 3, now + HOUR)).toBe(true);
    const shelf = await readTrending(store, now + HOUR);
    expect(shelf).toEqual([{ term: "sofa", score: expect.any(Number), people: 3 }]);
  });
});
