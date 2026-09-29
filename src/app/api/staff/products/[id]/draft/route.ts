/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * A copy draft for the product editor: the Greek from the English, or the English tightened. Nothing is saved here.
 */

import { z } from "zod";

import { serverEnv } from "@/env";
import { draftCopy } from "@/lib/ai/agents/copy-draft";
import { MODELS } from "@/lib/ai/models";
import { textModel } from "@/lib/ai/providers";
import { aiMode, usageStore } from "@/lib/ai/server";
import { authorize } from "@/lib/auth/session";
import { logger } from "@/lib/log";

/**
 * docs/adr/045. For "catalog:edit". The words sent are the ones in the form
 * now, so a draft follows what the person is looking at, not what was last
 * saved. A draft costs money with a key, so it passes the same guard as every
 * AI call (kill switch, daily budget) and is recorded against the person who
 * asked. Without a key there is no draft: rules cannot write copy, and the
 * editor says so.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  task: z.enum(["greek", "tighten"]),
  source: z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(5000),
    highlights: z.array(z.string().max(400)).max(12),
  }),
});

const refuse = (reason: string, status: number) => Response.json({ ok: false, reason }, { status });

export async function POST(request: Request, { params }: RouteContext<"/api/staff/products/[id]/draft">): Promise<Response> {
  const access = await authorize("catalog:edit");
  if (!access.ok) return refuse(access.status === 401 ? "sign_in" : "forbidden", access.status);
  const { id } = await params;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !body.success) return refuse("invalid_request", 400);

  const mode = aiMode();
  if (mode === "off") return refuse("ai_off", 409);
  if (mode === "demo") return refuse("needs_key", 409);
  const usage = await usageStore();
  const gate = await usage.open();
  if (!gate.ok) return refuse("ai_paused", 409);
  const chosen = textModel(mode, MODELS.translation, { locale: body.data.task === "greek" ? "el" : "en", apiKey: serverEnv().GOOGLE_GENERATIVE_AI_API_KEY });
  if (chosen === null) return refuse("needs_key", 409);

  let written;
  try {
    written = await draftCopy({ model: chosen.model, modelId: chosen.entry.id, task: body.data.task, source: body.data.source, abortSignal: request.signal });
  } catch (error) {
    logger.warn({ err: error, product: id }, "copy draft failed");
    return refuse("no_draft", 502);
  }
  if (written === null) return refuse("no_draft", 502);
  const cost = await usage.record({ feature: "copy_draft", model: chosen.entry, surface: "staff", actorKey: `user:${access.user.id}`, usage: written.usage });
  logger.info({ copyDraft: { product: id, task: body.data.task, costMicros: cost } }, "copy draft written");
  return Response.json({ ok: true, task: body.data.task, draft: written.draft, missingFigures: written.missingFigures, model: written.model });
}
