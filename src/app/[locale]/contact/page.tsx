/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Contact page: what the shop is, and the form that writes to the support desk.
 */

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { InfoPage } from "@/components/shell/info-page";
import { SupportForm } from "@/components/support/support-form";
import { SmartLink } from "@/components/ui/smart-link";
import { requireLocale } from "@/i18n/params";
import { routing } from "@/i18n/routing";
import { currentUser } from "@/lib/auth/session";
import { myTickets } from "@/lib/support/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/contact">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages" });
  return {
    title: t("contactTitle"),
    alternates: {
      canonical: `/${locale}/contact`,
      languages: Object.fromEntries(routing.locales.map((candidate) => [candidate, `/${candidate}/contact`])),
    },
  };
}

/** The form writes to the desk, so this page is rendered for the person asking. */

export default async function ContactPage({ params }: PageProps<"/[locale]/contact">) {
  await requireLocale(params);
  const t = await getTranslations("pages");
  const s = await getTranslations("support");
  const user = await currentUser();
  const tickets = await myTickets(user);

  return (
    <InfoPage title={t("contactTitle")} intro={t("contactIntro")}>
      <p>{t("contactBody")}</p>

      <SupportForm signedIn={user !== null} name={user?.name ?? null} email={user?.email ?? null} />

      {tickets.length === 0 ? null : (
        <section aria-labelledby="my-tickets" className="mt-12">
          <h2 id="my-tickets" className="font-display text-dusk text-xl">
            {s("mine.title")}
          </h2>
          <ul className="border-hairline divide-hairline mt-4 divide-y border-y" data-agent-id="support:mine">
            {tickets.map((ticket) => (
              <li key={ticket.id} className="py-3">
                <SmartLink href={`/support/${ticket.id}`} className="text-dusk no-underline hover:underline underline-offset-4" data-agent-id={`support:mine:${ticket.number}`}>
                  {ticket.subject}
                </SmartLink>
                <p className="text-slate text-sm">
                  {ticket.number} · {s(`ticket.statuses.${ticket.status}`)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </InfoPage>
  );
}
