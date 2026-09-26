"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A figure that rolls to its new value when it changes: a total, a count.
 */

import { useState, type ReactNode } from "react";

/**
 * docs/adr/031. The new value rises into place (`animate-tick`) each time
 * `value` changes; the first value, seen as the page loads, just appears —
 * nothing happened for it to answer. Works wherever the new value comes from:
 * a refresh, a filter, a server action.
 */
export function Ticker({ value, children }: { value: string | number; children: ReactNode }) {
  // Derived during render, not in an effect: the count of changes since the page loaded.
  const [shown, setShown] = useState(value);
  const [changes, setChanges] = useState(0);
  if (value !== shown) {
    setShown(value);
    setChanges((count) => count + 1);
  }
  return (
    <span key={changes} className={changes > 0 ? "animate-tick" : "inline-block"}>
      {children}
    </span>
  );
}
