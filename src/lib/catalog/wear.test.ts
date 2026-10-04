/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Tests for reading ABO's wearables: which they are, who they are for, their sizes, and their titles and colours as a shop prints them.
 */

import { describe, expect, it } from "vitest";

import {
  brandFromTitle,
  canonicalBrand,
  cleanColourLabel,
  cleanWearTitle,
  euSizeForFoot,
  footForEuSize,
  forChildren,
  isKindAsListed,
  SHOE_SIZES,
  wearerOf,
  wearChart,
  wearKindFor,
  wearSizes,
  wearStock,
} from "@/lib/catalog/wear";

describe("wearKindFor (docs/adr/061)", () => {
  it("takes ABO's wearable types as the shop's kinds", () => {
    expect(wearKindFor("SHOES", "Women's Block Heel Pump")).toBe("SHOES");
    expect(wearKindFor("TECHNICAL_SPORT_SHOE", "Women's Flora Sneaker")).toBe("SHOES");
    expect(wearKindFor("FINEEARRING", "Sterling Silver Hoop Earrings")).toBe("EARRING");
    expect(wearKindFor("CHAIR", "Accent Chair")).toBeNull();
  });

  it("tells a scarf from a balaclava, and a necklace from a bracelet, by the title", () => {
    expect(wearKindFor("ACCESSORY", "Men's Cashmere Diamond Cable Scarf")).toBe("SCARF");
    expect(wearKindFor("ACCESSORY", "Unisex Balaclava")).toBeNull();
    expect(wearKindFor("FINENECKLACEBRACELETANKLET", "14k Gold Solitaire Pendant Necklace")).toBe("NECKLACE");
    expect(wearKindFor("FINENECKLACEBRACELETANKLET", "Sterling Silver Chain Bracelet")).toBe("BRACELET");
  });

  it("leaves children's pieces out: their sizes are another system", () => {
    expect(forChildren("Girl's 3-Piece Fleece Cold Weather Set")).toBe(true);
    expect(wearKindFor("SHOES", "Kids' Light-Up Sneaker")).toBeNull();
    expect(forChildren("Women's Boyfriend Cardigan")).toBe(false);
  });
});

describe("who a piece is for, and its sizes", () => {
  it("reads women's, men's or both from the title, with either apostrophe", () => {
    expect(wearerOf("Women's Ankle Boot")).toBe("women");
    expect(wearerOf("Men’s Chelsea Boots")).toBe("men");
    expect(wearerOf("Mens Leather Loafers")).toBe("men");
    expect(wearerOf("Canvas Sneaker")).toBe("unisex");
  });

  it("sells shoes in EU sizes by who they are for, hats in S/M/L or one size, the rest in one size", () => {
    expect(wearSizes("BOOT", "Women's Ankle Boot")).toEqual(SHOE_SIZES.women);
    expect(wearSizes("SHOES", "Men's Loafers")).toEqual(SHOE_SIZES.men);
    expect(wearSizes("SANDAL", "Slide Sandal")).toHaveLength(11);
    expect(wearSizes("HAT", "Cable Knit Beanie")).toEqual(["One size"]);
    expect(wearSizes("HAT", "Wool Fedora")).toEqual(["S", "M", "L"]);
    expect(wearSizes("HANDBAG", "Leather Crossbody")).toEqual(["One size"]);
  });

  it("sizes a shoe for the wearer its shown title names, even when the listing's size tail names another", () => {
    expect(wearSizes("SHOES", "Men's Loafers", "find. Men's Amz28/01 Loafers, Black, Womens 10")).toEqual(SHOE_SIZES.men);
    // A shown title that names no one falls back to the listing's words.
    expect(wearSizes("SHOES", "Leather Loafers", "find. Leather Loafers, Black, Womens 10")).toEqual(SHOE_SIZES.women);
    expect(wearSizes("HAT", "Ribbed Hat", "Ribbed Hat, One Size")).toEqual(["One size"]);
  });

  it("turns a foot into an EU size and back: a size is 2/3 cm of a last 1.5 cm longer than the foot", () => {
    expect(euSizeForFoot(25)).toBeCloseTo(39.75, 9);
    expect(footForEuSize(42)).toBeCloseTo(26.5, 9);
    expect(euSizeForFoot(footForEuSize(38))).toBeCloseTo(38, 9);
  });

  it("stocks the middle of a run deepest, the same every time", () => {
    const sizes = SHOE_SIZES.unisex;
    const stock = sizes.map((size) => wearStock("B07EXAMPLE", size, sizes));
    expect(stock).toEqual(sizes.map((size) => wearStock("B07EXAMPLE", size, sizes)));
    const sum = (indices: number[]) => indices.reduce((total, at) => total + stock[at]!, 0);
    // Across many pieces the middle sizes carry more than the ends.
    let middle = 0;
    let ends = 0;
    for (let n = 0; n < 200; n += 1) {
      middle += wearStock(`B0${n}`, "41", sizes);
      ends += wearStock(`B0${n}`, "36", sizes);
    }
    expect(middle).toBeGreaterThan(ends);
    expect(sum([0])).toBeGreaterThanOrEqual(0);
  });
});

describe("cleanWearTitle", () => {
  it("prints a title without Amazon's prefixes, model codes, sizes or repeated colours", () => {
    expect(cleanWearTitle("Men's Boots Traveller Lace-Up Brown (Brown) US 12", "find.")).toBe("Men's Boots Traveller Lace-Up Brown");
    expect(cleanWearTitle("Men's Amz28/01 Loafers", "find.")).toBe("Men's Loafers");
    expect(cleanWearTitle("Amazon Brand: Eono Essentials Carrying Bag", "Eono")).toBe("Carrying Bag");
    expect(cleanWearTitle("FIND Women's Mules with Suede Cross-Over Upper", "find.")).toBe("Women's Mules with Suede Cross-Over Upper");
    expect(cleanWearTitle("HIKARO Checked Scarf for Women & Men - Elegant Plaid Pattern - High Quality", "HIKARO")).toBe("Checked Scarf for Women & Men");
    expect(cleanWearTitle("Womens Block Heel Sandal 8.5 M US", null)).toBe("Women's Block Heel Sandal");
  });

  it("says repeated words once, and drops bare model numbers and sizes written either way round", () => {
    expect(cleanWearTitle("Men's Suede Casual Desert Desert Boots Desert Boots", "find.")).toBe("Men's Suede Casual Desert Boots");
    expect(cleanWearTitle("Women's 36905 Boots", "find.")).toBe("Women's Boots");
    expect(cleanWearTitle("Women's Boots Ankle Block Heel Pointed toe Black 8 UK", "find.")).toBe("Women's Boots Ankle Block Heel Pointed toe Black");
  });

  it("drops codes joined to words by underscores or hash signs, and a colour said again after a dash", () => {
    expect(cleanWearTitle("Amz038_Leather Men's Boat Shoes", "find.", "SHOES")).toBe("Leather Men's Boat Shoes");
    expect(cleanWearTitle("Women's #_INNIS-S-17 Gladiator Sandals", "find.", "SANDAL")).toBe("Women's Gladiator Sandals");
    expect(cleanWearTitle("Women's #_DARLING 1W3 Closed Toe Sandals", "find.", "SANDAL")).toBe("Women's DARLING Closed Toe Sandals");
    expect(cleanWearTitle("Casual Daypack – Black", "AmazonBasics", "BACKPACK")).toBe("Casual Daypack");
    expect(cleanWearTitle("Women's 10311a Open-Toe Sandals", "find.", "SANDAL")).toBe("Women's Open-Toe Sandals");
    expect(cleanWearTitle("Women's Buckle Slider Sandals White6 UK", "find.", "SANDAL")).toBe("Women's Buckle Slider Sandals White");
    expect(cleanWearTitle("Listilla Women's Flatform Ankle Strap Microsuede Cognac 39.5", "The Drop", "SHOES")).toBe("Listilla Women's Flatform Ankle Strap Microsuede Cognac Shoes");
    // Gold is written 14K; that stays.
    expect(cleanWearTitle("14K Gold Hoop Earrings", null, "EARRING")).toBe("14K Gold Hoop Earrings");
  });

  it("ends a long title where it names the piece, names a piece the title never names, and leaves nothing dangling", () => {
    expect(cleanWearTitle("Platinum Plated Sterling Silver Leverback Drop Earrings Set with Round Cut", null, "EARRING")).toBe("Platinum Plated Sterling Silver Leverback Drop Earrings");
    expect(cleanWearTitle("Omens Winter Bucket Gatsby Derby Hat 1920s Fedora Round Cloche Bowler Beret Fall", null, "HAT")).toBe("Omens Winter Bucket Gatsby Derby Hat");
    expect(cleanWearTitle("Sterling Silver Alternating Sapphire and White Prong Set Cubic Zirconia Tennis", null, "BRACELET")).toBe(
      "Sterling Silver Alternating Sapphire and White Prong Set Cubic Zirconia Tennis Bracelet",
    );
    expect(cleanWearTitle("Platinum-Plated Sterling Silver Princess Cut Leverback Earrings made with", null, "EARRING")).toBe("Platinum-Plated Sterling Silver Princess Cut Leverback Earrings");
    // A short title is left as it is.
    expect(cleanWearTitle("Cotton Cloche Hat", null, "HAT")).toBe("Cotton Cloche Hat");
  });

  it("takes a label named only in the title as the brand, and keeps brackets, size suffixes and codes out of the name", () => {
    expect(brandFromTitle("The Drop Ivette Women's Flat Shape Sandals")).toBe("The Drop");
    expect(brandFromTitle("Monika Women's Flat Mules with H Strap by The Drop")).toBe("The Drop");
    expect(brandFromTitle("Women's Flat Sandals")).toBeNull();
    expect(brandFromTitle("AmazonBasics Anti-Theft Rolltop Backpack")).toBe("AmazonBasics");
    // One spelling per brand, so the same piece from two marketplaces is one product.
    expect(canonicalBrand("AmazonBasics Licensing")).toBe("AmazonBasics");
    expect(canonicalBrand("Care of by Puma")).toBe(canonicalBrand("CARE OF by PUMA"));
    expect(canonicalBrand("  Burwood ")).toBe("Burwood");
    expect(canonicalBrand(" ")).toBeNull();
    expect(cleanWearTitle("AmazonBasics Sling Bag Backpack", "AmazonBasics", "BACKPACK")).toBe("Sling Bag Backpack");
    expect(cleanWearTitle("The Drop Ivette Women's Flat Shape Sandals", "The Drop", "SANDAL")).toBe("Ivette Women's Flat Shape Sandals");
    expect(cleanWearTitle("Monika Women's Flat Mules with H Strap by The Drop", "The Drop", "SANDAL")).toBe("Monika Women's Flat Mules with H Strap");
    expect(cleanWearTitle("Men's Moccasin Black)", "find.", "SHOES")).toBe("Men's Moccasin Black");
    expect(cleanWearTitle("Men's Grey Leather Boots-10", "Symbol", "BOOT")).toBe("Men's Grey Leather Boots");
    expect(cleanWearTitle("find. Mens Blue Navy Suede Leather Slipper Size 46 UK", "find.", "SHOES")).toBe("Men's Blue Navy Suede Leather Slipper");
    expect(cleanWearTitle("Ribbed Cuff Beanie One Size", null, "HAT")).toBe("Ribbed Cuff Beanie");
    expect(cleanWearTitle("Women's 137.271new Espadrilles", "find.", "SANDAL")).toBe("Women's Espadrilles");
    expect(cleanWearTitle("Ming-s-1b-108 Women's Espadrilles", "find.", "SANDAL")).toBe("Women's Espadrilles");
    expect(cleanWearTitle("Sterling Silver Heart with Mother-of-Pearl Cross Design Locket", null, "NECKLACE")).toBe("Sterling Silver Heart with Mother-of-Pearl Cross Design Locket");
    expect(cleanWearTitle("Sterling Silver And K iero-go-rudodaiyamondoakusento Earrings", null, "EARRING")).toBeNull();
  });

  it("files footwear by its own noun", () => {
    expect(wearKindFor("SHOES", "Women's Gladiator Sandals")).toBe("SANDAL");
    expect(wearKindFor("SHOES", "Women's Casual Suede Chelsea Boots")).toBe("BOOT");
    expect(wearKindFor("BOOT", "Men's Desert Shoes")).toBe("BOOT");
  });

  it("refuses titles a person could not read, or that contradict themselves", () => {
    expect(cleanWearTitle("[Find] Amazon Collection suri-pi-susuta-ringusiruba- 16", null)).toBeNull();
    expect(cleanWearTitle("K go-rudobondyingusuta-ringusiruba- 2", null)).toBeNull();
    expect(cleanWearTitle("Men's Loafers, Black, Womens 10", "find.")).toBeNull();
    expect(cleanWearTitle("‘Care of’ by Puma", "Care of by Puma")).toBeNull();
  });
});

describe("isKindAsListed", () => {
  it("knows a shopping basket is not a tote, a gaiter is not a scarf, a nappy bag is not a backpack", () => {
    expect(isKindAsListed("TOTE_BAG", "Foldable Shopping Bag with Aluminium Handles")).toBe(false);
    expect(isKindAsListed("SCARF", "Seamless Neck Gaiter with Earloop Face Scarf")).toBe(false);
    expect(isKindAsListed("BACKPACK", "Changing Bag Backpack with Pram Clips")).toBe(false);
    expect(isKindAsListed("BACKPACK", "Leather Rucksack Backpack")).toBe(true);
    expect(isKindAsListed("SHOES", "Women's Leather Ballet Flats")).toBe(true);
    // ABO files these under wearables' types.
    expect(isKindAsListed("HAT", "Thermal Boot Socks")).toBe(false);
    expect(isKindAsListed("HANDBAG", "Women's Microfibre Thong_do Not Use")).toBe(false);
    expect(isKindAsListed("HAT", "Unisex Ear Hangers Face Balaclava")).toBe(false);
  });
});

describe("cleanColourLabel", () => {
  it("prints a colour a person would say, or nothing", () => {
    expect(cleanColourLabel("Black_99765")).toBe("Black");
    expect(cleanColourLabel("Black (Black)")).toBe("Black");
    expect(cleanColourLabel("Brown (Beige)")).toBe("Brown");
    expect(cleanColourLabel("Multicolour (Red Print)")).toBe("Red print");
    expect(cleanColourLabel("Navy Blue:: Mustard")).toBe("Navy blue and mustard");
    expect(cleanColourLabel("grey")).toBe("Grey");
    expect(cleanColourLabel("16 Pcs (4l+8m+4s)")).toBeNull();
    expect(cleanColourLabel("A#white-vb")).toBeNull();
    expect(cleanColourLabel(null)).toBeNull();
  });
});

describe("wearChart", () => {
  it("gives a shoe's foot length for each EU size, and a hat's head circumference for S, M and L", () => {
    expect(wearChart("BOOT", ["38", "42"])).toEqual([{ measure: { en: "Foot length, cm", el: "Μήκος πέλματος, εκ." }, values: { "38": 23.8, "42": 26.5 } }]);
    expect(wearChart("HAT", ["S", "M", "L"])?.[0]?.values).toEqual({ S: 55, M: 57, L: 59 });
    expect(wearChart("HAT", ["One size"])).toBeNull();
    expect(wearChart("HANDBAG", ["One size"])).toBeNull();
  });
});
