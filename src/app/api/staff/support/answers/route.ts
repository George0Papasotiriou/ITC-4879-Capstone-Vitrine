/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The desk's ready answers: saving one, putting the shop's words back, and removing one the desk wrote.
 */

import { z } from "zod";

import { authorize } from "@/lib/auth/session";
import { answerInputSchema } from "@/lib/support/answers";
import { DEFAULT_MACROS } from "@/lib/support/macros";
import { supportStore } from "@/lib/support/server";

/**
 * docs/adr/029. The people who work the desk own its words, so the same
 * permission that answers tickets edits the answers; every change is on the
 * audit log under the person who made it.
 */

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.uuid().nullable(), answer: z.unknown() }),
  z.object({ action: z.literal("restore"), id: z.uuid() }),
  z.object({ action: z.literal("remove"), id: z.uuid() }),
]);

export type AnswersResponse =
  | { ok: true; id?: string; changed?: readonly string[] }
  | { ok: false; reason: "sign_in" | "forbidden" | "invalid_request" | "not_found" | "not_shipped" | "shipped" }
  | { ok: false; reason: "invalid_answer"; fields: Record<string, string> };

const refuse = (reason: "sign_in" | "forbidden" | "invalid_request" | "not_found" | "not_shipped" | "shipped", status: number) =>
  Response.json({ ok: false, reason } satisfies AnswersResponse, { status });

export async function POST(request: Request): Promise<Response> {
  const access = await authorize("support:work");
  if (!access.ok) return refuse(access.status === 401 ? "sign_in" : "forbidden", access.status);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("invalid_request", 400);

  const actor = { userId: access.user.id, email: access.user.email };
  const desk = await supportStore();
  const body = parsed.data;

  if (body.action === "save") {
    const answer = answerInputSchema.safeParse(body.answer);
    if (!answer.success) {
      // One message per field, so the form can say what to fix next to it.
      const fields: Record<string, string> = {};
      for (const issue of answer.error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
      return Response.json({ ok: false, reason: "invalid_answer", fields } satisfies AnswersResponse, { status: 400 });
    }
    const saved = await desk.saveMacro(body.id, answer.data, actor);
    if (!saved.ok) return refuse(saved.reason, 404);
    return Response.json({ ok: true, id: saved.id, changed: saved.changed } satisfies AnswersResponse);
  }

  const result = body.action === "restore" ? await desk.restoreMacro(body.id, DEFAULT_MACROS, actor) : await desk.removeMacro(body.id, DEFAULT_MACROS, actor);
  if (!result.ok) return refuse(result.reason, result.reason === "not_found" ? 404 : 409);
  return Response.json({ ok: true } satisfies AnswersResponse);
}
