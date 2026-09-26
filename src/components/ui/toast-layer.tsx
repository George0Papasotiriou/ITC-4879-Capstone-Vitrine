"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Lazily loaded toast renderer.
 */

import { useTranslations } from "next-intl";
import { Toast as Primitive } from "radix-ui";

import type { ToastEntry, ToastTone } from "@/components/ui/toast";
import { cx } from "@/lib/ui/cx";

/**
 * The rendered toasts, loaded on demand by `Toaster` the first time one is
 * shown, so the Radix primitives are not part of every page's JavaScript.
 */
export default function ToastLayer({
  toasts,
  onClose,
}: {
  toasts: readonly ToastEntry[];
  onClose: (id: number) => void;
}) {
  return (
    <Primitive.Provider swipeDirection="down" duration={5000}>
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onOpenChange={(open) => {
            if (!open) onClose(toast.id);
          }}
        />
      ))}
      <Primitive.Viewport
        className={cx(
          "fixed z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none",
          // Above the mobile bar on phones; bottom-right from tablet up.
          "bottom-16 left-1/2 -translate-x-1/2 md:bottom-0 md:left-auto md:right-0 md:translate-x-0",
        )}
      />
    </Primitive.Provider>
  );
}

function ToastItem({
  toast,
  onOpenChange,
}: {
  toast: ToastEntry;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("common");
  const tone = toast.tone ?? "neutral";

  return (
    <Primitive.Root
      open={toast.open}
      onOpenChange={onOpenChange}
      // Errors persist: an unread failure is worse than a toast left on screen.
      duration={tone === "danger" ? Infinity : 5000}
      // Failures interrupt a screen reader; confirmations wait their turn.
      type={tone === "danger" ? "foreground" : "background"}
      className="bg-glass shadow-sheet rounded-sheet animate-toast relative flex touch-none items-start gap-3 p-4 pr-12"
    >
      <ToneMark tone={tone} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Primitive.Title className="text-sm font-medium">{toast.title}</Primitive.Title>
        {toast.description === undefined ? null : (
          <Primitive.Description className="text-slate text-sm">
            {toast.description}
          </Primitive.Description>
        )}
        {toast.action === undefined ? null : (
          <Primitive.Action
            altText={toast.action.label}
            onClick={toast.action.onSelect}
            className="text-dusk mt-1 cursor-pointer self-start text-sm underline underline-offset-4"
          >
            {toast.action.label}
          </Primitive.Action>
        )}
      </div>
      <Primitive.Close
        aria-label={t("dismiss")}
        className="text-slate hover:text-dusk absolute top-2 right-2 inline-flex size-9 cursor-pointer items-center justify-center rounded-plinth"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
        </svg>
      </Primitive.Close>
    </Primitive.Root>
  );
}

function ToneMark({ tone }: { tone: ToastTone }) {
  if (tone === "success") {
    return (
      <svg viewBox="0 0 24 24" className="text-success mt-0.5 size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m5 12 5 5 9-10" pathLength={24} strokeLinecap="round" strokeLinejoin="round" className="animate-draw" />
      </svg>
    );
  }
  if (tone === "danger") {
    return (
      <svg viewBox="0 0 24 24" className="text-danger mt-0.5 size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5v.01" strokeLinecap="round" />
      </svg>
    );
  }
  return <span className="bg-slate mt-2 size-1.5 shrink-0 rounded-full" aria-hidden="true" />;
}
