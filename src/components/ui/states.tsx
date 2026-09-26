/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Loading skeleton, empty state and error state components.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/ui/cn";

/**
 * Loading placeholder. Sized by the caller so the layout does not shift when
 * content arrives — a skeleton that is the wrong size is worse than none.
 *
 * It does not pulse (nothing loops but the listening light, 4.5) and it fades
 * in only after 300ms, so a fast answer never flashes a placeholder first
 * (docs/adr/031).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-plinth animate-appear-late rounded-plinth", className)}
    />
  );
}

/**
 * Empty state (docs/PLAN.md 4.4): says what to do next, and offers the next
 * step as a real action. "No lamps under €20" alone is a dead end;
 * "Show lamps under €50" is a way forward.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-4 py-16 text-center", className)}>
      <p className="font-display text-xl">{title}</p>
      {description !== undefined ? (
        <p className="text-slate max-w-[46ch]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

/**
 * Error state (4.6): says what happened and what to do, without apologising
 * and without an exclamation mark.
 */
export function ErrorState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("animate-rise flex flex-col items-start gap-3 py-8", className)}>
      <p className="text-danger font-medium">{title}</p>
      {description !== undefined ? (
        <p className="text-slate max-w-[60ch]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
