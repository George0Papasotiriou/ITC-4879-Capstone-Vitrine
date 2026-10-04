/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Wearables from Amazon Berkeley Objects: which listings they are, what the shop calls them, and the sizes each is sold in.
 */

/**
 * docs/adr/061. ABO (CC BY 4.0) has almost no garments, but thousands of
 * wearables photographed in a studio on white: shoes, boots and sandals, bags,
 * hats, scarves, sunglasses, jewellery and watches. This module is the shop's
 * reading of them, pure and tested:
 *
 * - which ABO product types are wearables, and the shop's own kind for each
 *   (ABO files a scarf under ACCESSORY beside balaclavas and children's
 *   mitten sets, and necklaces with bracelets, so some are told apart by the
 *   words of their title);
 * - who a piece is for (women, men, both), read from its title, which decides
 *   a shoe's size run;
 * - the sizes each kind is sold in, each its own variant with its own stock
 *   (docs/adr/022's pattern): shoes in EU sizes, hats S/M/L or one size.
 *
 * Children's pieces are left out: their sizes are another system, and the
 * shop's fit tools are built for adults.
 */

import { stableUnit } from "@/lib/catalog/taxonomy";

/** The shop's kinds of wearable. */
export const WEAR_KINDS = ["SHOES", "BOOT", "SANDAL", "HANDBAG", "TOTE_BAG", "WALLET", "BACKPACK", "HAT", "SCARF", "SUNGLASSES", "EARRING", "NECKLACE", "BRACELET", "WATCH"] as const;
export type WearKind = (typeof WEAR_KINDS)[number];

/** ABO product types that are wearables, and the shop's kind for each (null: decided by the title). */
export const ABO_WEAR_TYPES: Readonly<Record<string, WearKind | null>> = {
  SHOES: "SHOES",
  TECHNICAL_SPORT_SHOE: "SHOES",
  BOOT: "BOOT",
  SANDAL: "SANDAL",
  HANDBAG: "HANDBAG",
  TOTE_BAG: "TOTE_BAG",
  WALLET: "WALLET",
  BACKPACK: "BACKPACK",
  HAT: "HAT",
  ACCESSORY: null,
  SUNGLASSES: "SUNGLASSES",
  EARRING: "EARRING",
  FINEEARRING: "EARRING",
  FASHIONEARRING: "EARRING",
  NECKLACE: "NECKLACE",
  FINENECKLACEBRACELETANKLET: null,
  FASHIONNECKLACEBRACELETANKLET: null,
  BRACELET: "BRACELET",
  WATCH: "WATCH",
};

const CHILDREN = /\b(kids?|child(ren)?'?s?|girls?'?s?|boys?'?s?|toddler|baby|infant|junior|youth|little kid|big kid)\b/i;
const SCARF = /\b(scarf|scarves|shawl|wrap|stole|pashmina|snood)\b/i;
const BRACELET = /\b(bracelet|bangle|anklet|cuff)\b/i;
const NECKLACE = /\b(necklace|pendant|chain|choker|locket)\b/i;

/** Whether a title is for children, whose sizes are another system. */
export const forChildren = (title: string) => CHILDREN.test(title);

/**
 * The shop's kind for an ABO listing, or null when it is not a wearable the
 * shop sells: a type it does not take, a child's piece, or an ACCESSORY that
 * is not a scarf (balaclavas, glove-and-hat sets).
 */
export function wearKindFor(aboType: string, title: string): WearKind | null {
  if (!(aboType in ABO_WEAR_TYPES) || forChildren(title)) return null;
  const fixed = ABO_WEAR_TYPES[aboType];
  // Footwear is filed loosely (gladiator sandals under SHOES, Chelsea boots under SHOES): the title's own noun decides.
  if (fixed === "SHOES" || fixed === "BOOT" || fixed === "SANDAL") {
    if (/\b(sandals?|slides?|espadrilles?|flip[- ]?flops?)\b/i.test(title)) return "SANDAL";
    if (/\b(boots?|booties?)\b/i.test(title)) return "BOOT";
    return fixed === "BOOT" ? "BOOT" : fixed === "SANDAL" ? "SANDAL" : "SHOES";
  }
  if (fixed !== null && fixed !== undefined) return fixed;
  if (aboType === "ACCESSORY") return SCARF.test(title) ? "SCARF" : null;
  // Necklaces and bracelets share one ABO type; the title says which (a "chain bracelet" is a bracelet).
  if (BRACELET.test(title)) return "BRACELET";
  if (NECKLACE.test(title)) return "NECKLACE";
  return null;
}

export type Wearer = "women" | "men" | "unisex";

/** Who a piece is for, from its title: "Women's", "Men's", or neither (both). */
export function wearerOf(title: string): Wearer {
  // Either apostrophe: listings write "Men's" and "Men’s".
  const women = /\b(women['’]?s?|womens|ladies|lady|damen|femme|mujer)\b/i.test(title);
  const men = /\b(men['’]?s?|mens|herren|homme|hombre)\b/i.test(title) && !/\bwomen/i.test(title);
  if (women && !men) return "women";
  if (men && !women) return "men";
  return "unisex";
}

/** EU shoe sizes the shop stocks, by who they are for. */
export const SHOE_SIZES: Readonly<Record<Wearer, readonly string[]>> = {
  women: ["36", "37", "38", "39", "40", "41", "42"],
  men: ["40", "41", "42", "43", "44", "45", "46"],
  unisex: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"],
};

export const HAT_SIZES = ["S", "M", "L"] as const;
export const ONE_SIZE = "One size";

/**
 * The sizes a wearable is sold in. Bags, scarves, sunglasses, jewellery and
 * watches come in one size. Who a shoe is for comes from the title the shop
 * shows when that title says, so the sizes agree with it; only a title that
 * says nothing falls back to the listing's own words. A listing such as
 * "Men's Loafers, Black, Womens 10" names one wearer and another's size.
 */
export function wearSizes(kind: WearKind, shownTitle: string, listedTitle: string = shownTitle): readonly string[] {
  if (kind === "SHOES" || kind === "BOOT" || kind === "SANDAL") {
    const shown = wearerOf(shownTitle);
    return SHOE_SIZES[shown === "unisex" ? wearerOf(listedTitle) : shown];
  }
  if (kind === "HAT") return /\b(one size|beanie|skull ?cap)\b/i.test(listedTitle) ? [ONE_SIZE] : HAT_SIZES;
  return [ONE_SIZE];
}

/**
 * EU (Paris point) shoe size from foot length: an EU size is 2/3 cm of last
 * length, and a last is about 1.5 cm longer than the foot it fits, so
 * size = (foot cm + 1.5) × 1.5. Used both to label the chart and, in the
 * Fit Engine, to turn a measured foot into a size (docs/adr/061).
 */
export const euSizeForFoot = (footCm: number) => (footCm + 1.5) * 1.5;
export const footForEuSize = (size: number) => size / 1.5 - 1.5;

/** Head circumference in centimetres for each hat size (S/M/L), the upper end of each. */
export const HAT_CHART = { S: 55, M: 57, L: 59 } as const;

/**
 * Stock of one size: the middle of a size run sells most, so it is stocked
 * deepest (a bell over the run), and about one size in twelve is sold out.
 * Deterministic from the piece and the size, like the rest of the synthetic
 * catalogue (taxonomy.ts stableUnit).
 */
export function wearStock(sourceId: string, size: string, sizes: readonly string[]): number {
  const draw = stableUnit(`wear-stock:${sourceId}:${size}`);
  if (draw < 0.08) return 0;
  const at = sizes.indexOf(size);
  const middle = (sizes.length - 1) / 2;
  const spread = sizes.length <= 1 ? 1 : Math.exp(-(((at - middle) / Math.max(1, middle)) ** 2) * 1.5);
  const depth = sizes.length <= 1 ? 24 : 12;
  return Math.max(1, Math.round(draw * depth * spread));
}

/**
 * Words that mark a listing as not the wearable its ABO type claims: a
 * shopping basket filed as a tote, a nappy bag as a backpack, a neck gaiter as
 * a scarf. Found by reading the first selection (2026-10-05).
 */
const NOT_THIS_KIND: Partial<Record<WearKind, RegExp>> = {
  TOTE_BAG: /\b(shopping|grocery|basket|reusable|pcs|pack of|laundry|cooler|insulated)\b/i,
  BACKPACK: /\b(changing|diaper|nappy|baseball|softball|equipment|camera|golf|cooler|lunch|insulated|school|hydration|tactical|pram)\b/i,
  HANDBAG: /\b(diaper|nappy|changing|laptop|camera|cosmetic|toiletry|grocery|shopping|reusable)\b/i,
  SCARF: /\b(gaiter|mask|balaclava|bandana|earloop|uv|dust|ski|protector|face)\b/i,
  HAT: /\b(helmet|hard hat|swim cap|shower cap|hairnet|balaclava|face shield|mask|earmuffs?|ear muffs?)\b/i,
  SHOES: /\b(insoles?|shoe care|polish|shoe trees?|laces only|socks?)\b/i,
  BOOT: /\b(insoles?|shoe care|polish|boot trees?|socks?)\b/i,
  SANDAL: /\b(insoles?|socks?)\b/i,
};

/** Listings ABO files under a wearable's type that are something else entirely (socks under HAT, a thong under HANDBAG). */
const NOT_A_WEARABLE = /\b(socks?|thong|underwear|lingerie|panties|bra|do not use|test listing)\b/i;

/**
 * Japanese written out syllable by syllable, as some listings' English titles are
 * ("suri-pi-susuta-ringusiruba-", "go-rudobondyingusuta-ringusiruba-"): a run of
 * hyphenated lower-case pieces that ends in a hyphen, or the transliterated
 * "silver" and "sterling".
 */
const TRANSLITERATED = /\b[a-z]+(?:-[a-z]+)+-(?=\s|$)|siruba|suta-ringu|ringusiruba|daiyamondo|akusento|go-rudo|\biero-/i;

/** Amazon's own fashion labels, which some listings name only in their title ("The Drop Ivette …", "… by The Drop"). */
const TITLE_BRANDS = ["The Drop", "The Fix", "206 Collective", "Goodthreads", "Daily Ritual", "Core 10", "Amazon Essentials", "AmazonBasics", "Symbol", "find."];

/**
 * The brand a listing names only in its title, when its brand field is
 * empty: one of Amazon's own fashion labels, at the start or after "by" at
 * the end. The caller strips it from the title with the brand it now has.
 */
export function brandFromTitle(title: string): string | null {
  for (const brand of TITLE_BRANDS) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^${escaped}\\s|\\bby\\s+${escaped}$`, "i").test(title.trim())) return brand;
  }
  return null;
}

/** One spelling per brand: listings from different marketplaces write the same label differently. */
const BRAND_SPELLINGS: readonly [RegExp, string][] = [
  [/^amazon\s*basics(\s+licensing)?$/i, "AmazonBasics"],
  [/^care\s+of\s+by\s+puma$/i, "CARE OF by PUMA"],
];

/** A brand as the shop prints it: trimmed, and in its one spelling where listings disagree ("AmazonBasics Licensing" is AmazonBasics). */
export function canonicalBrand(brand: string | null): string | null {
  const trimmed = brand?.trim() ?? "";
  if (trimmed === "") return null;
  return BRAND_SPELLINGS.find(([pattern]) => pattern.test(trimmed))?.[1] ?? trimmed;
}

/** Retail prefixes and marketplace noise ABO's titles carry ("Amazon Brand: find. …", "[Find] Amazon Collection …"). */
const RETAIL_PREFIX = /^(amazon\s+brand\s*[:\-–—]?\s*|by\s+amazon\s*[:\-–—]?\s*|\[find\]\s*|find\.?\s+|amazon\s+(collection|essentials)\s*|eono(\s+essentials)?\s*(by\s+amazon)?\s*[:\-–—]?\s*|care\s+of\s+by\s+puma\s*)/i;

/**
 * A wearable's title as a shop would print it, from the listing's own title
 * once `cleanTitle` (abo.ts) has had it: retail prefixes, Amazon's model codes
 * ("Amz28/01"), size tokens ("US 12", "8.5 M US"), a colour repeated in
 * brackets, and marketing tails (" - High Quality …") removed, and "Mens" and
 * "Womens" written with their apostrophe. Null when nothing a person would
 * read is left, or the title is garbled (Japanese transliterated syllable by
 * syllable, "suri-pi-susuta-ringusiruba-"), or says it is both men's and
 * women's, which a messy listing does.
 *
 * Given the piece's kind, a long title is also ended where the piece is named
 * ("… Leverback Drop Earrings Set with Round Cut" → "… Leverback Drop
 * Earrings"), because `cleanTitle` cut it at 80 characters, often mid-phrase;
 * and a title that never names the piece gets its name ("… Tennis" →
 * "… Tennis Bracelet").
 */
export function cleanWearTitle(title: string, brand: string | null, kind?: WearKind): string | null {
  if (TRANSLITERATED.test(title)) return null;
  // "Men's … Womens 10" is a messy listing; "for Women & Men" is a unisex piece.
  const men = /\bmen['’]s\b|\bmens\b/i.test(title);
  const women = /\bwomen['’]s\b|\bwomens\b/i.test(title);
  if (men && women) return null;
  // Underscores and hash signs join codes to words ("Amz038_Leather", "#_INNIS-S-17"): read them as spaces.
  let clean = title
    .replace(/’/g, "'")
    .replace(/[‘“”]/g, "")
    .replace(/[_#]+/g, " ");
  for (let pass = 0; pass < 3; pass += 1) clean = clean.replace(RETAIL_PREFIX, "").trim();
  if (brand !== null) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    clean = clean.replace(new RegExp(`^${escaped}\\s*[-–—:,]?\\s*`, "i"), "").replace(new RegExp(`\\s+by\\s+${escaped}$`, "i"), "");
  }
  // A bracket left without its pair once `cleanTitle` cut the title ("Moccasin Black)"): the word stays, the bracket goes.
  if (!clean.includes("(")) clean = clean.replace(/\)/g, "");
  clean = clean
    .replace(/\bamz\s?\d+(\/\d+)?\b/gi, "")
    .replace(/\b(us|uk|eu)\s?\d{1,2}(\.\d)?\b/gi, "")
    // A size before its system, even run into a colour ("White6 UK").
    .replace(/\d{1,2}(\.\d)?\s?(m|w|b|d)?\s?(us|uk|eu)\b/gi, "")
    // An EU half size left in the words ("Cognac 39.5 Shoes").
    .replace(/\b[34]\d\.5\b/g, "")
    // Bare model numbers ("Women's 36905 Boots", "10311a", "137.271new").
    .replace(/\b\d{4,}[a-z]?\b/g, "")
    .replace(/\b\d{2,3}\.\d{3}[a-z]*\b/gi, "")
    // Hyphenated style codes with a digit in them ("Ming-s-1b-108"); "Mother-of-Pearl" has none and stays.
    .replace(/\b(?=[\w-]*\d)[a-z0-9]+(?:-[a-z0-9]+){2,}\b/gi, "")
    // Style codes in capitals and digits ("INNIS-S-17", "1W3"): never "14K", which is gold.
    .replace(/\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])(?![0-9]+K\b)[A-Z0-9]+(?:-[A-Z0-9]+)+\b|\b\d[A-Z]\d\b/g, "")
    // A size hung on a word ("Boots-10"), once the codes are gone.
    .replace(/(?<=[a-z])-\d{1,2}(\.\d)?\b/gi, "")
    .replace(/\s*\([^)]*\)/g, "")
    // A colour said again at the end after a dash ("Casual Daypack – Black").
    .replace(/\s+[-–—]\s+(black|white|navy|grey|gray|blue|red|green|brown|beige|pink|tan|khaki|silver|gold)$/i, "")
    .replace(/\s+[-–—|]\s+(high quality|elegant|perfect|premium|ideal|great|best|gift|stylish)\b.*$/i, "")
    .replace(/\bmens\b/gi, "Men's")
    .replace(/\bwomens\b/gi, "Women's")
    // The word "Size" left at the end once its number went ("Slipper Size 46 UK"), and "One Size", which the size picker says.
    .replace(/\s+(one\s+)?size\s*$/i, "")
    .replace(/[’]/g, "'")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s\-–—,:;|/&+]+$/, "")
    .trim();
  // Words said twice ("Desert Desert Boots Desert Boots"): a repeated run of up to three words is said once.
  for (let size = 3; size >= 1; size -= 1) {
    clean = clean.replace(new RegExp(`\\b((?:\\S+\\s+){${size - 1}}\\S+)(?:\\s+\\1\\b)+`, "gi"), "$1");
  }
  if (kind !== undefined) clean = namedPiece(clean, kind);
  const letters = (text: string) => text.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (clean.length < 8 || (brand !== null && letters(clean) === letters(brand))) return null;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** The words that name each kind of piece in a title, and the name it is given when the title never says it. */
const PIECE_NOUNS: Record<WearKind, { nouns: RegExp; name: string }> = {
  SHOES: { nouns: /\b(shoes?|sneakers?|trainers?|loafers?|pumps?|flats?|mules?|oxfords?|brogues?|moccasins?|clogs?|slippers?|heels?)\b/gi, name: "Shoes" },
  BOOT: { nouns: /\b(boots?|booties?)\b/gi, name: "Boots" },
  SANDAL: { nouns: /\b(sandals?|slides?|espadrilles?|mules?)\b/gi, name: "Sandals" },
  HANDBAG: { nouns: /\b(bags?|handbags?|totes?|clutch|crossbody|satchel|purse|bowler|hobo)\b/gi, name: "Bag" },
  TOTE_BAG: { nouns: /\b(totes?|bags?)\b/gi, name: "Tote" },
  WALLET: { nouns: /\b(wallets?|clutch|card (case|holder)|purse)\b/gi, name: "Wallet" },
  BACKPACK: { nouns: /\b(backpacks?|daypacks?|rucksacks?)\b/gi, name: "Backpack" },
  HAT: { nouns: /\b(hats?|caps?|berets?|beanies?|fedoras?|cloches?)\b/gi, name: "Hat" },
  SCARF: { nouns: /\b(scarf|scarves|shawls?|wraps?|stoles?)\b/gi, name: "Scarf" },
  SUNGLASSES: { nouns: /\b(sunglasses|glasses)\b/gi, name: "Sunglasses" },
  EARRING: { nouns: /\b(earrings?|studs?|hoops?)\b/gi, name: "Earrings" },
  NECKLACE: { nouns: /\b(necklaces?|pendants?|lockets?|chains?|chokers?)\b/gi, name: "Necklace" },
  BRACELET: { nouns: /\b(bracelets?|anklets?|bangles?|cuffs?)\b/gi, name: "Bracelet" },
  WATCH: { nouns: /\b(watch|watches|chronograph)\b/gi, name: "Watch" },
};

/** Words a title cut short may be left ending on. */
const DANGLING = /\s+(with|and|or|for|made|set|in|of|the|a|by|to|on|from|plus|&)$/i;

/**
 * A long title ended just after the first naming of the piece that leaves at
 * least a few words before it; a title that never names it, given its name;
 * and no title left ending on "with" or "and".
 */
export function namedPiece(title: string, kind: WearKind): string {
  const { nouns, name } = PIECE_NOUNS[kind];
  let named = title;
  if (named.length > 55) {
    for (const match of named.matchAll(nouns)) {
      const end = (match.index ?? 0) + match[0].length;
      if (end >= 18) {
        named = named.slice(0, end);
        break;
      }
    }
  }
  for (let pass = 0; pass < 3; pass += 1) named = named.replace(DANGLING, "").trim();
  nouns.lastIndex = 0;
  if (!nouns.test(named)) named = `${named} ${name}`;
  nouns.lastIndex = 0;
  return named;
}

/** Whether a listing is the wearable its kind says, by the words of its title. */
export function isKindAsListed(kind: WearKind, title: string): boolean {
  // Underscores join words in some listings ("Thong_do Not Use"): read them as spaces.
  const words = title.replace(/_/g, " ");
  return !NOT_A_WEARABLE.test(words) && !(NOT_THIS_KIND[kind]?.test(words) ?? false);
}

/**
 * A colour as a shop prints it, from ABO's colour field: "Black_99765" →
 * "Black", "Black (Black)" → "Black", "Brown (Beige)" → "Brown",
 * "Multicolour (Red Print)" → "Red print", "Navy Blue:: Mustard" → "Navy blue
 * and mustard". Null for anything that is not a colour ("16 Pcs (4l+8m+4s)",
 * "A#white-vb"), so the page falls back to the catalogue's colour words.
 */
export function cleanColourLabel(label: string | null): string | null {
  if (label === null) return null;
  const outer = label.replace(/\s*\(([^)]*)\)\s*/g, " ").replace(/_\d+$/, "").trim();
  const inner = /\(([^)]*)\)/.exec(label)?.[1]?.trim() ?? null;
  let colour = /^multi-?colou?r$/i.test(outer) && inner !== null ? inner : outer;
  colour = colour.replace(/\s*::\s*/g, " and ").replace(/\s+/g, " ").trim();
  if (colour === "" || /[\d#_+]|pcs\b/i.test(colour) || colour.length > 32) return null;
  const lower = colour.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** A size chart row for wearables: one measurement, its value for each size the piece is sold in. */
export type WearChartRow = { measure: { en: string; el: string }; values: Record<string, number> };

/**
 * The size chart a wearable's page shows: a shoe's foot length for each EU
 * size (to the millimetre, from the Paris point: `footForEuSize`), a hat's
 * head circumference for S, M and L. Null for pieces in one size.
 */
export function wearChart(kind: string, sizes: readonly string[]): WearChartRow[] | null {
  if (kind === "SHOES" || kind === "BOOT" || kind === "SANDAL") {
    const values = Object.fromEntries(sizes.map((size) => [size, Math.round(footForEuSize(Number(size)) * 10) / 10]));
    return [{ measure: { en: "Foot length, cm", el: "Μήκος πέλματος, εκ." }, values }];
  }
  if (kind === "HAT" && sizes.every((size) => size in HAT_CHART)) {
    const values = Object.fromEntries(sizes.map((size) => [size, HAT_CHART[size as keyof typeof HAT_CHART]]));
    return [{ measure: { en: "Head circumference, up to cm", el: "Περίμετρος κεφαλιού, έως εκ." }, values }];
  }
  return null;
}
