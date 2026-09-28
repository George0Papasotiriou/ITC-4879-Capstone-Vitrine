/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reads how many watched prices have dropped unseen, for the dot on the account icon.
 */

import { DropsBadge } from "@/components/commerce/drops-badge";
import { currentUser } from "@/lib/auth/session";
import { priceWatches } from "@/lib/commerce/server";

/** docs/adr/034. Rendered inside a Suspense boundary, so the header never waits for it. */
export async function AccountDrops({ variant }: { variant: "header" | "bar" }) {
  const user = await currentUser();
  if (user === null) return null;
  const drops = await (await priceWatches()).unseenDrops(user.id);
  return drops.length === 0 ? null : <DropsBadge count={drops.length} variant={variant} />;
}
