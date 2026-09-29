/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Trending now" for the search pop-up: terms several people searched for lately.
 */

import { kv } from "@/lib/kv";
import { readTrending } from "@/lib/search/trending";

/**
 * docs/adr/039. The same list for everyone, so browsers and any cache in
 * front may keep it for a minute. Only terms and a rounded score: never who,
 * never how many people exactly.
 */

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const terms = await readTrending(kv()).catch(() => []);
  return Response.json(
    { terms: terms.map(({ term }) => term) },
    { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
