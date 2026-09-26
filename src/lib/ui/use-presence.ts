"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Keeps a closing surface on screen for its exit animation, then lets it go.
 */

import { useEffect, useState } from "react";

import { prefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * docs/adr/031. A surface that unmounts the moment it closes cannot animate
 * out: it just vanishes. This keeps it mounted, marked `data-state="closed"`,
 * for `exitMs`, which the stylesheet uses to play the exit — and not at all
 * under reduced motion. Opening again mid-exit simply reopens it.
 *
 * Radix does this for its own primitives; this is the same for the surfaces
 * that are not Radix (the Concierge dock).
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; state: "open" | "closed" } {
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);

  // Adjusting state during render when `open` changes, as React recommends for
  // derived state: no effect, no extra frame with the wrong value.
  if (open !== wasOpen) {
    setWasOpen(open);
    setLeaving(!open);
  }

  useEffect(() => {
    if (!leaving) return;
    const done = window.setTimeout(() => setLeaving(false), prefersReducedMotion() ? 0 : exitMs);
    return () => window.clearTimeout(done);
  }, [leaving, exitMs]);

  return { mounted: open || leaving, state: open ? "open" : "closed" };
}
