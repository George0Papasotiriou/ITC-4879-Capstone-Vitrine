/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * The support inbox: what is waiting, in the order it should be answered.
 */

import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";

import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { requirePermission } from "@/lib/auth/session";
import { supportStore } from "@/lib/support/server";
import { TICKET_STATUSES, ticketSla, type TicketStatus } from "@/lib/support/tickets";
import { cn } from "@/lib/ui/cn";

/**
 * For "support:work" (support, admin). The queue is ordered by the promise in
 * docs/policies.md: whatever nobody has answered comes first, oldest promise
 * first (docs/adr/021).
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/staff/support">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "staff.support" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

const CLOCK_TONE: Record<string, string> = {
  late: "text-danger",
  soon: "text-dusk",
  due: "text-slate",
  answered: "text-slate",
};

export default async function SupportQueuePage({ params, searchParams }: PageProps<"/[locale]/staff/support">) {
  const locale = await requireLocale(params);
  await requirePermission(locale, `/${locale}/staff/support`, "support:work");

  const query = await searchParams;
  const status = TICKET_STATUSES.find((option) => option === query.status) ?? null;
  const desk = await supportStore();
  const [tickets, counts] = await Promise.all([desk.queue({ status, limit: 50 }), desk.counts()]);

  const t = await getTranslations("staff.support");
  const format = await getFormatter();
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16" data-agent-id="desk:support">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-slate mt-3 max-w-[70ch]">{t("lede")}</p>
        </div>
        <p className="text-slate text-sm" data-agent-id="desk:counts">
          {t("counts", { unanswered: counts.unanswered, late: counts.late })}
        </p>
      </div>

      <nav aria-label={t("filterLabel")} className="mt-8">
        <ul className="flex flex-wrap gap-1">
          {[null, ...TICKET_STATUSES].map((option) => (
            <li key={option ?? "all"}>
              <SmartLink
                href={option === null ? "/staff/support" : `/staff/support?status=${option}`}
                aria-current={option === status ? "page" : undefined}
                className={cn(
                  "rounded-plinth flex h-11 items-center px-4 text-sm whitespace-nowrap no-underline transition-colors",
                  option === status ? "bg-dusk text-glass" : "text-dusk hover:bg-dusk/[0.05]",
                )}
                data-agent-id={`desk:filter:${option ?? "all"}`}
              >
                {option === null ? t("filters.all") : `${t(`statuses.${option}`)} (${counts[option as TicketStatus]})`}
              </SmartLink>
            </li>
          ))}
        </ul>
      </nav>

      {tickets.length === 0 ? (
        <p className="text-slate mt-10">{t("empty")}</p>
      ) : (
        <ul className="border-hairline divide-hairline mt-8 divide-y border-y" data-agent-id="desk:queue">
          {tickets.map((ticket) => {
            const sla = ticketSla(ticket, now);
            return (
              <li key={ticket.id}>
                <SmartLink
                  href={`/staff/support/${ticket.id}`}
                  // On a phone the three parts stack; from small screens up they sit in a row.
                  className="hover:bg-dusk/[0.03] flex flex-col gap-1 py-4 no-underline transition-colors sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4"
                  data-agent-id={`desk:ticket:${ticket.number}`}
                >
                  <span className="tabular text-slate text-sm sm:w-32 sm:shrink-0">{ticket.number}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{ticket.subject}</span>
                    <span className="text-slate text-sm">
                      {ticket.name} · {t(`topics.${ticket.topic}`)} · {t(`statuses.${ticket.status}`)}
                      {ticket.hasDraft ? ` · ${t("draftWaiting")}` : ""}
                    </span>
                  </span>
                  <span className={cn("text-sm sm:shrink-0", CLOCK_TONE[sla.state])} data-agent-id={`desk:sla:${ticket.number}`}>
                    {sla.state === "answered" ? t("answered") : t(`clock.${sla.state}`, { when: format.relativeTime(sla.dueAt, now) })}
                  </span>
                </SmartLink>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
