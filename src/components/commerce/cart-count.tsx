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
import { useEffect, useRef, useState } from "react";

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

  // A count that changed after the page loaded answers with a bump, and the
  // number rolls to its new value (docs/adr/031). The first value, read after
  // load, just appears: nothing happened for it to answer.
  const previous = useRef<number | null>(null);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (summary === null) return;
    if (previous.current !== null && previous.current !== count) setChanges((value) => value + 1);
    previous.current = count;
  }, [summary, count]);

  const position = variant === "header" ? "absolute top-1.5 left-[1.1rem]" : "absolute -top-1 left-1/2 ml-1.5";

  return (
    <>
      <span className="sr-only">{`, ${t("cartCount", { count })}`}</span>
      {/* What the bump shows is also said, once, by the header's count (docs/adr/032). */}
      {variant === "header" ? (
        <span role="status" className="sr-only" data-agent-id="nav:cart-status">
          {changes > 0 ? t("cartCount", { count }) : ""}
        </span>
      ) : null}
      {/* Where the flight to the cart lands, present whether or not there is a count yet. */}
      <span aria-hidden="true" data-cart-target="" className={`${position} size-4`} />
      {count > 0 ? (
        <span
          key={changes}
          aria-hidden="true"
          data-agent-id="nav:cart-count"
          className={`bg-dusk text-glass tabular ${position} inline-flex h-4 min-w-4 items-center justify-center overflow-hidden rounded-full px-1 text-[10px] leading-none font-medium ${changes > 0 ? "animate-bump" : ""}`}
        >
          <span className={changes > 0 ? "animate-tick" : undefined}>{count > 99 ? "99+" : count}</span>
        </span>
      ) : null}
    </>
  );
}
