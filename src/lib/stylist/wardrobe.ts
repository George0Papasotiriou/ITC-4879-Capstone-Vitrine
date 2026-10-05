/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The outfit builder in the database: "Complete the look" around a piece, and a capsule wardrobe within a budget.
 */

import type postgres from "postgres";

import { wearerOf } from "@/lib/catalog/wear";
import { localizeCents } from "@/lib/commerce/vat";
import { buildCapsule, capsuleScore, type CapsuleRole } from "@/lib/optimize/capsule";
import { affinity } from "@/lib/optimize/compatibility";
import { completeLook, formality, GO_TOGETHER, outfitCompatibility, ROLE_KINDS, roleOf, rolesToComplete, type Department, type OutfitCandidate, type OutfitRole } from "@/lib/optimize/outfit";
import { contentVector, STYLE_WEIGHTS } from "@/lib/reco/content-vector";
import { bayesianRating, catalogRatingPrior } from "@/lib/search/rerank";

/**
 * docs/adr/066. Candidates are the shop's own in-stock pieces for the right
 * department (a garment's label, or a shoe's or bag's title: "Women's",
 * "Men's"; unisex pieces go either way), in the shopper's prices (ADR-013).
 * Each one's own merit is its rating, read by the same Bayesian rule as
 * search (rerank.ts); how two go together is outfitCompatibility.
 */

type Row = {
  id: string;
  kind: string;
  category: string;
  brand: string | null;
  colors: string[];
  materials: string[];
  attributes: Record<string, string>;
  title_en: string;
  price_cents: number;
  rating_sum: number;
  rating_count: number;
};

export type WardrobeCandidate = OutfitCandidate & { kind: string };

/** Shoes whose title names no wearer but whose cut does: a heel or a wedge goes to women's looks. */
const WOMENS_CUT = /\b(heels?|heeled|wedges?|pumps?|stilettos?|slingbacks?|mary janes?)\b/i;

/**
 * Who a piece is for: its label's department, else its title's words; null
 * for unisex (it suits either). Only the outfit builder reads the cut; sizes
 * still follow the title alone (wear.ts).
 */
export function departmentOf(row: Pick<Row, "attributes" | "title_en">): Department | null {
  const label = row.attributes.department;
  if (label === "women" || label === "men") return label;
  const wearer = wearerOf(row.title_en);
  if (wearer !== "unisex") return wearer;
  return WOMENS_CUT.test(row.title_en) ? "women" : null;
}

/** How many of each role a capsule holds: small (8 pieces), medium (12). */
export const CAPSULE_SIZES = {
  small: { women: { top: 3, bottom: 2, dress: 1, shoes: 2 }, men: { top: 3, bottom: 3, shoes: 2 } },
  medium: { women: { top: 4, bottom: 3, dress: 2, shoes: 3 }, men: { top: 5, bottom: 4, shoes: 3 } },
} as const satisfies Record<string, Record<Department, Partial<Record<CapsuleRole, number>>>>;

/** The budgets a shopper chooses from, in euros. */
export const CAPSULE_BUDGETS = [300, 450, 600, 800, 1000] as const;

/** τ: two pieces "go together" in a capsule when their compatibility reaches it (outfit.ts). */
export const CAPSULE_THRESHOLD = GO_TOGETHER;

/** The least a look's other pieces may cost by default: €150. */
export const LOOK_MIN_BUDGET_CENTS = 15_000;

/** Candidates per role the optimisers consider: the best rated first. */
const PER_ROLE = 12;

export function createWardrobe(sql: postgres.Sql) {
  async function candidates(roles: readonly OutfitRole[], department: Department, country: string, { maxPriceCents, exclude = [] }: { maxPriceCents?: number; exclude?: string[] } = {}): Promise<Partial<Record<OutfitRole, WardrobeCandidate[]>>> {
    const kinds = roles.flatMap((role) => ROLE_KINDS[role]);
    const rows = await sql<Row[]>`
      SELECT p.id, p.kind, c.slug AS category, b.name AS brand, p.colors, p.materials, p.attributes, p.title_en,
             p.price_cents, p.rating_sum, p.rating_count
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.status = 'active'
        AND p.kind = ANY(${kinds}::text[])
        AND NOT (p.id = ANY(${exclude}::uuid[]))
        AND EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0)
    `;
    const prior = catalogRatingPrior(rows.map((row) => ({ ratingSum: row.rating_sum, ratingCount: row.rating_count })));
    const out: Partial<Record<OutfitRole, WardrobeCandidate[]>> = {};
    for (const row of rows) {
      const role = roleOf(row.kind);
      const fits = departmentOf(row);
      if (role === null || !roles.includes(role) || (fits !== null && fits !== department)) continue;
      const priceCents = localizeCents(row.price_cents, country);
      if (maxPriceCents !== undefined && priceCents > maxPriceCents) continue;
      (out[role] ??= []).push(toCandidate(row, role, priceCents, prior));
    }
    for (const role of Object.keys(out) as OutfitRole[]) {
      out[role] = out[role]!.sort((a, b) => b.affinity - a.affinity || a.priceCents - b.priceCents || a.id.localeCompare(b.id)).slice(0, PER_ROLE);
    }
    return out;
  }

  function toCandidate(row: Row, role: OutfitRole, priceCents: number, prior: ReturnType<typeof catalogRatingPrior>): WardrobeCandidate {
    return {
      id: row.id,
      kind: row.kind,
      role,
      priceCents,
      colors: row.colors,
      formality: formality(row.kind, row.title_en),
      styleVector: contentVector({ category: row.category, kind: row.kind, colors: row.colors, materials: row.materials, brand: row.brand, attributes: row.attributes, priceCents: row.price_cents }, STYLE_WEIGHTS),
      affinity: affinity({ relevance: 1, taste: 0, rating: row.rating_count === 0 ? 0.5 : (bayesianRating({ ratingSum: row.rating_sum, ratingCount: row.rating_count }, prior) - 1) / 4 }),
    };
  }

  /**
   * Looks around a piece: up to three, each the piece plus a piece for every
   * role it needs. `budgetCents` is for the other pieces; by default three
   * times the piece's own price, and never less than LOOK_MIN_BUDGET_CENTS
   * (a €44 tee's three times could not buy the cheapest trousers and shoes).
   */
  async function lookFor(productId: string, country: string, budgetCents?: number): Promise<{ anchorId: string; looks: { ids: string[]; totalCents: number }[] } | null> {
    const [row] = await sql<Row[]>`
      SELECT p.id, p.kind, c.slug AS category, b.name AS brand, p.colors, p.materials, p.attributes, p.title_en, p.price_cents, p.rating_sum, p.rating_count
      FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.id = ${productId} AND p.status = 'active'
    `;
    if (row === undefined) return null;
    const role = roleOf(row.kind);
    if (role === null) return null;
    const department = departmentOf(row) ?? "women";
    const roles = rolesToComplete(role, department);
    const anchorPrice = localizeCents(row.price_cents, country);
    const budget = budgetCents ?? Math.max(anchorPrice * 3, LOOK_MIN_BUDGET_CENTS);
    const pool = await candidates(
      roles.map((entry) => entry.role),
      department,
      country,
      { maxPriceCents: budget, exclude: [row.id] },
    );
    const anchor = toCandidate(row, role, anchorPrice, catalogRatingPrior([]));
    const looks = completeLook({ anchor, candidates: pool, roles, budgetCents: budget });
    return {
      anchorId: row.id,
      looks: looks.map((look) => {
        const picks = Object.values(look.picks).filter((pick): pick is OutfitCandidate => pick !== null && pick !== undefined);
        // The anchor first, then the others in dressing order.
        const order: OutfitRole[] = ["top", "dress", "bottom", "outer", "shoes", "bag", "accessory"];
        const others = picks.filter((pick) => pick.id !== row.id).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
        return { ids: [row.id, ...others.map((pick) => pick.id)], totalCents: picks.reduce((sum, pick) => sum + pick.priceCents, 0) };
      }),
    };
  }

  /** A capsule for a department within a budget: its pieces, how many outfits they make and a few of them. */
  async function capsule(department: Department, size: keyof typeof CAPSULE_SIZES, budgetCents: number, country: string) {
    const counts: Partial<Record<CapsuleRole, number>> = CAPSULE_SIZES[size][department];
    const roles = Object.keys(counts) as CapsuleRole[];
    const pool = await candidates(roles, department, country, { maxPriceCents: budgetCents });
    const all = roles.flatMap((role) => (pool[role] ?? []).map((candidate) => ({ ...candidate, role })));
    const result = buildCapsule({ candidates: all, counts, budgetCents, compatibility: outfitCompatibility, threshold: CAPSULE_THRESHOLD });
    if (result === null) return null;
    const by = (role: CapsuleRole) => result.pieces.filter((piece) => piece.role === role);
    const ok = (a: OutfitCandidate, b: OutfitCandidate) => outfitCompatibility(a, b) >= CAPSULE_THRESHOLD;
    const outfits: string[][] = [];
    for (const top of by("top")) for (const bottom of by("bottom")) for (const shoes of by("shoes")) if (ok(top, bottom) && ok(top, shoes) && ok(bottom, shoes)) outfits.push([top.id, bottom.id, shoes.id]);
    for (const dress of by("dress")) for (const shoes of by("shoes")) if (ok(dress, shoes)) outfits.push([dress.id, shoes.id]);
    return {
      ids: result.pieces.map((piece) => piece.id),
      outfits: result.outfits,
      possible: Object.values(counts).length === 0 ? 0 : (counts.top ?? 0) * (counts.bottom ?? 0) * (counts.shoes ?? 0) + (counts.dress ?? 0) * (counts.shoes ?? 0),
      totalCents: result.priceCents,
      examples: outfits.slice(0, 6),
      meanCompatibility: capsuleScore(result.pieces, { compatibility: outfitCompatibility, threshold: CAPSULE_THRESHOLD }).meanCompatibility,
    };
  }

  return { candidates, lookFor, capsule };
}

export type Wardrobe = ReturnType<typeof createWardrobe>;
