"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The two switches that govern AI spending: the kill switch and the shop's daily budget.
 */

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";

/**
 * For "ai:manage" (admins). Both changes are recorded in the audit log by the
 * route, because they affect what the shop spends and whether the Concierge
 * answers at all (docs/adr/020).
 */
export function AiSettings({ killSwitch, dailyBudgetEur }: { killSwitch: boolean; dailyBudgetEur: number }) {
  const t = useTranslations("admin.ai");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (body: Record<string, unknown>) => {
    if (pending) return;
    setPending(true);
    const response = await fetch("/api/admin/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok: boolean } | null;
    setPending(false);
    if (result?.ok !== true) {
      setError(t("failed"));
      return;
    }
    setError(null);
    toast({ title: t("saved"), tone: "success" });
    router.refresh();
  };

  const saveBudget = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(String(new FormData(event.currentTarget).get("budget") ?? "").replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      setError(t("budgetInvalid"));
      return;
    }
    void send({ dailyBudgetEur: value });
  };

  return (
    <div className="flex flex-col gap-6" data-agent-id="admin:ai-settings">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant={killSwitch ? "primary" : "danger"}
          disabled={!hydrated}
          aria-disabled={pending}
          onClick={() => void send({ killSwitch: !killSwitch })}
          data-agent-id="admin:ai-kill-switch"
        >
          {killSwitch ? t("resume") : t("stop")}
        </Button>
        <p className="text-slate text-sm" data-agent-id="admin:ai-state">
          {killSwitch ? t("stopped") : t("running")}
        </p>
      </div>

      <form onSubmit={saveBudget} className="flex flex-wrap items-end gap-3">
        <Field label={t("budget")} name="budget" inputMode="decimal" defaultValue={dailyBudgetEur.toFixed(2)} hint={t("budgetHint")} className="max-w-[12rem]" data-agent-id="admin:ai-budget" />
        <Button type="submit" variant="secondary" disabled={!hydrated} aria-disabled={pending} data-agent-id="admin:ai-budget-save">
          {t("save")}
        </Button>
      </form>

      {error === null ? null : (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
