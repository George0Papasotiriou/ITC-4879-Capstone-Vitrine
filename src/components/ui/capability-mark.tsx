/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Non-interactive capability label for product tiles.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * A non-interactive mark on a product tile for a single capability ("3D",
 * "Try on"). Part 4.4 allows at most one per tile: a row of badges turns a
 * window display into a spreadsheet.
 *
 * Kept out of `chip.tsx` on purpose. That file is a Client Component (chips
 * toggle), and importing anything from it into `ProductTile` made every product
 * grid ship its client code — including tailwind-merge, 8.4 KB gzipped — for a
 * label that needs no JavaScript at all.
 */
export function CapabilityMark({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "border-hairline text-slate inline-flex items-center rounded-plinth border px-2 py-0.5 text-xs",
        className,
      )}
    >
      {children}
    </span>
  );
}
