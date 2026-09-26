/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Product photograph displayed on a plinth.
 */

import Image from "next/image";

import type { CatalogImage } from "@/lib/catalog/queries";

/**
 * A product photograph on a plinth.
 *
 * `object-contain` rather than `cover`: catalogue photography is composed with
 * the object centred and margin around it, and cropping it to fill would cut
 * the legs off a chair. The plinth is the frame; the photograph sits inside it.
 *
 * The multiply blend that dissolves the white studio ground is applied by
 * `ProductTile`, not here, so this component stays usable anywhere.
 *
 * Loading. Next.js 16 deprecated `priority`; this component says what the
 * image is instead:
 *
 *   "hero"   the one image that is the page's largest paint (home hero, product
 *            stage): loaded eagerly at high fetch priority.
 *   "fold"   one of several images that may be the largest paint depending on
 *            the viewport (the first row of a grid): the same.
 *   "lazy"   everything else, loaded as it approaches the viewport.
 *
 * Measured: with `priority` (and then `preload`) the product photograph was
 * still requested at low priority — the preload link carries no fetchpriority —
 * which Lighthouse flagged. The Next.js documentation recommends `loading` and
 * `fetchPriority` over `preload` in most cases, and that is what both modes use.
 */
export type ImageLoading = "hero" | "fold" | "lazy";

export function ProductImage({
  image,
  sizes = "(min-width: 1024px) 30vw, 50vw",
  loading = "lazy",
  decorative = false,
  appear = false,
}: {
  image: CatalogImage;
  sizes?: string;
  loading?: ImageLoading;
  /** A second view that repeats what the main image already says. */
  decorative?: boolean;
  /** Fades in when it replaces another photograph in the same place (a gallery thumbnail chosen). */
  appear?: boolean;
}) {
  return (
    <Image
      src={image.src}
      alt={decorative ? "" : image.alt}
      fill
      sizes={sizes}
      {...(loading === "lazy" ? {} : { loading: "eager" as const, fetchPriority: "high" as const })}
      className={appear ? "animate-[vitrine-fade-in_var(--duration-calm)_var(--ease-standard)] object-contain" : "object-contain"}
      // Read by the plinth: a studio shot is blended into it, a scene is not.
      data-ground={image.studio === false ? "scene" : "studio"}
    />
  );
}
