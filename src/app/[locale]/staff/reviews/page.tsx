/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Staff review moderation: every review, newest first, with hide and restore.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { ReviewModeration } from "@/components/staff/review-moderation";
import { Button } from "@/components/ui/button";
import { ReviewStars } from "@/components/ui/rating";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { reviewsStore } from "@/lib/commerce/server";
import { externalReviewStore } from "@/lib/reviews/server";
import { cn } from "@/lib/ui/cn";

/** The shop's own reviews by status, and the Amazon.com reviews shown on the wearables (docs/adr/061). */
const VIEWS = ["published", "hidden", "all", "amazon"] as const;
/** How many Amazon.com reviews the desk lists at once; finding a product reaches the rest. */
const AMAZON_PAGE = 100;

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/reviews">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff" });
  return { title: t("reviewsTitle"), robots: { index: false, follow: false } };
}

export default async function ReviewDeskPage({ params, searchParams }: PageProps<"/[locale]/staff/reviews">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/staff/reviews`, "reviews:moderate");
  const query = await searchParams;
  const view = VIEWS.find((option) => option === query.view) ?? "published";
  const product = typeof query.product === "string" ? query.product.trim().slice(0, 100) : "";

  const t = await getTranslations("staff");
  const r = await getTranslations("reviews");
  const format = await getFormatter();
  const reviews = view === "amazon" ? [] : await (await reviewsStore()).deskReviews({ status: view === "all" ? null : view });
  const amazon = view === "amazon" ? await (await externalReviewStore()).deskList({ hidden: null, product, limit: AMAZON_PAGE }) : [];

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="staff:reviews">
      <h1 className="font-display text-3xl">{t("reviewsTitle")}</h1>
      <p className="text-slate mt-3 max-w-[70ch]">{t("reviewsLede")}</p>
      <nav aria-label={t("reviewViewsLabel")} className="mt-8">
        <ul className="flex gap-1">
          {VIEWS.map((option) => (
            <li key={option}>
              <SmartLink
                href={`/staff/reviews?view=${option}`}
                aria-current={option === view ? "page" : undefined}
                className={cn("rounded-plinth flex h-11 items-center px-4 text-sm no-underline transition-colors", option === view ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]")}
              >
                {t(`reviewViews.${option}`)}
              </SmartLink>
            </li>
          ))}
        </ul>
      </nav>

      {view === "amazon" ? (
        <>
          <p className="text-slate mt-6 max-w-[70ch] text-sm">{t("amazonLede")}</p>
          <form method="get" role="search" className="mt-6 flex flex-wrap items-end gap-2">
            <input type="hidden" name="view" value="amazon" />
            <label className="flex flex-col gap-2 text-sm font-medium">
              {t("amazonFind")}
              <input
                name="product"
                type="search"
                defaultValue={product}
                maxLength={100}
                autoComplete="off"
                className="border-hairline text-dusk rounded-plinth hover:border-dusk/35 h-11 w-72 max-w-full border bg-white px-3 font-normal transition-colors"
                data-agent-id="staff:amazon-find"
              />
            </label>
            <Button type="submit" variant="secondary">
              {t("amazonFindAction")}
            </Button>
          </form>
          {amazon.length === 0 ? (
            <p className="text-slate mt-10">{product === "" ? t("reviewsEmpty") : t("amazonNone", { query: product })}</p>
          ) : null}
          {amazon.length === AMAZON_PAGE ? <p className="text-slate mt-4 text-sm">{t("amazonNewest", { count: AMAZON_PAGE })}</p> : null}
          <ol className={cn("divide-hairline border-hairline mt-6 divide-y border-y", amazon.length === 0 && "hidden")}>
            {amazon.map((review) => (
              <li key={review.id} className="grid gap-4 py-6 md:grid-cols-[minmax(0,1fr)_14rem]" data-agent-id={`staff:amazon-review:${review.id}`}>
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-slate text-sm">
                    <SmartLink href={`/p/${review.productSlug}`} className="underline underline-offset-4">
                      {review.productTitle}
                    </SmartLink>
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <ReviewStars rating={review.rating} label={r("starsLabel", { stars: review.rating })} />
                    {review.title !== null ? (
                      <span className="font-medium" lang="en">
                        {review.title}
                      </span>
                    ) : null}
                  </div>
                  <p className="max-w-[65ch] whitespace-pre-line" lang="en">
                    {review.body}
                  </p>
                  <p className="text-slate text-sm">
                    Amazon.com · {format.dateTime(new Date(`${review.reviewedOn}T12:00:00Z`), { dateStyle: "medium" })}
                  </p>
                  {review.hidden && review.hiddenReason !== null ? <p className="text-sm italic">{t("hiddenBecause", { reason: review.hiddenReason })}</p> : null}
                </div>
                <div className="md:justify-self-end">
                  <ReviewModeration reviewId={review.id} status={review.hidden ? "hidden" : "published"} endpoint={`/api/staff/external-reviews/${review.id}`} />
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : reviews.length === 0 ? (
        <p className="text-slate mt-10">{t("reviewsEmpty")}</p>
      ) : (
        <ol className="divide-hairline border-hairline mt-8 divide-y border-y">
          {reviews.map((review) => (
            <li key={review.id} className="grid gap-4 py-6 md:grid-cols-[minmax(0,1fr)_14rem]" data-agent-id={`staff:review:${review.id}`}>
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-slate text-sm">
                  <SmartLink href={`/p/${review.productSlug}`} className="underline underline-offset-4">
                    {t("reviewOf", { product: review.productTitle, order: review.orderNumber })}
                  </SmartLink>
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <ReviewStars rating={review.rating} label={r("starsLabel", { stars: review.rating })} />
                  {review.title !== null ? <span className="font-medium">{review.title}</span> : null}
                </div>
                <p className="max-w-[65ch] whitespace-pre-line">{review.body}</p>
                <p className="text-slate text-sm">
                  {review.authorName} · {format.dateTime(review.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                </p>
                {review.status === "hidden" && review.moderationReason !== null ? (
                  <p className="text-sm italic" data-agent-id="staff:review-reason-shown">
                    {t("hiddenBecause", { reason: review.moderationReason })}
                  </p>
                ) : null}
              </div>
              <div className="md:justify-self-end">
                <ReviewModeration reviewId={review.id} status={review.status} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
