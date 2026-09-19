"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Writing or editing the review of one delivered order line, from the order page.
 */

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ReviewStars } from "@/components/ui/rating";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { REVIEW_BODY_MAX, REVIEW_BODY_MIN, REVIEW_TITLE_MAX } from "@/lib/commerce/reviews";
import { cn } from "@/lib/ui/cn";

export type ExistingReview = { rating: number; title: string | null; body: string; status: "published" | "hidden" };

/**
 * The stars are five real radio buttons in a fieldset, so they work with a
 * keyboard (arrow keys move between them) and a screen reader says "4 stars,
 * 4 of 5"; the drawn stars only show the choice. The server checks everything
 * again (src/app/api/orders/[id]/reviews/route.ts).
 */
export function ItemReview({
  orderId,
  token,
  itemId,
  title,
  locale,
  existing,
}: {
  orderId: string;
  token: string | null;
  itemId: string;
  title: string;
  locale: string;
  existing: ExistingReview | null;
}) {
  const t = useTranslations("reviews");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ rating?: string; body?: string; form?: string }>({});

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const body = String(form.get("body") ?? "").trim();
    const reviewTitle = String(form.get("title") ?? "");
    const found = {
      rating: rating >= 1 && rating <= 5 ? undefined : t("errorRating"),
      body: body.length < REVIEW_BODY_MIN ? t("errorShort", { min: REVIEW_BODY_MIN }) : body.length > REVIEW_BODY_MAX ? t("errorLong", { max: REVIEW_BODY_MAX }) : undefined,
    };
    setErrors(found);
    if (found.rating !== undefined || found.body !== undefined) return;

    setPending(true);
    const response = await fetch(`/api/orders/${orderId}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(token === null ? {} : { token }), orderItemId: itemId, locale, review: { rating, title: reviewTitle, body } }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok: boolean; created?: boolean; fields?: Record<string, string> } | null;
    setPending(false);
    if (result?.ok !== true) {
      if (result?.fields?.body === "too_short") setErrors({ body: t("errorShort", { min: REVIEW_BODY_MIN }) });
      else setErrors({ form: t("errorFailed") });
      return;
    }
    toast({ title: result.created === true ? t("saved") : t("updated"), tone: "success" });
    setOpen(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3" data-agent-id={`review:item:${itemId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 font-medium">{title}</span>
        {existing !== null && !open ? <ReviewStars rating={existing.rating} label={t("starsLabel", { stars: existing.rating })} /> : null}
      </div>
      {existing !== null && !open ? (
        <div className="text-slate text-sm">
          {existing.title !== null ? <p className="text-dusk font-medium">{existing.title}</p> : null}
          <p className="line-clamp-3 whitespace-pre-line">{existing.body}</p>
          {existing.status === "hidden" ? <p className="mt-1">{t("hidden")}</p> : null}
        </div>
      ) : null}

      {open ? (
        <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4" data-agent-id={`review:form:${itemId}`}>
          <fieldset className="flex flex-col gap-2" aria-describedby={errors.rating === undefined ? undefined : `${id}-rating-error`}>
            <legend className="text-sm font-medium">{t("yourRating")}</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((stars) => (
                <label key={stars} className="cursor-pointer" title={t("starsLabel", { stars })}>
                  <input
                    type="radio"
                    name="rating"
                    value={stars}
                    checked={rating === stars}
                    onChange={() => setRating(stars)}
                    className="peer sr-only"
                    aria-label={t("starsLabel", { stars })}
                    data-agent-id={`review:stars:${stars}`}
                  />
                  <svg
                    viewBox="0 0 16 16"
                    className={cn(
                      "size-9 rounded-plinth p-1 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-dusk",
                      stars <= rating ? "text-dusk" : "text-hairline hover:text-slate",
                    )}
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M8 1.2l2.06 4.28 4.69.63-3.42 3.3.84 4.67L8 11.86l-4.17 2.22.84-4.67L1.25 6.1l4.69-.63z" />
                  </svg>
                </label>
              ))}
            </div>
            {errors.rating !== undefined ? (
              <p id={`${id}-rating-error`} className="text-danger text-sm">
                {errors.rating}
              </p>
            ) : null}
          </fieldset>
          <Field label={t("title")} name="title" maxLength={REVIEW_TITLE_MAX} defaultValue={existing?.title ?? ""} data-agent-id="review:title" />
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-body`} className="text-sm font-medium">
              {t("body")}
            </label>
            <textarea
              id={`${id}-body`}
              name="body"
              rows={5}
              maxLength={REVIEW_BODY_MAX}
              defaultValue={existing?.body ?? ""}
              aria-invalid={errors.body !== undefined}
              aria-describedby={`${id}-body-hint${errors.body === undefined ? "" : ` ${id}-body-error`}`}
              className={cn("border-hairline text-dusk rounded-plinth hover:border-dusk/35 w-full border bg-white p-3", errors.body !== undefined && "border-danger")}
              data-agent-id="review:body"
            />
            <p id={`${id}-body-hint`} className="text-slate text-sm">
              {t("bodyHint", { min: REVIEW_BODY_MIN })}
            </p>
            {errors.body !== undefined ? (
              <p id={`${id}-body-error`} className="text-danger text-sm">
                {errors.body}
              </p>
            ) : null}
          </div>
          {errors.form !== undefined ? (
            <p role="alert" className="text-danger text-sm">
              {errors.form}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!hydrated} aria-disabled={pending} data-agent-id={`review:submit:${itemId}`}>
              {pending ? t("saving") : t("submit")}
            </Button>
            <Button variant="tertiary" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={!hydrated} data-agent-id={`review:open:${itemId}`}>
            {existing === null ? t("write") : t("edit")}
          </Button>
        </div>
      )}
    </div>
  );
}
