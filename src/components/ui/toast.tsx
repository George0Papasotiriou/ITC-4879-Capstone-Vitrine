"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Toast provider and hook for transient notifications.
 */

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

/**
 * Toasts (docs/PLAN.md 4.4, 4.6).
 *
 * Brief confirmation of something the person did — "Added to cart" — or that
 * failed. Three tones, so the kind of message is carried by the words and a
 * mark, never by colour alone.
 *
 * Deliberately limited:
 * - Errors stay until dismissed. A failed payment that disappears after five
 *   seconds is a failed payment the person may never have seen.
 * - At most three at once. A stack of toasts is noise.
 * - Nothing marketing-shaped: no "Only 2 left", no countdowns (4.8).
 *
 * The Concierge's own actions do not use toasts; they have the Spotlight and the
 * action timeline, which carry undo.
 *
 * Performance: this provider sits in the root layout, so whatever it imports
 * ships on every page. It holds only state and context; the Radix toast
 * primitives (13.7 KB gzipped) live in `toast-layer.tsx` and load the first time
 * a toast is actually shown. Most page views never show one.
 */

export type ToastTone = "neutral" | "success" | "danger";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** A single follow-up, e.g. "View cart". */
  action?: { label: string; onSelect: () => void };
};

export type ToastEntry = ToastInput & { id: number; open: boolean };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (show === null) throw new Error("useToast must be used inside <Toaster>.");
  return show;
}

const MAX_VISIBLE = 3;

const ToastLayer = lazy(() => import("@/components/ui/toast-layer"));

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  // Once loaded, the layer stays mounted so exit animations can finish.
  const [layerNeeded, setLayerNeeded] = useState(false);

  const show = useCallback((input: ToastInput) => {
    setLayerNeeded(true);
    setToasts((current) =>
      [...current, { ...input, id: Date.now() + Math.random(), open: true }].slice(-MAX_VISIBLE),
    );
  }, []);

  const close = useCallback((id: number) => {
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, open: false } : toast)),
    );
    // Drop it after the exit animation has had time to run.
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 300);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {layerNeeded ? (
        <Suspense fallback={null}>
          <ToastLayer toasts={toasts} onClose={close} />
        </Suspense>
      ) : null}
    </ToastContext.Provider>
  );
}
