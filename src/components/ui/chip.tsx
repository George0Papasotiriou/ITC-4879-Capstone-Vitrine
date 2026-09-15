"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Toggleable filter chip.
 */

import type { ReactNode } from "react";

import { cx as cn } from "@/lib/ui/cx";

/**
 * Filter chip (docs/PLAN.md 4.2, 4.4)
 *
 * One of only two fully round shapes in the system — the other is the Lumen
 * presence dot. Everything else is 2px or 8px.
 *
 * Selection is exposed with `aria-pressed` on a real button, so the state a
 * sighted user sees and the state a screen reader announces are the same thing.
 */
export function Chip({
  children,
  selected = false,
  onToggle,
  count,
  disabled = false,
  className,
  ...rest
}: {
  children: ReactNode;
  selected?: boolean;
  onToggle?: () => void;
  /** Number of matching products, when the facet knows it. */
  count?: number;
  disabled?: boolean;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-sm",
        "transition-colors duration-quick ease-standard",
        "disabled:cursor-not-allowed disabled:opacity-40",
        selected
          ? "bg-dusk text-glass"
          : "border border-hairline text-dusk hover:border-dusk/35 hover:bg-dusk/[0.04]",
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined ? (
        <span className={cn("tabular text-xs", selected ? "text-mist" : "text-slate")}>
          {count}
        </span>
      ) : null}
    </button>
  );
}
