"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The part of the Concierge loaded on first use: the chat engine, the Spotlight and the dock.
 */

import { ConciergeDock } from "@/components/concierge/concierge-dock";
import { ConciergeProvider } from "@/components/concierge/concierge-provider";

/** docs/adr/034. One chunk, fetched when the shell first needs it. */
export function ConciergeEngine(props: Omit<Parameters<typeof ConciergeProvider>[0], "children">) {
  return (
    <ConciergeProvider {...props}>
      <ConciergeDock />
    </ConciergeProvider>
  );
}
