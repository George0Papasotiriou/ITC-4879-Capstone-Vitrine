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
import type { InsightPoint, ReviewInsights } from "@/lib/reviews/insights";

/**
 * Every review here comes from a delivered order (docs/adr/017), so each is
 * marked as a verified purchase. The text is shown as text — React escapes it
 * — and a review written in the other language says so, instead of being
 * machine-translated behind the reader's back.
 */
export function ProductReviews({ summary, reviews, locale, insights }: { summary: RatingSummary; reviews: PublicReview[]; locale: string; insights?: ReviewInsights }) {
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
            {insights === undefined || insights.pros.length + insights.cons.length === 0 ? null : (
              <BuyersSay insights={insights} shown={new Set(reviews.map((review) => review.id))} />
            )}
            <ol className="divide-hairline border-hairline divide-y border-y">
              {reviews.map((review) => (
                <li key={review.id} id={`review-${review.id}`} tabIndex={-1} className="flex scroll-mt-24 flex-col gap-2 py-6" data-agent-id={`review:${review.id}`} lang={review.locale}>
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

/**
 * docs/adr/041. What buyers like and what they mention against, each point
 * with how many reviews make it and the sentences that say it — quoted as
 * written, with a way to the whole review when it is on the page.
 */
function BuyersSay({ insights, shown }: { insights: ReviewInsights; shown: ReadonlySet<string> }) {
  const t = useTranslations("reviews.insights");
  const group = (title: string, points: InsightPoint[], id: string) =>
    points.length === 0 ? null : (
      <div className="flex flex-col gap-2">
        <h4 id={id} className="text-slate text-xs tracking-[0.08em] uppercase">
          {title}
        </h4>
        <ul aria-labelledby={id} className="flex flex-col gap-2">
          {points.map((point) => (
            <li key={`${point.aspect}-${point.polarity}`} data-agent-id={`insight:${point.aspect}-${point.polarity}`}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-baseline gap-2 [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className={point.polarity === "pro" ? "text-success" : "text-danger"}>
                    {point.polarity === "pro" ? "+" : "−"}
                  </span>
                  <span className="font-medium underline-offset-4 group-open:underline">{t(`aspects.${point.aspect}` as "aspects.build")}</span>
                  <span className="text-slate text-sm">{t("support", { count: point.reviews, total: insights.reviewed })}</span>
                </summary>
                <ul className="border-hairline mt-2 ml-5 flex flex-col gap-2 border-l pl-4">
                  {point.evidence.map((evidence) => (
                    <li key={evidence.reviewId} className="text-sm">
                      <q className="leading-relaxed">{evidence.sentence}</q>
                      <span className="text-slate"> — {evidence.author}</span>
                      {shown.has(evidence.reviewId) ? (
                        <a href={`#review-${evidence.reviewId}`} className="text-slate ml-2 underline underline-offset-4">
                          {t("read")}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <section aria-labelledby="buyers-say" className="bg-plinth rounded-plinth mb-8 flex flex-col gap-5 p-5" data-agent-id="product:insights">
      <div>
        <h3 id="buyers-say" className="font-display text-lg">
          {t("title")}
        </h3>
        <p className="text-slate text-sm">{t("lede", { total: insights.reviewed })}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {group(t("likes"), insights.pros, "buyers-like")}
        {group(t("dislikes"), insights.cons, "buyers-dislike")}
      </div>
    </section>
  );
}

