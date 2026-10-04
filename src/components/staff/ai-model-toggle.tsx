"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Hide an AI 3D model from shoppers, or show it.
 */

import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";

export function AiModelToggle({ id, shown }: { id: string; shown: boolean }) {
  const t = useTranslations("staff.models");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const send = () =>
    !pending &&
    startTransition(async () => {
      const response = await fetch(`/api/staff/models/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shown: !shown }) }).catch(() => null);
      const result = (await response?.json().catch(() => null)) as { ok: boolean } | null;
      toast(result?.ok === true ? { title: shown ? t("hidden") : t("shown") } : { title: t("failed"), tone: "danger" });
      router.refresh();
    });
  return (
    <Button variant="secondary" size="sm" disabled={!hydrated} aria-disabled={pending} onClick={send} data-agent-id={`staff:model-${shown ? "hide" : "show"}:${id}`}>
      {shown ? t("hide") : t("show")}
    </Button>
  );
}
