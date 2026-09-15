/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Product tile: photograph, title, price and capability mark.
 */

import { ViewTransition, type ReactNode } from "react";

import { CapabilityMark } from "@/components/ui/capability-mark";
import { Price } from "@/components/ui/price";
import { SmartLink } from "@/components/ui/smart-link";
import type { Money } from "@/lib/commerce/money";
import { cn } from "@/lib/ui/cn";

/**
 * Product tile (docs/PLAN.md 4.4)
 *
 * The plinth is the idea: a display surface the product stands on, not a card
 * it sits inside. So there is no border, no shadow, and no lift on hover —
 * Part 4.8 lists "identical rounded cards with the same grey shadow" as the
 * thing this design exists to avoid.
 *
 * The photograph blends into the plinth with `mix-blend-mode: multiply`, so a
 * white studio background dissolves instead of forming a visible rectangle.
 * That is what makes a grid of tiles read as an arranged window.
 *
 * On desktop hover the image swaps to a second angle. Nothing moves.
 */
export function ProductTile({
  href,
  title,
  brand,
  price,
  compareAt,
  media,
  mediaHover,
  capability,
  locale = "en",
  agentId,
  transitionName,
  note,
  className,
}: {
  href: string;
  title: string;
  brand?: string;
  price: Money;
  compareAt?: Money;
  /** The product visual. Rendered on the plinth with a multiply blend. */
  media: ReactNode;
  /** A second angle, revealed on hover. Optional. */
  mediaHover?: ReactNode;
  /** At most one mark per tile: "3D", "Try on", "In your room". */
  capability?: string;
  locale?: string;
  /** Identifier the Concierge can target with `highlight` (docs/PLAN.md 2.5). */
  agentId?: string;
  /**
   * Shared-element name linking this tile to the product page hero, so opening
   * a product morphs the photograph into place (4.5). Pass it only where the
   * product appears once on the page: a view-transition name must be unique,
   * and a duplicate makes the browser abandon the transition altogether.
   */
  transitionName?: string;
  /** One quiet line under the price: why the product is here ("Because you viewed …"). */
  note?: string;
  className?: string;
}) {
  const plinth = (
    <div className="bg-plinth rounded-plinth relative aspect-[4/5] overflow-hidden">
      <div
        className={cn(
          "on-plinth absolute inset-0 transition-opacity duration-calm ease-standard",
          mediaHover !== undefined && "group-hover:opacity-0",
        )}
      >
        {media}
      </div>

      {mediaHover !== undefined ? (
        <div
          aria-hidden="true"
          className="on-plinth absolute inset-0 opacity-0 transition-opacity duration-calm ease-standard group-hover:opacity-100"
        >
          {mediaHover}
        </div>
      ) : null}

      {capability !== undefined ? (
        <div className="absolute bottom-3 left-3">
          <CapabilityMark className="bg-plinth">{capability}</CapabilityMark>
        </div>
      ) : null}
    </div>
  );

  return (
    <article
      className={cn("group relative flex flex-col gap-3", className)}
      data-agent-id={agentId}
      // React applies `view-transition-name` only while a transition runs, so
      // at rest the name is invisible. Mirroring it here is what lets a test
      // assert the one invariant that silently breaks the morph: uniqueness.
      data-transition-name={transitionName}
    >
      {transitionName === undefined ? (
        plinth
      ) : (
        // `default="none"` stops this tile cross-fading on every unrelated
        // navigation; `share` keeps the morph when a pair does form.
        <ViewTransition name={transitionName} share="morph" default="none">
          {plinth}
        </ViewTransition>
      )}

      <div className="flex flex-col gap-1">
        {brand !== undefined ? <p className="text-slate text-sm">{brand}</p> : null}

        <h3 className="text-base leading-snug">
          {/* The whole tile is the target: the link is stretched over the
              plinth rather than wrapping it, so the heading stays a heading. */}
          <SmartLink
            href={href}
            className="after:absolute after:inset-0 after:content-[''] line-clamp-2 no-underline hover:underline underline-offset-4"
          >
            {title}
          </SmartLink>
        </h3>

        <Price amount={price} compareAt={compareAt} locale={locale} size="sm" />
        {note === undefined ? null : <p className="text-slate line-clamp-1 text-xs">{note}</p>}
      </div>
    </article>
  );
}

/** A view-transition name must be a valid CSS identifier. */
export function productTransitionName(productId: string): string {
  return `product-${productId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}
