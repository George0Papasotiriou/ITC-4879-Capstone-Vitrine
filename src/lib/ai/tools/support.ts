/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Handing a shopper over to a person at the support desk, with a summary they approve first.
 */

import { z } from "zod";

import type { VitrineTool } from "@/lib/ai/tools/types";
import { uiCommandSchema } from "@/lib/ai/ui-commands";
import { FIRST_REPLY_HOURS, TICKET_TOPICS } from "@/lib/support/tickets";

/**
 * The Concierge knows where it stops (docs/adr/027). A damaged delivery, an
 * address to change, a refund that has not arrived: those need a person, and
 * the support desk already has one (ADR-021). This tool is the door between
 * them.
 *
 * It is `sensitive`, so it asks first: the shopper sees the summary that will
 * be sent, word for word, and nothing leaves until they approve it. A
 * signed-in shopper's ticket is opened at once, in their name and with their
 * account's address. A guest has no address the shop could answer, and the
 * model must never be the one to ask for it — so the contact form opens with
 * the summary already written, and the guest types their email into the page,
 * where it never passes through the model.
 */

const define = <I, O>(tool: VitrineTool<I, O>) => tool;
const orderNumber = z.string().trim().toUpperCase().regex(/^VT-[0-9A-Z]{4}-[0-9A-Z]{4}$/, "An order number looks like VT-4JJZ-MPF9");

export const handToPerson = define({
  name: "hand_to_person",
  description:
    "Pass the conversation to a person at the shop's support desk, with a short summary the shopper approves before it is sent. " +
    "Use it when the shopper asks for a person, or needs something no tool can do: a damaged or missing delivery, a changed address, a refund question, a complaint. " +
    "Do not use it for what a tool or the shop's policies already answer, and never without the shopper asking or agreeing. " +
    "Write the summary so a person can act on it without reading the chat, in the shopper's language, with no payment details and no email address.",
  scope: "sensitive",
  input: z.object({
    summary: z.string().trim().min(10).max(600).describe("What the shopper needs, in their own language, in two to four sentences."),
    topic: z.enum(TICKET_TOPICS).describe("The desk's queue: delivery, returns, product, account, payment or other."),
    orderNumber: orderNumber.optional().describe("Only an order number the shopper gave or a tool returned."),
  }),
  // A plain union: two of the answers are refusals, and "ok" alone cannot tell them apart.
  output: z.union([
    z.object({ ok: z.literal(true), ticketId: z.string(), number: z.string(), replyWithinHours: z.number().int() }),
    z.object({ ok: z.literal(false), reason: z.literal("needs_contact"), summary: z.string(), commands: z.array(uiCommandSchema) }),
    z.object({ ok: z.literal(false), reason: z.enum(["slow_down", "failed"]) }),
  ]),
  async run(ctx, { summary, topic, orderNumber: number }) {
    if (ctx.user === null) {
      // The guest writes their address into the form themselves; the summary is waiting there.
      const caption = ctx.locale === "el" ? "Άνοιγμα της φόρμας επικοινωνίας" : "Opening the contact form";
      return { ok: false as const, reason: "needs_contact" as const, summary, commands: [uiCommandSchema.parse({ type: "navigate", href: "/contact", caption })] };
    }
    const result = await ctx.services.support.handOver({ summary, topic, ...(number === undefined ? {} : { orderNumber: number }) });
    if (!result.ok) return { ok: false as const, reason: result.reason };
    return { ok: true as const, ticketId: result.id, number: result.number, replyWithinHours: FIRST_REPLY_HOURS };
  },
});
