/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Locale-aware link primitive used by shared components.
 */

import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Link } from "@/i18n/navigation";

/**
 * The one link primitive that shared components use.
 *
 * Internal paths go through the locale-aware `Link`, so `/c/lighting` becomes
 * `/el/c/lighting` for a Greek reader. Using `next/link` directly drops the
 * prefix; the proxy then redirects to English, and a Greek shopper who clicks a
 * product lands on the English storefront — which is exactly what the first
 * version of `ProductTile` did.
 *
 * In-page anchors (`#section`) and absolute URLs are rendered as a plain `<a>`:
 * they are not routes, and localising them would turn `#specimen` into a
 * navigation to the home page.
 */
export function SmartLink({
  href,
  children,
  scroll,
  document = false,
  transitionTypes,
  ...props
}: {
  href: string;
  children: ReactNode;
  /** Routes only: `false` keeps the scroll position, as filter links should. */
  scroll?: boolean;
  /**
   * Load the destination as a new document instead of navigating inside the
   * app. For pages whose response headers matter, such as the cross-origin
   * isolated room page: headers apply to a document's first load only. The
   * caller passes the full localised path (`/el/room?…`), since it is used as is.
   */
  document?: boolean;
  /**
   * Routes only: what kind of move this navigation is, for the view
   * transitions (docs/adr/031) — "listing" rearranges a grid, "morph" carries a
   * photograph into a product page. Untagged navigations fade between pages.
   */
  transitionTypes?: string[];
} & Omit<ComponentPropsWithoutRef<"a">, "href" | "children">) {
  const isRoute = href.startsWith("/") && !href.startsWith("//");

  if (!isRoute || document) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} scroll={scroll} transitionTypes={transitionTypes} {...props}>
      {children}
    </Link>
  );
}
