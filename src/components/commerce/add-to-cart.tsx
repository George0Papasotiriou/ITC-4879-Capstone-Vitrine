"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Add-to-cart button with the confirmation sheet.
 */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import { announceCart, changeCart, type CartSummary } from "@/components/commerce/cart-client";
import { ProductImage } from "@/components/commerce/product-image";
import { sessionId } from "@/components/reco/track-interest";
import { Button, ButtonLink } from "@/components/ui/button";
import { DialogRoot, SheetContent } from "@/components/ui/dialog";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useToast } from "@/components/ui/toast";
import { formatMoney, money } from "@/lib/commerce/money";
import { flyToCart } from "@/lib/ui/fly-to-cart";

/**
 * "Add to cart" on a product page, and the mini cart it opens (docs/PLAN.md
 * 4.3, Phase 5 step 2).
 *
 * The button sends only the product id; the server picks the variant, checks
 * stock and answers with the cart as it now is. The sheet shows that answer,
 * so the shopper sees the real subtotal and what is left for free shipping
 * without leaving the page. Focus moves into the sheet and returns to the
 * button when it closes (Radix Dialog).
 *
 * Before the sheet, the piece's photograph flies to the cart and the count
 * ticks as it lands (docs/adr/031); the button says "Added to cart" with a
 * drawn tick for a moment. The flight starts only once the server has said
 * yes, so nothing ever flies into a cart it did not reach.
 */
export function AddToCart({
  productId,
  variantId,
  inStock,
  label,
  agentId,
  flightSource,
}: {
  productId: string;
  /** A chosen size; without one the server picks the product's only variant. */
  variantId?: string;
  inStock: boolean;
  /** Replaces "Add to cart" when the shopper has something to do first, such as choosing a size. */
  label?: string;
  agentId: string;
  /** A selector for the photograph that flies to the cart; the product page's hero by default. */
  flightSource?: string;
}) {
  const t = useTranslations("cart");
  const tp = useTranslations("product");
  const locale = useLocale();
  const toast = useToast();
  // Disabled until the page can act on a click, as the shop's other forms are.
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (added === 0) return;
    const settle = window.setTimeout(() => setAdded(0), 1_600);
    return () => window.clearTimeout(settle);
  }, [added]);

  const add = () => {
    if (!inStock || pending) return;
    startTransition(async () => {
      const result = await changeCart({ action: "add", ...(variantId === undefined ? { productId } : { variantId }), quantity: 1, locale, sessionId: sessionId() }, { announce: false });
      if (!result.ok) {
        const message = result.reason === "out_of_stock" ? t("outOfStock") : result.reason === "not_found" ? t("notFound") : result.reason === "cart_full" ? t("cartFull") : t("failed");
        toast({ title: message, tone: "danger" });
        return;
      }
      setCart(result.cart);
      setNote(result.limitedTo === null ? null : t("addedLimited", { count: result.limitedTo }));
      setAdded((value) => value + 1);
      // Outside the transition, so the button is not held "pending" while the piece flies.
      const cartNow = result.cart;
      void flyToCart(document.querySelector(flightSource ?? '[data-flight-source="product-hero"]')).then(() => {
        announceCart(cartNow);
        setOpen(true);
      });
    });
  };

  const format = (cents: number) => formatMoney(money(cents, cart?.currency ?? "EUR"), locale);

  return (
    <>
      <Button data-agent-id={agentId} disabled={!hydrated} aria-disabled={!inStock || pending || undefined} onClick={add}>
        {added > 0 ? (
          <span key={added} className="animate-rise inline-flex items-center gap-2" data-agent-id={`${agentId}:added`}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m5 12 5 5 9-10" pathLength={24} strokeLinecap="round" strokeLinejoin="round" className="animate-draw" />
            </svg>
            {tp("added")}
          </span>
        ) : (
          (label ?? (inStock ? tp("addToCart") : tp("outOfStock")))
        )}
      </Button>

      <DialogRoot open={open} onOpenChange={setOpen}>
        {cart === null ? null : (
          <SheetContent title={t("added")} side="right">
            <div className="flex h-full flex-col gap-6" data-agent-id="mini-cart">
              {note === null ? null : <p className="text-dusk text-sm">{note}</p>}
              <ul className="divide-hairline border-hairline divide-y border-y">
                {cart.lines.map((line) => (
                  <li key={line.variantId} className="flex gap-4 py-4">
                    <div className="bg-plinth rounded-plinth relative size-16 shrink-0 overflow-hidden">
                      {line.image === null ? null : (
                        <div className="on-plinth absolute inset-1.5">
                          <ProductImage image={line.image} loading="lazy" sizes="64px" />
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                      <span className="line-clamp-2">{line.title}</span>
                      <span className="text-slate tabular">
                        {line.quantity} × {format(line.unitCents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2 text-sm">
                <dl className="flex justify-between">
                  <dt>{t("subtotal")}</dt>
                  <dd className="tabular font-medium">{format(cart.subtotalCents)}</dd>
                </dl>
                <p className="text-slate">
                  {cart.freeShippingRemainingCents === null ? t("freeShippingReached") : t("freeShippingRemaining", { amount: format(cart.freeShippingRemainingCents) })}
                </p>
              </div>
              <div className="mt-auto flex flex-col gap-3">
                <ButtonLink href="/checkout" data-agent-id="action:checkout">
                  {t("checkout")}
                </ButtonLink>
                <ButtonLink href="/cart" variant="secondary">
                  {t("viewCart")}
                </ButtonLink>
                <Button variant="tertiary" onClick={() => setOpen(false)}>
                  {t("keepShopping")}
                </Button>
              </div>
            </div>
          </SheetContent>
        )}
      </DialogRoot>
    </>
  );
}
