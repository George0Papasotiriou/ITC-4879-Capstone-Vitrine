/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Region API: reports and remembers the country prices are shown for.
 */

import { cookies } from "next/headers";
import { z } from "zod";

import { COUNTRY_COOKIE, currentRegion, regionFor } from "@/lib/commerce/region";

/**
 * The country prices are shown for (docs/adr/013).
 *
 * GET says which country this request is priced for and why (the shopper's
 * choice, their location, or the shop's default), for components on cached
 * pages. POST remembers a choice. The choice only changes prices shown while
 * browsing; checkout charges the VAT of the delivery address.
 */

export const runtime = "nodejs";

const ONE_YEAR = 365 * 24 * 60 * 60;

export async function GET(): Promise<Response> {
  return Response.json(await currentRegion(), { headers: { "cache-control": "no-store" } });
}

const bodySchema = z.object({ country: z.string().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()) });

export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, reason: "invalid_country" }, { status: 400 });
  const jar = await cookies();
  // A display preference: no script on the page needs to read it.
  jar.set(COUNTRY_COOKIE, parsed.data.country, { path: "/", sameSite: "lax", maxAge: ONE_YEAR, httpOnly: true });
  return Response.json({ ok: true, region: regionFor(parsed.data.country, "choice") });
}
