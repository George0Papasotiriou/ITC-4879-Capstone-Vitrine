/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Hero plinth with the one-time window-light sweep animation.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * The hero plinth and the window light (docs/PLAN.md 4.5, moment 1).
 *
 * The most characteristic thing in a shop window is one lit object. On load,
 * Lumen sweeps once across the plinth and settles within 1.2 seconds — the
 * moment the lighting comes on at dusk — and then nothing moves again.
 *
 * This is a Server Component, and the sweep is a CSS keyframe. An earlier
 * version animated it with Motion, which put 45 KB of JavaScript on the home
 * page — a quarter of the plan's 180 KB per-route budget — for one tween that
 * nobody interacts with. Lighthouse then measured the home page at a mobile
 * Performance score of 74. The only motion nobody triggers should not need
 * hydration to happen.
 *
 * Reduced motion removes the sweep entirely (globals.css, `.window-light`), so
 * the plinth is simply lit.
 */
export function HeroPlinth({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-plinth rounded-plinth relative overflow-hidden", className)}>
      <div className="on-plinth absolute inset-6 sm:inset-10">{children}</div>
      <div aria-hidden="true" className="window-light pointer-events-none absolute inset-y-0 w-1/2" />
    </div>
  );
}
