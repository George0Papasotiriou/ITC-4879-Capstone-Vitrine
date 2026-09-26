"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Choosing a size, and adding that size to the cart.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";

import { AddToCart } from "@/components/commerce/add-to-cart";
import { useHydrated } from "@/components/ui/use-hydrated";
import { cn } from "@/lib/ui/cn";

/**
 * Sizes are variants, each with its own stock (docs/adr/022). A size that has
 * sold out stays on the page, disabled and said so: it tells the shopper the
 * piece is cut in that size, and that this one is gone rather than never made.
 *
 * Nothing can be added until a size is chosen, because a garment without a
 * size is not a thing the shop can send.
 */

export type SizeOption = { variantId: string; size: string; stock: number };

/** Few enough left that it is worth saying, as on the rest of the shop. */
const LOW_STOCK = 3;

export function SizePicker({ productId, sizes, agentId, preferred }: { productId: string; sizes: readonly SizeOption[]; agentId: string; preferred?: string }) {
  const t = useTranslations("product.sizes");
  // The shopper's own size, from their preferences (docs/adr/033): chosen to start with when it is in stock.
  const [chosen, setChosen] = useState<SizeOption | null>(() => sizes.find((size) => size.size === preferred && size.stock > 0) ?? null);
  // Until the page is hydrated a size button would swallow the tap and do
  // nothing, which reads as a broken shop; it waits instead.
  const hydrated = useHydrated();
  const anyLeft = sizes.some((size) => size.stock > 0);

  return (
    <div className="mt-6 flex flex-col gap-3" data-agent-id={`sizes:${productId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <p className="text-slate text-sm" data-agent-id="sizes:state">
          {chosen === null ? t("choose") : chosen.stock <= LOW_STOCK ? t("few", { size: chosen.size, count: chosen.stock }) : t("chosen", { size: chosen.size })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("title")}>
        {sizes.map((size) => {
          const soldOut = size.stock === 0;
          return (
            <button
              key={size.variantId}
              type="button"
              onClick={() => setChosen(size)}
              disabled={soldOut || !hydrated}
              aria-pressed={chosen?.variantId === size.variantId}
              aria-label={soldOut ? t("soldOutSize", { size: size.size }) : size.size === preferred ? t("yourSizeLabel", { size: size.size }) : size.size}
              className={cn(
                "rounded-plinth border-hairline flex h-11 min-w-[3.25rem] items-center justify-center border px-3 text-sm transition-colors",
                // Struck through only when the size has gone, never in the moment before the page wakes up.
                soldOut
                  ? "text-slate cursor-not-allowed line-through"
                  : chosen?.variantId === size.variantId
                    ? "bg-dusk text-glass border-dusk"
                    : "hover:border-dusk/40 bg-white",
              )}
              data-agent-id={`size:${size.size}`}
            >
              {size.size}
              {size.size === preferred ? <span className="bg-lumen ml-1.5 size-1.5 rounded-full" aria-hidden="true" data-agent-id="size:yours" /> : null}
            </button>
          );
        })}
      </div>

      {preferred === undefined ? null : (
        <p className="text-slate text-xs" data-agent-id="sizes:yours">
          {t("yourSize", { size: preferred })}
        </p>
      )}

      <AddToCart
        productId={productId}
        variantId={chosen?.variantId}
        inStock={anyLeft && chosen !== null}
        label={chosen === null && anyLeft ? t("chooseFirst") : undefined}
        agentId={agentId}
      />
    </div>
  );
}
