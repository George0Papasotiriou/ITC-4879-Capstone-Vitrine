/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reading real garments from Amazon's product listings: which kind each is, who it is for, and its title, fabric and price as a shop prints them.
 */

import type { CapsuleKind } from "@/lib/catalog/capsule";
import { stableUnit } from "@/lib/catalog/taxonomy";
import { COLORS, extractTerms, MATERIALS, type ColorId, type MaterialId } from "@/lib/search/vocabulary";
import { palette, type Rgb } from "@/lib/vision/palette";

/**
 * docs/adr/062. The clothes come from the product listings of Amazon Reviews
 * 2023: a listing's category path ("Clothing, Shoes & Jewelry › Women ›
 * Clothing › Dresses › Casual") says what it is, its `store` who made it,
 * and its bullet points what it is made of. Everything here is pure, so the
 * rules can be tested on the titles that taught them.
 *
 * The garments take the capsule's kinds (docs/adr/022), so the size charts,
 * the size finder, preferences, the Fitting Room and try-on work for them as
 * they did for the drawn pieces.
 */

export type Department = "women" | "men";

/** Who a listing is for: the details' "Department" when it says, else the category path. */
export function departmentOf(categories: readonly string[], details: Readonly<Record<string, string>> = {}): Department | null {
  const stated = (details.Department ?? "").toLowerCase();
  if (/\b(women|womens|ladies)\b/.test(stated)) return "women";
  if (/\b(men|mens)\b/.test(stated)) return "men";
  if (categories[1] === "Women") return "women";
  if (categories[1] === "Men") return "men";
  return null;
}

/** Bracketed asides: "(Available in Plus Size)", "[2 Pack]", "【Soft】". */
const withoutAsides = (text: string) => text.replace(/\s*\([^)]*\)|\s*\[[^\]]*\]|\s*【[^】]*】/g, " ");

/** Category paths and titles the shop does not sell: underwear, swimwear, costumes, children's and maternity clothes, sportswear, multipacks, slogans. */
const NOT_SOLD_PATH = /active|lingerie|sleep|lounge|swim|socks|hosiery|underwear|costume|novelty|uniform|work ?wear|maternity|jumpsuits|rompers|overalls|shorts|leggings|bodysuits|plus-size|big & tall|prom|wedding|tuxedo/i;
const NOT_SOLD_TITLE = new RegExp(
  [
    "costumes?|cosplay|pajamas?|pyjamas?|lingerie|thongs?|bras?|underwear|briefs|boxers?|swim\\w*|bikinis?|bathing|cover ?ups?|maternity|leggings?|shorts|rompers?|jumpsuits?",
    "scrubs?|uniforms?|plus[ -]size|big (and|&) tall|kids?|girls?|boys?|juniors?|toddlers?|baby|halloween|tactical|bibs?|nightgowns?|robes?|bodysuits?|corsets?|shapewear",
    "tutu|cheerleader|sets?|\\d+[ -]?piece|two[ -]piece|funny|graphic|novelty|slogan|letter print|patriotic|flag|christmas|gift for|cannabis|skull",
    "wedding|bridal|bridesmaids?|prom|rain ?suits?|ponchos?|capes?|kimonos?|coveralls?|aprons?",
  ]
    .map((part) => `\\b(${part})\\b`)
    .join("|"),
  "i",
);
/** Several pieces sold as one ("Multipack", "(2-Pack)"): read in the whole title, asides included. */
const MULTIPACK = /\b(\d+[ -]?(packs?|pcs|pieces|count)|pack of \d+|multi-?packs?|value packs?|bundles?)\b/i;

export function notSold(categories: readonly string[], title: string): boolean {
  return NOT_SOLD_PATH.test(categories.slice(3).join(" > ")) || NOT_SOLD_TITLE.test(withoutAsides(title)) || MULTIPACK.test(title);
}

const COAT_WORDS = /\b(coats?|overcoats?|parkas?|trench|pea ?coats?|peacoats?|puffers?|anoraks?|raincoats?|topcoats?|duffle)\b/i;
const JACKET_WORDS = /\b(jackets?|blazers?|bombers?|truckers?|shackets?)\b/i;
const VEST_WORDS = /\b(vests?|gilets?|waistcoats?)\b/i;
const BLAZER_WORDS = /\b(blazers?|sport coats?|suit jackets?)\b/i;
const BUTTON_SHIRT = /\b(button[- ]?(down|up|front)|dress shirts?|oxford|flannel|blouses?|chambray|poplin|linen shirts?)\b/i;
const KNIT_WORDS = /\b(sweaters?|cardigans?|pullovers?|jumpers?|hoodies?|sweatshirts?|turtlenecks?)\b/i;

/** Where in a text a pattern first matches, or Infinity. */
const firstAt = (text: string, pattern: RegExp) => {
  const at = text.search(pattern);
  return at < 0 ? Number.POSITIVE_INFINITY : at;
};

/**
 * The kind of a garment, from its listing's category path, then its title
 * where the path is broad (a "Coats, Jackets & Vests" listing is a coat or a
 * jacket by what its title calls it first). Null for what the shop does not
 * sell — vests are left out because no size chart here fits them.
 */
export function clothesKindFor(categories: readonly string[], title: string): CapsuleKind | null {
  if (categories[0] !== "Clothing, Shoes & Jewelry" || categories[2] !== "Clothing") return null;
  if (notSold(categories, title)) return null;
  const group = categories[3] ?? "";
  const sub = categories[4] ?? "";
  const name = withoutAsides(title);
  if (/^Dresses/.test(group)) return /\b(dress(es)?|gowns?|sundress(es)?)\b/i.test(name) ? "DRESS" : null;
  if (/^Skirts/.test(group)) return /\bskirts?\b/i.test(name) ? "SKIRT" : null;
  if (/^(Pants|Jeans)/.test(group)) return /\b(pants|trousers|jeans?|chinos?|slacks|joggers)\b/i.test(name) && !/\b(sweatpants|palazzo|lounge)\b/i.test(name) ? "TROUSERS" : null;
  if (/^(Sweaters|Fashion Hoodies|Hoodies|Sweatshirts)/.test(group)) return VEST_WORDS.test(name) ? null : "KNIT";
  if (/^(Coats, Jackets|Jackets & Coats)/.test(group)) {
    if (VEST_WORDS.test(`${sub} ${name}`)) return null;
    if (BLAZER_WORDS.test(name)) return "JACKET";
    const coat = firstAt(name, COAT_WORDS);
    const jacket = firstAt(name, JACKET_WORDS);
    if (coat !== jacket) return coat < jacket ? "COAT" : "JACKET";
    // The title names neither: the category does ("Denim Jackets", "Wool & Pea Coats").
    return COAT_WORDS.test(sub) ? "COAT" : JACKET_WORDS.test(sub) ? "JACKET" : null;
  }
  if (/^Suit/.test(group)) return BLAZER_WORDS.test(`${sub} ${name}`) && !VEST_WORDS.test(name) ? "JACKET" : null;
  if (/^(Tops, Tees|Shirts)/.test(group)) {
    if (KNIT_WORDS.test(name)) return "KNIT";
    if (BUTTON_SHIRT.test(name) || /Button-Down|Dress Shirts|Blouses/.test(sub)) return "SHIRT";
    return /\b(t-?shirts?|tees?|tops?|tanks?|camis?|polos?|henleys?|tunics?|shirts?)\b/i.test(name) ? "TOP" : null;
  }
  return null;
}


/**
 * Words a listing repeats for search engines, not for people. The wearer goes
 * too: the Department filter says it. A word inside a hyphenated one stays
 * ("Classic-Fit" is not "-Fit").
 */
const MARKETING = new RegExp(
  "(?<![\\w'-])(for (wo)?men|(wo)?men(['’]s|s['’]?)?|ladies|lady|unisex|adults?|multi-?colou?red|fashion(able)?|trendy|sexy|cute|sweet|stylish|elegant|chic|novelty|new|hot|basic|classic|casual|comfy|flowy|soft|lightweight|loose|oversized|summer|spring|autumn|fall|winter|20\\d\\d|clothes|clothing|outfits?|apparel)(?![\\w'-])",
  "gi",
);
/** Style codes ("WB1207", "Style G1100") are stock-keeping, not names; Levi's 501 is a name and stays. */
const STYLE_CODE = /\b(style\s+)?([A-Z]{1,4}\d{2,}[A-Z]*|\d{1,3}[A-Z]{2,})\b/g;
/** Fabric weights ("6.1 Oz.") belong on the label, not in the name. */
const WEIGHT = /\b\d+(\.\d+)?\s*oz\.?(?=\s|$)/gi;

/** The piece nouns a good name ends with, by kind. */
const NOUNS: Record<CapsuleKind, RegExp> = {
  TOP: /\b(t-?shirts?|tees?|tops?|tanks?|camis?|polos?|henleys?|tunics?|shirts?)\b/gi,
  SHIRT: /\b(shirts?|blouses?)\b/gi,
  KNIT: /\b(sweaters?|cardigans?|pullovers?|jumpers?|hoodies?|sweatshirts?|turtlenecks?)\b/gi,
  TROUSERS: /\b(pants|trousers|jeans?|chinos?|slacks|joggers)\b/gi,
  SKIRT: /\b(skirts?)\b/gi,
  DRESS: /\b(dress(es)?|gowns?|sundress(es)?)\b/gi,
  COAT: /\b(coats?|overcoats?|parkas?|trench|peacoats?|puffers?|anoraks?|raincoats?|jackets?)\b/gi,
  JACKET: /\b(jackets?|blazers?|bombers?|shackets?|truckers?)\b/gi,
};
/** Every kind's nouns: a leading one ("Tops Long Sleeve Tee") is a keyword, not a name. */
const ANY_PIECE = /^(t-?shirts?|tees?|tops?|shirts?|blouses?|dress(es)?|sweaters?|hoodies?|pants|jeans|skirts?|coats?|jackets?|blazers?)\b\s*/i;
/** Nouns that name another kind outright: a skirt called a "Midi Dress … Skirt" is a muddled listing. */
const OTHER_KIND: Record<CapsuleKind, RegExp> = {
  TOP: /\b(dress(es)?|skirts?|pants|jeans|jackets?|coats?)\b/i,
  SHIRT: /\b(dress(es)?|skirts?|pants|jeans|tanks?|camis?)\b/i,
  KNIT: /\b(dress(es)?|skirts?|pants|jeans|shirts?|blouses?|tops?|tees?)\b/i,
  TROUSERS: /\b(dress(es)?|skirts?|shirts?|tops?)\b/i,
  SKIRT: /\b(dress(es)?|pants|jeans|shirts?|tops?)\b/i,
  DRESS: /\b(skirts?|pants|jeans|jackets?|coats?)\b/i,
  COAT: /\b(dress(es)?|skirts?|pants|jeans|suits?)\b/i,
  JACKET: /\b(dress(es)?|skirts?|pants|jeans|suits?)\b/i,
};
/** A name fits two lines of a product tile. */
export const MAX_TITLE = 48;
/** A plural or a run-together noun at the end, said as a shop says one piece. */
const SINGULAR: [RegExp, string][] = [
  [/\bt-?shirts?$/i, "T-Shirt"],
  [/\btshirts?$/i, "T-Shirt"],
  [/\bdresses$/i, "Dress"],
  [/\b(shirt|blouse|top|tee|tank|cami|polo|tunic|sweater|cardigan|pullover|hoodie|sweatshirt|skirt|coat|jacket|blazer|parka)s$/i, "$1"],
];

const capitalise = (word: string) => (/^[a-z]/.test(word) && !/^(and|or|with|in|of|to|a|the|for)$/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word);
const lettersOf = (text: string) => text.replace(/[^a-z0-9]/gi, "").toLowerCase();

/** The title without the brand it starts with, however the brand is punctuated ("JOA" for "J.O.A.", "Cat" not inside "Caterpillar"). */
function withoutBrand(title: string, brand: string | null): string {
  if (brand === null || lettersOf(brand) === "") return title;
  const target = lettersOf(brand);
  const words = title.split(/\s+/);
  let letters = "";
  for (let index = 0; index < Math.min(words.length, 10); index += 1) {
    letters += lettersOf(words[index]!);
    if (letters === target) return words.slice(index + 1).join(" ").replace(/^(company|co\.?|clothing( co\.?)?|apparel)\s+/i, "");
    if (!target.startsWith(letters)) break;
  }
  // The brand's first word alone ("Novias …" for "Novia's Choice"), when it is a word of its own.
  const brandFirst = lettersOf(brand.split(/\s+/)[0] ?? "");
  if (brandFirst.length >= 4 && words.length > 2 && lettersOf(words[0]!) === brandFirst) return words.slice(1).join(" ");
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title.replace(new RegExp(`\\s+by\\s+${escaped}\\b.*$`, "i"), "");
}

/**
 * A garment's name as a shop prints it: "Surplice Dress", not "Amazon
 * Essentials Women's Surplice Dress (Available in Plus Size)". The brand,
 * the wearer (the Department filter says it), bracketed asides, keyword lists
 * after the first comma or dash, style codes and search-engine words go; the
 * name ends at the first noun of its kind that follows a describing word.
 * Null when nothing printable is left, when the name never says what the
 * piece is or names another kind, or when it is too long for a tile.
 */
export function cleanClothesTitle(title: string, brand: string | null, kind: CapsuleKind): string | null {
  let clean = withoutBrand(title.replace(/[’‘]/g, "'").replace(/[“”"]/g, ""), brand);
  clean = withoutAsides(clean)
    .replace(/^by\s+\S+\s+/i, "")
    // Keyword lists start at the first comma, dash or bar.
    .split(/\s*[,|/]\s*(?!\d)|\s+[-–—]\s+/)[0]!
    .replace(MARKETING, " ")
    .replace(STYLE_CODE, " ")
    .replace(WEIGHT, " ")
    // "Loose Fit" without "Loose" is not a name; the fit is said in the bullet points.
    .replace(/^\s*fit\s+/i, "")
    // A stray "Tops" inside a blouse's or a sweater's name is a keyword.
    .replace(kind === "TOP" ? /$^/ : /\s+tops?(?=\s)/gi, " ")
    .replace(/\b3\/4\s+sleeves?\b/gi, "Three-Quarter Sleeve")
    // "T Shirt" and "Tshirt" are spelt as a shop spells them.
    .replace(/\bt\s+shirt(s?)\b|\btshirt(s?)\b/gi, (_match, plural: string | undefined, other: string | undefined) => `T-Shirt${plural ?? other ?? ""}`)
    .replace(/\s{2,}/g, " ")
    .trim();
  while (ANY_PIECE.test(clean) && clean.split(" ").length > 3) clean = clean.replace(ANY_PIECE, "");
  // End at the first noun of the kind that has a word before it: "Pencil Dress Midi Business Dress" is a "Pencil Dress".
  const first = [...clean.matchAll(NOUNS[kind])].find((match) => (match.index ?? 0) > 0);
  // A name that never says what the piece is, or says it is something else, is not printed.
  if (first === undefined) return null;
  clean = clean.slice(0, (first.index ?? 0) + first[0].length);
  if (OTHER_KIND[kind].test(clean)) return null;
  for (const [pattern, replacement] of SINGULAR) clean = clean.replace(pattern, replacement);
  clean = clean
    .replace(/^(with|and|in|for|of|&)\s+/i, "")
    .replace(/\s+(with|and|in|for|of|&)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // A word said twice in a row ("Dress Dress") is said once.
  clean = clean.replace(/\b(\w+)(\s+\1\b)+/gi, "$1");
  const words = clean.split(" ").filter((word) => word !== "");
  if (words.length < 2 || clean.length < 8 || clean.length > MAX_TITLE) return null;
  // Only nouns ("Blouses Shirt") is a keyword list, not a name.
  if (words.every((word) => ANY_PIECE.test(word) || new RegExp(`^${NOUNS[kind].source}$`, "i").test(word))) return null;
  return words.map((word) => (/^[A-Z]{4,}$/.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : capitalise(word))).join(" ");
}

export type Fabric = { line: string; materials: MaterialId[] };

/**
 * What a garment is made of, from its bullet points: the first line with
 * percentages ("90% Polyester, 10% Spandex") that add up to no more than a
 * whole, printed in lower case as a label prints it, and the shop's material
 * words found in it. Stretch fibres are part of the line but not a material a
 * shopper filters by.
 */
export function fabricOf(features: readonly string[]): Fabric | null {
  for (const feature of features) {
    const parts = [...feature.matchAll(/(\d{1,3})\s*%\s*([A-Za-z][A-Za-z -]{1,24}?)(?=\s*(?:[,/&+;.)]|\band\b|\d|$))/g)];
    if (parts.length === 0) continue;
    if (parts.reduce((sum, part) => sum + Number(part[1]), 0) > 100) continue;
    const line = parts.map((part) => `${part[1]}% ${part[2]!.trim().toLowerCase()}`).join(", ");
    return { line, materials: extractTerms(line, MATERIALS, { greeklish: false }) };
  }
  return null;
}

/** The care line a listing gives ("Machine Wash", "Hand Wash Only", "Dry Clean Only"). */
export function careOf(features: readonly string[]): string | null {
  const line = features.find((feature) => /^(machine wash|hand wash|dry clean)/i.test(feature.trim()) && feature.length <= 40);
  return line === undefined ? null : line.trim().replace(/^./, (letter) => letter.toUpperCase());
}

/** Lines a shop does not print: the marketplace's promises, size advice that points at Amazon's chart, pleas, and the label lines shown elsewhere. */
const NOT_A_HIGHLIGHT = /\b(amazon|returns?|refund|warranty|guarantee|customer service|contact us|size chart|sizing chart|please|note:|kindly|satisfaction|gift box|package includes|imported)\b/i;
const LABEL_LINE = /^((zipper|button|pull on|drawstring|hook and eye|tie|snap|elastic|lace up|zip) closure|machine wash|hand wash( only)?|dry clean( only)?|\d{1,3}\s*%.*)$/i;

/**
 * Selling points from the bullet points: brackets and shouted lead-ins
 * ("SOFT & COMFY:") taken off, emoji dropped, the fabric, closure and care
 * lines left to their own places, at most five lines of at most 220
 * characters, ending at a sentence or a word.
 */
export function clothesHighlights(features: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    let text = feature
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}]/gu, "")
      .replace(/[【\[][^】\]]*[】\]]\s*[-:：]?\s*/g, "")
      .replace(/^[A-Z0-9 &'/+-]{4,}[:：-]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 16 || NOT_A_HIGHLIGHT.test(text) || LABEL_LINE.test(text)) continue;
    if (text.length > 220) {
      const sentence = text.slice(0, 220).lastIndexOf(". ");
      text = sentence > 80 ? text.slice(0, sentence + 1) : `${text.slice(0, text.lastIndexOf(" ", 217))}…`;
    }
    text = text.charAt(0).toUpperCase() + text.slice(1);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length === 5) break;
  }
  return result;
}

/**
 * Whether a garment's photograph is a studio shot on white. The furniture's
 * rule (`isWhiteGround`, 85% of the border white) refuses a dress worn by a
 * model, whose head and feet cross the frame, and a pair of trousers cropped
 * at the waist, whose top corners are the model; what the tile's white blend
 * needs is a white ground around them. So: at least two corners near-white
 * and neutral, and at least 40% of the border.
 */
export function isGarmentStudioShot(rgb: Uint8Array | Buffer, size: number, { corner = 4, border = 2, share = 0.4, corners = 2 } = {}): boolean {
  const white = (x: number, y: number) => {
    const i = (y * size + x) * 3;
    const r = rgb[i]!;
    const g = rgb[i + 1]!;
    const b = rgb[i + 2]!;
    return Math.max(r, g, b) - Math.min(r, g, b) < 14 && (r + g + b) / 3 >= 236;
  };
  let whiteCorners = 0;
  for (const [x0, y0] of [[0, 0], [size - corner, 0], [0, size - corner], [size - corner, size - corner]] as const) {
    let patch = true;
    for (let y = y0; y < y0 + corner && patch; y += 1) for (let x = x0; x < x0 + corner && patch; x += 1) patch = white(x, y);
    if (patch) whiteCorners += 1;
  }
  if (whiteCorners < corners) return false;
  let count = 0;
  let whites = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x >= border && y >= border && x < size - border && y < size - border) continue;
      count += 1;
      if (white(x, y)) whites += 1;
    }
  }
  return whites / count >= share;
}

/**
 * Whether a listing's extra photograph can stand in a garment's gallery.
 * Garments are photographed upright, on a model or laid flat, so their
 * photographs are portrait or square; the wide ones among a listing's
 * extras are mostly the brand's own size charts and measuring guides
 * (22 of the 31 wide ones in the range, reviewed by eye), which would
 * contradict the shop's chart.
 */
export const isGarmentPhotoShape = (width: number, height: number): boolean => height > 0 && width / height <= 1.05;

/**
 * Skin, roughly: a warm hue (red to yellow-orange), moderately saturated, not
 * very dark or very light. Good enough to keep a model's arms out of a
 * garment's colour; a beige garment loses a little of its own area to it,
 * which the largest-cluster choice survives.
 */
export function looksLikeSkin({ r, g, b }: Rgb): boolean {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const chroma = max - min;
  if (chroma < 0.08 || lightness < 0.2 || lightness > 0.9) return false;
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r / 255) hue = (60 * ((g - b) / 255 / chroma) + 360) % 360;
  else if (max === g / 255) hue = 60 * ((b - r) / 255 / chroma + 2);
  else hue = 60 * ((r - g) / 255 / chroma + 4);
  return hue >= 5 && hue <= 45 && saturation >= 0.15 && saturation <= 0.7 && r > g && g > b;
}

/**
 * Where in a listing's main photograph each kind of garment is, as fractions
 * of the frame (left, top, width, height): the middle of the torso for what is
 * worn above the waist, the thighs for trousers and skirts, the body for a
 * dress. Inside the garment, so its own colour fills the crop.
 */
export const GARMENT_CROP: Readonly<Record<CapsuleKind, readonly [number, number, number, number]>> = {
  TOP: [0.35, 0.3, 0.3, 0.25],
  SHIRT: [0.35, 0.3, 0.3, 0.25],
  KNIT: [0.35, 0.3, 0.3, 0.25],
  COAT: [0.35, 0.3, 0.3, 0.3],
  JACKET: [0.35, 0.3, 0.3, 0.25],
  TROUSERS: [0.3, 0.4, 0.4, 0.2],
  SKIRT: [0.3, 0.35, 0.4, 0.25],
  DRESS: [0.35, 0.3, 0.3, 0.35],
};

/**
 * A garment's colour from its photograph, for a listing whose title names
 * none: the part of the frame where its kind is worn (the torso for a top,
 * the legs for trousers; `GARMENT_CROP`),
 * without the white ground and without skin, named by the palette's largest
 * cluster (src/lib/vision/palette.ts, the code Snap to shop uses).
 */
export function garmentColour(pixels: readonly Rgb[]): ColorId | null {
  const white = pixels.filter((pixel) => pixel.r > 232 && pixel.g > 232 && pixel.b > 232).length;
  // The crop sits inside the garment: mostly white there is a white garment, not the studio ground.
  if (pixels.length > 0 && white / pixels.length > 0.6) return "white";
  const cloth = pixels.filter((pixel) => !(pixel.r > 232 && pixel.g > 232 && pixel.b > 232) && !looksLikeSkin(pixel));
  if (cloth.length < 50) return null;
  // Gold and silver are metals: on cloth the palette's "gold" is an olive or a mustard, its "silver" a light grey.
  for (const entry of palette(cloth)) {
    if (entry.color === "silver") return "grey";
    if (entry.color !== "gold") return entry.color;
  }
  return null;
}

/**
 * The colour words a garment's title names, in the shop's vocabulary — read
 * without the brand, which may be a colour itself ("Red Kap", "Pink Queen",
 * "Signature by Levi Strauss & Co. Gold Label"). Metals are not cloth colours.
 */
export const titleColours = (title: string, brand: string | null = null): ColorId[] =>
  extractTerms(withoutAsides(withoutBrand(title, brand)), COLORS, { greeklish: false }).filter((colour) => colour !== "gold" && colour !== "silver");

/**
 * Listings refused by eye when the chosen range was reviewed on a contact
 * sheet: what the rules cannot read from a title (a flag print called
 * "Bohemian Print"). Each with its reason.
 */
export const EXCLUDED_LISTINGS: ReadonlyMap<string, string> = new Map([
  ["B07MF25DHS", "a US flag print; the shop sells no flags or slogans"],
  ["B079K6YZJZ", "photographed as four camisoles, a multipack in all but name"],
]);

/**
 * The euro price. The shop's prices are its own, within a band for each kind
 * of piece (the credits say so, and the furniture and wearables are priced the
 * same way); a listing's dollar price only says where in that band the piece
 * sits. `rank` is the piece's place among the range's pieces of its kind by
 * listing price, from 0 (cheapest) to 1 (dearest): a Gildan tee lands near
 * the bottom of the tops, a Levi's 517 near the top of the trousers, and no
 * tee costs €9 beside €139 loafers. Rounded the way the shop prices: whole
 * euros ending in 9, to the nearest 5 under €100 and 10 above.
 */
export function clothesPriceCents(rank: number, band: { minCents: number; maxCents: number }): number {
  const place = Math.min(1, Math.max(0, rank));
  const euros = (band.minCents + place * (band.maxCents - band.minCents)) / 100;
  const rounded = euros < 100 ? Math.round(euros / 5) * 5 : Math.round(euros / 10) * 10;
  return Math.max(band.minCents - 100, rounded * 100 - 100);
}

/**
 * Each piece's place by listing price among its kind, 0 to 1. Pieces without
 * a price take a stable place from their id; ties keep the order given.
 */
export function priceRanks(pieces: readonly { id: string; usd: number | null }[]): Map<string, number> {
  const valued = pieces.map((piece) => ({ id: piece.id, value: piece.usd ?? Number.NaN }));
  const priced = valued.filter((piece) => Number.isFinite(piece.value)).sort((a, b) => a.value - b.value);
  const ranks = new Map<string, number>();
  priced.forEach((piece, index) => ranks.set(piece.id, priced.length === 1 ? 0.5 : index / (priced.length - 1)));
  for (const piece of valued) if (!ranks.has(piece.id)) ranks.set(piece.id, stableUnit(`price:${piece.id}`));
  return ranks;
}
