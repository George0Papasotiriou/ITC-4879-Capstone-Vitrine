/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The desk's side of a ticket: replies, notes, AI drafts, the state of the conversation and who has it.
 */

import { z } from "zod";

import { draftReply } from "@/lib/ai/agents/support-draft";
import { MODELS } from "@/lib/ai/models";
import { textModel } from "@/lib/ai/providers";
import { aiMode, usageStore } from "@/lib/ai/server";
import { authorize } from "@/lib/auth/session";
import { emailLocale } from "@/lib/email/templates";
import { logger } from "@/lib/log";
import { notifyTicket, supportStore } from "@/lib/support/server";
import { MAX_MESSAGE_LENGTH } from "@/lib/support/tickets";
import { serverEnv } from "@/env";

/**
 * Everything here needs "support:work" (support and admin). A draft is written
 * by the model and stored as a message nobody outside the desk can see; it
 * becomes a reply only when an agent sends it, and then it is the agent's
 * message (docs/adr/021).
 */

export const runtime = "nodejs";

const body = z.string().trim().min(2).max(MAX_MESSAGE_LENGTH);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), body }),
  z.object({ action: z.literal("note"), body }),
  z.object({ action: z.literal("draft") }),
  z.object({ action: z.literal("send_draft"), messageId: z.uuid(), body }),
  z.object({ action: z.literal("discard_draft"), messageId: z.uuid() }),
  z.object({ action: z.literal("move"), event: z.enum(["resolve", "close", "reopen"]) }),
  z.object({ action: z.literal("assign"), to: z.union([z.uuid(), z.null()]) }),
]);

export type DeskResponse =
  | { ok: true; draft?: { id: string; body: string; source: string } }
  | { ok: false; reason: "sign_in" | "forbidden" | "invalid_request" | "not_found" | "closed" | "not_allowed" | "ai_off" | "ai_paused" | "no_draft" };

const refuse = (reason: Extract<DeskResponse, { ok: false }>["reason"], status: number) => Response.json({ ok: false, reason } satisfies DeskResponse, { status });

export async function POST(request: Request, context: RouteContext<"/api/staff/support/[id]">): Promise<Response> {
  const access = await authorize("support:work");
  if (!access.ok) return refuse(access.status === 401 ? "sign_in" : "forbidden", access.status);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("invalid_request", 400);
  const { id } = await context.params;

  const desk = await supportStore();
  const ticket = await desk.byId(id, { withDrafts: true });
  if (ticket === null) return refuse("not_found", 404);
  const agent = access.user;
  const action = parsed.data;

  if (action.action === "reply" || action.action === "note") {
    const internal = action.action === "note";
    const result = await desk.addMessage(ticket.id, { author: internal ? "system" : "agent", authorUserId: agent.id, body: action.body, internal });
    if (!result.ok) return refuse(result.reason === "closed" ? "closed" : "not_found", result.reason === "closed" ? 409 : 404);
    if (!internal) await notifyTicket("reply", ticket);
    return Response.json({ ok: true } satisfies DeskResponse);
  }

  if (action.action === "send_draft") {
    const result = await desk.sendDraft(action.messageId, { body: action.body, agentUserId: agent.id });
    if (!result.ok) return refuse(result.reason === "closed" ? "closed" : "not_found", result.reason === "closed" ? 409 : 404);
    await notifyTicket("reply", ticket);
    return Response.json({ ok: true } satisfies DeskResponse);
  }

  if (action.action === "discard_draft") {
    return (await desk.discardDraft(action.messageId)) ? Response.json({ ok: true } satisfies DeskResponse) : refuse("not_found", 404);
  }

  if (action.action === "move") {
    const result = await desk.move(ticket.id, action.event);
    if (!result.ok) return refuse(result.reason === "not_found" ? "not_found" : "not_allowed", result.reason === "not_found" ? 404 : 409);
    // Closing asks the one question; the other moves are the desk's own business.
    if (result.status === "closed") await notifyTicket("closed", ticket);
    return Response.json({ ok: true } satisfies DeskResponse);
  }

  if (action.action === "assign") {
    return (await desk.assign(ticket.id, action.to)) ? Response.json({ ok: true } satisfies DeskResponse) : refuse("not_found", 404);
  }

  // A draft costs money when a key is set, so it goes through the same guard as every other AI call.
  const mode = aiMode();
  if (mode === "off") return refuse("ai_off", 409);
  const usage = await usageStore();
  const gate = await usage.open();
  if (!gate.ok) return refuse("ai_paused", 409);

  const chosen = textModel(mode, MODELS.support, { locale: emailLocale(ticket.locale), apiKey: serverEnv().GOOGLE_GENERATIVE_AI_API_KEY });
  const macros = await desk.macros();
  const written = await draftReply({
    model: mode === "demo" ? null : (chosen?.model ?? null),
    modelId: chosen?.entry.id ?? "macros",
    context: {
      locale: emailLocale(ticket.locale),
      ticket: {
        number: ticket.number,
        subject: ticket.subject,
        name: ticket.name,
        topic: ticket.topic,
        orderNumber: ticket.orderNumber,
        status: ticket.status,
        locale: ticket.locale,
      },
    },
    messages: ticket.messages.filter((entry) => !entry.draft && !entry.internal).map((entry) => ({ author: entry.author, body: entry.body })),
    macros,
  });
  if (written === null) return refuse("no_draft", 409);

  if (written.source !== "macros" && chosen !== null) {
    // The agent is the actor: a draft is spent on their behalf, not a shopper's.
    const cost = await usage.record({ feature: "support_draft", model: chosen.entry, surface: "support", actorKey: `user:${agent.id}`, usage: written.usage });
    logger.info({ support: { ticket: ticket.number, costMicros: cost } }, "support draft written");
  }

  const stored = await desk.addMessage(ticket.id, { author: "ai", authorUserId: null, body: written.body, draft: true, model: written.source });
  if (!stored.ok) return refuse(stored.reason === "closed" ? "closed" : "not_found", stored.reason === "closed" ? 409 : 404);
  return Response.json({ ok: true, draft: { id: stored.messageId, body: written.body, source: written.source } } satisfies DeskResponse);
}
