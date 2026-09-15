/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Filter chip rendered as a link so listing filters live in the URL.
 */

import type { ReactNode } from "react";

import { SmartLink } from "@/components/ui/smart-link";
import { cn } from "@/lib/ui/cn";

/**
 * A filter chip that is a link (docs/PLAN.md 4.4).
 *
 * Listing filters live in the URL, so choosing one is a navigation: it works
 * without JavaScript, can be opened in a new tab, and goes back with the back
 * button. It looks exactly like `Chip`, but a link cannot carry
 * `aria-pressed`, so the selected state is announced with visually hidden text
 * — and a button is never nested inside a link, which is invalid markup.
 */
export function FilterLink({
  href,
  selected,
  selectedLabel,
  count,
  children,
  current = false,
  className,
}: {
  href: string;
  selected: boolean;
  /** "selected", in the page language; empty when the link text already says what it does. */
  selectedLabel: string;
  count?: number;
  children: ReactNode;
  /** For navigation chips (categories): marks the page the reader is on. */
  current?: boolean;
  className?: string;
}) {
  return (
    <SmartLink
      href={href}
      aria-current={current ? "page" : undefined}
      scroll={false}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm no-underline",
        "transition-colors duration-quick ease-standard",
        selected
          ? "bg-dusk text-glass"
          : "border-hairline text-dusk hover:border-dusk/35 hover:bg-dusk/[0.04] border",
        className,
      )}
    >
      {children}
      {count !== undefined ? (
        <span className={cn("tabular text-xs", selected ? "text-mist" : "text-slate")}>{count}</span>
      ) : null}
      {selected && !current && selectedLabel !== "" ? <span className="sr-only">, {selectedLabel}</span> : null}
    </SmartLink>
  );
}
