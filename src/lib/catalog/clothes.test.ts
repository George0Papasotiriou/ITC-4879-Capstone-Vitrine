/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for reading real garments from Amazon's listings: their kind, who they are for, their names, fabric, colour and price.
 */

import { describe, expect, it } from "vitest";

import {
  careOf,
  cleanClothesTitle,
  clothesHighlights,
  clothesKindFor,
  clothesPriceCents,
  departmentOf,
  fabricOf,
  garmentColour,
  isGarmentPhotoShape,
  isGarmentStudioShot,
  looksLikeSkin,
  MAX_TITLE,
  notSold,
  priceRanks,
  titleColours,
} from "@/lib/catalog/clothes";

const path = (...rest: string[]) => ["Clothing, Shoes & Jewelry", ...rest];

describe("clothesKindFor (docs/adr/062)", () => {
  it("reads the kind from the category path, then the title where the path is broad", () => {
    expect(clothesKindFor(path("Women", "Clothing", "Dresses", "Casual"), "Amazon Essentials Women's Surplice Dress (Available in Plus Size)")).toBe("DRESS");
    expect(clothesKindFor(path("Men", "Clothing", "Jeans"), "Amazon Essentials Women's Mid-Rise Slim Bootcut Jean")).toBe("TROUSERS");
    expect(clothesKindFor(path("Men", "Clothing", "Shirts", "Casual Button-Down Shirts"), "Levi's Men's Marin Poplin Long Sleeve Woven Shirt")).toBe("SHIRT");
    expect(clothesKindFor(path("Men", "Clothing", "Shirts", "Polos"), "COOFANDY Men's Long Sleeve Polo Shirt")).toBe("TOP");
    expect(clothesKindFor(path("Women", "Clothing", "Sweaters", "Cardigans"), "Lovaru Womens Boho Knit Cardigan")).toBe("KNIT");
  });

  it("tells a coat from a jacket by what the title calls it first, and the category when it says neither", () => {
    expect(clothesKindFor(path("Women", "Clothing", "Coats, Jackets & Vests", "Wool & Pea Coats"), "Foshow Women's Lapel Wrap Belted Pea Coat Jacket")).toBe("COAT");
    expect(clothesKindFor(path("Men", "Clothing", "Jackets & Coats", "Leather & Faux Leather"), "Mericiny Men Vintage Slim Zip Faux Leather Jacket Multi-Pocket Coat")).toBe("JACKET");
    expect(clothesKindFor(path("Men", "Clothing", "Jackets & Coats", "Trench & Rain"), "Helly-Hansen Men's Voss Windproof Waterproof Rain Jacket")).toBe("JACKET");
    expect(clothesKindFor(path("Women", "Clothing", "Coats, Jackets & Vests", "Denim Jackets"), "Levi's Hybrid Original Trucker")).toBe("JACKET");
    expect(clothesKindFor(path("Women", "Clothing", "Coats, Jackets & Vests", "Vests"), "Puffer Vest")).toBeNull();
  });

  it("sells no underwear, swimwear, sportswear, costumes, multipacks or slogans", () => {
    expect(clothesKindFor(path("Women", "Clothing", "Lingerie, Sleep & Lounge", "Lingerie"), "Olga Women's Sheer Leaves Minimizer Bra")).toBeNull();
    expect(clothesKindFor(path("Men", "Clothing", "Active", "Active Shirts & Tees"), "Under Armour Men's Performance Polo")).toBeNull();
    expect(notSold(path("Men", "Clothing", "Shirts", "T-Shirts"), "Gildan Men's Crew T-Shirts, Multipack, Style G1100")).toBe(true);
    expect(notSold(path("Men", "Clothing", "Shirts", "T-Shirts"), "Hanes Mens Beefy Short Sleeve Tee Value Pack (2-Pack)")).toBe(true);
    expect(notSold(path("Women", "Clothing", "Tops, Tees & Blouses", "T-Shirts"), "Amazon Essentials Women's Classic-Fit Crewneck T-Shirt, Multipacks")).toBe(true);
    expect(notSold(path("Women", "Clothing", "Tops, Tees & Blouses", "T-Shirts"), "Womens Go Climb A Cactus Tshirt Funny Graphic Novelty Tee")).toBe(true);
    expect(notSold(path("Men", "Clothing", "Jackets & Coats"), "FROGG TOGGS Men's Classic All-Sport Waterproof Breathable Rain Suit")).toBe(true);
    // An aside offering plus sizes is not a plus-size listing.
    expect(notSold(path("Women", "Clothing", "Dresses"), "Amazon Essentials Women's Surplice Dress (Available in Plus Size)")).toBe(false);
  });
});

describe("departmentOf", () => {
  it("takes the listing's Department, else its category path", () => {
    expect(departmentOf(path("Women", "Clothing"), { Department: "mens" })).toBe("men");
    expect(departmentOf(path("Men", "Clothing"), { Department: "womens" })).toBe("women");
    expect(departmentOf(path("Women", "Clothing"))).toBe("women");
    expect(departmentOf(path("Novelty & More", "Clothing"))).toBeNull();
  });
});

describe("cleanClothesTitle", () => {
  it("prints a garment's name as a shop does: no brand, wearer, asides or keyword lists", () => {
    expect(cleanClothesTitle("Amazon Essentials Women's Surplice Dress (Available in Plus Size)", "Amazon Essentials", "DRESS")).toBe("Surplice Dress");
    expect(cleanClothesTitle("Levi's Men's 505 Regular Fit Jeans (Also Available in Big & Tall)", "Levi's", "TROUSERS")).toBe("505 Regular Fit Jeans");
    expect(cleanClothesTitle("Columbia Men's Glennaker Rain Jacket", "Columbia", "JACKET")).toBe("Glennaker Rain Jacket");
    expect(cleanClothesTitle("Hanes Women's Perfect-T Short-Sleeve T-Shirt, Women's Crewneck T-Shirt", "Hanes", "TOP")).toBe("Perfect-T Short-Sleeve T-Shirt");
  });

  it("keeps hyphenated words whole and drops style codes, weights and a stray fit", () => {
    expect(cleanClothesTitle("Amazon Essentials Women's Classic-Fit Short-Sleeve V-Neck T-Shirt", "Amazon Essentials", "TOP")).toBe("Classic-Fit Short-Sleeve V-Neck T-Shirt");
    expect(cleanClothesTitle("Lock and Love WB1207 Womens Printed Fold Over Maxi Skirt S Aqua", "Lock and Love", "SKIRT")).toBe("Printed Fold Over Maxi Skirt");
    expect(cleanClothesTitle("Wrangler Men's 13MWZ Cowboy Cut Original Fit Jean", "Wrangler", "TROUSERS")).toBe("Cowboy Cut Original Fit Jean");
    expect(cleanClothesTitle("Hanes Men's 6.1 Oz. Tagless ComfortSoft Long-Sleeve T-Shirt", "Hanes", "TOP")).toBe("Tagless ComfortSoft Long-Sleeve T-Shirt");
    expect(cleanClothesTitle("Carhartt Men's Loose Fit Heavyweight Long-Sleeve Pocket Henley", "Carhartt", "TOP")).toBe("Heavyweight Long-Sleeve Pocket Henley");
  });

  it("strips a brand however it is punctuated, and only the brand", () => {
    expect(cleanClothesTitle("JOA Women's Sleeveless Check Button-Front Dress", "J.O.A.", "DRESS")).toBe("Sleeveless Check Button-Front Dress");
    expect(cleanClothesTitle("Caterpillar Men's Flame Resistant Hooded Sweatshirt", "Cat", "KNIT")).toBe("Caterpillar Flame Resistant Hooded Sweatshirt");
    expect(cleanClothesTitle("Signature by Levi Strauss & Co. Gold Label Women's Modern Skinny Jeans", "Signature by Levi Strauss & Co. Gold Label", "TROUSERS")).toBe("Modern Skinny Jeans");
    expect(cleanClothesTitle("Novias Multicolored Print High Waist Maxi Skirt", "Novia's Choice", "SKIRT")).toBe("Print High Waist Maxi Skirt");
  });

  it("ends at the first noun of its kind, and spells T-shirts one way", () => {
    expect(cleanClothesTitle("Scarlet Darkness Women Pencil Dress Midi Business Dress Cocktail Party", "Scarlet Darkness", "DRESS")).toBe("Pencil Dress");
    expect(cleanClothesTitle("NIASHOT Women V Neck T Shirts Short Sleeve", "NIASHOT", "TOP")).toBe("V Neck T-Shirt");
    expect(cleanClothesTitle("Cicy Bell Womens Casual Blazers Open Front Long Sleeve Work Office Jackets Blazer", "Cicy Bell", "JACKET")).toBe("Open Front Long Sleeve Work Office Jacket");
  });

  it("prints nothing rather than a muddled or overlong name", () => {
    // Only nouns.
    expect(cleanClothesTitle("Blouses for Women Fashion, Casual Long Sleeve Button Down Shirts Tops", "BIG DART", "SHIRT")).toBeNull();
    // Another kind's noun in a skirt's name.
    expect(cleanClothesTitle("EXCHIC Women's Basic Skirt A-Line Midi Dress Casual Stretchy Skater Skirt", "EXCHIC", "SKIRT")).toBeNull();
    // No noun of the kind at all.
    expect(cleanClothesTitle("Champion Men's Crewneck, Cotton Midweight", "Champion", "TOP")).toBeNull();
    const long = cleanClothesTitle("Brand Women Off The Shoulder Short Sleeve High Low Cocktail Party Swing Skater Dress", "Brand", "DRESS");
    expect(long === null || long.length <= MAX_TITLE).toBe(true);
  });
});

describe("fabric, care and highlights", () => {
  it("reads the fabric line from percentages and finds the shop's materials in it", () => {
    expect(fabricOf(["Button closure", "97% Cotton, 3% Spandex, Stretchy fabric."])).toEqual({ line: "97% cotton, 3% spandex", materials: ["cotton"] });
    expect(fabricOf(["90% Polyester, 10% Spandex"])?.materials).toEqual(["fabric"]);
    expect(fabricOf(["Made of lace, soft and comfortable"])).toBeNull();
    // Percentages that add up to more than a whole are a marketing claim, not a label.
    expect(fabricOf(["100% cotton and 100% comfort"])).toBeNull();
  });

  it("finds the care line, and leaves label lines and the marketplace's promises out of the highlights", () => {
    expect(careOf(["Pull On closure", "Machine Wash"])).toBe("Machine Wash");
    expect(careOf(["Hand wash only, dry flat and never tumble dry, please note the colours may run in the first wash"])).toBeNull();
    const highlights = clothesHighlights([
      "92% Nylon, 8% Spandex",
      "Pull On closure",
      "Machine Wash",
      "【SOFT & COMFY】- Brushed jersey that keeps its shape wash after wash 🌸",
      "If it does not fit, Amazon returns are free within 30 days",
      "SLIM FIT: Cut close to the body with a longer back hem for tucking in",
    ]);
    expect(highlights).toEqual(["Brushed jersey that keeps its shape wash after wash", "Cut close to the body with a longer back hem for tucking in"]);
  });
});

describe("a garment's colour", () => {
  const rgb = (r: number, g: number, b: number) => ({ r, g, b });
  const many = (pixel: { r: number; g: number; b: number }, count: number) => Array.from({ length: count }, () => pixel);

  it("tells skin from cloth, roughly", () => {
    expect(looksLikeSkin(rgb(224, 172, 140))).toBe(true);
    expect(looksLikeSkin(rgb(141, 85, 60))).toBe(true);
    expect(looksLikeSkin(rgb(30, 60, 140))).toBe(false);
    expect(looksLikeSkin(rgb(128, 128, 128))).toBe(false);
  });

  it("names the cloth, not the model's arms or the studio, and calls a garment that fills the crop with white white", () => {
    expect(garmentColour([...many(rgb(25, 45, 110), 300), ...many(rgb(224, 172, 140), 200), ...many(rgb(255, 255, 255), 100)])).toBe("blue");
    expect(garmentColour([...many(rgb(250, 250, 250), 400), ...many(rgb(30, 30, 30), 100)])).toBe("white");
    // Metals are not cloth colours: a light grey is grey.
    expect(garmentColour(many(rgb(196, 196, 198), 300))).toBe("grey");
  });

  it("reads colour words from the title without the brand", () => {
    expect(titleColours("Red Kap Men's Industrial Work Shirt", "Red Kap")).toEqual([]);
    expect(titleColours("Pink Queen Women's Turtleneck Oversize Pullover", "Pink Queen")).toEqual([]);
    expect(titleColours("Minibee Women's Patchwork T-Shirt Dress Wine Red", "Minibee")).toEqual(["red"]);
  });
});

describe("isGarmentStudioShot", () => {
  const size = 16;
  const frame = (paint: (x: number, y: number) => [number, number, number]) => {
    const data = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) data.set(paint(x, y), (y * size + x) * 3);
    return data;
  };

  it("takes a model on white, cropped at the waist, and refuses a room or a grey backdrop", () => {
    // White ground, a figure down the middle reaching the top edge (trousers cropped at the waist).
    expect(isGarmentStudioShot(frame((x) => (x >= 5 && x <= 10 ? [40, 50, 90] : [255, 255, 255])), size)).toBe(true);
    // Top corners are the model's shirt; the floor corners are white.
    expect(isGarmentStudioShot(frame((x, y) => (y < 5 ? [200, 160, 140] : x >= 5 && x <= 10 ? [40, 50, 90] : [255, 255, 255])), size)).toBe(true);
    expect(isGarmentStudioShot(frame(() => [214, 214, 214]), size)).toBe(false);
    expect(isGarmentStudioShot(frame((x, y) => [120 + x * 4, 100 + y * 3, 80]), size)).toBe(false);
  });
});

describe("isGarmentPhotoShape", () => {
  it("keeps upright and square photographs, and leaves out the wide size charts", () => {
    expect(isGarmentPhotoShape(1000, 1500)).toBe(true);
    expect(isGarmentPhotoShape(1500, 1500)).toBe(true);
    expect(isGarmentPhotoShape(1500, 1000)).toBe(false);
    expect(isGarmentPhotoShape(1500, 0)).toBe(false);
  });
});

describe("prices", () => {
  const band = { minCents: 2900, maxCents: 7900 };

  it("places each piece in its kind's band by its listing price among the others, the shop's way", () => {
    const ranks = priceRanks([
      { id: "a", usd: 9.5 },
      { id: "b", usd: 24 },
      { id: "c", usd: 60 },
      { id: "d", usd: null },
    ]);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(0.5);
    expect(ranks.get("c")).toBe(1);
    expect(ranks.get("d")).toBeGreaterThanOrEqual(0);
    expect(clothesPriceCents(0, band)).toBe(2900);
    expect(clothesPriceCents(1, band)).toBe(7900);
    expect(clothesPriceCents(0.5, band) % 100).toBe(0);
    expect(String(clothesPriceCents(0.5, band) / 100).endsWith("9") || String(clothesPriceCents(0.5, band) / 100).endsWith("4")).toBe(true);
  });
});
