"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The button that opens the Concierge, in the header on wide screens and in the mobile bar on phones.
 */

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { useConciergeShell } from "@/components/concierge/concierge-shell";
import { cn } from "@/lib/ui/cn";

export function ConciergeToggle({ className, children, agentId = "nav:concierge" }: { className?: string; children: ReactNode; agentId?: string }) {
  const t = useTranslations("concierge");
  const { open, setOpen, warm } = useConciergeShell();
  return (
    <button type="button" onClick={() => setOpen(!open)} onPointerEnter={warm} onFocus={warm} aria-expanded={open} aria-label={open ? t("close") : t("open")} className={cn(className)} data-agent-id={agentId}>
      {children}
    </button>
  );
}
