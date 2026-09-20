/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The AI switches: an admin stops every AI feature, or changes the shop's daily budget; both are audited.
 */

import { z } from "zod";

import { recordAudit } from "@/lib/admin/audit";
import { BUDGET_SETTING, KILL_SWITCH_SETTING } from "@/lib/ai/usage";
import { usageStore } from "@/lib/ai/server";
import { authorize } from "@/lib/auth/session";
import { sql } from "@/lib/db/client";
import { logger } from "@/lib/log";

/**
 * For "ai:manage" (admins). The kill switch pauses the Concierge and every
 * other AI feature at once; the shop keeps working without them (docs/adr/019).
 */

export const runtime = "nodejs";

const bodySchema = z
  .object({ killSwitch: z.boolean().optional(), dailyBudgetEur: z.number().min(0).max(1000).optional() })
  .refine((body) => body.killSwitch !== undefined || body.dailyBudgetEur !== undefined, { message: "nothing_to_change" });

export async function POST(request: Request): Promise<Response> {
  const access = await authorize("ai:manage");
  if (!access.ok) return Response.json({ ok: false, reason: access.status === 401 ? "sign_in" : "forbidden" }, { status: access.status });

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });

  const usage = await usageStore();
  const before = await usage.settings();
  const actor = { userId: access.user.id, email: access.user.email };

  if (body.data.killSwitch !== undefined) {
    await usage.setSetting(KILL_SWITCH_SETTING, body.data.killSwitch, "Set from the AI page");
    await recordAudit(sql, {
      actor,
      action: "ai.settings",
      entityType: "setting",
      entityId: KILL_SWITCH_SETTING,
      changes: { killSwitch: { before: before.killSwitch, after: body.data.killSwitch } },
    });
  }
  if (body.data.dailyBudgetEur !== undefined) {
    await usage.setSetting(BUDGET_SETTING, body.data.dailyBudgetEur, "Set from the AI page");
    await recordAudit(sql, {
      actor,
      action: "ai.settings",
      entityType: "setting",
      entityId: BUDGET_SETTING,
      changes: { dailyBudgetEur: { before: before.dailyBudgetMicros / 1_000_000, after: body.data.dailyBudgetEur } },
    });
  }

  logger.warn({ ai: { killSwitch: body.data.killSwitch, budget: body.data.dailyBudgetEur, staff: actor.userId } }, "AI settings changed");
  return Response.json({ ok: true });
}
