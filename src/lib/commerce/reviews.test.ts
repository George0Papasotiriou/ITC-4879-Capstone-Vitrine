/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for review input rules, author names, text cleaning and rating summaries.
 */

import { describe, expect, it } from "vitest";

import { authorDisplayName, cleanReviewText, reviewInputSchema, summarizeRatings } from "@/lib/commerce/reviews";

describe("review input", () => {
  it("accepts a rating, an optional title and a body of reasonable length", () => {
    const parsed = reviewInputSchema.parse({ rating: 4, title: "  Sturdy  ", body: "Solid oak, arrived well packed and took ten minutes to assemble." });
    expect(parsed).toEqual({ rating: 4, title: "Sturdy", body: "Solid oak, arrived well packed and took ten minutes to assemble." });
    expect(reviewInputSchema.parse({ rating: 5, title: "", body: "Exactly as the photos show it." }).title).toBeNull();
  });

  it("refuses ratings outside one to five stars, and bodies too short to help anyone", () => {
    expect(reviewInputSchema.safeParse({ rating: 0, body: "x".repeat(30) }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ rating: 6, body: "x".repeat(30) }).success).toBe(false);
    expect(reviewInputSchema.safeParse({ rating: 3.5, body: "x".repeat(30) }).success).toBe(false);
    const short = reviewInputSchema.safeParse({ rating: 4, body: "Nice." });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toBe("too_short");
  });

  it("counts length after cleaning, so padding does not pass the minimum", () => {
    expect(reviewInputSchema.safeParse({ rating: 4, body: `Good.${" ".repeat(40)}` }).success).toBe(false);
  });
});

describe("cleanReviewText", () => {
  it("keeps line breaks, drops control and direction-override characters, and shortens blank runs", () => {
    expect(cleanReviewText("Great lamp.\r\n\r\n\r\n\r\nWarm light.")).toBe("Great lamp.\n\nWarm light.");
    expect(cleanReviewText(`a${String.fromCharCode(0)}b${String.fromCharCode(0x202e)}c${String.fromCharCode(0x200b)}d`)).toBe("abcd");
    expect(cleanReviewText("  <b>bold</b>  ")).toBe("<b>bold</b>");
  });
});

describe("authorDisplayName", () => {
  it("shows a first name and the initial of the last", () => {
    expect(authorDisplayName("Eleni Papadopoulou")).toBe("Eleni P.");
    expect(authorDisplayName("  Γιώργος   Παπασωτηρίου ")).toBe("Γιώργος Π.");
    expect(authorDisplayName("Maria de la Cruz")).toBe("Maria C.");
    expect(authorDisplayName("Nikos")).toBe("Nikos");
    expect(authorDisplayName("   ")).toBe("");
  });
});

describe("summarizeRatings", () => {
  it("gives the plain mean and the count per star", () => {
    expect(summarizeRatings({ 5: 3, 4: 1 })).toEqual({ count: 4, average: 4.75, distribution: [0, 0, 0, 1, 3] });
    expect(summarizeRatings({})).toEqual({ count: 0, average: 0, distribution: [0, 0, 0, 0, 0] });
  });
});
