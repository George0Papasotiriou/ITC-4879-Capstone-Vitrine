"use client";

/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Grading one product for one query, by button or by the keys 0–3.
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

type Grade = 0 | 1 | 2 | 3;

/**
 * docs/adr/036. Judging goes quickly when the hands stay on the keyboard: 0, 1,
 * 2 or 3 grades the product on screen and the next one appears. The grade
 * names say what each means, so two people grading the same pair agree.
 */
export function JudgeCard({ query, locale, productId }: { query: string; locale: "en" | "el"; productId: string }) {
  const t = useTranslations("admin.labeling");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const grade = useCallback(
    async (value: Grade) => {
      setPending(true);
      const response = await fetch("/api/admin/judgments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, locale, productId, grade: value }) }).catch(() => null);
      setPending(false);
      setFailed(response?.ok !== true);
      if (response?.ok === true) router.refresh();
    },
    [query, locale, productId, router],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || !["0", "1", "2", "3"].includes(event.key)) return;
      if (event.target instanceof HTMLElement && event.target.matches("input, textarea, select")) return;
      event.preventDefault();
      void grade(Number(event.key) as Grade);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [grade]);

  return (
    <div className="flex flex-col gap-3" data-agent-id="labeling:grades">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {([3, 2, 1, 0] as const).map((value) => (
          <Button key={value} variant={value >= 2 ? "primary" : "secondary"} disabled={pending} onClick={() => void grade(value)} data-agent-id={`labeling:grade:${value}`}>
            <span className="tabular-nums">{value}</span>&nbsp;{t(`grades.${value}.name`)}
          </Button>
        ))}
      </div>
      <p className="text-slate text-xs">{t("keys")}</p>
      {failed ? (
        <p role="alert" className="text-danger text-sm">
          {t("failed")}
        </p>
      ) : null}
    </div>
  );
}
