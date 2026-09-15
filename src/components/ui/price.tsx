/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Price display with tabular numerals and compare-at discount.
 */

import { discountPercent, formatMoney, type Money } from "@/lib/commerce/money";
import { cn } from "@/lib/ui/cn";

/**
 * Price (docs/PLAN.md 4.2, 4.4)
 *
 * Tabular numerals, so prices in a grid align down the column instead of
 * shimmying. The value always comes from the database as integer cents — a
 * price is never a string the Concierge produced (CLAUDE.md golden rule 5).
 */
export function Price({
  amount,
  compareAt,
  locale = "en",
  size = "base",
  className,
}: {
  amount: Money;
  /** Original price, when this item is reduced. */
  compareAt?: Money;
  locale?: string;
  size?: "sm" | "base" | "lg";
  className?: string;
}) {
  const reduction = compareAt === undefined ? null : discountPercent(amount, compareAt);
  const isReduced = reduction !== null;

  const sizes = {
    sm: "text-sm",
    base: "text-base",
    lg: "text-xl",
  } as const;

  return (
    <span className={cn("tabular inline-flex items-baseline gap-2", sizes[size], className)}>
      <span className={cn(isReduced && "text-danger")}>{formatMoney(amount, locale)}</span>

      {compareAt !== undefined && isReduced ? (
        <>
          <s className="text-slate text-[0.875em]">{formatMoney(compareAt, locale)}</s>
          {/* Percentage stated plainly, never as a pressure device: no
              countdown, no "only today" (Part 4.8). */}
          <span className="text-slate text-[0.8125em]">−{reduction}%</span>
        </>
      ) : null}
    </span>
  );
}
