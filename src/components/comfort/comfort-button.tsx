"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The ways into the comfort settings: a button in the header and a link in the footer.
 */

import { useTranslations } from "next-intl";

import { openComfortPanel } from "@/components/comfort/comfort-store";
import { cn } from "@/lib/ui/cn";

/** docs/adr/032. In the header on every page, so it is found before it is needed. */
export function ComfortButton({ className }: { className?: string }) {
  const t = useTranslations("comfort");
  return (
    <button
      type="button"
      onClick={openComfortPanel}
      aria-label={t("open")}
      title={t("open")}
      data-agent-id="nav:comfort"
      className={cn("text-dusk rounded-plinth hover:bg-dusk/[0.05] press inline-flex size-11 cursor-pointer items-center justify-center", className)}
    >
      {/* "Aa": the sign readers already know for text settings. */}
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M3 18 8 6l5 12M4.8 14h6.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M20 18v-4.5a2.5 2.5 0 0 0-5 0M20 15.5c-2.8 0-5 .6-5 1.6s1 1.1 2 1.1c1.6 0 3-1 3-2.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** The same, as a line of text in the footer. */
export function ComfortLink({ className }: { className?: string }) {
  const t = useTranslations("comfort");
  return (
    <button type="button" onClick={openComfortPanel} className={cn("cursor-pointer text-left underline-offset-4 hover:underline", className)} data-agent-id="footer:comfort">
      {t("footerLink")}
    </button>
  );
}
