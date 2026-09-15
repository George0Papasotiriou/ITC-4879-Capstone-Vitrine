/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Catalogue taxonomy: categories, product kinds, Greek names and synthetic price bands.
 */

/**
 * The catalogue taxonomy: the categories shoppers browse, and how the Amazon
 * Berkeley Objects product types map into them (docs/PLAN.md Phase 3).
 *
 * ABO has hundreds of product types, from CHAIR to NUTRITIONAL_SUPPLEMENT. A
 * shop window shows a curated few, so each accepted type is listed here with
 * the category it belongs to, a singular noun naming the kind of object in both
 * languages (shown on Greek pages, where product titles stay in English until
 * they are translated, and indexed so "καναπές" finds sofas), and the price and
 * stock bands used to synthesise commercial data ABO does not have.
 *
 * Greek names are written by hand, not machine translated: there are few of
 * them and they appear on every page.
 */

export type CategorySlug =
  | "seating"
  | "tables"
  | "lighting"
  | "rugs"
  | "storage"
  | "bedroom"
  | "wall-decor"
  | "accents";

export type Category = {
  slug: CategorySlug;
  nameEn: string;
  nameEl: string;
  /** One line under the heading on the category page. */
  descriptionEn: string;
  descriptionEl: string;
  position: number;
};

export const CATEGORIES: readonly Category[] = [
  {
    slug: "seating",
    nameEn: "Seating",
    nameEl: "Καθίσματα",
    descriptionEn: "Chairs, sofas, stools and benches.",
    descriptionEl: "Καρέκλες, καναπέδες, σκαμπό και πάγκοι.",
    position: 0,
  },
  {
    slug: "tables",
    nameEn: "Tables",
    nameEl: "Τραπέζια",
    descriptionEn: "Dining, side and coffee tables, and desks.",
    descriptionEl: "Τραπέζια φαγητού, βοηθητικά, σαλονιού και γραφεία.",
    position: 1,
  },
  {
    slug: "lighting",
    nameEn: "Lighting",
    nameEl: "Φωτισμός",
    descriptionEn: "Floor and table lamps, pendants and fixtures.",
    descriptionEl: "Φωτιστικά δαπέδου, επιτραπέζια, κρεμαστά και οροφής.",
    position: 2,
  },
  {
    slug: "rugs",
    nameEn: "Rugs",
    nameEl: "Χαλιά",
    descriptionEn: "Area rugs and runners.",
    descriptionEl: "Χαλιά και διάδρομοι.",
    position: 3,
  },
  {
    slug: "storage",
    nameEn: "Storage",
    nameEl: "Αποθήκευση",
    descriptionEn: "Cabinets, shelves, dressers and baskets.",
    descriptionEl: "Ντουλάπια, ράφια, συρταριέρες και καλάθια.",
    position: 4,
  },
  {
    slug: "bedroom",
    nameEn: "Bedroom",
    nameEl: "Υπνοδωμάτιο",
    descriptionEn: "Beds, headboards and pillows.",
    descriptionEl: "Κρεβάτια, κεφαλάρια και μαξιλάρια.",
    position: 5,
  },
  {
    slug: "wall-decor",
    nameEn: "Wall decor",
    nameEl: "Διακόσμηση τοίχου",
    descriptionEn: "Art, mirrors and clocks.",
    descriptionEl: "Πίνακες, καθρέφτες και ρολόγια.",
    position: 6,
  },
  {
    slug: "accents",
    nameEn: "Accents",
    nameEl: "Διακοσμητικά",
    descriptionEn: "Vases, planters and candles.",
    descriptionEl: "Βάζα, γλάστρες και κεριά.",
    position: 7,
  },
];

export const CATEGORY_SLUGS = CATEGORIES.map((category) => category.slug);

export function isCategorySlug(value: string): value is CategorySlug {
  return (CATEGORY_SLUGS as readonly string[]).includes(value);
}

/**
 * Synthetic price and stock bands. Prices are integer cents; the band is the
 * range a real mid-market European retailer would plausibly list the type at.
 * Stock is a unit count, with `soldOutShare` of products out of stock so that
 * availability filtering and re-ranking have something real to act on.
 */
export type SyntheticBands = {
  minCents: number;
  maxCents: number;
  maxStock: number;
  soldOutShare: number;
};

export type ProductKind = {
  category: CategorySlug;
  kindEn: string;
  kindEl: string;
  bands: SyntheticBands;
};

const band = (minEuros: number, maxEuros: number, maxStock = 40, soldOutShare = 0.08): SyntheticBands => ({
  minCents: minEuros * 100,
  maxCents: maxEuros * 100,
  maxStock,
  soldOutShare,
});

/** ABO `product_type` → where it lives in Vitrine. Types not listed are not imported. */
export const ABO_PRODUCT_KINDS: Readonly<Record<string, ProductKind>> = {
  CHAIR: { category: "seating", kindEn: "Chair", kindEl: "Καρέκλα", bands: band(120, 780) },
  SOFA: { category: "seating", kindEn: "Sofa", kindEl: "Καναπές", bands: band(450, 1900, 12) },
  OTTOMAN: { category: "seating", kindEn: "Ottoman", kindEl: "Πουφ", bands: band(80, 340) },
  STOOL_SEATING: { category: "seating", kindEn: "Stool", kindEl: "Σκαμπό", bands: band(45, 210) },
  BENCH: { category: "seating", kindEn: "Bench", kindEl: "Πάγκος", bands: band(90, 460, 20) },
  BEAN_BAG_CHAIR: { category: "seating", kindEn: "Bean bag", kindEl: "Πουφ φασόλι", bands: band(60, 240) },

  TABLE: { category: "tables", kindEn: "Table", kindEl: "Τραπέζι", bands: band(90, 650, 20) },
  DESK: { category: "tables", kindEn: "Desk", kindEl: "Γραφείο", bands: band(140, 720, 15) },

  LAMP: { category: "lighting", kindEn: "Lamp", kindEl: "Φωτιστικό", bands: band(35, 260, 60) },
  LIGHT_FIXTURE: { category: "lighting", kindEn: "Light fixture", kindEl: "Φωτιστικό οροφής", bands: band(60, 390, 30) },
  HOME_LIGHTING_AND_LAMPS: { category: "lighting", kindEn: "Lamp", kindEl: "Φωτιστικό", bands: band(35, 260, 60) },
  STRING_LIGHT: { category: "lighting", kindEn: "String lights", kindEl: "Φωτάκια", bands: band(15, 60, 80) },

  RUG: { category: "rugs", kindEn: "Rug", kindEl: "Χαλί", bands: band(45, 420, 25) },

  CABINET: { category: "storage", kindEn: "Cabinet", kindEl: "Ντουλάπι", bands: band(120, 690, 15) },
  SHELF: { category: "storage", kindEn: "Shelf", kindEl: "Ράφι", bands: band(40, 320, 30) },
  DRESSER: { category: "storage", kindEn: "Dresser", kindEl: "Συρταριέρα", bands: band(220, 890, 10) },
  STORAGE_DRAWER: { category: "storage", kindEn: "Drawer unit", kindEl: "Συρταριέρα", bands: band(45, 220, 30) },
  CLOTHES_RACK: { category: "storage", kindEn: "Clothes rack", kindEl: "Κρεμάστρα ρούχων", bands: band(35, 180, 30) },
  BASKET: { category: "storage", kindEn: "Basket", kindEl: "Καλάθι", bands: band(15, 80, 60) },
  LAUNDRY_HAMPER: { category: "storage", kindEn: "Laundry basket", kindEl: "Καλάθι απλύτων", bands: band(20, 90, 60) },

  BED: { category: "bedroom", kindEn: "Bed", kindEl: "Κρεβάτι", bands: band(290, 1400, 8) },
  HEADBOARD: { category: "bedroom", kindEn: "Headboard", kindEl: "Κεφαλάρι", bands: band(110, 520, 15) },
  PILLOW: { category: "bedroom", kindEn: "Pillow", kindEl: "Μαξιλάρι", bands: band(18, 90, 80) },

  WALL_ART: { category: "wall-decor", kindEn: "Wall art", kindEl: "Πίνακας", bands: band(30, 260, 40) },
  HOME_MIRROR: { category: "wall-decor", kindEn: "Mirror", kindEl: "Καθρέφτης", bands: band(50, 380, 25) },
  CLOCK: { category: "wall-decor", kindEn: "Clock", kindEl: "Ρολόι", bands: band(25, 140, 40) },
  PICTURE_FRAME: { category: "wall-decor", kindEn: "Picture frame", kindEl: "Κορνίζα", bands: band(12, 70, 80) },

  VASE: { category: "accents", kindEn: "Vase", kindEl: "Βάζο", bands: band(18, 140, 50) },
  PLANTER: { category: "accents", kindEn: "Planter", kindEl: "Γλάστρα", bands: band(20, 160, 50) },
  CANDLE: { category: "accents", kindEn: "Candle", kindEl: "Κερί", bands: band(10, 55, 90) },
};

/**
 * How a kind of product can be shown in a photo of a room (A4, Phase 10).
 * "stand": it stands on the floor, drawn as a scaled cutout on its footprint.
 * "lie": it lies flat on the floor (a rug), drawn as its footprint.
 * Kinds that hang on walls or ceilings are not listed: placing them needs a wall
 * plane, which the tap method does not measure.
 */
export const ROOM_PLACEMENT: Readonly<Record<string, "stand" | "lie">> = {
  CHAIR: "stand",
  SOFA: "stand",
  OTTOMAN: "stand",
  STOOL_SEATING: "stand",
  BENCH: "stand",
  BEAN_BAG_CHAIR: "stand",
  TABLE: "stand",
  DESK: "stand",
  LAMP: "stand",
  HOME_LIGHTING_AND_LAMPS: "stand",
  CABINET: "stand",
  SHELF: "stand",
  DRESSER: "stand",
  STORAGE_DRAWER: "stand",
  CLOTHES_RACK: "stand",
  BASKET: "stand",
  LAUNDRY_HAMPER: "stand",
  BED: "stand",
  PLANTER: "stand",
  RUG: "lie",
};

export function roomPlacement(kind: string, dims: { w: number; d: number; h: number } | null): "stand" | "lie" | null {
  if (dims === null) return null;
  return ROOM_PLACEMENT[kind] ?? null;
}

/**
 * Stable pseudo-random number in [0, 1) from a string (FNV-1a hash).
 *
 * Synthetic data must not change between imports: a rerun that reshuffled
 * prices would invalidate carts, orders and every screenshot in the report.
 * Hashing the ABO item id with a purpose label ("price", "stock") gives each
 * product the same values every time, and independent values per purpose.
 */
export function stableUnit(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 2 ** 32;
}

/**
 * A plausible retail price within the band: whole euros, ending in 9 (or 5 and
 * 9 under €100), never below the band minimum.
 */
export function syntheticPriceCents(sourceId: string, bands: SyntheticBands): number {
  const raw = bands.minCents + stableUnit(`price:${sourceId}`) * (bands.maxCents - bands.minCents);
  const euros = raw / 100;
  const rounded = euros < 100 ? Math.round(euros / 5) * 5 : Math.round(euros / 10) * 10;
  return Math.max(bands.minCents - 100, rounded * 100 - 100);
}

export function syntheticStock(sourceId: string, bands: SyntheticBands): number {
  if (stableUnit(`sold-out:${sourceId}`) < bands.soldOutShare) return 0;
  return 1 + Math.floor(stableUnit(`stock:${sourceId}`) * bands.maxStock);
}
