"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Browser-side cart helper: fetch wrapper and change event shared by cart components.
 */

import { useEffect, useState } from "react";

import type { CartSummary } from "@/app/api/cart/route";

/**
 * The browser side of the cart: one fetch helper and one event, so the header
 * count, the mini cart and the cart page agree without a global store. Every
 * number shown comes back from `/api/cart`, which reads it from the database.
 */

export type { CartSummary };

export const CART_EVENT = "vitrine:cart";

export type CartChangeResponse =
  | { ok: true; quantity: number; limitedTo: number | null; cart: CartSummary }
  | { ok: false; reason: "invalid_request" | "not_found" | "out_of_stock" | "cart_full" | "network" };

export async function changeCart(body: Record<string, unknown>): Promise<CartChangeResponse> {
  try {
    const response = await fetch("/api/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as CartChangeResponse;
    if (data.ok) window.dispatchEvent(new CustomEvent<CartSummary>(CART_EVENT, { detail: data.cart }));
    return data;
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** The current cart, refreshed whenever any component changes it. */
export function useCartSummary(locale: string): CartSummary | null {
  const [summary, setSummary] = useState<CartSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Every update bumps the version. A fetch that started before a change was
    // announced carries an older version, and its (stale) answer is dropped:
    // otherwise a slow first load could overwrite the item someone just added.
    let version = 0;
    const load = () => {
      const started = ++version;
      fetch(`/api/cart?locale=${locale}`, { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<CartSummary>) : null))
        .then((data) => {
          if (!cancelled && data !== null && started === version) setSummary(data);
        })
        .catch(() => {});
    };
    load();
    const onChange = (event: Event) => {
      version++;
      setSummary((event as CustomEvent<CartSummary>).detail);
    };
    // A new country changes the prices in the cart: fetch it again.
    const onRegion = () => load();
    window.addEventListener(CART_EVENT, onChange);
    window.addEventListener("vitrine:region", onRegion);
    return () => {
      cancelled = true;
      window.removeEventListener(CART_EVENT, onChange);
      window.removeEventListener("vitrine:region", onRegion);
    };
  }, [locale]);

  return summary;
}
