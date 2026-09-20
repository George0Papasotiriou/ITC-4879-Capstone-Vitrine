/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One support conversation, as the customer sees it.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { Conversation, type ConversationMessage } from "@/components/support/conversation";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { currentUser } from "@/lib/auth/session";
import { accessibleTicket } from "@/lib/support/server";
import { ticketSla } from "@/lib/support/tickets";

/**
 * A ticket is opened by the account it belongs to, or by the private link in
 * its emails (docs/adr/021). Anything else is a 404: guessing an id or a token
 * teaches nothing.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/support/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "support.ticket" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function TicketPage({ params, searchParams }: PageProps<"/[locale]/support/[id]">) {
  await requireLocale(params);
  const { id } = await params;
  const token = (await searchParams).t;
  const user = await currentUser();
  const ticket = await accessibleTicket(id, typeof token === "string" ? token : null, user);
  if (ticket === null) notFound();

  const t = await getTranslations("support.ticket");
  const format = await getFormatter();
  const sla = ticketSla(ticket);
  const messages: ConversationMessage[] = ticket.messages.map((message) => ({
    id: message.id,
    author: message.author,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  }));

  return (
    <main className="mx-auto w-full max-w-[52rem] px-6 py-10 md:px-10 md:py-16" data-agent-id={`support:ticket:${ticket.number}`}>
      <p className="text-slate text-sm">
        <SmartLink href="/contact" className="no-underline hover:underline underline-offset-4">
          {t("backToContact")}
        </SmartLink>
      </p>
      <h1 className="font-display mt-4 text-3xl">{ticket.subject}</h1>
      <p className="text-slate mt-2 text-sm" data-agent-id="support:state">
        {t("number", { number: ticket.number })} · {t(`statuses.${ticket.status}`)}
        {ticket.orderNumber === null ? null : <> · {t("aboutOrder", { number: ticket.orderNumber })}</>}
      </p>
      {ticket.status === "closed" || sla.state === "answered" ? null : (
        <p className="text-slate mt-1 text-sm" data-agent-id="support:promise">
          {t("promise", { when: format.relativeTime(sla.dueAt) })}
        </p>
      )}

      <Conversation
        ticketId={ticket.id}
        token={typeof token === "string" ? token : null}
        status={ticket.status}
        messages={messages}
        csatScore={ticket.csatScore}
      />
    </main>
  );
}
