/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * One ticket at the desk: the conversation with its notes and drafts, and everything an agent can do about it.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { TicketDesk, type DeskMacro } from "@/components/staff/ticket-desk";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { supportStore } from "@/lib/support/server";
import { ticketSla } from "@/lib/support/tickets";
import { cn } from "@/lib/ui/cn";

/**
 * For "support:work". Drafts and internal notes are shown here and nowhere
 * else: the customer's page asks the store for the conversation without them
 * (docs/adr/021).
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/support/[id]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.support" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DeskTicketPage({ params }: PageProps<"/[locale]/staff/support/[id]">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/staff/support`, "support:work");
  const { id } = await params;

  const desk = await supportStore();
  const [ticket, macros] = await Promise.all([desk.byId(id, { withDrafts: true }), desk.macros()]);
  if (ticket === null) notFound();

  const t = await getTranslations("staff.support");
  const format = await getFormatter();
  const sla = ticketSla(ticket);
  const draft = ticket.messages.findLast((message) => message.draft) ?? null;
  const deskMacros: DeskMacro[] = macros.map((macro) => ({
    key: macro.key,
    title: locale === "el" ? macro.titleEl : macro.titleEn,
    body: ticket.locale === "el" ? macro.bodyEl : macro.bodyEn,
  }));

  return (
    <main className="mx-auto w-full max-w-[52rem] px-6 py-10 md:px-10 md:py-16" data-agent-id={`desk:ticket-page:${ticket.number}`}>
      <p className="text-slate text-sm">
        <SmartLink href="/staff/support" className="no-underline hover:underline underline-offset-4">
          {t("backToQueue")}
        </SmartLink>
      </p>

      <h1 className="font-display mt-4 text-3xl">{ticket.subject}</h1>
      <dl className="text-slate mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2" data-agent-id="desk:ticket-facts">
        <div className="flex gap-2">
          <dt>{t("facts.number")}</dt>
          <dd className="text-dusk tabular">{ticket.number}</dd>
        </div>
        <div className="flex gap-2">
          <dt>{t("facts.status")}</dt>
          <dd className="text-dusk">{t(`statuses.${ticket.status}`)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>{t("facts.customer")}</dt>
          <dd className="text-dusk">
            {ticket.name} · {ticket.email}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>{t("facts.topic")}</dt>
          <dd className="text-dusk">{t(`topics.${ticket.topic}`)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>{t("facts.firstReply")}</dt>
          <dd className={cn(sla.state === "late" ? "text-danger" : "text-dusk")} data-agent-id="desk:ticket-sla">
            {sla.state === "answered" ? t(sla.wasLate ? "answeredLate" : "answered") : t(`clock.${sla.state}`, { when: format.relativeTime(sla.dueAt) })}
          </dd>
        </div>
        {ticket.orderId === null ? null : (
          <div className="flex gap-2">
            <dt>{t("facts.order")}</dt>
            <dd>
              <SmartLink href={`/staff/orders/${ticket.orderId}`} className="text-dusk underline underline-offset-4">
                {ticket.orderNumber}
              </SmartLink>
            </dd>
          </div>
        )}
      </dl>

      <ol className="mt-8 flex flex-col gap-4" data-agent-id="desk:conversation">
        {ticket.messages.map((message) => (
          <li
            key={message.id}
            className={cn(
              "rounded-plinth border-hairline border p-4",
              message.draft ? "border-dusk/40 bg-plinth/60" : message.internal ? "bg-plinth/40" : message.author === "customer" ? "bg-glass" : "bg-white",
            )}
            data-agent-id={`desk:message:${message.draft ? "draft" : message.internal ? "note" : message.author}`}
          >
            <p className="text-slate text-xs">
              {message.draft ? t("authors.draft", { source: message.model ?? "" }) : message.internal ? t("authors.note") : t(`authors.${message.author}`)}
              {message.authorEmail === null ? "" : ` · ${message.authorEmail}`} · {format.dateTime(message.createdAt, { dateStyle: "medium", timeStyle: "short" })}
            </p>
            <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{message.body}</p>
          </li>
        ))}
      </ol>

      <TicketDesk
        ticketId={ticket.id}
        status={ticket.status}
        macros={deskMacros}
        customerName={ticket.name}
        ticketNumber={ticket.number}
        orderNumber={ticket.orderNumber}
        draft={draft === null ? null : { id: draft.id, body: draft.body, source: draft.model ?? "" }}
      />
    </main>
  );
}
