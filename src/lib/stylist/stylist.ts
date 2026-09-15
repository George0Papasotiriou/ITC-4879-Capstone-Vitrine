/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Budget Stylist service: loads candidates, runs the optimiser and prices bundles.
 */

import type postgres from "postgres";
import { z } from "zod";

import { optimizeBundles, alternativesFor, type Bundle, type BundleProblem } from "@/lib/optimize/bundle";
import { affinity, compatibility, DEFAULT_LAMBDA, strongestPair, type StylistCandidate } from "@/lib/optimize/compatibility";
import { fitsSize, TEMPLATE_IDS, TEMPLATES, type TemplateId } from "@/lib/optimize/templates";
import { BASE_COUNTRY, localizeCents, toBaseBound } from "@/lib/commerce/vat";
import { contentVector, STYLE_WEIGHTS } from "@/lib/reco/content-vector";
import type { DimensionsCm } from "@/lib/db/schema";
import { searchProducts } from "@/lib/search/pipeline";
import { bayesianRating, catalogRatingPrior } from "@/lib/search/rerank";
import type { Retrievers } from "@/lib/search/retrieve";
import { COLORS } from "@/lib/search/vocabulary";

/**
 * The Budget Stylist service: from a request to three bundles (A3, Phase 8).
 *
 *   request ─► per slot: products of the right kind, in stock, affordable, not
 *              in an avoided colour, within size limits
 *           ─► score a(x) for each (relevance to the words, taste, rating)
 *           ─► keep the top K per slot
 *           ─► optimise (src/lib/optimize/bundle.ts)
 *           ─► three bundles, each with the reason its pieces go together
 *
 * Every price here is read from the database for this request, converted to
 * the shopper's country (docs/adr/013) and multiplied by the slot's quantity in
 * integer cents, so a bundle's total is exactly what the cart will show.
 */

const COLOR_IDS = Object.keys(COLORS) as [string, ...string[]];

export const stylistRequestSchema = z.object({
  template: z.enum(TEMPLATE_IDS as [TemplateId, ...TemplateId[]]),
  budgetCents: z.number().int().min(1_000).max(5_000_000),
  avoidColors: z.array(z.enum(COLOR_IDS)).max(COLOR_IDS.length).default([]),
  /** A measured limit for every piece, e.g. the width of an alcove. */
  maxWidthCm: z.number().int().min(10).max(1_000).optional(),
  /** Words describing the look, searched with A1: "mid-century", "ξύλινο". */
  query: z.string().trim().max(120).optional(),
});

export type StylistRequest = z.infer<typeof stylistRequestSchema>;

/** Candidates kept per slot: the plan's K of 15 to 25. */
export const CANDIDATES_PER_SLOT = 20;

type ProductRow = {
  id: string;
  kind: string;
  category: string;
  brand: string | null;
  colors: string[];
  materials: string[];
  attributes: Record<string, string>;
  dims_cm: DimensionsCm | null;
  price_cents: number;
  rating_sum: number;
  rating_count: number;
  stock: number;
};

export type StylistPick = {
  slotId: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type StylistBundle = {
  picks: StylistPick[];
  totalCents: number;
  remainingCents: number;
  utility: number;
  method: Bundle["method"];
  /** The pairing that contributes most, and why. */
  highlight: { first: string; second: string; style: number; harmony: number } | null;
};

export type StylistResult = {
  request: StylistRequest;
  bundles: StylistBundle[];
  /** Candidates per slot after filtering, so an empty result can say which slot ran dry. */
  candidateCounts: Record<string, number>;
  missingRequired: string[];
  stats: { elapsedMs: number; exact: boolean; nodes: number };
};

type Scored = StylistCandidate & { unitPriceCents: number; quantity: number };

export function createStylist(sql: postgres.Sql, retrievers: Retrievers) {
  async function candidatesFor(request: StylistRequest, country: string) {
    const template = TEMPLATES[request.template];
    const rows = await Promise.all(
      template.slots.map(
        (slot) => sql<ProductRow[]>`
          SELECT p.id, p.kind, c.slug AS category, b.name AS brand, p.colors, p.materials, p.attributes,
                 p.dims_cm, p.price_cents, p.rating_sum, p.rating_count,
                 COALESCE((SELECT sum(v.stock) FROM product_variants v WHERE v.product_id = p.id), 0)::int AS stock
          FROM products p
          JOIN categories c ON c.id = p.category_id
          LEFT JOIN brands b ON b.id = p.brand_id
          WHERE p.status = 'active'
            AND p.kind = ANY(${[...slot.kinds]}::text[])
            AND p.price_cents <= ${toBaseBound(Math.floor(request.budgetCents / slot.quantity), "max", country)}
            AND NOT (p.colors && ${request.avoidColors}::text[])
        `,
      ),
    );
    return template.slots.map((slot, index) => ({
      slot,
      rows: rows[index]!.filter(
        (row) =>
          row.stock >= slot.quantity &&
          fitsSize(row.dims_cm, [slot.size, request.maxWidthCm === undefined ? undefined : { maxWidthCm: request.maxWidthCm }]),
      ),
    }));
  }

  async function relevanceScores(query: string | undefined): Promise<Map<string, number> | null> {
    if (query === undefined || query === "") return null;
    const result = await searchProducts(retrievers, query, { limit: 200, rerank: false });
    const scores = new Map<string, number>();
    // Rank-based, like fusion: the first result 1, the last found 0.3.
    result.ids.forEach((id, rank) => scores.set(id, 1 - (0.7 * rank) / Math.max(1, result.ids.length - 1)));
    return scores;
  }

  async function problemFor(request: StylistRequest, country: string, taste?: ReadonlyMap<string, number>) {
    const [bySlot, relevance] = await Promise.all([candidatesFor(request, country), relevanceScores(request.query)]);
    const prior = catalogRatingPrior(bySlot.flatMap(({ rows }) => rows.map((row) => ({ ratingSum: row.rating_sum, ratingCount: row.rating_count }))));

    const slots = bySlot.map(({ slot, rows }) => {
      const scored: Scored[] = rows.map((row) => ({
        id: row.id,
        quantity: slot.quantity,
        // The budget is in the shopper's prices, so the optimiser works in them too.
        unitPriceCents: localizeCents(row.price_cents, country),
        priceCents: localizeCents(row.price_cents, country) * slot.quantity,
        colors: row.colors,
        styleVector: contentVector(
          {
            category: row.category,
            kind: row.kind,
            colors: row.colors,
            materials: row.materials,
            brand: row.brand,
            attributes: row.attributes,
            priceCents: row.price_cents,
          },
          STYLE_WEIGHTS,
        ),
        affinity: affinity({
          relevance: relevance === null ? 1 : (relevance.get(row.id) ?? 0.2),
          taste: taste?.get(row.id) ?? 0,
          rating: row.rating_count === 0 ? 0.5 : (bayesianRating({ ratingSum: row.rating_sum, ratingCount: row.rating_count }, prior) - 1) / 4,
        }),
      }));
      scored.sort((a, b) => b.affinity - a.affinity || a.priceCents - b.priceCents || a.id.localeCompare(b.id));
      return { id: slot.id, required: slot.required, candidates: scored.slice(0, CANDIDATES_PER_SLOT) };
    });

    const problem: BundleProblem<Scored> = { slots, budgetCents: request.budgetCents, lambda: DEFAULT_LAMBDA, compatibility };
    return problem;
  }

  function describe(problem: BundleProblem<Scored>, bundle: Bundle<Scored>, budgetCents: number): StylistBundle {
    const picks: StylistPick[] = [];
    for (const slot of problem.slots) {
      const pick = bundle.picks[slot.id];
      if (pick == null) continue;
      picks.push({
        slotId: slot.id,
        productId: pick.id,
        quantity: pick.quantity,
        unitPriceCents: pick.unitPriceCents,
        lineTotalCents: pick.priceCents,
      });
    }
    const chosen = problem.slots.map((slot) => bundle.picks[slot.id]).filter((pick): pick is Scored => pick != null);
    return {
      picks,
      totalCents: bundle.priceCents,
      remainingCents: budgetCents - bundle.priceCents,
      utility: bundle.utility,
      method: bundle.method,
      highlight: strongestPair(chosen),
    };
  }

  async function build(input: unknown, options: { taste?: ReadonlyMap<string, number>; country?: string } = {}): Promise<StylistResult> {
    const request = stylistRequestSchema.parse(input);
    const problem = await problemFor(request, options.country ?? BASE_COUNTRY, options.taste);
    const outcome = optimizeBundles(problem);
    return {
      request,
      bundles: outcome.bundles.map((bundle) => describe(problem, bundle, request.budgetCents)),
      candidateCounts: Object.fromEntries(problem.slots.map((slot) => [slot.id, slot.candidates.length])),
      missingRequired: problem.slots.filter((slot) => slot.required && slot.candidates.length === 0).map((slot) => slot.id),
      stats: { elapsedMs: Math.round(outcome.stats.elapsedMs * 10) / 10, exact: outcome.stats.exact, nodes: outcome.stats.nodes },
    };
  }

  /** "Swap one piece" for one slot of one returned bundle. */
  async function swaps(input: unknown, bundleIndex: number, slotId: string, { limit = 4, country = BASE_COUNTRY }: { limit?: number; country?: string } = {}) {
    const request = stylistRequestSchema.parse(input);
    const problem = await problemFor(request, country);
    const outcome = optimizeBundles(problem);
    const bundle = outcome.bundles[bundleIndex];
    if (bundle === undefined) return [];
    return alternativesFor(problem, bundle, slotId, limit).map((alternative) => ({
      productId: alternative.candidate.id,
      quantity: alternative.candidate.quantity,
      lineTotalCents: alternative.candidate.priceCents,
      bundleTotalCents: alternative.priceCents,
      utilityChange: alternative.utility - bundle.utility,
    }));
  }

  return { build, swaps };
}

export type Stylist = ReturnType<typeof createStylist>;
