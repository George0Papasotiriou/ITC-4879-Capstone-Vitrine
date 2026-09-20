/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Price-watch API: a signed-in shopper sets, moves or removes the price they are waiting for.
 */

import { z } from "zod";

import { routing } from "@/i18n/routing";
import { MAX_PRICE_CENTS } from "@/lib/admin/catalog";
import { currentUser } from "@/lib/auth/session";
import { MIN_TARGET_CENTS } from "@/lib/commerce/price-watch";
import { priceWatches } from "@/lib/commerce/server";

/**
 * Watches belong to an account, because the answer is an email (docs/adr/020).
 * The target arrives in cents, already read from what the shopper typed, and
 * is checked again here against the price in the database: a page left open
 * through a price change cannot set a target above today's price.
 */

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    productId: z.uuid(),
    targetCents: z.number().int().min(MIN_TARGET_CENTS).max(MAX_PRICE_CENTS),
    locale: z.enum(routing.locales).catch(routing.defaultLocale),
  }),
  z.object({ action: z.literal("remove"), productId: z.uuid() }),
]);

export type WatchResponse =
  | { ok: true; watching: boolean; targetCents: number | null }
  | { ok: false; reason: "sign_in" | "invalid_request" | "not_found" | "not_below_price" | "too_many" };

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (user === null) return Response.json({ ok: false, reason: "sign_in" } satisfies WatchResponse, { status: 401 });

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" } satisfies WatchResponse, { status: 400 });

  const store = await priceWatches();
  if (body.data.action === "remove") {
    await store.remove({ userId: user.id, productId: body.data.productId });
    return Response.json({ ok: true, watching: false, targetCents: null } satisfies WatchResponse);
  }

  const result = await store.set({ userId: user.id, productId: body.data.productId, targetCents: body.data.targetCents, locale: body.data.locale });
  if (!result.ok) return Response.json({ ok: false, reason: result.reason } satisfies WatchResponse, { status: result.reason === "not_found" ? 404 : 409 });
  return Response.json({ ok: true, watching: true, targetCents: body.data.targetCents } satisfies WatchResponse);
}
