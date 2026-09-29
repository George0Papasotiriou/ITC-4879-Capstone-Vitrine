"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One tap to shop the window: every piece of the display into the cart, in its quantity.
 */

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { announceCart, changeCart } from "@/components/commerce/cart-client";
import { sessionId } from "@/components/reco/track-interest";
import { Button, ButtonLink } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useToast } from "@/components/ui/toast";

/**
 * docs/adr/040. The cart API is asked once per piece, each with the product id
 * and the quantity only — the server picks the variant, checks the stock and
 * prices it, as it does for every add. A piece that cannot be added (sold out
 * since the page was drawn) is named, and the rest still go in. The cart can
 * be emptied as ever; nothing here is paid for until checkout.
 */
export function AddWindow({ pieces }: { pieces: readonly { productId: string; quantity: number; title: string }[] }) {
  const t = useTranslations("showcase");
  const locale = useLocale();
  const toast = useToast();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const addAll = () => {
    if (pending) return;
    startTransition(async () => {
      const missed: string[] = [];
      let last = null;
      for (const piece of pieces) {
        const result = await changeCart({ action: "add", productId: piece.productId, quantity: piece.quantity, locale, sessionId: sessionId() }, { announce: false });
        if (result.ok) last = result.cart;
        else missed.push(piece.title);
      }
      if (last !== null) announceCart(last);
      setDone(missed.length < pieces.length);
      toast(
        missed.length === 0
          ? { title: t("addedAll"), tone: "success" }
          : { title: t("addedSome", { missed: missed.join(", ") }), tone: missed.length === pieces.length ? "danger" : "neutral" },
      );
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={addAll} disabled={!hydrated} aria-disabled={pending || pieces.length === 0 || undefined} data-agent-id="action:add-window">
        {pending ? t("adding") : t("addAll")}
      </Button>
      {done ? (
        <ButtonLink href="/cart" variant="secondary" data-agent-id="action:window-cart">
          {t("toCart")}
        </ButtonLink>
      ) : null}
    </div>
  );
}
