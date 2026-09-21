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

export function SizePicker({ productId, sizes, agentId }: { productId: string; sizes: readonly SizeOption[]; agentId: string }) {
  const t = useTranslations("product.sizes");
  const [chosen, setChosen] = useState<SizeOption | null>(null);
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
              disabled={soldOut}
              aria-pressed={chosen?.variantId === size.variantId}
              aria-label={soldOut ? t("soldOutSize", { size: size.size }) : size.size}
              className={cn(
                "rounded-plinth border-hairline flex h-11 min-w-[3.25rem] items-center justify-center border px-3 text-sm transition-colors",
                "disabled:text-slate disabled:cursor-not-allowed disabled:line-through disabled:opacity-60",
                chosen?.variantId === size.variantId ? "bg-dusk text-glass border-dusk" : "hover:border-dusk/40 bg-white",
              )}
              data-agent-id={`size:${size.size}`}
            >
              {size.size}
            </button>
          );
        })}
      </div>

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
