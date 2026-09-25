/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for the desk's ready answers: what an answer may say, and the key a new one gets.
 */

import { describe, expect, it } from "vitest";

import { answerInputSchema, answerKey, placeholdersIn, unknownPlaceholders } from "@/lib/support/answers";
import { DEFAULT_MACROS } from "@/lib/support/macros";

const valid = {
  topic: "delivery",
  titleEn: "Saturday delivery",
  titleEl: "Παράδοση το Σάββατο",
  bodyEn: "Hello {name},\n\nThe carrier can come on Saturday morning for {order}.",
  bodyEl: "Γεια σου {name},\n\nΗ μεταφορική μπορεί να έρθει το Σάββατο το πρωί για την {order}.",
  sort: 50,
};

describe("the blanks in an answer", () => {
  it("finds each blank once, in order", () => {
    expect(placeholdersIn("{name}, about {order}: {name}")).toEqual(["name", "order"]);
  });

  it("names the blanks a draft cannot fill", () => {
    expect(unknownPlaceholders("Hello {customer}, your {order} and {total}")).toEqual(["customer", "total"]);
    expect(unknownPlaceholders(valid.bodyEn)).toEqual([]);
  });

  it("leaves none unknown in the shop's own answers", () => {
    for (const macro of DEFAULT_MACROS) {
      expect(unknownPlaceholders(macro.bodyEn), macro.key).toEqual([]);
      expect(unknownPlaceholders(macro.bodyEl), macro.key).toEqual([]);
    }
  });
});

describe("an answer as the editor sends it", () => {
  it("accepts both languages with known blanks", () => {
    expect(answerInputSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a blank the draft would leave in braces, and says which", () => {
    const result = answerInputSchema.safeParse({ ...valid, bodyEl: "Γεια σου {customer}, ευχαριστούμε για την παραγγελία." });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((entry) => entry.message === "unknown_placeholder");
    expect(issue?.path).toEqual(["bodyEl"]);
  });

  it("needs both languages, and something to say", () => {
    expect(answerInputSchema.safeParse({ ...valid, titleEl: "" }).success).toBe(false);
    expect(answerInputSchema.safeParse({ ...valid, bodyEn: "Thanks" }).success).toBe(false);
    expect(answerInputSchema.safeParse({ ...valid, topic: "gossip" }).success).toBe(false);
  });
});

describe("the key a new answer gets", () => {
  it("comes from the English title, and never takes a key already in use", () => {
    expect(answerKey("Saturday delivery", new Set())).toBe("saturday_delivery");
    expect(answerKey("Saturday delivery!", new Set(["saturday_delivery"]))).toBe("saturday_delivery_2");
    expect(answerKey("Saturday delivery", new Set(["saturday_delivery", "saturday_delivery_2"]))).toBe("saturday_delivery_3");
    // The shop's own keys are taken too, so a new answer cannot replace one of them.
    expect(answerKey("Where is my order", new Set(DEFAULT_MACROS.map((macro) => macro.key)))).toBe("where_is_my_order_2");
  });

  it("still gives a key to a title with nothing a key can use", () => {
    expect(answerKey("¿?", new Set())).toBe("answer");
  });
});
