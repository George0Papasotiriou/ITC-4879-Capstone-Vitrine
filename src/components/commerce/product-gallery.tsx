"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Product page media stage: main photograph on the plinth with angle thumbnails.
 */

import { useState, ViewTransition } from "react";

import { HeroPlinth } from "@/components/commerce/hero-plinth";
import { ProductImage } from "@/components/commerce/product-image";
import type { CatalogImage } from "@/lib/catalog/queries";
import { cn } from "@/lib/ui/cn";

/**
 * The media stage on a product page (docs/PLAN.md 4.3): one photograph on the
 * hero plinth, the other angles as thumbnails beneath it.
 *
 * The main plinth carries the same view-transition name as the tile the
 * product was opened from, so the photograph morphs from the grid into place.
 * Thumbnails are buttons that swap the photograph in place; the first one is
 * what the page renders on the server, so nothing shifts when it hydrates.
 */
export function ProductGallery({
  images,
  transitionName,
  label,
  showImageLabel,
}: {
  images: readonly CatalogImage[];
  transitionName: string;
  /** Accessible name of the thumbnail group. */
  label: string;
  /** "Show photograph {index} of {count}", already translated, per image. */
  showImageLabel: readonly string[];
}) {
  const [selected, setSelected] = useState(0);
  const current = images[selected] ?? images[0];

  return (
    <div className="flex flex-col gap-4">
      <ViewTransition name={transitionName} share="morph" default="none">
        <HeroPlinth className="aspect-square w-full">
          {current === undefined ? null : (
            <ProductImage key={current.src} image={current} loading={selected === 0 ? "hero" : "lazy"} sizes="(min-width: 1024px) 55vw, 90vw" />
          )}
        </HeroPlinth>
      </ViewTransition>

      {images.length > 1 ? (
        <ul aria-label={label} className="flex flex-wrap gap-3">
          {images.map((image, index) => (
            <li key={image.src}>
              <button
                type="button"
                aria-label={showImageLabel[index]}
                aria-pressed={index === selected}
                onClick={() => setSelected(index)}
                className={cn(
                  "bg-plinth rounded-plinth relative block aspect-square w-20 cursor-pointer overflow-hidden sm:w-24",
                  "outline-offset-2 transition-shadow duration-quick ease-standard",
                  index === selected ? "ring-dusk ring-2" : "hover:ring-dusk/30 hover:ring-1",
                )}
              >
                <span className="on-plinth absolute inset-2">
                  <ProductImage image={image} decorative sizes="6rem" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
