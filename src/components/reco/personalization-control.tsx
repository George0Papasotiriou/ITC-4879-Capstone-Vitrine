"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Opt-in control for personal recommendations, including forget my history.
 */

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "@/i18n/navigation";

/**
 * The opt-in for personal recommendations (docs/PLAN.md 2.8, CLAUDE.md rule 9).
 *
 * Off by default. Turning it on creates an anonymous id; turning it off stops
 * recording; "Forget my history" deletes what was recorded. Each action
 * refreshes the page, so shelves change in front of the shopper and the choice
 * is visibly real.
 */
export function PersonalizationControl({ enabled, compact = false }: { enabled: boolean; compact?: boolean }) {
  const t = useTranslations("personalization");
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState(enabled);

  const act = (action: "enable" | "disable" | "forget") => {
    startTransition(async () => {
      const response = await fetch("/api/personalization", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }).catch(() => null);
      if (response === null || !response.ok) {
        toast({ title: t("failed"), tone: "danger" });
        return;
      }
      setState(action === "enable");
      toast({ title: action === "enable" ? t("enabled") : action === "disable" ? t("disabled") : t("forgotten"), tone: "success" });
      router.refresh();
    });
  };

  return (
    <div className={compact ? "flex flex-wrap items-center gap-3" : "flex flex-col gap-4"} data-agent-id="control:personalization">
      {compact ? null : <p className="text-slate max-w-[60ch] text-sm">{state ? t("on") : t("off")}</p>}
      <div className="flex flex-wrap gap-3">
        {state ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => act("disable")} aria-disabled={pending || undefined}>
              {t("disable")}
            </Button>
            <Button variant="tertiary" size="sm" onClick={() => act("forget")} aria-disabled={pending || undefined}>
              {t("forget")}
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => act("enable")} aria-disabled={pending || undefined}>
            {t("enable")}
          </Button>
        )}
      </div>
    </div>
  );
}
