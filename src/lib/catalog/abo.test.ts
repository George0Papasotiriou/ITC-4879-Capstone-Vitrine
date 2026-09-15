/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Unit tests for the Amazon Berkeley Objects listing converter.
 */

import { describe, expect, it } from "vitest";

import {
  cleanBrand,
  cleanTitle,
  dimensionsCm,
  highlights,
  parseAboListing,
  productSlug,
  weightGrams,
  type AboListing,
} from "@/lib/catalog/abo";
import { ABO_PRODUCT_KINDS, syntheticPriceCents, syntheticStock } from "@/lib/catalog/taxonomy";

const inches = (value: number) => ({ normalized_value: { unit: "inches", value } });
const en = (value: string, standardized?: string[]) => ({
  language_tag: "en_US",
  value,
  ...(standardized === undefined ? {} : { standardized_values: standardized }),
});

/** Trimmed from real ABO listings (listings_0.json.gz). */
const RUG = {
  item_id: "B07B4YVDLQ",
  marketplace: "Amazon",
  product_type: [{ value: "RUG" }],
  item_name: [
    { language_tag: "zh_CN", value: "Amazon Brand – Rivet 现代几何羊毛地毯" },
    en("Amazon Brand – Rivet Modern Geometric Wool Area Rug, 4 x 6 Foot, Blue, Grey, Brown"),
  ],
  brand: [en("Rivet")],
  bullet_point: [
    en("This vibrant chevron rug will liven up any room and impress your guests."),
    en("4' x 6'"),
    en("Medium pile is easy to clean"),
    en("Free returns for 30 days. 1-year warranty."),
    { language_tag: "de_DE", value: "Mittlerer Flor ist leicht zu reinigen." },
  ],
  color: [en("Blue, Grey, Brown", ["Multi"]), { language_tag: "de_DE", value: "Blau, Grau, Braun" }],
  material: [en("wool")],
  pattern: [en("geometric")],
  item_shape: [en("Rectangular")],
  item_dimensions: { height: inches(0.31), length: inches(48), width: inches(72) },
  item_weight: [{ normalized_value: { unit: "pounds", value: 15 } }],
  main_image_id: "81hmIvQwu8L",
  other_image_id: ["A1jAinb74wL", "916e0YmQ3xL"],
  spin_id: "fd9e3060",
  "3dmodel_id": "B07B4YVDLQ",
};

const LAMP = {
  item_id: "B073P3NK7T",
  marketplace: "Amazon",
  product_type: [{ value: "LAMP" }],
  item_name: [
    en("Amazon Brand – Stone & Beam Modern Crystal Glass Rectangle Table Desk Lamp With Bulb And White Shade - 18 x 12 x 12 Inches"),
  ],
  brand: [en("Stone & Beam")],
  color: [en("Polished Nickel", ["White"])],
  material: [en("Metal+Crystal+Fabric")],
  item_dimensions: { height: inches(18), length: inches(12), width: inches(12) },
  main_image_id: "81oTHF1PcUL",
};

describe("cleanTitle", () => {
  it("removes the retailer prefix, the brand, and the size and colour after the comma", () => {
    expect(cleanTitle(RUG.item_name[1]!.value, "Rivet")).toBe("Modern Geometric Wool Area Rug");
  });

  it("removes a trailing dash segment that carries a measurement", () => {
    expect(cleanTitle(LAMP.item_name[0]!.value, "Stone & Beam")).toBe(
      "Modern Crystal Glass Rectangle Table Desk Lamp With Bulb And White Shade",
    );
  });

  it("removes model numbers and keeps ordinary words with digits out of it", () => {
    expect(cleanTitle("Rivet MH103137 Mid-Century Lounge Chair, Walnut", "Rivet")).toBe("Mid-Century Lounge Chair");
  });

  it("recases shouting titles", () => {
    expect(cleanTitle("RAVENNA HOME CURVED ARM ACCENT CHAIR", null)).toBe("Ravenna Home Curved Arm Accent Chair");
  });

  it("trims long titles at a word boundary", () => {
    const title = cleanTitle(
      "Modern Upholstered Tufted Button Back Wingback Accent Chair With Solid Wood Legs For Living Room Bedroom Office",
      null,
    );
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith(" ")).toBe(false);
    expect(title).toBe("Modern Upholstered Tufted Button Back Wingback Accent Chair With Solid Wood Legs");
  });
});

describe("field helpers", () => {
  it("cleans brands", () => {
    expect(cleanBrand("Amazon Brand - Rivet")).toBe("Rivet");
    expect(cleanBrand("   ")).toBeNull();
    expect(cleanBrand(undefined)).toBeNull();
  });

  it("makes unique ASCII slugs", () => {
    expect(productSlug("Modern Geometric Wool Area Rug", "B07B4YVDLQ")).toBe("modern-geometric-wool-area-rug-b07b4yvdlq");
    expect(productSlug("Crème Brûlée Stool", "B0X")).toBe("creme-brulee-stool-b0x");
  });

  it("converts dimensions to whole centimetres, width, depth, height", () => {
    const listing = RUG as unknown as AboListing;
    expect(dimensionsCm(listing)).toEqual({ w: 183, d: 122, h: 1 });
  });

  it("takes the longer horizontal measurement as the width, whatever the listing calls it", () => {
    const sofa = { ...RUG, item_dimensions: { height: inches(31.5), length: inches(89), width: inches(42) } };
    expect(dimensionsCm(sofa as unknown as AboListing)).toEqual({ w: 226, d: 107, h: 80 });
  });

  it("discards implausible or incomplete dimensions", () => {
    expect(dimensionsCm({ ...RUG, item_dimensions: { width: inches(72) } } as unknown as AboListing)).toBeNull();
    expect(
      dimensionsCm({ ...RUG, item_dimensions: { height: inches(1), length: inches(1), width: inches(9000) } } as unknown as AboListing),
    ).toBeNull();
  });

  it("converts weight to grams", () => {
    expect(weightGrams(RUG as unknown as AboListing)).toBe(6804);
  });

  it("keeps English selling points and drops bare measurements", () => {
    expect(highlights(RUG as unknown as AboListing)).toEqual([
      "This vibrant chevron rug will liven up any room and impress your guests.",
      "Medium pile is easy to clean",
    ]);
  });
});

describe("parseAboListing", () => {
  it("turns a real listing into a clean product draft", () => {
    const result = parseAboListing(RUG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product).toMatchObject({
      sourceId: "B07B4YVDLQ",
      slug: "modern-geometric-wool-area-rug-b07b4yvdlq",
      kind: "RUG",
      category: "rugs",
      titleEn: "Modern Geometric Wool Area Rug",
      brand: "Rivet",
      colorLabel: "Blue, Grey, Brown",
      colors: ["blue", "grey", "brown"],
      materials: ["wool"],
      attributes: { pattern: "geometric", shape: "Rectangular", material: "wool" },
      dimsCm: { w: 183, d: 122, h: 1 },
      mainImageId: "81hmIvQwu8L",
      spinId: "fd9e3060",
      modelId: "B07B4YVDLQ",
    });
  });

  it("uses standardised colour values and materials listed together", () => {
    const result = parseAboListing(LAMP);
    if (!result.ok) throw new Error(result.reason);
    expect(result.product.colors).toEqual(["silver", "white"]);
    expect(result.product.materials).toEqual(["metal", "fabric", "glass"]);
    expect(result.product.category).toBe("lighting");
  });

  it("derives price and stock deterministically from the item id, within the band", () => {
    const first = parseAboListing(LAMP);
    const second = parseAboListing(LAMP);
    if (!first.ok || !second.ok) throw new Error("rejected");
    const bands = ABO_PRODUCT_KINDS.LAMP!.bands;
    expect(first.product.priceCents).toBe(second.product.priceCents);
    expect(first.product.priceCents).toBe(syntheticPriceCents("B073P3NK7T", bands));
    expect(first.product.priceCents).toBeGreaterThanOrEqual(bands.minCents - 100);
    expect(first.product.priceCents).toBeLessThanOrEqual(bands.maxCents);
    expect(first.product.priceCents % 100).toBe(0);
    expect(first.product.stock).toBe(syntheticStock("B073P3NK7T", bands));
  });

  it.each([
    [{ ...LAMP, marketplace: "WholeFoods" }, "not-amazon-marketplace"],
    [{ ...LAMP, product_type: [{ value: "CELLULAR_PHONE_CASE" }] }, "product-type-not-sold"],
    [{ ...LAMP, item_name: [{ language_tag: "de_DE", value: "Tischlampe aus Kristallglas" }] }, "no-english-title"],
    [{ ...LAMP, item_name: [en("Replacement Lamp Shade for Floor Lamp")] }, "not-a-product"],
    [{ ...LAMP, item_name: [en("Amazon Brand – Lamp")] }, "title-too-short"],
    [{ ...LAMP, main_image_id: undefined }, "no-main-image"],
    [{ item_id: 42 }, "malformed"],
    [{ ...LAMP, item_id: "B089LB7TJC" }, "excluded"],
  ])("rejects with a reason: %#", (listing, reason) => {
    expect(parseAboListing(listing)).toEqual({ ok: false, reason });
  });
});

describe("synthetic commercial data", () => {
  it("prices every kind within its band and ends prices in a whole euro", () => {
    for (const [kind, { bands }] of Object.entries(ABO_PRODUCT_KINDS)) {
      for (let i = 0; i < 200; i += 1) {
        const price = syntheticPriceCents(`${kind}-${i}`, bands);
        expect(price, kind).toBeGreaterThanOrEqual(bands.minCents - 100);
        expect(price, kind).toBeLessThanOrEqual(bands.maxCents);
        expect(price % 100, kind).toBe(0);
      }
    }
  });

  it("puts roughly the configured share of products out of stock", () => {
    const bands = ABO_PRODUCT_KINDS.CHAIR!.bands;
    let soldOut = 0;
    for (let i = 0; i < 5000; i += 1) if (syntheticStock(`chair-${i}`, bands) === 0) soldOut += 1;
    expect(soldOut / 5000).toBeGreaterThan(bands.soldOutShare - 0.02);
    expect(soldOut / 5000).toBeLessThan(bands.soldOutShare + 0.02);
  });
});
