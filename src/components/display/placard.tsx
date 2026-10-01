"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The placard beside a piece in the shop window: what it is, its true size, its price, and a way to buy it.
 */

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { AddToCart } from "@/components/commerce/add-to-cart";
import { SmartLink } from "@/components/ui/smart-link";

/**
 * docs/adr/048. A museum's label, for a shop: maker and kind, the piece's
 * name, its measured size and materials, then the price — every word and
 * figure from the database, formatted on the server. The small photograph is
 * the piece as the studio shot it, beside the scan the window shows; it is
 * also what flies to the cart. On a wide screen the placard stands to the
 * right of the piece (the camera moves the piece left to make room); on a
 * phone it rises from the bottom (the camera lifts the piece above it).
 * Escape, or the close button, returns to the whole window.
 */

export type PlacardPiece = {
  id: string;
  slug: string;
  title: string;
  eyebrow: string;
  size: string;
  materials: string | null;
  price: string;
  quantityNote: string | null;
  inStock: boolean;
  image: { src: string; alt: string } | null;
  shownAs: "scan" | "photo";
};

export function Placard({ piece, onClose }: { piece: PlacardPiece; onClose: () => void }) {
  const t = useTranslations("showcase.placard");
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [piece.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={`placard-title-${piece.id}`}
      onKeyDown={onKeyDown}
      className="rounded-sheet shadow-sheet animate-pop text-dusk absolute inset-x-3 bottom-3 z-30 max-h-[62%] overflow-y-auto bg-white/95 p-5 backdrop-blur-md sm:inset-x-auto sm:top-1/2 sm:right-6 sm:bottom-auto sm:w-[22rem] sm:max-h-[86%] sm:-translate-y-1/2 sm:p-6"
      data-agent-id={`showcase:placard:${piece.id}`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        className="text-slate hover:text-dusk absolute top-3 right-3 grid size-10 place-items-center rounded-full"
        data-agent-id="action:close-placard"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className="flex items-center gap-3 pr-10">
        {piece.image === null ? null : (
          <span id={`placard-photo-${piece.id}`} className="bg-plinth relative size-14 shrink-0 overflow-hidden rounded-md">
            <Image src={piece.image.src} alt={piece.image.alt} fill sizes="56px" className="object-contain mix-blend-multiply" />
          </span>
        )}
        <p className="text-slate text-xs tracking-[0.08em] uppercase">{piece.eyebrow}</p>
      </div>

      <h2 id={`placard-title-${piece.id}`} ref={heading} tabIndex={-1} className="font-display mt-3 text-xl leading-snug outline-offset-4">
        {piece.title}
      </h2>
      <p className="text-slate mt-2 text-sm">{[piece.size, piece.materials].filter((part) => part !== null && part !== "").join(" · ")}</p>
      <p className="text-slate mt-1 text-xs">{piece.shownAs === "scan" ? t("scan") : t("photo")}</p>

      <p className="font-display mt-5 text-2xl tabular-nums">
        {piece.price}
        {piece.quantityNote === null ? null : <span className="text-slate ml-1 text-sm">{piece.quantityNote}</span>}
      </p>
      <p className="text-slate text-xs">{piece.inStock ? t("inStock") : t("outOfStock")}</p>

      <div className="mt-5 flex flex-col gap-3">
        <AddToCart productId={piece.id} inStock={piece.inStock} agentId={`placard:add-to-cart:${piece.id}`} flightSource={`#placard-photo-${piece.id}`} />
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <SmartLink href={`/p/${piece.slug}`} className="underline-offset-4 hover:underline" data-agent-id={`placard:details:${piece.id}`}>
            {t("details")}
          </SmartLink>
          <SmartLink href={`/p/${piece.slug}?view=ar`} className="underline-offset-4 hover:underline" data-agent-id={`placard:room:${piece.id}`}>
            {t("room")}
          </SmartLink>
        </div>
      </div>
    </aside>
  );
}
