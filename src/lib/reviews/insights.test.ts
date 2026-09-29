/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for review intelligence: aspects, opinions with negation, clauses, and the support a point needs.
 */

import { describe, expect, it } from "vitest";

import { aspectsOf, polarityOf, reviewInsights, sentencesOf, type ReviewForInsights } from "@/lib/reviews/insights";

const review = (id: string, rating: number, body: string, title: string | null = null): ReviewForInsights => ({ id, rating, title, body, authorName: `Buyer ${id}` });
const words = (text: string) => sentencesOf(text)[0]!.clauses[0]!;

describe("aspects and opinions", () => {
  it("finds the aspect in English and Greek, whatever the accents", () => {
    expect(aspectsOf(words("Very sturdy construction"))).toEqual(["build"]);
    expect(aspectsOf(words("Η ΚΑΤΑΣΚΕΥΗ είναι γερή"))).toEqual(["build"]);
    expect(aspectsOf(words("The delivery was late"))).toEqual(["delivery"]);
    expect(aspectsOf(words("Άνετο κάθισμα"))).toEqual(["comfort"]);
  });

  it("flips an opinion after a negator and weighs it more after an intensifier", () => {
    expect(polarityOf(words("It is comfortable"))).toBe(1);
    expect(polarityOf(words("It is not comfortable"))).toBe(-1);
    expect(polarityOf(words("Δεν είναι άνετο"))).toBe(-1);
    expect(polarityOf(words("very sturdy"))).toBe(1.5);
    expect(polarityOf(words("πολύ γερό"))).toBe(1.5);
    expect(polarityOf(words("The table is oak"))).toBe(0);
  });

  it("judges each clause on its own words", () => {
    const [sentence] = sentencesOf("Solid and well made, but the colour is darker than the photos.");
    expect(sentence!.clauses).toHaveLength(2);
    expect(polarityOf(sentence!.clauses[0]!)).toBeGreaterThan(0);
    expect(polarityOf(sentence!.clauses[1]!)).toBeLessThan(0);
  });
});

describe("reviewInsights", () => {
  it("turns reviews into pros and cons, each with the sentence that says it", () => {
    const insights = reviewInsights([
      review("a", 4, "Solid and well made, but the colour is darker than the photos."),
      review("b", 5, "Very sturdy. Delivery was quick."),
      review("c", 2, "The colour looks nothing like the photo. The construction is good though."),
    ]);
    expect(insights.pros.map((point) => [point.aspect, point.reviews])).toEqual([
      ["build", 3],
      ["delivery", 1],
    ]);
    expect(insights.cons.map((point) => [point.aspect, point.reviews])).toEqual([["colour", 2]]);
    expect(insights.cons[0]!.evidence[0]).toEqual({ reviewId: "a", author: "Buyer a", sentence: "Solid and well made, but the colour is darker than the photos." });
  });

  it("counts a review once per aspect, however many sentences it spends on it", () => {
    const insights = reviewInsights([review("a", 5, "Comfortable seat. So comfortable. The cushions are soft and comfy.")]);
    expect(insights.pros).toEqual([{ aspect: "comfort", polarity: "pro", reviews: 1, evidence: [expect.objectContaining({ reviewId: "a" })] }]);
  });

  it("lets the stars decide a sentence that names an aspect without an opinion word", () => {
    expect(reviewInsights([review("a", 5, "The delivery came on Tuesday.")]).pros[0]?.aspect).toBe("delivery");
    expect(reviewInsights([review("a", 1, "The delivery came on Tuesday.")]).cons[0]?.aspect).toBe("delivery");
    expect(reviewInsights([review("a", 3, "The delivery came on Tuesday.")])).toEqual({ reviewed: 1, pros: [], cons: [] });
  });

  it("needs two voices for a point once a product has five reviews or more", () => {
    const five = [
      review("a", 5, "Great value for money."),
      review("b", 5, "Lovely."),
      review("c", 4, "Nice."),
      review("d", 4, "Good."),
      review("e", 2, "The assembly instructions were confusing and hard."),
    ];
    const insights = reviewInsights(five);
    expect(insights.cons).toEqual([]);
    expect(insights.pros).toEqual([]);
    const agreed = reviewInsights([...five, review("f", 2, "Assembly was difficult.")]);
    expect(agreed.cons.map((point) => point.aspect)).toEqual(["assembly"]);
  });

  it("reads Greek reviews as written", () => {
    const insights = reviewInsights([
      review("a", 5, "Πολύ καλή κατασκευή και ήρθε καλά συσκευασμένο."),
      review("b", 4, "Όμορφο και γερό. Η παράδοση άργησε μία μέρα, αλλά μας ενημέρωσαν."),
    ]);
    expect(insights.pros.find((point) => point.aspect === "build")?.reviews).toBe(2);
    expect(insights.pros.find((point) => point.aspect === "delivery")?.reviews).toBe(1);
  });

  it("says nothing about a product without reviews", () => {
    expect(reviewInsights([])).toEqual({ reviewed: 0, pros: [], cons: [] });
  });
});
