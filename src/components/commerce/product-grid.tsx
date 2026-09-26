/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Editorial product grid with a large hero tile at a fixed interval.
 */

import { ProductImage } from "@/components/commerce/product-image";
import { ProductTile, productTransitionName } from "@/components/commerce/product-tile";
import type { ProductCard } from "@/lib/catalog/queries";
import { cn } from "@/lib/ui/cn";

/**
 * The editorial grid (docs/PLAN.md 4.3).
 *
 * Two columns on mobile, four on desktop, with a 2 × 2 hero plinth every ninth
 * position. The rhythm is the whole point: an unbroken grid of equal tiles
 * reads as a spreadsheet, and the argument against Amazon and Temu in Part 1.2
 * is precisely that they read as spreadsheets. Breaking the rhythm at a fixed
 * interval makes a collection read as an arranged window.
 *
 * Ninth, not tenth, so the feature lands at the start of a row on a four-column
 * layout rather than mid-row.
 *
 * Each tile carries `data-flip-key`: inside a FlipGroup (the listing), a
 * filter, the sort or the page changing makes the pieces that stay glide to
 * their new places and the new ones rise in (docs/adr/031).
 */

const HERO_EVERY = 9;

export function ProductGrid({
  products,
  locale,
  className,
  priorityCount = 4,
  notes,
}: {
  products: readonly ProductCard[];
  locale: string;
  className?: string;
  /** How many leading images load eagerly at high priority (the first row). */
  priorityCount?: number;
  /** Product id → a short explanation shown under the price. */
  notes?: ReadonlyMap<string, string>;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4", className)}>
      {products.map((product, index) => {
        const isHero = index > 0 && index % HERO_EVERY === 0;

        return (
          <div key={product.id} data-flip-key={product.id} className={cn(isHero && "col-span-2 row-span-2")}>
            <ProductTile
              href={`/p/${product.slug}`}
              agentId={`product:${product.id}`}
              transitionName={productTransitionName(product.id)}
              title={product.title}
              brand={product.brand ?? undefined}
              price={product.price}
              compareAt={product.compareAt ?? undefined}
              locale={locale}
              note={notes?.get(product.id)}
              media={
                product.image === null ? null : (
                  <ProductImage
                    image={product.image}
                    loading={index < priorityCount ? "fold" : "lazy"}
                    sizes={isHero ? "(min-width: 1024px) 50vw, 90vw" : "(min-width: 1024px) 25vw, 45vw"}
                  />
                )
              }
              mediaHover={
                product.hoverImage === null ? undefined : <ProductImage image={product.hoverImage} decorative />
              }
            />
          </div>
        );
      })}
    </div>
  );
}
