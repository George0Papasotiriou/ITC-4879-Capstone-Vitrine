/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The customer's side of the support desk: writing in, replying, and answering the one question at the end.
 */

import { z } from "zod";

import { routing } from "@/i18n/routing";
import { guessTopic } from "@/lib/ai/agents/support-draft";
import { createRateLimiter } from "@/lib/ai/guardrails/rate-limit";
import { currentUser } from "@/lib/auth/session";
import { commerce, orderOwner } from "@/lib/commerce/server";
import { clientAddress } from "@/lib/geo/ip-country";
import { accessibleTicket, newTicketIdentity, notifyTicket, supportStore, ticketUrl } from "@/lib/support/server";
import { MAX_MESSAGE_LENGTH, TICKET_TOPICS } from "@/lib/support/tickets";
import { uuidv7 } from "uuidv7";

/**
 * Anyone can write to the desk, with or without an account (docs/adr/021).
 * A guest gets a private link by email, derived from the ticket id and the
 * server's secret, and only its hash is stored — the same shape as a guest
 * order's link (ADR-016).
 *
 * The desk is a place people can write anything, so: a rate limit per address,
 * a length limit, and nothing from the message is ever used as an instruction.
 */

export const runtime = "nodejs";

/** A handful of tickets an hour from one address is plenty for a shop this size. */
const perAddress = createRateLimiter({ limit: 6, windowMs: 60 * 60 * 1000 });
/** Replies are cheaper, but still not unlimited. */
const repliesPerAddress = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });

const message = z.string().trim().min(2, "too_short").max(MAX_MESSAGE_LENGTH, "too_long");

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    name: z.string().trim().min(1).max(120),
    email: z.email().max(200),
    subject: z.string().trim().max(120).optional(),
    body: message,
    topic: z.enum(TICKET_TOPICS).optional(),
    orderNumber: z.string().trim().max(20).optional(),
    locale: z.enum(routing.locales).catch(routing.defaultLocale),
  }),
  z.object({ action: z.literal("reply"), ticketId: z.uuid(), token: z.string().max(200).optional(), body: message }),
  z.object({
    action: z.literal("rate"),
    ticketId: z.uuid(),
    token: z.string().max(200).optional(),
    score: z.number().int().min(1).max(5),
    comment: z.string().trim().max(500).optional(),
  }),
]);

export type SupportResponse =
  | { ok: true; ticketId: string; number: string; url: string }
  | { ok: true }
  | { ok: false; reason: "invalid_request" | "slow_down" | "not_found" | "closed" | "failed" };

const refuse = (reason: "invalid_request" | "slow_down" | "not_found" | "closed" | "failed", status: number) =>
  Response.json({ ok: false, reason } satisfies SupportResponse, { status });

export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("invalid_request", 400);
  const body = parsed.data;
  const address = clientAddress(request.headers) ?? "unknown";
  const user = await currentUser();
  const desk = await supportStore();

  if (body.action === "open") {
    if (!perAddress(address)) return refuse("slow_down", 429);
    // A signed-in customer writes as themselves, whatever the form says.
    const email = user?.email ?? body.email.toLowerCase();
    const name = user?.name ?? body.name;

    // An order number is accepted only when it is one of this person's own.
    let orderId: string | null = null;
    if (body.orderNumber !== undefined && body.orderNumber !== "") {
      const store = await commerce();
      const mine = user === null ? [] : await store.ordersForOwner(orderOwner(user), 50);
      orderId = mine.find((order) => order.number.toUpperCase() === body.orderNumber!.toUpperCase())?.id ?? null;
    }

    const id = uuidv7();
    const identity = newTicketIdentity(id);
    const ticket = await desk.open({
      id,
      number: identity.number,
      subject: body.subject === undefined || body.subject === "" ? null : body.subject,
      body: body.body,
      topic: body.topic ?? guessTopic(`${body.subject ?? ""} ${body.body}`),
      locale: body.locale,
      email,
      name,
      userId: user?.id ?? null,
      orderId,
      accessTokenHash: identity.accessTokenHash,
    });

    await notifyTicket("received", { id: ticket.id, number: ticket.number, name, email, locale: body.locale });
    return Response.json({
      ok: true,
      ticketId: ticket.id,
      number: ticket.number,
      url: ticketUrl({ id: ticket.id, locale: body.locale }),
    } satisfies SupportResponse);
  }

  // Replying and rating both need the ticket to be this person's, by account or by link.
  const ticket = await accessibleTicket(body.ticketId, body.token, user);
  if (ticket === null) return refuse("not_found", 404);

  if (body.action === "reply") {
    if (!repliesPerAddress(address)) return refuse("slow_down", 429);
    const result = await desk.addMessage(ticket.id, { author: "customer", authorUserId: user?.id ?? null, body: body.body });
    if (!result.ok) return refuse(result.reason === "closed" ? "closed" : "not_found", result.reason === "closed" ? 409 : 404);
    return Response.json({ ok: true } satisfies SupportResponse);
  }

  const saved = await desk.saveSatisfaction(ticket.id, body.score, body.comment ?? null);
  return saved ? Response.json({ ok: true } satisfies SupportResponse) : refuse("failed", 409);
}
