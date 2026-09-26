"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Quantity and remove controls for one cart line.
 */

import { useLocale, useTranslations } from "next-intl";
import { useRef, useTransition } from "react";

import { changeCart } from "@/components/commerce/cart-client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";
import { MAX_QUANTITY_PER_LINE } from "@/lib/commerce/pricing";
import { DURATION, EASE } from "@/lib/ui/motion";
import { prefersReducedMotion } from "@/lib/ui/use-reduced-motion";

/**
 * Quantity and remove for one cart line. A native select: on a phone it opens
 * the system picker, and it needs no custom keyboard handling. Each change goes
 * to the server, then the page re-renders with the totals the server computed.
 */
export function CartLineControls({ variantId, title, quantity, stock, available }: { variantId: string; title: string; quantity: number; stock: number; available: boolean }) {
  const t = useTranslations("cart");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const most = Math.max(quantity, Math.min(stock, MAX_QUANTITY_PER_LINE));
  const controls = useRef<HTMLDivElement>(null);

  const set = (next: number) =>
    startTransition(async () => {
      // Removing: the line folds away first (docs/adr/031), and comes back if the shop says no.
      const line = next === 0 && !prefersReducedMotion() ? controls.current?.closest<HTMLElement>("[data-flip-key]") : null;
      const fold = line?.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-12px) scale(0.98)" }], { duration: DURATION.quick, easing: EASE.exit, fill: "forwards" });
      const [result] = await Promise.all([changeCart({ action: "set", variantId, quantity: next, locale }), fold?.finished.catch(() => undefined)]);
      if (!result.ok) {
        fold?.cancel();
        toast({ title: result.reason === "out_of_stock" ? t("outOfStock") : t("failed"), tone: "danger" });
        return;
      }
      if (next === 0) toast({ title: t("remove"), description: title, tone: "neutral" });
      router.refresh();
    });

  return (
    <div ref={controls} className="flex items-center gap-3" aria-busy={pending || undefined}>
      {available ? (
        <select
          aria-label={t("quantityFor", { title })}
          value={quantity}
          disabled={pending}
          onChange={(event) => set(Number(event.currentTarget.value))}
          className="border-hairline text-dusk hover:border-dusk/35 rounded-plinth tabular h-11 w-20 cursor-pointer border bg-white px-3 transition-colors"
        >
          {Array.from({ length: most }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      ) : null}
      <Button variant="tertiary" size="sm" onClick={() => set(0)} aria-label={t("removeItem", { title })} aria-disabled={pending || undefined}>
        {t("remove")}
      </Button>
    </div>
  );
}
