"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Cart item count badge and accessible cart link label.
 */

import { useLocale, useTranslations } from "next-intl";

import { useCartSummary } from "@/components/commerce/cart-client";

/**
 * The number on the cart icon, and the cart link's accessible name with it
 * ("Open your cart, 2 items in your cart"). Rendered after load, so pages stay
 * cacheable: the server never reads the cart cookie to draw the header.
 */
export function CartCount({ variant }: { variant: "header" | "bar" }) {
  const t = useTranslations("nav");
  const summary = useCartSummary(useLocale());
  const count = summary?.itemCount ?? 0;

  return (
    <>
      <span className="sr-only">{`, ${t("cartCount", { count })}`}</span>
      {count > 0 ? (
        <span
          aria-hidden="true"
          data-agent-id="nav:cart-count"
          className={
            variant === "header"
              ? "bg-dusk text-glass tabular absolute top-1.5 left-[1.1rem] inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium"
              : "bg-dusk text-glass tabular absolute -top-1 left-1/2 ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium"
          }
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </>
  );
}
