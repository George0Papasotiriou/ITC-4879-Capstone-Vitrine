/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Server wiring for the support desk: the store, who may open a ticket, its private link and its emails.
 */

import { connection } from "next/server";

import { serverEnv } from "@/env";
import type { CurrentUser } from "@/lib/auth/session";
import { hashToken, newTicketNumber, ticketLinkToken, tokenMatches } from "@/lib/commerce/tokens";
import { sql } from "@/lib/db/client";
import { appMailer } from "@/lib/email/server";
import { emailLocale, supportUpdate, type SupportEmailKind } from "@/lib/email/templates";
import { logger } from "@/lib/log";
import { createSupportStore, type SupportStore, type Ticket, type TicketSummary } from "@/lib/support/store";

/**
 * Everything here reads the request or the environment, so it runs only in
 * route handlers and server components. The desk's rules are in tickets.ts and
 * its queries in store.ts; neither knows about a request.
 */

let store: SupportStore | undefined;

export async function supportStore(): Promise<SupportStore> {
  await connection();
  return (store ??= createSupportStore(sql));
}

function secret(): string {
  const value = serverEnv().COOKIE_SECRET;
  if (value === undefined) throw new Error("COOKIE_SECRET is not set. `pnpm local` generates one; in production it is required.");
  return value;
}

/** A new ticket's number and the secret that opens it, derived rather than stored. */
export function newTicketIdentity(id: string): { number: string; token: string; accessTokenHash: string } {
  const token = ticketLinkToken(id, secret());
  return { number: newTicketNumber(), token, accessTokenHash: hashToken(token) };
}

/** The token for a ticket that already exists, so an email written later can link to it. */
export function ticketToken(ticketId: string): string {
  return ticketLinkToken(ticketId, secret());
}

export function ticketUrl(ticket: { id: string; locale: string }, { token = true }: { token?: boolean } = {}): string {
  const origin = new URL(serverEnv().APP_URL).origin;
  const locale = emailLocale(ticket.locale);
  const query = token ? `?t=${encodeURIComponent(ticketToken(ticket.id))}` : "";
  return `${origin}/${locale}/support/${ticket.id}${query}`;
}

/**
 * The ticket a request may see: through the link's token when it brings one,
 * otherwise as the account it belongs to. Null for anything else, whatever the
 * reason, so guessing ids or tokens teaches nothing.
 */
export async function accessibleTicket(
  ticketId: string,
  token: string | null | undefined,
  user: CurrentUser | null,
): Promise<Ticket | null> {
  const desk = await supportStore();
  const ticket = await desk.byId(ticketId);
  if (ticket === null) return null;
  if (user !== null && (ticket.userId === user.id || ticket.email === user.email.toLowerCase())) return ticket;
  if (typeof token === "string" && token !== "") {
    const stored = await desk.tokenHash(ticketId);
    if (stored !== null && tokenMatches(token, stored)) return ticket;
  }
  return null;
}

/** The conversations this person can see in their account. */
export async function myTickets(user: CurrentUser | null): Promise<TicketSummary[]> {
  if (user === null) return [];
  return (await supportStore()).forCustomer({ userId: user.id, email: user.email });
}

/**
 * Tells the customer what happened, in the ticket's own language. A failed
 * email is logged, never thrown: the message has already been written, and a
 * broken mailer must not make the desk believe it was not.
 */
export async function notifyTicket(kind: SupportEmailKind, ticket: { id: string; number: string; name: string; email: string; locale: string }): Promise<void> {
  const locale = emailLocale(ticket.locale);
  try {
    await appMailer().sendEmail({
      to: ticket.email,
      kind: `support_${kind}`,
      locale,
      content: supportUpdate(locale, { kind, name: ticket.name, number: ticket.number, url: ticketUrl({ id: ticket.id, locale }) }),
    });
  } catch (error) {
    logger.warn({ err: error, ticket: ticket.number }, "support email not written");
  }
}
