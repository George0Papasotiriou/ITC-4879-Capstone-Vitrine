/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Evaluation E1: the systems compared (the search with stages switched off) and the fixed query set.
 */

import type { SearchOptions } from "@/lib/search/pipeline";

/**
 * docs/adr/036. The ablations: the shop's search with one stage at a time
 * taken away, so the evaluation says what each stage adds. Semantic retrieval
 * joins the list when an embedding model is configured; until then the page
 * says so rather than scoring a system that cannot run.
 */
export const E1_SYSTEMS = {
  lexical: { retrievers: { lexical: true, fuzzy: false, semantic: false }, rerank: false },
  fuzzy: { retrievers: { lexical: false, fuzzy: true, semantic: false }, rerank: false },
  fusion: { retrievers: { lexical: true, fuzzy: true, semantic: false }, rerank: false },
  full: { retrievers: { lexical: true, fuzzy: true, semantic: false }, rerank: true },
} as const satisfies Record<string, Pick<SearchOptions, "retrievers" | "rerank">>;

export type E1System = keyof typeof E1_SYSTEMS;
export const E1_SYSTEM_NAMES = Object.keys(E1_SYSTEMS) as E1System[];

/**
 * The fixed queries, chosen to exercise each stage: plain product words,
 * colours, materials and budgets the parser reads, misspellings the fuzzy
 * retriever and spelling correction should catch, Greek, and Greeklish (Greek
 * typed in Latin letters). Kept small enough for one person to judge in an
 * afternoon — about forty queries and their pooled top tens.
 */
export const E1_QUERIES: readonly { query: string; locale: "en" | "el"; kind: "plain" | "attribute" | "budget" | "misspelt" | "greek" | "greeklish" }[] = [
  { query: "sofa", locale: "en", kind: "plain" },
  { query: "armchair", locale: "en", kind: "plain" },
  { query: "dining chair", locale: "en", kind: "plain" },
  { query: "coffee table", locale: "en", kind: "plain" },
  { query: "desk", locale: "en", kind: "plain" },
  { query: "floor lamp", locale: "en", kind: "plain" },
  { query: "table lamp", locale: "en", kind: "plain" },
  { query: "rug", locale: "en", kind: "plain" },
  { query: "bookshelf", locale: "en", kind: "plain" },
  { query: "mirror", locale: "en", kind: "plain" },
  { query: "vase", locale: "en", kind: "plain" },
  { query: "bench", locale: "en", kind: "plain" },
  { query: "linen shirt", locale: "en", kind: "plain" },
  { query: "wool coat", locale: "en", kind: "plain" },
  { query: "leather sofa", locale: "en", kind: "attribute" },
  { query: "grey armchair", locale: "en", kind: "attribute" },
  { query: "oak table", locale: "en", kind: "attribute" },
  { query: "black chair", locale: "en", kind: "attribute" },
  { query: "white cabinet", locale: "en", kind: "attribute" },
  { query: "wool rug", locale: "en", kind: "attribute" },
  { query: "table lamp under 100", locale: "en", kind: "budget" },
  { query: "sofa under 800", locale: "en", kind: "budget" },
  { query: "chair between 100 and 300", locale: "en", kind: "budget" },
  { query: "chiar", locale: "en", kind: "misspelt" },
  { query: "lampp", locale: "en", kind: "misspelt" },
  { query: "sofaa", locale: "en", kind: "misspelt" },
  { query: "bookshelv", locale: "en", kind: "misspelt" },
  { query: "καναπές", locale: "el", kind: "greek" },
  { query: "δερμάτινος καναπές", locale: "el", kind: "greek" },
  { query: "καρέκλα", locale: "el", kind: "greek" },
  { query: "φωτιστικό δαπέδου", locale: "el", kind: "greek" },
  { query: "χαλί", locale: "el", kind: "greek" },
  { query: "τραπεζάκι σαλονιού", locale: "el", kind: "greek" },
  { query: "πουκάμισο", locale: "el", kind: "greek" },
  { query: "kanapes", locale: "el", kind: "greeklish" },
  { query: "karekla", locale: "el", kind: "greeklish" },
  { query: "fotistiko", locale: "el", kind: "greeklish" },
  { query: "xali", locale: "el", kind: "greeklish" },
  { query: "trapezi", locale: "el", kind: "greeklish" },
];
