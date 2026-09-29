/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A UCP checkout's continue_url: the cart an agent assembled becomes this browser's cart, and the buyer checks it.
 */

import { redirect } from "next/navigation";

import { UCP_SIGNING_PREFIX } from "@/lib/ai/surfaces/ucp/checkout";
import { rememberCart } from "@/lib/commerce/server";
import { cookieSecret } from "@/lib/commerce/services";
import { verifySignedValue } from "@/lib/commerce/tokens";
import { sql } from "@/lib/db/client";

/**
 * docs/adr/043. The link carries the session's cart id signed for UCP, so
 * only a session the shop made opens here. A cart already taken into an
 * account is not handed out again. The buyer lands on the cart page, sees
 * what the agent chose with the shop's prices, and goes to checkout from
 * there; signed in, the cart joins their account's as any guest cart does.
 */

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") === "el" ? "el" : "en";
  const value = verifySignedValue(url.searchParams.get("c") ?? undefined, cookieSecret());
  const cartId = value !== null && value.startsWith(UCP_SIGNING_PREFIX) ? value.slice(UCP_SIGNING_PREFIX.length) : null;
  if (cartId === null) redirect(`/${locale}/cart?handoff=invalid`);

  const [cart] = await sql<{ user_id: string | null }[]>`SELECT user_id FROM carts WHERE id = ${cartId}`;
  if (cart === undefined || cart.user_id !== null) redirect(`/${locale}/cart?handoff=gone`);
  await rememberCart(cartId);
  redirect(`/${locale}/cart?handoff=agent`);
}
