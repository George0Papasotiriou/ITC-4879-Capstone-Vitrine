"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * React hook for the reduced-motion preference: the system's, or the shopper's own choice in the shop.
 */

import { useSyncExternalStore } from "react";

/**
 * Whether the visitor has asked for reduced motion.
 *
 * Media queries do not exist on the server, so branching markup on one is a
 * classic source of hydration mismatches: the server renders the animated
 * element, the client decides it should not exist, and React tears down and
 * regenerates the subtree — taking any element references with it.
 *
 * `useSyncExternalStore` is the right tool because this *is* an external store.
 * `getServerSnapshot` returns false, so the server and the first client render
 * agree; the real value arrives in the re-render immediately after hydration,
 * before anything has had time to move.
 *
 * Two places can ask for it (docs/adr/032): the operating system, and the
 * shop's comfort settings, which write `data-motion` on <html> — "reduce" to
 * ask for less motion whatever the system says, "full" to keep it. The
 * stylesheet reads the same attribute, so CSS and script always agree.
 *
 * Reduced motion is honoured everywhere (docs/PLAN.md 4.7). The rule is that
 * turning it on removes animation, never function: the Spotlight still acts,
 * still captions, still announces and still records an undo.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  const attribute = new MutationObserver(onChange);
  attribute.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => {
    media.removeEventListener("change", onChange);
    attribute.disconnect();
  };
}

/** The same decision the stylesheet makes, readable outside React. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const chosen = document.documentElement.dataset.motion;
  if (chosen === "reduce") return true;
  if (chosen === "full") return false;
  return window.matchMedia(QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, getServerSnapshot);
}
