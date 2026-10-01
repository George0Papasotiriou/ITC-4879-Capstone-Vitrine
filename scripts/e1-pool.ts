/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E1: the pool of (query, product) pairs to be graded, with the facts a judge grades from.
 */

/**
 * docs/adr/049.
 *
 *   pnpm evals:e1-pool [--dry-run]
 *
 * Runs each of E1's 39 queries through every version of the search (the same
 * versions /admin/labeling compares), pools their top tens — every product any
 * version shows in its first ten — and writes, for each pair, the product's
 * facts as a shopper would read them: title, maker, kind, category, colours,
 * materials, size, price and the opening of its description.
 *
 * The pool goes to docs/report/e1/pool.json (not part of the source; git
 * ignores docs/). An AI judge grades it there, from these facts only, into
 * docs/report/e1/ai-judgments.json; `pnpm evals:search --judge ai` scores the
 * search from those grades, and a person checks a blind sample of them at
 * /admin/labeling?view=check.
 *
 * Products are named by slug, which is the same in every database the
 * catalogue is synced into; ids are not.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";

import { E1_QUERIES, E1_SYSTEM_NAMES, E1_SYSTEMS } from "@/lib/search/evaluation";
import { searchProducts } from "@/lib/search/pipeline";
import { createRetrievers } from "@/lib/search/retrieve";

const OUT = path.join("docs", "report", "e1", "pool.json");
const DESCRIPTION_CHARS = 320;

type Facts = {
  slug: string;
  title: string;
  brand: string | null;
  kind: string;
  category: string;
  colours: string[];
  materials: string[];
  sizeCm: { w: number; d: number; h: number } | null;
  priceEur: number;
  description: string;
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set. Run this through `pnpm evals:e1-pool`.");
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const retrievers = createRetrievers(sql);
    const pooled: { query: string; locale: "en" | "el"; kind: string; ids: string[] }[] = [];
    for (const entry of E1_QUERIES) {
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const system of E1_SYSTEM_NAMES) {
        const result = await searchProducts(retrievers, entry.query, { ...E1_SYSTEMS[system], limit: 10 });
        for (const id of result.ids.slice(0, 10)) {
          if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }
      }
      pooled.push({ query: entry.query, locale: entry.locale, kind: entry.kind, ids });
    }

    const allIds = [...new Set(pooled.flatMap((entry) => entry.ids))];
    const rows = await sql<
      { id: string; slug: string; title_en: string; brand: string | null; kind: string; category: string; colors: string[]; materials: string[]; dims_cm: { w: number; d: number; h: number } | null; price_cents: number; description_en: string | null }[]
    >`
      SELECT p.id, p.slug, p.title_en, b.name AS brand, p.kind, c.slug AS category, p.colors, p.materials, p.dims_cm, p.price_cents, p.description_en
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.id = ANY(${allIds}::uuid[])
    `;
    const facts = new Map<string, Facts>(
      rows.map((row) => [
        row.id,
        {
          slug: row.slug,
          title: row.title_en,
          brand: row.brand,
          kind: row.kind,
          category: row.category,
          colours: row.colors,
          materials: row.materials,
          sizeCm: row.dims_cm,
          priceEur: row.price_cents / 100,
          description: (row.description_en ?? "").replace(/\s+/g, " ").slice(0, DESCRIPTION_CHARS),
        },
      ]),
    );

    const pairs = pooled.reduce((sum, entry) => sum + entry.ids.length, 0);
    console.log(`${E1_QUERIES.length} queries, ${pairs} pairs to grade (${allIds.length} different products), from ${E1_SYSTEM_NAMES.length} versions of the search.`);
    if (dryRun) return;
    await mkdir(path.dirname(OUT), { recursive: true });
    const pool = pooled.map((entry) => ({ query: entry.query, locale: entry.locale, kind: entry.kind, products: entry.ids.map((id) => facts.get(id)!).filter(Boolean) }));
    await writeFile(OUT, `${JSON.stringify({ at: new Date().toISOString(), queries: pool.length, pairs, pool }, null, 2)}\n`);
    console.log(`Wrote ${OUT}.`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
