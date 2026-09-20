"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The price watches on the account page, with the price each one is waiting for.
 */

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import type { WatchResponse } from "@/app/api/watch/route";
import { ProductImage } from "@/components/commerce/product-image";
import { Button } from "@/components/ui/button";
import { SmartLink } from "@/components/ui/smart-link";
import { useToast } from "@/components/ui/toast";
import type { CatalogImage } from "@/lib/catalog/queries";
import { formatMoney, money } from "@/lib/commerce/money";

/**
 * One row per watch (docs/adr/020): the piece, today's price, and the price
 * the shopper is waiting for. Removing one takes the row away at once; if the
 * request fails the row comes back with a message, so the list never claims
 * something the database does not say.
 */

export type WatchItem = {
  productId: string;
  slug: string;
  title: string;
  image: CatalogImage | null;
  priceCents: number;
  targetCents: number;
  currency: string;
  /** The price is already at or below the target: the email has gone out. */
  reached: boolean;
};

export function WatchList({ items }: { items: readonly WatchItem[] }) {
  const t = useTranslations("account.watches");
  const locale = useLocale();
  const toast = useToast();
  const [removed, setRemoved] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  const amount = (cents: number, currency: string) => formatMoney(money(cents, currency), locale);

  const stop = async (productId: string) => {
    if (pending !== null) return;
    setPending(productId);
    setRemoved((current) => [...current, productId]);
    const response = await fetch("/api/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", productId }) }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as WatchResponse | null;
    setPending(null);
    if (result?.ok !== true) {
      setRemoved((current) => current.filter((id) => id !== productId));
      toast({ title: t("failed"), tone: "danger" });
      return;
    }
    toast({ title: t("stopped"), tone: "success" });
  };

  const visible = items.filter((item) => !removed.includes(item.productId));
  if (visible.length === 0) return <p className="text-slate mt-4 max-w-[60ch]">{t("empty")}</p>;

  return (
    <ul className="border-hairline divide-hairline mt-6 divide-y border-y" data-agent-id="account:watches">
      {visible.map((item) => (
        <li key={item.productId} className="flex flex-wrap items-center gap-4 py-4">
          <span className="bg-plinth rounded-plinth relative size-16 shrink-0 overflow-hidden">
            {item.image === null ? null : (
              <span className="on-plinth absolute inset-1.5">
                <ProductImage image={item.image} loading="lazy" sizes="64px" decorative />
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <SmartLink href={`/p/${item.slug}`} className="font-medium no-underline hover:underline underline-offset-4" data-agent-id={`account:watch:${item.productId}`}>
              {item.title}
            </SmartLink>
            <span className="text-slate text-sm">
              {t("now", { amount: amount(item.priceCents, item.currency) })} · {item.reached ? t("reached") : t("target", { amount: amount(item.targetCents, item.currency) })}
            </span>
          </span>
          <Button variant="tertiary" aria-disabled={pending === item.productId} onClick={() => void stop(item.productId)} data-agent-id={`action:stop-watch:${item.productId}`}>
            {t("stop")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
