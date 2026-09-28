/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Load test: fifty shoppers searching at once, against a running production build.
 */

/**
 * docs/adr/036 (addendum).
 *
 *   pnpm build && pnpm local:start          (in one terminal)
 *   pnpm load:search                        (in another; BASE_URL=… for another address)
 *   PEAK=10 pnpm load:search                a smaller peak
 *
 * Ramps to 50 virtual shoppers (PEAK), each typing a query from the E1 set about once
 * a second, and holds there for a minute. Requests carry `instant=1`, as
 * search-as-you-type does, so the test does not fill the search analytics.
 * Pass: fewer than 1% errors and a p95 under 800 ms. The figures go to
 * docs/report/evaluations/load-search.json.
 *
 * The number that counts is on Railway's PostgreSQL. The local stack's PGlite
 * answers one query at a time and, locally, the web process also runs the
 * scheduled jobs, so a local run measures the laptop, not the shop.
 */

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const PEAK = Math.max(1, Number(__ENV.PEAK || 50));

// The E1 queries (src/lib/search/evaluation.ts): plain words, attributes, budgets, misspellings, Greek and Greeklish.
const QUERIES = [
  ["sofa", "en"], ["armchair", "en"], ["dining chair", "en"], ["coffee table", "en"], ["desk", "en"],
  ["floor lamp", "en"], ["table lamp", "en"], ["rug", "en"], ["bookshelf", "en"], ["mirror", "en"],
  ["leather sofa", "en"], ["grey armchair", "en"], ["oak table", "en"], ["black chair", "en"], ["wool rug", "en"],
  ["table lamp under 100", "en"], ["sofa under 800", "en"], ["chair between 100 and 300", "en"],
  ["chiar", "en"], ["lampp", "en"], ["sofaa", "en"], ["bookshelv", "en"],
  ["καναπές", "el"], ["καρέκλα", "el"], ["φωτιστικό δαπέδου", "el"], ["χαλί", "el"],
  ["kanapes", "el"], ["karekla", "el"], ["fotistiko", "el"], ["xali", "el"],
];

export const options = {
  stages: [
    { duration: "20s", target: Math.max(1, Math.round(PEAK / 5)) },
    { duration: "40s", target: PEAK },
    { duration: "60s", target: PEAK },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
  },
};

export default function shopperSearches() {
  const [query, locale] = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const response = http.get(`${BASE_URL}/api/search?q=${encodeURIComponent(query)}&locale=${locale}&limit=24&instant=1`, {
    tags: { name: "search" },
  });
  check(response, {
    "answered 200": (r) => r.status === 200,
    "sent results as JSON": (r) => {
      try {
        return Array.isArray(r.json("results"));
      } catch {
        return false;
      }
    },
  });
  // A shopper reads the results before typing again.
  sleep(0.5 + Math.random());
}

export function handleSummary(data) {
  const duration = data.metrics.http_req_duration.values;
  const failed = data.metrics.http_req_failed.values.rate;
  const summary = {
    at: new Date().toISOString(),
    baseUrl: BASE_URL,
    peakShoppers: PEAK,
    requests: data.metrics.http_reqs.values.count,
    perSecond: Math.round(data.metrics.http_reqs.values.rate * 10) / 10,
    errorRate: failed,
    ms: { median: Math.round(duration.med), p90: Math.round(duration["p(90)"]), p95: Math.round(duration["p(95)"]), max: Math.round(duration.max) },
    passed: Object.values(data.metrics).every((metric) => metric.thresholds === undefined || Object.values(metric.thresholds).every((threshold) => threshold.ok)),
  };
  const line = `search under load: ${summary.requests} requests (${summary.perSecond}/s), median ${summary.ms.median} ms, p95 ${summary.ms.p95} ms, errors ${(failed * 100).toFixed(2)}% — ${summary.passed ? "passed" : "FAILED"}\n`;
  return {
    stdout: line,
    "docs/report/evaluations/load-search.json": `${JSON.stringify(summary, null, 2)}\n`,
  };
}
