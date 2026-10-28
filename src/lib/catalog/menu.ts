/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The header's categories menu: groups, columns and links, as data the header renders in either language.
 */

import type { CategorySlug } from "@/lib/catalog/taxonomy";

/**
 * docs/adr/067. The menu is fixed data, like the footer's category list: the
 * header makes no database query, and menu.test.ts checks every link against
 * the catalogue the shop ships (the committed fixtures every deploy syncs), so
 * no link can lead to an empty page in production.
 *
 * Labels are not stored here. A category link takes its name from the
 * taxonomy; a kind link from messages (menu.kinds.<CODE>, the plural a menu
 * reads); a brand is its own name; everything else from messages
 * (menu.links.<key>). The header resolves them, so the menu's client
 * component receives plain words.
 */

export type MenuLabel =
  | { category: CategorySlug }
  | { kind: string }
  | { brand: string }
  | { message: string };

export type MenuLink = {
  /** The data-agent-id after "menu:", so the Concierge can point at it. */
  id: string;
  href: string;
  label: MenuLabel;
};

export type MenuColumn = { heading: MenuLink | null; headingMessage?: string; links: MenuLink[] };

export type MenuGroupId = "home" | "fashion" | "brands" | "discover";
export type MenuGroup = { id: MenuGroupId; columns: MenuColumn[]; all: MenuLink };

const category = (slug: CategorySlug): MenuLink => ({ id: slug, href: `/c/${slug}`, label: { category: slug } });

/** One kind of piece within a category; several codes when the shop sells one thing under two (lamps). */
const kind = (slug: CategorySlug, codes: readonly string[]): MenuLink => ({
  id: `${slug}-${codes[0]!.toLowerCase().replace(/_/g, "-")}`,
  href: `/c/${slug}?${codes.map((code) => `kind=${code}`).join("&")}`,
  label: { kind: codes[0]! },
});

const brand = (name: string, slugs: readonly string[]): MenuLink => ({
  id: `brand-${slugs[0]}`,
  href: `/c?${slugs.map((slug) => `brand=${slug}`).join("&")}`,
  label: { brand: name },
});

const page = (key: string, href: string): MenuLink => ({ id: key, href, label: { message: key } });

export const MENU: readonly MenuGroup[] = [
  {
    id: "home",
    all: { id: "all-home", href: "/c", label: { message: "allCategories" } },
    columns: [
      { heading: category("seating"), links: [kind("seating", ["CHAIR"]), kind("seating", ["SOFA"]), kind("seating", ["STOOL_SEATING"]), kind("seating", ["OTTOMAN"]), kind("seating", ["BENCH"])] },
      // The heading lists every table; "Tables" again beneath it would only repeat it.
      { heading: category("tables"), links: [kind("tables", ["DESK"])] },
      { heading: category("lighting"), links: [kind("lighting", ["LAMP", "HOME_LIGHTING_AND_LAMPS"]), kind("lighting", ["LIGHT_FIXTURE"]), kind("lighting", ["STRING_LIGHT"])] },
      { heading: category("rugs"), links: [] },
      { heading: category("bedroom"), links: [kind("bedroom", ["BED"]), kind("bedroom", ["HEADBOARD"]), kind("bedroom", ["PILLOW"])] },
      { heading: category("storage"), links: [kind("storage", ["SHELF"]), kind("storage", ["CABINET"]), kind("storage", ["DRESSER", "STORAGE_DRAWER"]), kind("storage", ["BASKET", "LAUNDRY_HAMPER"]), kind("storage", ["CLOTHES_RACK"])] },
      { heading: category("wall-decor"), links: [kind("wall-decor", ["WALL_ART"]), kind("wall-decor", ["CLOCK"]), kind("wall-decor", ["HOME_MIRROR"])] },
      { heading: category("accents"), links: [kind("accents", ["PLANTER"]), kind("accents", ["VASE"]), kind("accents", ["CANDLE"])] },
    ],
  },
  {
    id: "fashion",
    all: { id: "all-fashion", href: "/c/wear", label: { message: "allClothing" } },
    columns: [
      {
        heading: category("wear"),
        links: [
          { id: "wear-women", href: "/c/wear?for=women", label: { message: "women" } },
          { id: "wear-men", href: "/c/wear?for=men", label: { message: "men" } },
          kind("wear", ["DRESS"]),
          kind("wear", ["TOP"]),
          kind("wear", ["SHIRT"]),
        ],
      },
      { heading: null, headingMessage: "moreClothing", links: [kind("wear", ["KNIT"]), kind("wear", ["TROUSERS"]), kind("wear", ["SKIRT"]), kind("wear", ["COAT"]), kind("wear", ["JACKET"])] },
      { heading: category("shoes"), links: [kind("shoes", ["SHOES"]), kind("shoes", ["BOOT"]), kind("shoes", ["SANDAL"])] },
      { heading: category("bags"), links: [kind("bags", ["BACKPACK"]), kind("bags", ["HANDBAG"]), kind("bags", ["WALLET"])] },
      { heading: category("accessories"), links: [kind("accessories", ["EARRING"]), kind("accessories", ["NECKLACE"]), kind("accessories", ["HAT"]), kind("accessories", ["BRACELET"])] },
    ],
  },
  {
    id: "brands",
    all: { id: "all-brands", href: "/c", label: { message: "allCategories" } },
    columns: [
      {
        heading: null,
        headingMessage: "homeBrands",
        links: [
          brand("Stone & Beam", ["stone-and-beam"]),
          brand("Rivet", ["rivet"]),
          brand("Ravenna Home", ["ravenna-home"]),
          brand("AmazonBasics", ["amazonbasics", "amazon-basics"]),
          brand("Movian", ["movian"]),
          brand("Solimo", ["solimo"]),
          brand("Alkove", ["alkove"]),
        ],
      },
      {
        heading: null,
        headingMessage: "fashionBrands",
        links: [
          brand("find.", ["find"]),
          brand("Amazon Collection", ["amazon-collection"]),
          brand("Concept 3 by Skechers", ["concept-3-by-skechers"]),
          brand("Symbol", ["symbol"]),
          brand("Jeff & Aimy", ["jeff-and-aimy"]),
          brand("Amazon Essentials", ["amazon-essentials"]),
        ],
      },
    ],
  },
  {
    id: "discover",
    all: { id: "all-discover", href: "/c", label: { message: "allCategories" } },
    columns: [
      {
        heading: null,
        headingMessage: "tryItOut",
        links: [
          page("fittingRoom", "/fitting-room"),
          page("mirror", "/mirror"),
          page("room", "/room"),
          page("snap", "/snap"),
          page("colours", "/colours"),
        ],
      },
      {
        heading: null,
        headingMessage: "putTogether",
        links: [page("stylist", "/stylist"), page("capsule", "/capsule"), page("showcase", "/showcase"), page("taste", "/taste"), page("boards", "/boards")],
      },
      {
        heading: null,
        headingMessage: "quickPicks",
        links: [page("newIn", "/c?sort=newest"), page("underHundred", "/c?max=100"), page("inStock", "/c?stock=1")],
      },
    ],
  },
];

/** Every link in the menu, headings included. */
export function menuLinks(groups: readonly MenuGroup[] = MENU): MenuLink[] {
  return groups.flatMap((group) => [group.all, ...group.columns.flatMap((column) => [...(column.heading === null ? [] : [column.heading]), ...column.links])]);
}

/** A menu link as the client component receives it: words already in the shopper's language. */
export type ResolvedLink = { id: string; href: string; label: string };
export type ResolvedColumn = { heading: ResolvedLink | null; headingLabel: string | null; links: ResolvedLink[] };
export type ResolvedGroup = { id: MenuGroupId; title: string; columns: ResolvedColumn[]; all: ResolvedLink };
