/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the Amazon.com reviews of the wearables: the committed fixture's shape, the mean, which way a piece runs, and a review's identity.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { amazonReviewsFixtureSchema, decodeEntities, fitLean, meanRating } from "@/lib/reviews/amazon";
import { externalReviewId } from "@/lib/reviews/external-store";

describe("the committed reviews fixture (docs/adr/061)", () => {
  const fixture = amazonReviewsFixtureSchema.parse(JSON.parse(readFileSync("src/lib/catalog/fixtures/amazon-reviews.json", "utf8")));
  const wear = (JSON.parse(readFileSync("src/lib/catalog/fixtures/abo-wear.json", "utf8")) as { products: { sourceId: string }[] }).products;

  it("holds reviews only of wearables the shop sells, at most eight shown each", () => {
    const sold = new Set(wear.map((product) => product.sourceId));
    const ids = Object.keys(fixture.products);
    expect(ids.length).toBeGreaterThan(150);
    for (const id of ids) expect(sold.has(id), id).toBe(true);
    for (const entry of Object.values(fixture.products)) {
      expect(entry.reviews.length).toBeLessThanOrEqual(8);
      expect(entry.reviews.length).toBeLessThanOrEqual(entry.count);
    }
  });

  it("keeps nothing about the reviewer: no names, no ids", () => {
    const text = readFileSync("src/lib/catalog/fixtures/amazon-reviews.json", "utf8");
    expect(text).not.toMatch(/"user_id"|"userId"|"author"|"name"\s*:/);
  });

  it("holds reviews as their writers typed them, with no HTML escapes left", () => {
    for (const file of ["amazon-reviews.json", "amazon-clothes-reviews.json"]) {
      const products = amazonReviewsFixtureSchema.parse(JSON.parse(readFileSync(`src/lib/catalog/fixtures/${file}`, "utf8"))).products;
      for (const entry of Object.values(products)) for (const review of entry.reviews) expect(`${review.title} ${review.text}`).not.toMatch(/&(#\d+|#x[0-9a-f]+|[a-z]{2,8});/i);
    }
  });

  it("says where the reviews come from", () => {
    expect(fixture.citation).toMatch(/Amazon Reviews 2023/);
    expect(fixture.citation).toMatch(/McAuley/);
  });
});

describe("meanRating and fitLean", () => {
  it("gives the mean to one decimal", () => {
    expect(meanRating({ count: 3, ratingSum: 13 })).toBe(4.3);
  });

  it("says which way a piece runs only when the reviews clearly agree, and when enough say anything", () => {
    expect(fitLean({ small: 30, trueToSize: 10, large: 5 })).toMatchObject({ lean: "small", remarks: 45 });
    expect(fitLean({ small: 2, trueToSize: 10, large: 3 })).toMatchObject({ lean: "true" });
    // Split three ways: no side has half.
    expect(fitLean({ small: 4, trueToSize: 4, large: 4 }).lean).toBe("unknown");
    // Four remarks are too few to label a shoe.
    expect(fitLean({ small: 4, trueToSize: 0, large: 0 }).lean).toBe("unknown");
  });
});

describe("decodeEntities", () => {
  it("turns the dataset's HTML escapes back into the characters typed, and leaves unknown ones alone", () => {
    expect(decodeEntities("a L might be &#34;just right&#34; &amp; roomy")).toBe('a L might be "just right" & roomy');
    expect(decodeEntities("caf&eacute; &lt;3 &#x27;yes&#x27; &quot;ok&quot;")).toBe("café <3 'yes' \"ok\"");
    expect(decodeEntities("&bogus; and &#0; stay")).toBe("&bogus; and &#0; stay");
  });
});

describe("externalReviewId", () => {
  it("is the same for the same review on every sync, and different for another", () => {
    const review = { at: "2020-07-12", title: "Surprisingly good", text: "They fit well." };
    expect(externalReviewId("B07YFG47BK", review)).toBe(externalReviewId("B07YFG47BK", { ...review }));
    expect(externalReviewId("B07YFG47BK", review)).not.toBe(externalReviewId("B07YFG47BK", { ...review, text: "They fit badly." }));
    expect(externalReviewId("B07YFG47BK", review)).toMatch(/^[0-9a-f]{20}$/);
  });
});
