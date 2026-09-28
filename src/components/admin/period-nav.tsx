/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The 7 / 30 / 90-day choice at the top of a dashboard.
 */

import { getTranslations } from "next-intl/server";

import { SmartLink } from "@/components/ui/smart-link";
import { PERIODS, type PeriodDays } from "@/lib/admin/metrics";
import { cn } from "@/lib/ui/cn";

export async function PeriodNav({ base, days, agentPrefix }: { base: string; days: PeriodDays; agentPrefix: string }) {
  const d = await getTranslations("admin.dashboard");
  return (
    <nav aria-label={d("periodLabel")}>
      <ul className="flex gap-1">
        {PERIODS.map((option) => (
          <li key={option}>
            <SmartLink
              href={`${base}?days=${option}`}
              aria-current={option === days ? "page" : undefined}
              className={cn("rounded-plinth flex h-11 items-center px-4 text-sm whitespace-nowrap no-underline transition-colors", option === days ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]")}
              data-agent-id={`${agentPrefix}:period:${option}`}
            >
              {d(`periods.${option}`)}
            </SmartLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
