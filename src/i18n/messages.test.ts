/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Checks that the English and Greek message catalogues have identical keys and placeholders.
 */

import { describe, expect, it } from "vitest";

import { OUTSIDE_VAT_AREA_PLACES } from "@/lib/commerce/vat";

import el from "../../messages/el.json";
import en from "../../messages/en.json";

/**
 * The two message catalogues must describe the same interface.
 *
 * A key that exists only in English renders as a raw key path on the Greek
 * storefront; a placeholder that exists in only one language renders as a
 * literal "{caption}". Both are the kind of defect nobody notices while
 * developing in English, which is exactly how the first version of this project
 * shipped English text onto Greek product pages.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      out.set(path, value);
    } else {
      for (const [nested, text] of flatten(value, path)) out.set(nested, text);
    }
  }
  return out;
}

/**
 * Top-level ICU arguments — `{caption}`, `{count, plural, …}` — but not the
 * branch selectors inside a plural such as `one {…}`.
 */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i += 1) {
    const character = message[i];
    if (character === "{") {
      if (depth === 0) {
        const match = /^\{\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(message.slice(i));
        if (match?.[1] !== undefined) names.add(match[1]);
      }
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    }
  }
  return [...names].sort();
}

const english = flatten(en as Tree);
const greek = flatten(el as Tree);

describe("message catalogues", () => {
  it("have exactly the same keys in English and Greek", () => {
    const onlyEnglish = [...english.keys()].filter((key) => !greek.has(key));
    const onlyGreek = [...greek.keys()].filter((key) => !english.has(key));

    expect(onlyEnglish, "keys missing from el.json").toEqual([]);
    expect(onlyGreek, "keys missing from en.json").toEqual([]);
  });

  it("use the same placeholders in both languages", () => {
    const mismatched = [...english.entries()]
      .filter(([key, text]) => {
        const other = greek.get(key);
        return other !== undefined && placeholders(text).join() !== placeholders(other).join();
      })
      .map(([key]) => key);

    expect(mismatched).toEqual([]);
  });

  it("never leave a Greek message empty", () => {
    const empty = [...greek.entries()]
      .filter(([, text]) => text.trim() === "")
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("name every place outside the EU VAT area in both languages, never falling back to “this address”", () => {
    for (const catalogue of [english, greek]) {
      const message = catalogue.get("checkout.errorOutsideVatArea") ?? "";
      const missing = OUTSIDE_VAT_AREA_PLACES.filter((place) => !message.includes(` ${place} {`));
      expect(missing).toEqual([]);
    }
  });

  it("do not set Greek in capitals, which strips the accents (docs/PLAN.md 4.6)", () => {
    const shouting = [...greek.entries()]
      .filter(([, text]) => {
        const letters = text.replace(/\{[^}]*\}/g, "").replace(/[^Ͱ-Ͽἀ-῿]/g, "");
        return letters.length > 3 && letters === letters.toUpperCase();
      })
      .map(([key]) => key);
    expect(shouting).toEqual([]);
  });
});

describe("placeholders()", () => {
  it("finds simple and plural arguments but not plural branches", () => {
    expect(placeholders("{caption}. You can undo this.")).toEqual(["caption"]);
    expect(
      placeholders("{rating} out of 5, {count, plural, one {# review} other {# reviews}}"),
    ).toEqual(["count", "rating"]);
  });
});
