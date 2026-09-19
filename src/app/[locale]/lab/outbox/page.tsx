/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * Email outbox: every email the shop has sent, for the local stack and for admins.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { requireLocale } from "@/i18n/params";
import { can } from "@/lib/auth/roles";
import { currentUser } from "@/lib/auth/session";
import { firstLink } from "@/lib/email/mailer";
import { appMailer, outboxIsOpen } from "@/lib/email/server";

/**
 * Until an email provider is connected, this page is where the shop's emails
 * arrive (docs/adr/016): open the confirmation link from here to finish a
 * sign-up on the local stack. The emails hold one-time links, so outside the
 * local stack only an admin may read it; anyone else gets a 404.
 */

export async function generateMetadata({ params }: PageProps<"/[locale]/lab/outbox">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "outbox" });
  return { title: t("title"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export const dynamic = "force-dynamic";

export default async function OutboxPage({ params }: PageProps<"/[locale]/lab/outbox">) {
  await requireLocale(params);
  if (!outboxIsOpen()) {
    const user = await currentUser();
    if (user === null || !can(user.roles, "outbox:read")) notFound();
  }

  const t = await getTranslations("outbox");
  const format = await getFormatter();
  const emails = await appMailer().recent({ limit: 50 });

  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10 md:px-10 md:py-16">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <p className="text-slate mt-4 max-w-[70ch]">{t("lede")}</p>
      {emails.length === 0 ? (
        <p className="mt-10">{t("empty")}</p>
      ) : (
        <ol className="mt-10 flex flex-col gap-6" data-agent-id="outbox:list">
          {emails.map((email) => {
            const link = firstLink(email.text);
            return (
              <li key={email.id} className="border-hairline rounded-plinth border bg-white p-5" data-agent-id={`outbox:email:${email.kind}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <h2 className="font-medium">{email.subject}</h2>
                  <span className="text-slate text-sm tabular">{format.dateTime(email.createdAt, { dateStyle: "medium", timeStyle: "medium" })}</span>
                </div>
                <p className="text-slate mt-1 text-sm" data-agent-id="outbox:to">
                  {t("to", { address: email.to })} · {email.kind} · {email.locale}
                </p>
                {email.transport === "resend" ? (
                  <p className="mt-1 text-sm">{email.error === null ? t("delivered") : t("failed", { error: email.error })}</p>
                ) : null}
                <pre className="bg-plinth/60 rounded-plinth mt-4 max-h-64 overflow-auto p-4 text-sm leading-relaxed whitespace-pre-wrap">{email.text}</pre>
                {link !== null ? (
                  <p className="mt-4">
                    <a href={link} className="font-medium underline underline-offset-4" rel="noreferrer" data-agent-id="outbox:link">
                      {t("openLink")}
                    </a>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
