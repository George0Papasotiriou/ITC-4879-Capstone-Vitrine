/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Builds schema.org Product and BreadcrumbList structured data.
 */

import type { ProductDetail } from "@/lib/catalog/queries";
import type { PublicReview } from "@/lib/commerce/review-store";
import type { RatingSummary } from "@/lib/commerce/reviews";
import { minorUnitsPerMajor } from "@/lib/commerce/money";

/**
 * Structured data for search engines (docs/PLAN.md Phase 3, step 8):
 * schema.org Product with an Offer, and a BreadcrumbList.
 *
 * Built from the same database record the page renders, so the price in the
 * markup can never disagree with the price on the page.
 */

/**
 * With reviews, an AggregateRating and the newest few reviews are added (docs/adr/017):
 * the same verified reviews the page shows, never an invented score. Without
 * any, both are left out, as search engines require.
 */
export function productJsonLd(
  product: ProductDetail,
  { url, origin, categoryUrl, reviews }: { url: string; origin: string; categoryUrl: string; reviews?: { summary: RatingSummary; reviews: PublicReview[] } },
) {
  const divisor = minorUnitsPerMajor(product.price.currency);
  const rated = reviews !== undefined && reviews.summary.count > 0;
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
      ...(rated
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: reviews.summary.average.toFixed(1),
              reviewCount: reviews.summary.count,
              bestRating: 5,
              worstRating: 1,
            },
            review: reviews.reviews.slice(0, 5).map((review) => ({
              "@type": "Review",
              reviewRating: { "@type": "Rating", ratingValue: review.rating, bestRating: 5, worstRating: 1 },
              author: { "@type": "Person", name: review.authorName },
              datePublished: review.createdAt.toISOString().slice(0, 10),
              ...(review.title === null ? {} : { name: review.title }),
              reviewBody: review.body,
              inLanguage: review.locale,
            })),
          }
        : {}),
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
