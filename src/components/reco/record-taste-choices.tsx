"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Stores finished This-or-That choices as Taste Graph events when consent is given.
 */

import { useEffect } from "react";

/**
 * Stores a finished This-or-That round as `tot_choice` events, so the Taste
 * Graph can use the choices once personal recommendations are on. Sent once per
 * set of choices in a tab, and only with consent.
 */
export function RecordTasteChoices({ productIds }: { productIds: readonly string[] }) {
  useEffect(() => {
    if (!document.cookie.split("; ").includes("vt_personalize=1") || productIds.length === 0) return;
    try {
      const key = `vt_tot_${productIds.join(",")}`;
      if (sessionStorage.getItem(key) !== null) return;
      sessionStorage.setItem(key, "1");
      let session = sessionStorage.getItem("vt_sid");
      if (session === null) {
        session = crypto.randomUUID();
        sessionStorage.setItem("vt_sid", session);
      }
      for (const productId of productIds) {
        void fetch("/api/interactions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ productId, kind: "tot_choice", sessionId: session }),
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Storage unavailable (private mode, blocked site data): the choices simply are not kept.
    }
  }, [productIds]);

  return null;
}
