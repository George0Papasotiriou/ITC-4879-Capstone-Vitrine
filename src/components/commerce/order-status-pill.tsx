/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * An order's status as a labelled pill: the word carries the meaning, the colour only supports it.
 */

import type { OrderStatus } from "@/lib/commerce/order-state";
import { cn } from "@/lib/ui/cn";

const FINISHED: readonly OrderStatus[] = ["cancelled", "refunded", "returned"];

export function OrderStatusPill({ status, label, className }: { status: OrderStatus; label: string; className?: string }) {
  const finished = FINISHED.includes(status);
  const waiting = status === "pending_payment" || status === "return_requested";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap",
        finished ? "bg-dusk/[0.06] text-slate" : waiting ? "bg-lumen/25 text-dusk" : "bg-plinth text-dusk",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", finished ? "bg-slate" : waiting ? "bg-lumen" : "bg-success")} />
      {label}
    </span>
  );
}
