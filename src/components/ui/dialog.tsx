"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Accessible dialog and sheet primitives.
 */

import { useTranslations } from "next-intl";
import { Dialog as Primitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Dialog and Sheet (docs/PLAN.md 4.2, 4.4).
 *
 * Both are the same accessible primitive — focus is trapped inside, Esc closes,
 * focus returns to the trigger, and the page behind is inert to screen readers.
 * Radix does that bookkeeping; getting any one of those wrong by hand is a
 * keyboard trap, which is why this is a dependency and not a hand-rolled div.
 *
 * They differ only in where they sit. A dialog interrupts: it is for a decision
 * that has to be made now. A sheet sits beside the page: it is for content you
 * work with while the page stays visible — the Concierge dock, the mini cart,
 * filters on a phone.
 *
 * Sheets and dialogs are the only surfaces allowed a shadow (4.2): one soft one,
 * plus a hairline.
 */

export const DialogRoot = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

function Overlay() {
  return (
    <Primitive.Overlay className="bg-dusk/40 animate-overlay fixed inset-0 z-50" />
  );
}

function CloseButton() {
  const t = useTranslations("common");
  return (
    <Primitive.Close
      aria-label={t("close")}
      className={cn(
        "text-slate hover:text-dusk absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-plinth",
        "transition-colors duration-quick ease-standard cursor-pointer",
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
      </svg>
    </Primitive.Close>
  );
}

/**
 * A title is required rather than optional: a dialog without an accessible name
 * announces as "dialog" and nothing else. When the design calls for no visible
 * heading, pass `hideTitle` and it is kept for screen readers only.
 */
type SurfaceProps = {
  title: string;
  description?: string;
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
};

export function DialogContent({
  title,
  description,
  hideTitle = false,
  children,
  className,
}: SurfaceProps) {
  return (
    <Primitive.Portal>
      <Overlay />
      <Primitive.Content
        className={cn(
          "bg-glass shadow-sheet rounded-sheet animate-pop fixed top-1/2 left-1/2 z-50",
          "max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6",
          className,
        )}
      >
        <Primitive.Title className={cn("font-display pr-10 text-xl", hideTitle && "sr-only")}>
          {title}
        </Primitive.Title>
        {description === undefined ? (
          <Primitive.Description className="sr-only">{title}</Primitive.Description>
        ) : (
          <Primitive.Description className="text-slate mt-2">{description}</Primitive.Description>
        )}
        <div className="mt-5">{children}</div>
        <CloseButton />
      </Primitive.Content>
    </Primitive.Portal>
  );
}

/**
 * Sheet placement.
 *
 * `responsive` is the Concierge dock's layout from 4.3: a bottom sheet on a
 * phone, where the thumb is, and a 420px side panel from tablet up, where it can
 * stay open beside the page it is operating.
 */
type Side = "right" | "bottom" | "responsive";

const SIDES: Record<Side, string> = {
  right: "inset-y-0 right-0 h-full w-full max-w-[420px] animate-sheet-right",
  bottom: "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-sheet animate-sheet-bottom",
  responsive: cn(
    "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-sheet animate-sheet-bottom",
    "md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:h-full md:max-w-[420px] md:rounded-none md:animate-sheet-right",
  ),
};

export function SheetContent({
  title,
  description,
  hideTitle = false,
  side = "responsive",
  children,
  className,
}: SurfaceProps & { side?: Side }) {
  return (
    <Primitive.Portal>
      <Overlay />
      <Primitive.Content
        className={cn(
          "bg-glass shadow-sheet fixed z-50 flex flex-col overflow-y-auto p-6",
          // Keep clear of the iOS home indicator on the bottom placement.
          "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
          SIDES[side],
          className,
        )}
      >
        <Primitive.Title className={cn("font-display pr-10 text-xl", hideTitle && "sr-only")}>
          {title}
        </Primitive.Title>
        {description === undefined ? (
          <Primitive.Description className="sr-only">{title}</Primitive.Description>
        ) : (
          <Primitive.Description className="text-slate mt-2">{description}</Primitive.Description>
        )}
        <div className="mt-5 flex-1">{children}</div>
        <CloseButton />
      </Primitive.Content>
    </Primitive.Portal>
  );
}
