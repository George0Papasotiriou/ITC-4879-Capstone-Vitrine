/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Search API returning compact product results and the parsed query.
 */

import { z } from "zod";

import { isLocale } from "@/i18n/routing";
import { logSearch } from "@/lib/admin/server";
import { getCardsByIds, runSearch } from "@/lib/catalog/server";
import { CATEGORY_SLUGS, type CategorySlug } from "@/lib/catalog/taxonomy";
import { loggerForRequest } from "@/lib/log";

/**
 * Typed search endpoint (docs/PLAN.md Phase 4, step 4) for the instant search
 * overlay and the Concierge's search tool.
 *
 * The response is compact on purpose: ids and the essentials to render a
 * result, plus what the search understood. Components and tools look up
 * anything else from the database themselves (CLAUDE.md conventions).
 */

export const runtime = "nodejs";

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  locale: z.string().refine(isLocale).default("en"),
  category: z.enum(CATEGORY_SLUGS as [CategorySlug, ...CategorySlug[]]).optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  /** Sent by search-as-you-type, whose keystrokes are not searches worth counting (docs/adr/018). */
  instant: z.literal("1").optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_query", message: "Send a search as ?q= with 1 to 200 characters." },
      { status: 400 },
    );
  }

  const { q, locale, category, limit, instant } = parsed.data;
  const started = performance.now();
  const result = await runSearch(q, { limit, filters: category === undefined ? undefined : { categories: [category] } });
  const cards = await getCardsByIds(result.ids, locale);
  const tookMs = Math.round(performance.now() - started);

  if (instant === undefined) {
    logSearch({
      query: q,
      locale,
      results: result.ids.length,
      relaxed: result.relaxed.length > 0,
      corrected: result.corrections.length > 0,
      tookMs,
      source: "api",
    });
  }
  loggerForRequest(request.headers).info(
    { search: { results: cards.length, tookMs, retrievers: result.retrieversUsed, relaxed: result.relaxed } },
    "search",
  );

  return Response.json(
    {
      query: q,
      understood: {
        text: result.query.text,
        filters: result.filters,
        readings: result.readings.map((entry) => ({ term: entry.term, greek: entry.readings.map((reading) => reading.greek) })),
        corrections: result.corrections,
        relaxed: result.relaxed,
      },
      results: cards.map((card) => ({
        id: card.id,
        slug: card.slug,
        title: card.title,
        brand: card.brand,
        category: card.category,
        priceCents: card.price.cents,
        currency: card.price.currency,
        inStock: card.inStock,
        image: card.image?.src ?? null,
      })),
      suggestions: result.suggestions,
      tookMs,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
