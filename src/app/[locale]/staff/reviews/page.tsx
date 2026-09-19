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
import { ReviewStars } from "@/components/ui/rating";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { reviewsStore } from "@/lib/commerce/server";
import { cn } from "@/lib/ui/cn";

const VIEWS = ["published", "hidden", "all"] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/reviews">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff" });
  return { title: t("reviewsTitle"), robots: { index: false, follow: false } };
}

export default async function ReviewDeskPage({ params, searchParams }: PageProps<"/[locale]/staff/reviews">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/staff/reviews`, "reviews:moderate");
  const requested = (await searchParams).view;
  const view = VIEWS.find((option) => option === requested) ?? "published";

  const t = await getTranslations("staff");
  const r = await getTranslations("reviews");
  const format = await getFormatter();
  const reviews = await (await reviewsStore()).deskReviews({ status: view === "all" ? null : view });

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

      {reviews.length === 0 ? (
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
