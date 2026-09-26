/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The move between pages: the old one steps back, the new one settles in, and the header stays put.
 */

import { ViewTransition, type ReactNode } from "react";

/**
 * docs/adr/031. A template, not the layout: Next.js mounts a template afresh
 * on every navigation, which is what lets the page leave and arrive, while the
 * layout — the header, the Concierge, the mobile bar — stays where it is, the
 * one fixed point the eye keeps.
 *
 * Two kinds of navigation move differently and are left alone here: opening a
 * product from a tile ("morph", the photograph carries the move) and changing
 * a listing's filters, sort or page ("listing", the grid rearranges itself).
 * Everything else — a link, the back button, the Concierge opening a page —
 * is a short step: out in 90ms, in over 280ms after it.
 */
export default function Template({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ morph: "none", listing: "none", default: "page-in" }}
      exit={{ morph: "none", listing: "none", default: "page-out" }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
