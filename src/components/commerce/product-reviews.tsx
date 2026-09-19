/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A product's verified reviews: the average, how the stars are spread, and the newest reviews.
 */

import { useFormatter, useTranslations } from "next-intl";

import { ReviewStars } from "@/components/ui/rating";
import type { PublicReview } from "@/lib/commerce/review-store";
import type { RatingSummary } from "@/lib/commerce/reviews";

/**
 * Every review here comes from a delivered order (docs/adr/017), so each is
 * marked as a verified purchase. The text is shown as text — React escapes it
 * — and a review written in the other language says so, instead of being
 * machine-translated behind the reader's back.
 */
export function ProductReviews({ summary, reviews, locale }: { summary: RatingSummary; reviews: PublicReview[]; locale: string }) {
  const t = useTranslations("reviews");
  const format = useFormatter();
  const average = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(summary.average);

  return (
    <section aria-labelledby="reviews-heading" className="border-hairline mt-20 border-t pt-10" data-agent-id="product:reviews">
      <h2 id="reviews-heading" className="font-display text-2xl">
        {t("heading")}
      </h2>
      {summary.count === 0 ? (
        <p className="text-slate mt-4 max-w-[60ch]">{t("none")}</p>
      ) : (
        <div className="mt-8 grid gap-12 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <p className="flex items-baseline gap-3">
              <span className="font-display tabular text-4xl" data-agent-id="product:rating-average">
                {average}
              </span>
              <span className="text-slate">{t("outOfFive")}</span>
            </p>
            <ReviewStars rating={summary.average} label={t("outOf", { average })} />
            <p className="text-slate text-sm">{t("basedOn", { count: summary.count })}</p>
            <ul className="flex flex-col gap-2 text-sm" aria-label={t("heading")}>
              {[5, 4, 3, 2, 1].map((stars) => {
                const count = summary.distribution[stars - 1]!;
                const share = summary.count === 0 ? 0 : count / summary.count;
                return (
                  <li key={stars} className="flex items-center gap-3">
                    <span className="tabular w-4 text-right" aria-hidden="true">
                      {stars}
                    </span>
                    <span className="bg-plinth relative h-2 flex-1 overflow-hidden rounded-full" aria-hidden="true">
                      <span className="bg-dusk absolute inset-y-0 left-0 rounded-full" style={{ width: `${share * 100}%` }} />
                    </span>
                    <span className="tabular text-slate w-8 text-right" aria-hidden="true">
                      {count}
                    </span>
                    <span className="sr-only">{t("starsShare", { stars, count })}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <ol className="divide-hairline border-hairline divide-y border-y">
              {reviews.map((review) => (
                <li key={review.id} className="flex flex-col gap-2 py-6" data-agent-id={`review:${review.id}`} lang={review.locale}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ReviewStars rating={review.rating} label={t("starsLabel", { stars: review.rating })} />
                    {review.title !== null ? <h3 className="font-medium">{review.title}</h3> : null}
                  </div>
                  <p className="max-w-[65ch] leading-relaxed whitespace-pre-line">{review.body}</p>
                  <p className="text-slate text-sm" lang={locale}>
                    {review.authorName} · {t("verified")} · {format.dateTime(review.createdAt, { dateStyle: "medium" })}
                    {review.edited ? ` · ${t("edited")}` : ""}
                    {review.locale !== locale ? ` · ${review.locale === "el" ? t("inGreek") : t("inEnglish")}` : ""}
                  </p>
                </li>
              ))}
            </ol>
            {reviews.length < summary.count ? <p className="text-slate mt-4 text-sm">{t("showing", { shown: reviews.length, count: summary.count })}</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}
