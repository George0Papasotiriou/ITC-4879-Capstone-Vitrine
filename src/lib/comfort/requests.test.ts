/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for reading comfort requests in words, in English and Greek, and leaving ordinary shopping sentences alone.
 */

import { describe, expect, it } from "vitest";

import { comfortRequestOf, numbersRequestOf } from "@/lib/comfort/requests";
import { DEFAULT_COMFORT } from "@/lib/comfort/settings";

describe("asking for comfort in words", () => {
  it.each([
    ["The text is too small", { text: "125" }],
    ["Can you make the letters bigger please", { text: "125" }],
    ["make bigger text", { text: "125" }],
    ["I can't read the text", { text: "125" }],
    ["Much bigger text", { text: "150" }],
    ["Please stop the animations", { motion: "reduce" }],
    ["The motion makes me dizzy", { motion: "reduce" }],
    ["More contrast", { contrast: "more" }],
    ["A font for dyslexia", { font: "readable" }],
    ["underline the links", { links: "underline" }],
    ["bigger buttons", { targets: "large" }],
    ["turn on the reading guide", { guide: "on" }],
    ["Bigger text and less motion", { text: "125", motion: "reduce" }],
  ])("%s", (sentence, expected) => {
    expect(comfortRequestOf(sentence)).toEqual(expected);
  });

  it("understands Greek, with or without accents", () => {
    expect(comfortRequestOf("Θέλω μεγαλύτερα γράμματα")).toEqual({ text: "125" });
    expect(comfortRequestOf("μεγαλυτερα γραμματα και λιγοτερη κινηση")).toEqual({ text: "125", motion: "reduce" });
    expect(comfortRequestOf("Περισσότερη αντίθεση")).toEqual({ contrast: "more" });
    expect(comfortRequestOf("Μια ευανάγνωστη γραμματοσειρά")).toEqual({ font: "readable" });
  });

  it("puts everything back on a reset, whatever else is said", () => {
    expect(comfortRequestOf("reset the display settings and bigger text")).toEqual(DEFAULT_COMFORT);
    expect(comfortRequestOf("Επαναφορά")).toEqual(DEFAULT_COMFORT);
  });

  it("hears point by number: show, hide, and a number only while they are shown", () => {
    expect(numbersRequestOf("Show numbers", false)).toEqual({ show: true });
    expect(numbersRequestOf("δείξε αριθμούς", false)).toEqual({ show: true });
    expect(numbersRequestOf("hide the numbers.", true)).toEqual({ show: false });
    expect(numbersRequestOf("12", true)).toEqual({ pick: 12 });
    expect(numbersRequestOf("number 7", true)).toEqual({ pick: 7 });
    expect(numbersRequestOf("αριθμός 3", true)).toEqual({ pick: 3 });
    expect(numbersRequestOf("12", false)).toBeNull();
    expect(numbersRequestOf("show me 2 lamps", true)).toBeNull();
  });

  it("leaves shopping sentences alone", () => {
    for (const sentence of ["Show me a large oak table", "a bigger sofa for the living room", "is the rug small?", "contrast stitching on the chair", "Δείξε μου μεγάλα χαλιά", "reading corner under 600"]) {
      expect(comfortRequestOf(sentence), sentence).toBeNull();
    }
  });
});
