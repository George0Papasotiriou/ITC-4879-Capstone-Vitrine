/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Builds schema.org Product and BreadcrumbList structured data.
 */

import type { ProductDetail } from "@/lib/catalog/queries";
import { minorUnitsPerMajor } from "@/lib/commerce/money";

/**
 * Structured data for search engines (docs/PLAN.md Phase 3, step 8):
 * schema.org Product with an Offer, and a BreadcrumbList.
 *
 * Built from the same database record the page renders, so the price in the
 * markup can never disagree with the price on the page.
 */

export function productJsonLd(product: ProductDetail, { url, origin, categoryUrl }: { url: string; origin: string; categoryUrl: string }) {
  const divisor = minorUnitsPerMajor(product.price.currency);
  return [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      sku: product.id,
      category: product.categoryName,
      image: product.media.map((image) => new URL(image.src, origin).toString()),
      ...(product.description === null && product.highlights.length === 0
        ? {}
        : { description: product.description ?? product.highlights.join(" ") }),
      ...(product.brand === null ? {} : { brand: { "@type": "Brand", name: product.brand } }),
      offers: {
        "@type": "Offer",
        url,
        priceCurrency: product.price.currency,
        price: (product.price.cents / divisor).toFixed(divisor === 1 ? 0 : 2),
        availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        itemCondition: "https://schema.org/NewCondition",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Vitrine", item: origin },
        { "@type": "ListItem", position: 2, name: product.categoryName, item: categoryUrl },
        { "@type": "ListItem", position: 3, name: product.title, item: url },
      ],
    },
  ];
}

/**
 * JSON for a `<script type="application/ld+json">`. A product title is data
 * from outside the application; escaping `<` means a title containing
 * "</script>" cannot end the script element and inject markup.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
