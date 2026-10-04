/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Reviews Amazon.com customers wrote of this very product: apart from the shop's own, and saying where they come from.
 */

import { useFormatter, useTranslations } from "next-intl";

import { ReviewStars } from "@/components/ui/rating";
import { fitLean, meanRating } from "@/lib/reviews/amazon";
import type { ExternalReview, ExternalSummary } from "@/lib/reviews/external-store";

/**
 * docs/adr/061 (George, 2026-10-04: "Real Amazon reviews, labelled"). The
 * shop's own reviews come only from its buyers (docs/adr/017); these were
 * written on Amazon.com about the same product, and the block says so in its
 * heading and its source line. Their stars are not the shop's stars: nothing
 * here feeds the product's rating, search or structured data.
 *
 * What reviewers say about fit leads the block for pieces sold in sizes,
 * because it is what a shoe shopper wants to know first. The text is English
 * (it is marked so for screen readers and translation tools) and is shown as
 * written; the first few are open, the rest one click away.
 */

const OPEN = 3;

export function AmazonReviews({ summary, reviews, sized, locale }: { summary: ExternalSummary; reviews: ExternalReview[]; sized: boolean; locale: string }) {
  const t = useTranslations("reviews.amazon");
  const format = useFormatter();
  const mean = meanRating(summary);
  const average = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(mean);
  const fit = fitLean({ small: summary.runsSmall, trueToSize: summary.trueToSize, large: summary.runsLarge });
  const percent = new Intl.NumberFormat(locale, { style: "percent" }).format(fit.share);

  const item = (review: ExternalReview) => (
    <li key={review.id} className="flex flex-col gap-2 py-6" data-agent-id={`amazon-review:${review.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ReviewStars rating={review.rating} label={t("starsLabel", { stars: review.rating })} />
        {review.title === null ? null : (
          <h3 className="font-medium" lang="en">
            {review.title}
          </h3>
        )}
      </div>
      <p className="max-w-[65ch] leading-relaxed whitespace-pre-line" lang="en">
        {review.body}
      </p>
      <p className="text-slate text-sm">
        {[
          review.verified ? t("verified") : t("onAmazon"),
          format.dateTime(new Date(`${review.reviewedOn}T12:00:00Z`), { dateStyle: "medium" }),
          review.helpful > 0 ? t("helpful", { count: review.helpful }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </li>
  );

  return (
    <section aria-labelledby="amazon-reviews-heading" className="border-hairline mt-16 border-t pt-10" data-agent-id="product:amazon-reviews">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="amazon-reviews-heading" className="font-display text-2xl">
          {t("heading")}
        </h2>
        <p className="text-slate text-sm">{t("notOurs")}</p>
      </div>
      <div className="mt-8 grid gap-12 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <p className="flex items-baseline gap-3">
            <span className="font-display tabular text-4xl" data-agent-id="amazon-reviews:average">
              {average}
            </span>
            <span className="text-slate">{t("outOfFive")}</span>
          </p>
          <ReviewStars rating={mean} label={t("outOf", { average })} />
          <p className="text-slate text-sm">{t("basedOn", { count: summary.count })}</p>
          {sized && fit.lean !== "unknown" ? (
            <p className="bg-plinth rounded-plinth p-4 text-sm" data-agent-id="amazon-reviews:fit">
              <span className="font-medium">{t(`fit.${fit.lean}`)}</span> {t("fitShare", { percent, count: fit.remarks })}
            </p>
          ) : null}
        </div>
        <div>
          <ol className="divide-hairline border-hairline divide-y border-y">{reviews.slice(0, OPEN).map(item)}</ol>
          {reviews.length > OPEN ? (
            <details className="group mt-2">
              <summary className="text-dusk cursor-pointer py-3 text-sm font-medium underline-offset-4 hover:underline" data-agent-id="amazon-reviews:more">
                {t("more", { count: reviews.length - OPEN })}
              </summary>
              <ol className="divide-hairline border-hairline divide-y border-b">{reviews.slice(OPEN).map(item)}</ol>
            </details>
          ) : null}
          <p className="text-slate mt-6 max-w-[70ch] text-xs leading-relaxed" data-agent-id="amazon-reviews:source">
            {t("source")}
          </p>
        </div>
      </div>
    </section>
  );
}
