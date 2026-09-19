/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Links to the staff desks a person's roles allow, as cards.
 */

import { getTranslations } from "next-intl/server";

import { SmartLink } from "@/components/ui/smart-link";
import { desksFor } from "@/lib/admin/desks";
import type { Role } from "@/lib/auth/roles";
import { cn } from "@/lib/ui/cn";

/** Only what the roles allow is shown; the pages check again on the server. */
export async function DeskLinks({ roles, className }: { roles: readonly Role[]; className?: string }) {
  const desks = desksFor(roles);
  if (desks.length === 0) return null;
  const t = await getTranslations("admin.desks");
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {desks.map((desk) => (
        <li key={desk.key}>
          <SmartLink
            href={desk.href}
            className="bg-plinth/60 rounded-plinth hover:bg-plinth flex h-full flex-col gap-1 p-5 no-underline transition-colors"
            data-agent-id={desk.agentId}
          >
            <span className="font-medium">{t(`${desk.key}.title`)}</span>
            <span className="text-slate text-sm">{t(`${desk.key}.lede`)}</span>
          </SmartLink>
        </li>
      ))}
    </ul>
  );
}
