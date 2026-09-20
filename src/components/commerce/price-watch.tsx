"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Tell me when the price drops": the price-watch form on a product page.
 */

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { WatchResponse } from "@/app/api/watch/route";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { centsToInput } from "@/lib/admin/catalog";
import { formatMoney, money } from "@/lib/commerce/money";
import { parseTargetCents, suggestedTargetCents } from "@/lib/commerce/price-watch";

/**
 * A watch is a promise to email, so it needs an account (docs/adr/020). A
 * visitor who is not signed in sees what it does and a link that brings them
 * back to this product afterwards.
 *
 * What the shopper types is read by the same rules the server uses
 * (price-watch.ts), so the message about a target that is too high appears as
 * they type rather than after a round trip; the server checks again against
 * the price in the database.
 */
export function PriceWatch({
  productId,
  slug,
  priceCents,
  currency,
  targetCents,
  signedIn,
}: {
  productId: string;
  slug: string;
  priceCents: number;
  currency: string;
  /** The target already set, if this person is watching. */
  targetCents: number | null;
  signedIn: boolean;
}) {
  const t = useTranslations("product.watch");
  const locale = useLocale();
  const toast = useToast();
  const [target, setTarget] = useState<number | null>(targetCents);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = (cents: number) => formatMoney(money(cents, currency), locale);
  const suggestion = centsToInput(suggestedTargetCents(priceCents));

  if (!signedIn) {
    return (
      <div className="border-hairline mt-8 border-t pt-6" data-agent-id={`price-watch:${productId}`}>
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <p className="text-slate mt-2 text-sm">{t("signInLede")}</p>
        <ButtonLink href={`/account/sign-in?returnTo=${encodeURIComponent(`/${locale}/p/${slug}`)}`} variant="tertiary" className="mt-3" data-agent-id="action:sign-in-to-watch">
          {t("signIn")}
        </ButtonLink>
      </div>
    );
  }

  const send = async (body: Record<string, unknown>, message: string) => {
    setPending(true);
    const response = await fetch("/api/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as WatchResponse | null;
    setPending(false);
    if (result === null || !result.ok) {
      setError(t(result === null ? "failed" : `errors.${result.reason}`, { price: amount(priceCents) }));
      return false;
    }
    setError(null);
    setTarget(result.targetCents);
    setOpen(false);
    toast({ title: message, tone: "success" });
    return true;
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const typed = String(new FormData(event.currentTarget).get("target") ?? "");
    const parsed = parseTargetCents(typed, priceCents);
    if (!parsed.ok) {
      setError(t(`errors.${parsed.problem}`, { price: amount(priceCents) }));
      return;
    }
    void send({ action: "set", productId, targetCents: parsed.cents, locale }, t("saved", { amount: amount(parsed.cents) }));
  };

  return (
    <section className="border-hairline mt-8 border-t pt-6" data-agent-id={`price-watch:${productId}`}>
      <h2 className="text-sm font-medium">{t("title")}</h2>

      {target === null ? (
        <p className="text-slate mt-2 text-sm">{t("lede")}</p>
      ) : (
        <p className="text-dusk mt-2 text-sm" data-agent-id="price-watch:state">
          {t("watching", { amount: amount(target) })}
        </p>
      )}

      {open ? (
        <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3" data-agent-id="price-watch:form">
          <Field
            label={t("target")}
            name="target"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={target === null ? suggestion : centsToInput(target)}
            hint={t("targetHint", { price: amount(priceCents) })}
            error={error ?? undefined}
            className="max-w-[14rem]"
            data-agent-id="price-watch:target"
          />
          <Button type="submit" aria-disabled={pending} data-agent-id="action:save-price-watch">
            {t("save")}
          </Button>
          <Button type="button" variant="tertiary" onClick={() => { setOpen(false); setError(null); }}>
            {t("cancel")}
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-3">
          <Button variant="tertiary" onClick={() => setOpen(true)} data-agent-id="action:watch-price">
            {target === null ? t("start") : t("change")}
          </Button>
          {target === null ? null : (
            <Button
              variant="tertiary"
              aria-disabled={pending}
              onClick={() => void send({ action: "remove", productId }, t("stopped"))}
              data-agent-id="action:stop-price-watch"
            >
              {t("stop")}
            </Button>
          )}
        </div>
      )}

      {!open && error !== null ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
