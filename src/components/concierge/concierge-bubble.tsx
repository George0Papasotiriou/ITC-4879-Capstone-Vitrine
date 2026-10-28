"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The Concierge's bubble: a round button at the bottom left of every page on tablets and computers that opens the dock.
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useConciergeShell } from "@/components/concierge/concierge-shell";
import { ConciergeToggle } from "@/components/concierge/concierge-toggle";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/ui/cn";

/**
 * docs/adr/067. The same toggle as the header's Concierge button, with its
 * own id (nav:concierge-bubble), mounted after the header and the phone bar so
 * the tests' "first visible toggle" still finds those. Phones keep the
 * Concierge in the middle of their bottom bar, so the bubble shows from
 * tablets up (George's choice). The Spotlight's light sets off from it
 * (data-spotlight-source), so an action the Concierge takes visibly starts
 * where the shopper asked.
 *
 * A one-time hint offers help after a short while on a shopping page. Once
 * dismissed, or once the Concierge has been opened, it never returns on this
 * device (a per-device convenience kept in localStorage, not account data).
 */

const HINT_KEY = "vt-concierge-hint";
const HINT_DELAY_MS = 9000;
/** Pages where an offer of help would be in the way: paying, signing in, and the staff's own desks. */
const QUIET = /^\/(checkout|account|staff|admin|orders|study)(\/|$)/;

function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "seen";
  } catch {
    return true;
  }
}

function markHintSeen() {
  try {
    window.localStorage.setItem(HINT_KEY, "seen");
  } catch {
    // Storage blocked: the hint simply does not come back on this page.
  }
}

export function ConciergeBubble() {
  const t = useTranslations("concierge");
  const { open, setOpen } = useConciergeShell();
  const pathname = usePathname();
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (open || QUIET.test(pathname) || hintSeen()) return;
    const timer = window.setTimeout(() => setHint(true), HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, pathname]);

  // Opening the Concierge, however it is opened, is the hint's answer.
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open && hint) setHint(false);
  }
  useEffect(() => {
    if (open) markHintSeen();
  }, [open]);

  const dismiss = () => {
    setHint(false);
    markHintSeen();
  };

  return (
    <div data-concierge-bubble className="pointer-events-none fixed bottom-6 left-6 z-[45] hidden items-end gap-3 md:flex">
      <div data-spotlight-source className="pointer-events-auto">
        <ConciergeToggle
          agentId="nav:concierge-bubble"
          className={cn(
            "group bg-dusk text-glass press animate-rise relative grid size-14 cursor-pointer place-items-center rounded-full",
            "shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)] transition-[transform,box-shadow] duration-quick ease-standard",
            "hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-12px_rgb(0_0_0/0.5)]",
          )}
        >
          {open ? (
            <CloseGlyph />
          ) : (
            <span aria-hidden="true" className="relative grid size-6 place-items-center">
              {/* A still glow: breathing is kept for the listening light, the one loop in the shop (docs/PLAN.md 4.5). */}
              <span className="bg-lumen/30 absolute inset-0 rounded-full" />
              <span className="bg-lumen relative size-3 rounded-full" />
            </span>
          )}
          {/* The name, shown beside the bubble on hover and keyboard focus; the button's own label is what is read out. */}
          <span
            aria-hidden="true"
            className={cn(
              "bg-dusk text-glass rounded-plinth pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 text-sm whitespace-nowrap",
              "-translate-x-1 opacity-0 transition-[opacity,transform] duration-quick ease-standard",
              "group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100",
              hint && "hidden",
            )}
          >
            {open ? t("close") : t("open")}
          </span>
        </ConciergeToggle>
      </div>

      {hint ? (
        <div role="status" data-agent-id="concierge:bubble-hint" className="animate-rise border-hairline bg-glass rounded-plinth pointer-events-auto mb-1 flex max-w-[17rem] items-start gap-2 border py-2.5 pr-2 pl-3.5 text-sm shadow-[0_12px_32px_-16px_rgb(0_0_0/0.35)]">
          <button type="button" onClick={() => setOpen(true)} className="text-dusk cursor-pointer py-0.5 text-left underline-offset-4 hover:underline">
            {t("bubbleHint")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("dismissHint")}
            data-agent-id="concierge:bubble-hint-dismiss"
            className="text-slate hover:text-dusk hover:bg-dusk/[0.05] rounded-plinth grid size-7 shrink-0 cursor-pointer place-items-center"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
