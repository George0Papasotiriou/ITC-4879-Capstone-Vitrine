/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for Greeklish transliteration and resolution.
 */

import { describe, expect, it } from "vitest";

import { greeklishCandidates, resolveGreeklish, segment } from "@/lib/search/greeklish";
import { TrigramIndex } from "@/lib/search/trigram";

/**
 * A realistic vocabulary: folded Greek words a furniture and lighting catalogue
 * would contain.
 */
const vocabulary = new TrigramIndex([
  "καναπεσ", "καρεκλα", "πολυθρονα", "σκαμπο", "τραπεζι", "γραφειο", "φωτιστικο",
  "λαμπα", "χαλι", "ξυλινο", "δερματινο", "μαυρο", "λευκο", "γκρι", "μπλε", "κοκκινο",
  "πρασινο", "χρυσο", "θεσεισ", "δρυσ", "καρυδια", "μεταλλικο", "γυαλινο", "βελουδο",
  "αυτοκινητο", "καφε", "ψαθινο", "μπαμπου", "ντουλαπα", "κουζινα",
]);

describe("segment", () => {
  it("takes the longest rule first, so digraphs stay one sound", () => {
    expect(segment("thesi")?.map((s) => s.latin)).toEqual(["th", "e", "s", "i"]);
    expect(segment("ntoulapa")?.map((s) => s.latin)).toEqual(["nt", "ou", "l", "a", "p", "a"]);
    expect(segment("psathino")?.map((s) => s.latin)).toEqual(["ps", "a", "th", "i", "n", "o"]);
  });

  it("refuses characters no rule covers, rather than guessing", () => {
    expect(segment("iphone15")).toBeNull();
    expect(segment("big-lamp")).toBeNull();
  });

  it("accepts 8 for theta inside a word", () => {
    expect(segment("8esi")?.[0]).toEqual({ latin: "8", options: ["θ"] });
  });
});

describe("greeklishCandidates", () => {
  it("puts the most common reading first", () => {
    expect(greeklishCandidates("kanapes")[0]).toBe("καναπεσ");
    expect(greeklishCandidates("trapezi")[0]).toBe("τραπεζι");
  });

  it("orders candidates by how many less common choices they make", () => {
    const candidates = greeklishCandidates("fotistiko");
    const correct = candidates.indexOf("φωτιστικο");
    // φωτιστικο uses ω, the second option for "o": it costs 1, so it must come
    // after the cost-0 spelling and before any cost-2 spelling.
    expect(candidates[0]).toBe("φοτιστικο");
    expect(correct).toBeGreaterThan(0);
    expect(correct).toBeLessThan(candidates.indexOf("φωτηστικο"));
  });

  it("covers the ambiguous letters the plan names", () => {
    expect(greeklishCandidates("xali")).toEqual(expect.arrayContaining(["χαλι", "ξαλι"]));
    expect(greeklishCandidates("mi")).toEqual(expect.arrayContaining(["μι", "μη", "μυ"]));
    expect(greeklishCandidates("lo")).toEqual(expect.arrayContaining(["λο", "λω"]));
  });

  it("reads av and af both ways, as Greeklish writers do", () => {
    expect(greeklishCandidates("mavro")[0]).toBe("μαυρο");
    expect(greeklishCandidates("kafe")).toEqual(expect.arrayContaining(["καφε", "καυε"]));
  });

  it("never returns duplicates", () => {
    const candidates = greeklishCandidates("gkri");
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("stops at the cap, keeping the cheapest candidates", () => {
    // o → ο|ω and x → χ|ξ: eight ambiguous letters, 2^8 = 256 spellings.
    const all = greeklishCandidates("oxoxoxox", 1_000);
    expect(all).toHaveLength(256);

    const capped = greeklishCandidates("oxoxoxox", 5);
    expect(capped).toEqual(all.slice(0, 5));
    // The one cost-0 spelling, then cost-1 spellings (exactly one second option).
    expect(capped[0]).toBe("οχοχοχοχ");
  });

  it("does not treat a digraph with a single reading as ambiguous", () => {
    // Five "oi" digraphs, each only ever οι: one spelling, nothing to cap.
    expect(greeklishCandidates("oioioioioi")).toEqual(["οιοιοιοιοι"]);
  });

  it("returns nothing for Greek or non-transliterable input", () => {
    expect(greeklishCandidates("καναπεσ")).toEqual([]);
    expect(greeklishCandidates("300")).toEqual([]);
  });
});

describe("resolveGreeklish", () => {
  it("finds the Greek word even when it is not the first candidate", () => {
    expect(resolveGreeklish("fotistiko", vocabulary)).toEqual([
      { greek: "φωτιστικο", match: "exact", confidence: 1 },
    ]);
  });

  it("resolves the common shopping words", () => {
    const cases: [string, string][] = [
      ["kanapes", "καναπεσ"],
      ["karekla", "καρεκλα"],
      ["polythrona", "πολυθρονα"],
      ["xali", "χαλι"],
      ["lampa", "λαμπα"],
      ["mavro", "μαυρο"],
      ["ble", "μπλε"],
      ["gkri", "γκρι"],
      ["xryso", "χρυσο"],
      ["dermatino", "δερματινο"],
      ["ksylino", "ξυλινο"],
      ["psathino", "ψαθινο"],
      ["ntoulapa", "ντουλαπα"],
      ["kouzina", "κουζινα"],
      ["veloudo", "βελουδο"],
      ["aftokinito", "αυτοκινητο"],
      ["8eseis", "θεσεισ"],
    ];
    for (const [latin, greek] of cases) {
      expect(resolveGreeklish(latin, vocabulary)[0]?.greek, latin).toBe(greek);
    }
  });

  it("falls back to the nearest word when Greeklish and a typo combine", () => {
    // "fotistko" is missing an i: no candidate is an exact word.
    const [reading] = resolveGreeklish("fotistko", vocabulary);
    expect(reading?.greek).toBe("φωτιστικο");
    expect(reading?.match).toBe("similar");
    expect(reading?.confidence).toBeLessThan(1);
  });

  it("returns nothing for an English word with no Greek counterpart in the catalogue", () => {
    expect(resolveGreeklish("wardrobe", vocabulary)).toEqual([]);
  });
});
