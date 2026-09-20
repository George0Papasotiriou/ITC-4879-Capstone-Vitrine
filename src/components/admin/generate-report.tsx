"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * "Generate now" for the weekly report, with the wait that follows it.
 */

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";

/**
 * The report is built by a job, so the answer here is "asked for", not
 * "ready" (docs/adr/020). The page refreshes a few seconds later, by which
 * time a week's figures are normally written; if it is not there yet, the
 * admin refreshes again rather than the button pretending to wait.
 */
const REFRESH_AFTER_MS = 4_000;

export function GenerateReport() {
  const t = useTranslations("admin.dashboard.reports");
  const toast = useToast();
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);

  const generate = async () => {
    if (pending) return;
    setPending(true);
    const response = await fetch("/api/admin/reports", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok: boolean } | null;
    if (result?.ok !== true) {
      setPending(false);
      toast({ title: t("failed"), tone: "danger" });
      return;
    }
    toast({ title: t("started"), tone: "success" });
    window.setTimeout(() => {
      setPending(false);
      router.refresh();
    }, REFRESH_AFTER_MS);
  };

  return (
    <Button variant="secondary" disabled={!hydrated} aria-disabled={pending} onClick={() => void generate()} data-agent-id="action:generate-report">
      {pending ? t("generating") : t("generate")}
    </Button>
  );
}
